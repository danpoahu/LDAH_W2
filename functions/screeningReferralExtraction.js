"use strict";

/* Lions Club school screening referral forms → structured intake data.
 *
 * Two forms, both one page of US Letter, both handwritten:
 *
 *   VISION  — "District 50 Hawaii Lions, Vision Screening Program - Protocol # 3,
 *             Parent Consent and Screening Results Form" (Rev. 1/15/26)
 *   HEARING — "D50 Hawaii-Lions, Hearing Screening Consent, Results & Referral
 *             Form" (Rev. 7/21/25)
 *
 * They are NOT interchangeable and the difference decides what we may do next:
 *
 *   - The VISION consent names LDAH explicitly ("LDAH (vendor for the Department
 *     of Health (DOH) for referral, follow-up, and reporting purposes)") and
 *     collects the parent's printed name, email and cell. A vision referral is
 *     actionable on arrival.
 *   - The HEARING consent names only the child's doctor, audiologist, school and
 *     the Lions Club — NOT LDAH — and collects no parent contact at all, only a
 *     signature. A hearing referral cannot be acted on without more information,
 *     which is why parentEmail/parentPhone are nullable and the caller queues
 *     rather than contacting.
 *
 * Only REFERRED children reach LDAH; a pass is kept by the school. We still
 * extract the outcome, because a batch occasionally includes a pass by mistake
 * and silently opening a case for a child who passed would be worse than
 * refusing the page.
 */

const SCREENING_REFERRAL_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    formType: {
      type: "string",
      enum: ["vision", "hearing"],
      description:
        "Which Lions form this page is. 'vision' says 'Vision Screening Program - Protocol # 3'; " +
        "'hearing' says 'Hearing Screening Consent, Results & Referral Form'.",
    },
    childName: {
      type: ["string", "null"],
      description:
        "The child's full legal name as written on the 'Dear Parents/Guardian of' line. " +
        "Transcribe the handwriting exactly; do not correct spelling or expand a nickname. " +
        "Null if the line is blank or genuinely illegible.",
    },
    childAge: {
      type: ["string", "null"],
      description:
        "VISION only: the age CIRCLED on the 'Pre K & K' line (2, 3, 4, 5 or 6+). " +
        "Null if nothing is circled or this is a hearing form.",
    },
    grade: {
      type: ["string", "null"],
      description:
        "Grade level. On the vision form this is CIRCLED on the 'Grade:' line (1, 2, 3, 5, 7 or 10); " +
        "on the hearing form it is handwritten in the 'Grade' blank. Use 'K' for kindergarten, " +
        "'PreK' for pre-kindergarten. Null if blank.",
    },
    room: {
      type: ["string", "null"],
      description: "Classroom, from the 'Rm.' or 'Room' blank. Null if blank.",
    },
    teacherName: {
      type: ["string", "null"],
      description: "VISION only: the 'Teacher Name' blank, top right. Null if blank or hearing form.",
    },
    schoolName: {
      type: ["string", "null"],
      description:
        "The school the screening took place at, from the 'at ______' blank (vision) or " +
        "'will conduct a free hearing screening at ______ School' (hearing). Null if blank.",
    },
    screeningDate: {
      type: ["string", "null"],
      description:
        "The date the screening happened, from the 'on ______' blank, as YYYY-MM-DD. " +
        "This is NOT the parent's signature date and NOT the 'form is due' date. " +
        "If the year is omitted, infer it from today's date given in the system prompt, " +
        "choosing the most recent PAST occurrence — a screening has already happened. " +
        "Null if no screening date is written.",
    },
    consentSigned: {
      type: "boolean",
      description:
        "True if there is a parent/guardian signature on the signature line. A mark, initials or " +
        "a written name all count. False if the line is empty.",
    },
    consentDate: {
      type: ["string", "null"],
      description: "The date written beside the parent signature, as YYYY-MM-DD. Null if blank.",
    },
    parentName: {
      type: ["string", "null"],
      description:
        "VISION only: the 'Print Parent/Guardian Name' blank. This is the PRINTED name, not the " +
        "signature — do not try to read a cursive signature into this field. Null if blank. " +
        "The hearing form has no such field, so always null there.",
    },
    parentEmail: {
      type: ["string", "null"],
      description:
        "VISION only: the 'Email:' blank. Transcribe exactly, lowercase. Handwritten addresses are " +
        "error-prone: check an ambiguous character against the parent's printed name and common " +
        "domains first; if it is still genuinely ambiguous, give your best reading and list " +
        "'parentEmail' in uncertainFields. Null if blank. Always null on a hearing form.",
    },
    parentPhone: {
      type: ["string", "null"],
      description:
        "VISION only: the 'Cell:' blank, digits only. Null if blank. Always null on a hearing form.",
    },
    outcome: {
      type: "string",
      enum: ["pass", "refer", "unclear"],
      description:
        "VISION: 'pass' if 'Your child Passed the Vision Screening' is ticked; 'refer' if 'Your child " +
        "should see an Eye Doctor' is ticked, or if UTT is marked for a Pre K child (UTT for Pre K is a " +
        "Refer). HEARING: 'pass' if recommendation 1 is marked; 'refer' for any of 2, 2a, 2b, 3 or 4. " +
        "'unclear' when no box is marked or two conflict — never guess between pass and refer.",
    },
    hearingRecommendation: {
      type: ["string", "null"],
      enum: ["1", "2", "2a", "2b", "3", "4", null],
      description:
        "HEARING only: which numbered recommendation is marked at the foot of the form. Null on a " +
        "vision form or when nothing is marked.",
    },
    resultNotes: {
      type: ["string", "null"],
      description:
        "Anything handwritten in the results area that a parent consultant would want before ringing " +
        "the family — the Comments box on the hearing form, wax/foreign-object notes, 'wears glasses', " +
        "UTT marks, or acuity figures that stand out. Quote the form; do not interpret or diagnose. " +
        "Null if there is nothing written.",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description:
        "Your overall confidence in this page. 'low' for a poor photo, heavy skew, cut-off edges, or " +
        "handwriting you are mostly guessing at.",
    },
    uncertainFields: {
      type: "array",
      items: { type: "string" },
      description:
        "Names of the fields above you genuinely cannot read with confidence, so a human checks exactly " +
        "those: smudged or faint writing, ambiguous letters, text cut off at the edge, or two plausible " +
        "readings that the rest of the page cannot settle. Do NOT flag a field that is clearly written. " +
        "Before flagging, use the context of the whole page to resolve the doubt: the printed labels, " +
        "the email address spelling against the parent's printed name, Hawaii phone numbers starting " +
        "808, the school name. Empty array if everything was clear.",
    },
  },
  required: ["formType", "outcome", "consentSigned", "confidence", "uncertainFields"],
};

