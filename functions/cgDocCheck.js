// Connect-Gen document check (2026-10-30).
//
// Daniel, 10-30: when a family sends documents that are not an IEP or an
// evaluation, or are not current, do not mark them complete; email the family
// and tell the presenter.
//
// Until now the Documents tick went green the moment ANY file sat in each slot.
// Of the first 12 families who uploaded, one sent two letters to the school, a
// doctor's letter and two Prior Written Notices as "evaluations"; another's only
// IEP was dated September 2022. Both were confirmed.
//
// Current means (Daniel, 10-30):
//   IEP         meeting / annual review within the last 12 months
//   evaluation  report or testing within the last 3 years (the triennial cycle)
// measured back from the LATER of today and the family's first session.
//
// This module is the pure part: the model prompt and schema, one classify call,
// and the rule that turns per-file results into "documents done or not". The
// trigger, the sweep, the email and the task live in index.js.

const crypto = require("crypto");

const CG_DOC_CHECK_VERSION = 1;
// Sonnet, not Haiku (2026-10-30 dry run on a real family's 7 files): Haiku took
// a DOE report's mistyped header year (2022) over the body's 2023 testing dates
// and would have failed a current evaluation. Sonnet read the body correctly.
// Sonnet 5.5 refuses a forced tool_choice, so the call asks for the tool and a
// reply without it throws -> check.error -> counts for its slot (fail open).
const CG_DOC_CHECK_MODEL = "claude-sonnet-5-5";
const CG_DOC_IEP_WINDOW_DAYS = 365;
const CG_DOC_EVAL_WINDOW_DAYS = 3 * 365 + 1;
// A claimed-but-unfinished check older than this is treated as abandoned (the
// instance died) and may be claimed again.
const CG_DOC_CHECK_STALE_MS = 15 * 60 * 1000;
// The family is usually mid-upload when the first results come back; the email
// waits until nothing new has arrived for this long.
const CG_DOC_EMAIL_QUIET_MS = 20 * 60 * 1000;
// Larger files are not sent to the model; they fail OPEN (count as passing) and
// the presenter is told the file could not be checked.
const CG_DOC_CHECK_MAX_BYTES = 20 * 1024 * 1024;

// Firestore map key for one stored file. storagePath carries "/" and "." which
// break dotted update paths, so key on a short hash of it instead.
function docKey(storagePath) {
  return crypto.createHash("sha1").update(String(storagePath || "")).digest("hex").slice(0, 16);
}

function contentHash(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const CG_DOC_CHECK_SCHEMA = {
  type: "object",
  properties: {
    docType: {
      type: "string", enum: ["iep", "evaluation", "other"],
      description: "iep = the Individualized Education Program document itself. evaluation = an assessment or evaluation REPORT (psychological / cognitive, speech-language, OT, PT, academic, adaptive, behavioral FBA, audiology, vision, medical-diagnostic evaluation report). other = anything else.",
    },
    otherKind: {
      type: "string",
      description: "When docType is other, what it is in a few plain words a parent would understand, e.g. 'progress report', 'Prior Written Notice', 'letter to the school', 'doctor's letter', 'behavior plan', 'report card', 'meeting notice'. Empty otherwise.",
    },
    documentDate: {
      type: "string",
      description: "YYYY-MM-DD, or empty when the document carries no usable date. For an IEP: the IEP MEETING date (never the next annual review date or the reevaluation due date, which are in the future). For an evaluation: the report date, or the LAST testing date when there is no report date.",
    },
    dateBasis: {
      type: "string",
      description: "Where the date came from, e.g. 'IEP Meeting Date(s) field', 'last testing date in the body', 'report signature date'.",
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    reason: { type: "string", description: "One short sentence explaining the classification and the date." },
  },
  required: ["docType", "otherKind", "documentDate", "dateBasis", "confidence", "reason"],
};

const CG_DOC_CHECK_SYSTEM = [
  "You sort documents a parent uploaded before a special-education advocacy session in Hawaii.",
  "Each request is ONE file (sometimes only part of a longer document). Decide what it is and when it is from,",
  "and record the answer with the tool.",
  "",
  "What it is:",
  "- iep: the Individualized Education Program itself (Hawaii DOE form 'INDIVIDUALIZED EDUCATION PROGRAM',",
  "  with present levels, goals, services). An IEP amendment counts as an IEP.",
  "- evaluation: an assessment or evaluation REPORT written by an assessor: cognitive / psychological,",
  "  speech-language, occupational or physical therapy, academic achievement, adaptive behaviour (e.g. Vineland),",
  "  functional behaviour assessment, audiology, vision, or a private diagnostic evaluation report.",
  "  A page or section cut out of such a report still counts as an evaluation.",
  "- other: everything else, including Prior Written Notices (PWN), progress reports (IEP or ABA),",
  "  behaviour intervention plans, report cards, letters to or from the school, a doctor's or",
  "  psychiatrist's letter that is not an evaluation report, meeting notices, consent forms, eligibility",
  "  summaries, and blank or unreadable pages.",
  "",
  "When it is from:",
  "- Read the body, not just the header. Headers are copied forward and can carry last year's date; when the",
  "  header and the body disagree, prefer the latest date that the body consistently supports.",
  "- For an IEP use the meeting date. The 'Annual Review Date' and 'Reevaluation Date' on the form are FUTURE",
  "  due dates; never return those.",
  "- For an evaluation use the report date, else the last testing date.",
  "- Dates of birth, previous assessments quoted in the history, and school-year ranges are NOT the document date.",
  "- If there is genuinely no date, return an empty documentDate. Do not guess.",
  "",
  "Never repeat the child's scores, diagnoses or personal details in the reason; describe the document, not the child.",
].join("\n");

// One file. client is an Anthropic client; block is a {type:'document'|'image'} content block.
async function classifyDocument({ client, block, filename, slot, cachedSystem }) {
  const response = await client.messages.create({
    model: CG_DOC_CHECK_MODEL,
    max_tokens: 1024,
    system: cachedSystem ? cachedSystem(CG_DOC_CHECK_SYSTEM) : CG_DOC_CHECK_SYSTEM,
    tools: [{
      name: "record_document_check",
      description: "Record what this document is and its date.",
      input_schema: CG_DOC_CHECK_SCHEMA,
    }],
    tool_choice: { type: "auto" },
    messages: [{
      role: "user",
      content: [block, {
        type: "text",
        text: "The parent uploaded this as their child's " + (slot === "iep" ? "IEP" : "evaluation") +
          (filename ? " (file name: " + filename + ")" : "") + ". What is it, and what is its date? Answer only by calling record_document_check.",
      }],
    }],
  });
  const tool = (response.content || []).find((b) => b.type === "tool_use");
  if (!tool || !tool.input) throw new Error("no structured result");
  return normaliseResult(tool.input);
}

function normaliseResult(r) {
  const x = r || {};
  const docType = ["iep", "evaluation", "other"].indexOf(x.docType) > -1 ? x.docType : "other";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(x.documentDate || "")) ? x.documentDate : "";
  return {
    docType,
    otherKind: docType === "other" ? String(x.otherKind || "").slice(0, 80) : "",
    documentDate: date,
    dateBasis: String(x.dateBasis || "").slice(0, 160),
    confidence: ["high", "medium", "low"].indexOf(x.confidence) > -1 ? x.confidence : "low",
    reason: String(x.reason || "").slice(0, 300),
  };
}

function _dayMs(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return null;
  const t = Date.parse(dateKey + "T00:00:00-10:00");
  return isNaN(t) ? null : t;
}

// The reference date currency is measured back from: the later of today and the
// family's first session (an IEP that is current today but lapses before the
// session is not current for the session).
function referenceMillis(firstSessionDateKey, nowMs) {
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  const s = _dayMs(firstSessionDateKey);
  return s !== null && s > now ? s : now;
}

function isCurrent(docType, documentDate, refMs) {
  const d = _dayMs(documentDate);
  if (d === null) return false;
  const days = docType === "iep" ? CG_DOC_IEP_WINDOW_DAYS : CG_DOC_EVAL_WINDOW_DAYS;
  return d >= refMs - days * 86400000;
}

// Every stored file, both slots, with its check (if any).
function filesWithChecks(signup) {
  const docs = (signup && signup.connectGenDocuments) || {};
  const checks = (signup && signup.cgDocChecks) || {};
  const out = [];
  for (const slot of ["iep", "evaluation"]) {
    const v = docs[slot];
    const list = Array.isArray(v) ? v : (v && v.storagePath ? [v] : []);
    for (const rec of list) {
      if (!rec || !rec.storagePath) continue;
      out.push({ slot, rec, key: docKey(rec.storagePath), check: checks[docKey(rec.storagePath)] || null });
    }
  }
  return out;
}

// Turn per-file results into the documents requirement.
//
// A file counts by WHAT IT IS, not which slot it was put in: an evaluation
// uploaded under "IEP" still satisfies the evaluation requirement. A file that
// does not count is harmless as long as something else covers its need (Natalie
// Jardine's 2022-23 ABA progress report sat in the IEP slot beside a current IEP).
//
// Fail-open: a file the check could not read (error / too large / disabled)
// counts for the slot it was put in, so an outage on our side never holds a
// family back. Staff uploads count as given.
function evaluateDocuments(signup, opts) {
  const o = opts || {};
  const refMs = referenceMillis(o.firstSessionDateKey, o.nowMs);
  const files = filesWithChecks(signup);
  let hasIep = false, hasEval = false, pending = 0;
  const failOpen = [];
  for (const f of files) {
    const c = f.check;
    if (f.rec.uploadedByStaff) { if (f.slot === "iep") hasIep = true; else hasEval = true; continue; }
    if (!c || c.status === "pending") { pending++; continue; }
    if (c.status === "error" || c.status === "skipped") {
      if (f.slot === "iep") hasIep = true; else hasEval = true;
      if (c.status === "error") failOpen.push(f);
      continue;
    }
    if (c.docType === "iep" && isCurrent("iep", c.documentDate, refMs)) hasIep = true;
    if (c.docType === "evaluation" && isCurrent("evaluation", c.documentDate, refMs)) hasEval = true;
  }

  const missing = [];
  if (!hasIep) missing.push("iep");
  if (!hasEval) missing.push("evaluation");

  // The files to name to the family: those that relate to a missing need (put
  // in that slot, or classified as that type) and did not count.
  const problems = [];
  for (const f of files) {
    const c = f.check;
    if (!c || c.status !== "done" || f.rec.uploadedByStaff) continue;
    const relates = missing.some((m) => f.slot === m || c.docType === m);
    if (!relates) continue;
    let why;
    if (c.docType === "other") why = "other";
    else if (!c.documentDate) why = "undated";
    else if (!isCurrent(c.docType, c.documentDate, refMs)) why = "old";
    else continue;   // current, just of the other type
    problems.push({
      key: f.key, slot: f.slot, storagePath: f.rec.storagePath,
      originalFilename: f.rec.originalFilename || "", why,
      docType: c.docType, otherKind: c.otherKind || "", documentDate: c.documentDate || "",
    });
  }

  return {
    ok: missing.length === 0,
    pending,
    missing,
    problems,
    failOpen: failOpen.map((f) => ({ key: f.key, originalFilename: f.rec.originalFilename || "", error: (f.check || {}).error || "" })),
    fileCount: files.length,
    refMs,
  };
}

// One email per distinct set of problems: the family sending one more old file
// changes the key and earns a fresh, accurate email; a re-run does not.
function problemsKey(result) {
  const r = result || {};
  const parts = (r.missing || []).slice().sort().concat(
    (r.problems || []).map((p) => p.key + ":" + p.why).sort());
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 20);
}