/* The model is told today's date so it can resolve an omitted year, and told to
 * transcribe rather than tidy. The standing rule across this codebase is that a
 * blank stays blank: an invented value is far more expensive than a null a human
 * fills in. */
function buildSystemPrompt(todayStr) {
  return [
    "You read a single scanned or photographed Lions Club school screening form and return its contents as structured data.",
    "TODAY'S DATE is " + todayStr + " (Hawaii time) — use it to resolve any year a date leaves out.",
    "",
    "There are exactly two forms:",
    "  VISION  — 'District 50 Hawaii Lions / Vision Screening Program - Protocol # 3 / Parent Consent and Screening Results Form'.",
    "  HEARING — 'D50 Hawaii-Lions / Hearing Screening Consent, Results & Referral Form'.",
    "Identify which from the heading before reading anything else, and set formType accordingly.",
    "",
    "Return ONLY via the provided tool. Rules:",
    "- TRANSCRIBE, never tidy. Copy handwriting exactly as written, including unusual spellings and Hawaiian diacritics. Do not expand nicknames, correct names, or reformat an address.",
    "- A BLANK FIELD IS null. Never infer a value from context, never carry a value across from another field, and never invent a plausible one. A null costs a human one keystroke; a wrong value costs a family.",
    "- Read CIRCLES as well as ticks. On the vision form, age and grade are selected by circling a printed number, not by writing one.",
    "- screeningDate is the date the screening was performed — not the parent's signature date and not the 'This form is due' date. These sit close together; take care.",
    "- Do not diagnose, summarise or soften the results. Quote what the form says.",
    "- Flag a field in uncertainFields only when you genuinely cannot read it with confidence: smudged, ambiguous letters, cut off, or two plausible readings. Do NOT flag fields that are clearly written. Before flagging, use the context of the whole page to resolve ambiguity: the printed labels, the email address spelling against the parent's printed name, area code 808 on phone numbers, the school name.",
    "- Keep confidence 'low' for genuinely poor pages (bad photo, heavy skew, cut-off edges, handwriting you are mostly guessing at).",
    "",
    "After examining the page, you MUST call record_screening_referral exactly once.",
  ].join("\n");
}

/* Referral status is derived here rather than trusted from the model, so the
 * rule lives in one readable place: a hearing recommendation of 1 is a pass,
 * every other numbered recommendation is a referral. */
function isReferral(data) {
  if (!data) return false;
  if (data.formType === "hearing" && data.hearingRecommendation) {
    return data.hearingRecommendation !== "1";
  }
  return data.outcome === "refer";
}

/* A hearing form carries no parent contact at all, and its consent does not name
 * LDAH. Vision carries both. The caller uses this to decide between opening a
 * case and parking the referral in the "needs parent contact" queue. */