// "January 2022"
function monthYear(dateKey) {
  const t = _dayMs(dateKey);
  if (t === null) return "";
  return new Date(t).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "Pacific/Honolulu" });
}

// The plain sentence the family reads for one file.
function problemSentence(p) {
  const article = (w) => (/^[aeiou]/i.test(w) ? "an " : "a ");
  if (p.why === "other") {
    const kind = p.otherKind ? p.otherKind.toLowerCase() : "a different kind of document";
    return "This looks like " + (p.otherKind ? article(kind) + kind : kind) + ", not an IEP or an evaluation report.";
  }
  if (p.why === "undated") {
    return "We could not find a date on this " + (p.docType === "iep" ? "IEP" : "evaluation") +
      ", so we cannot tell whether it is current.";
  }
  const when = monthYear(p.documentDate);
  return p.docType === "iep"
    ? "This IEP is dated " + when + ". We need the IEP from the last 12 months."
    : "This evaluation is dated " + when + ". We need evaluations from the last 3 years.";
}

module.exports = {
  CG_DOC_CHECK_VERSION,
  CG_DOC_CHECK_MODEL,
  CG_DOC_IEP_WINDOW_DAYS,
  CG_DOC_EVAL_WINDOW_DAYS,
  CG_DOC_CHECK_STALE_MS,
  CG_DOC_EMAIL_QUIET_MS,
  CG_DOC_CHECK_MAX_BYTES,
  CG_DOC_CHECK_SCHEMA,
  CG_DOC_CHECK_SYSTEM,
  docKey,
  contentHash,
  classifyDocument,
  normaliseResult,
  referenceMillis,
  isCurrent,
  filesWithChecks,
  evaluateDocuments,
  problemsKey,
  monthYear,
  problemSentence,
};