function contactability(data, paired) {
  const email = String((data && data.parentEmail) || "").trim() ||
    String((paired && paired.email) || "").trim();
  const phone = (String((data && data.parentPhone) || "") ||
    String((paired && paired.phone) || "")).replace(/\D/g, "");
  /* Lions screen a child for BOTH and send the pair together; the parent signs
     the consent on the VISION page and it covers the student, not one test.
     So a hearing form for a child whose vision consent is already on file is
     contactable, and borrows that page's email and phone when its own are
     blank. Hearing on its own still names nobody and still waits.
     (Daniel, 2026-09-19.) */
  const visionConsent = !!data && data.formType === "vision";
  const pairedVision = !!(paired && paired.visionConsentOnFile);
  return {
    hasEmail: !!email,
    hasPhone: phone.length >= 7,
    reachable: !!email || phone.length >= 7,
    namesLdah: visionConsent || (!!data && data.formType === "hearing" && pairedVision),
    viaPairedVision: !visionConsent && pairedVision,
    email: email,
    phone: phone,
  };
}

/* The model call and its response parsing, kept here (not inline in index.js)
 * so a test can drive it with a fake client.
 *
 * Adaptive thinking cannot be combined with a FORCED tool_choice, so the first
 * attempt lets the model think and uses tool_choice auto, with the system prompt
 * insisting on exactly one record_screening_referral call. If it answers in text
 * instead, we retry ONCE the old way (forced tool, no thinking) rather than fail
 * the page. Streamed + finalMessage(): 16000 max_tokens with thinking can run
 * long, and streaming keeps the socket alive (same reason as the Case Review).
 *
 * Throws an Error whose .code is "truncated" (stop_reason max_tokens) or
 * "no_tool_use" (nothing usable after the retry). (2026-10-05) */
const SCREENING_REFERRAL_TOOL_NAME = "record_screening_referral";
const SCREENING_REFERRAL_MAX_TOKENS = 16000;
const SCREENING_REFERRAL_RETRY_MAX_TOKENS = 4000;

function _extractionError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function _findToolUse(response) {
  return ((response && response.content) || []).find(
    (b) => b && b.type === "tool_use" && b.name === SCREENING_REFERRAL_TOOL_NAME && b.input
  ) || null;
}

async function runScreeningExtraction(client, { model, system, mediaBlock }) {
  const tools = [{
    name: SCREENING_REFERRAL_TOOL_NAME,
    description: "Record the contents of this Lions screening form. Call exactly once.",
    input_schema: SCREENING_REFERRAL_TOOL_SCHEMA,
  }];
  const messages = [{ role: "user", content: [mediaBlock, { type: "text", text: "Read this Lions screening form." }] }];

  const first = await client.messages.stream({
    model,
    max_tokens: SCREENING_REFERRAL_MAX_TOKENS,
    thinking: { type: "adaptive" },
    system,
    tools,
    tool_choice: { type: "auto" },
    messages,
  }).finalMessage();

  if (first.stop_reason === "max_tokens") throw _extractionError("truncated", "truncated at max_tokens");
  const toolUse = _findToolUse(first);
  if (toolUse) return { response: first, toolUse, retried: false };

  /* Model replied in prose. One forced retry, thinking off (forced tool use and
     thinking cannot be combined). */
  const second = await client.messages.stream({
    model,
    max_tokens: SCREENING_REFERRAL_RETRY_MAX_TOKENS,
    thinking: { type: "disabled" },
    system,
    tools,
    tool_choice: { type: "tool", name: SCREENING_REFERRAL_TOOL_NAME },
    messages,
  }).finalMessage();

  if (second.stop_reason === "max_tokens") throw _extractionError("truncated", "truncated at max_tokens (retry)");
  const retryUse = _findToolUse(second);
  if (!retryUse) throw _extractionError("no_tool_use", "no tool_use block after retry");
  return { response: second, toolUse: retryUse, retried: true, firstUsage: first.usage || null };
}

const SCREENING_REFERRAL_FORM_TYPES = ["vision", "hearing"];
const SCREENING_REFERRAL_OUTCOMES = ["pass", "refer", "unclear"];
const SCREENING_REFERRAL_HEARING_RECS = ["1", "2", "2a", "2b", "3", "4"];

module.exports = {
  SCREENING_REFERRAL_TOOL_SCHEMA,
  SCREENING_REFERRAL_FORM_TYPES,
  SCREENING_REFERRAL_OUTCOMES,
  SCREENING_REFERRAL_HEARING_RECS,
  SCREENING_REFERRAL_TOOL_NAME,
  SCREENING_REFERRAL_MAX_TOKENS,
  buildSystemPrompt,
  runScreeningExtraction,
  isReferral,
  contactability,
};
