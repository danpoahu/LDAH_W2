// ═══════════════════════════════════════════════════════════════════════════
// Volunteer application link (2026-10-02)
//
// Someone who sent only the quick volunteer form (Step 1 on volunteer.html)
// has a volunteers/{id} doc but no full application. Staff press "Resend
// application link" on their Int Applications card; the applicant gets a
// branded LDAH email with ONE personal link that opens Step 2 directly, pre-
// filled, on ANY device:
//
//   https://www.ldahawaii.org/volunteer.html?apply=<token>
//
// The page then writes volunteerApplicationDetails/{id} and the one-time
// volunteers.fullApplicationAt flag exactly as Step 2 always has (live rules:
// volunteerId == docId and the volunteers doc exists), so no rule changes.
//
// STORAGE (Admin SDK only):
//   volunteerApplyTokens/{sha256(token)}   SERVER ONLY (no rules match = denied)
//     { volunteerId, token, createdAt }   the raw token is kept so a resend
//                                         re-sends the SAME link.
//   volunteers/{id}.applyLinkSentAt / applyLinkSendCount
//     staff-readable stamp that drives "Link sent Oct 2" on the card. No PII,
//     and the status-change trigger ignores it (status does not change).
//   volunteerApplicationDrafts/{volunteerId}   SERVER ONLY (no rules match = denied)
//     { draft, part, savedAt }   the applicant's Step 2 answers so far, saved by
//     emailMyApplicationLink ("Email me a link to finish on another device",
//     2026-10-03). Holds sensitive answers (DOB, license, criminal history):
//     returned ONLY through getVolunteerApplicationPrefill with a valid token.
//     Deleted when the full application is created (deleteVolunteerDraftOnApply)
//     and after 30 days (purgeVolunteerApplicationDrafts, daily).
//   volunteerApplyLinkRequests/{v_<sha256(volunteerId)> | i_<sha256(ip)>}
//     SERVER ONLY rate-limit counters for emailMyApplicationLink. Hashes only.
// ═══════════════════════════════════════════════════════════════════════════

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");

// Live page (promoted to root with W2 v63.0, 2026-10-02).
const APPLY_PAGE_URL = "https://www.ldahawaii.org/volunteer.html";
const TOKENS = "volunteerApplyTokens";
const RESEND_COOLDOWN_MS = 2 * 60 * 1000;
const OFFICE_PHONE = "(808) 536-9684";
const DRAFTS = "volunteerApplicationDrafts";
const SELF_REQUESTS = "volunteerApplyLinkRequests";
const SELF_COOLDOWN_MS = 2 * 60 * 1000;     // one self-service email per volunteer per 2 minutes
const SELF_DAY_MAX = 5;                     // and at most 5 a day
const SELF_IP_HOUR_MAX = 30;                // any calls, per IP, per hour
const DRAFT_MAX_DAYS = 30;
const DRAFT_MAX_BYTES = 40 * 1024;

// Step 2 field names that may be carried to another device. Signature, certify
// and parental-consent ticks are deliberately NOT carried: the applicant signs
// on the device where they submit. Email is not carried either (the address on
// file is used).
const DRAFT_STRING_KEYS = [
  "lastName", "firstName", "middleName", "address", "apt", "city", "state", "zip",
  "cellPhone", "homePhone", "workPhone", "sex", "dob", "physicalLimitations",
  "interests", "clubs", "education", "schoolName", "volunteeredBefore",
  "pastPosition", "pastAgency", "pastWork", "pastAgencyAddress", "pastAgencyPhone", "mayContactAgency",
  "hours", "hoursPer", "geoPref",
  "ref1Name", "ref1Rel", "ref1Phone", "ref1Address",
  "ref2Name", "ref2Rel", "ref2Phone", "ref2Address",
  "ref3Name", "ref3Rel", "ref3Phone", "ref3Address",
  "employed", "employerName", "employerPhone", "employerAddress", "employmentBegan",
  "supervisor", "jobTitle", "mayContactEmployer", "jobDuties", "employerPartnership",
  "ec1Name", "ec1Rel", "ec1Phone", "ec2Name", "ec2Rel", "ec2Phone",
  "canDrive", "insCarrier", "insPolicy", "dlNumber", "dlState", "dlExpires",
  "criminal", "criminalExplain", "parentName",
];
const DRAFT_LONG_KEYS = ["physicalLimitations", "interests", "clubs", "pastWork", "jobDuties", "criminalExplain"];
const DRAFT_BOOL_KEYS = ["driveAgree"];
const DRAFT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Any day"];

function hashToken(token) { return crypto.createHash("sha256").update(String(token)).digest("hex"); }
function newToken() { return crypto.randomBytes(32).toString("hex"); }
function cleanText(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max || 200);
}
function applyLink(token) { return APPLY_PAGE_URL + "?apply=" + token; }

// Whitelist + cap a Step 2 draft from the browser. Returns { draft, part } or
// null when nothing usable was sent. Strings only (plus the driving tick and
// the preferred-days list); unknown keys are dropped.
function sanitizeDraft(raw, rawPart) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  DRAFT_STRING_KEYS.forEach((k) => {
    const v = raw[k];
    if (typeof v !== "string" && typeof v !== "number") return;
    const t = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, DRAFT_LONG_KEYS.indexOf(k) !== -1 ? 2000 : 200);
    if (t.trim()) out[k] = t;
  });
  DRAFT_BOOL_KEYS.forEach((k) => { if (raw[k] === true) out[k] = true; });
  if (Array.isArray(raw.preferredDays)) {
    const days = raw.preferredDays.filter((x) => DRAFT_DAYS.indexOf(x) !== -1);
    const uniq = days.filter((x, i) => days.indexOf(x) === i);
    if (uniq.length) out.preferredDays = uniq;
  }
  if (!Object.keys(out).length) return null;
  if (Buffer.byteLength(JSON.stringify(out), "utf8") > DRAFT_MAX_BYTES) return null;
  const n = Math.floor(Number(rawPart));
  return { draft: out, part: n >= 0 && n <= 4 ? n : 0 };
}

// d***@gmail.com
function maskEmail(email) {
  const e = String(email || "").trim();
  const at = e.lastIndexOf("@");
  if (at < 1) return "";
  return e.charAt(0) + "***" + e.slice(at);
}

// Rate limit: { allowed, tooSoon, overMax, retryAfterSec, next }.
// prev = { lastAt, dayStart, dayCount } in ms; next is the record to store.
function rateDecision(prev, nowMs, opts) {
  const p = prev || {};
  const windowMs = opts.windowMs, max = opts.max, cooldownMs = opts.cooldownMs || 0;
  const inWindow = !!(p.dayStart && nowMs - p.dayStart < windowMs);
  const count = inWindow ? (p.dayCount || 0) : 0;
  const tooSoon = !!(cooldownMs && p.lastAt && nowMs - p.lastAt < cooldownMs);
  const allowed = !tooSoon && count < max;
  return {
    allowed, tooSoon, overMax: !tooSoon && count >= max,
    retryAfterSec: tooSoon ? Math.ceil((cooldownMs - (nowMs - p.lastAt)) / 1000) : 0,
    next: allowed
      ? { lastAt: nowMs, dayStart: inWindow ? p.dayStart : nowMs, dayCount: count + 1 }
      : { lastAt: p.lastAt || nowMs, dayStart: inWindow ? p.dayStart : nowMs, dayCount: count, blockedAt: nowMs },
  };
}

function buildApplyEmailHtml({ firstName, link, opportunityTitle, deps }) {
  const esc = deps._emailEsc;
  const P = (s) => '<p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.55;">' + s + "</p>";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Please complete your LDAH volunteer application</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
  <tr>
    <td style="background-color:#ffffff;padding:28px 32px 20px;text-align:center;">
      <img src="https://www.ldahawaii.org/logo_blue.png" alt="Leadership in Disabilities &amp; Achievement of Hawai&#699;i" width="150" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;">
    </td>
  </tr>
  <tr>
    <td style="background-color:#0891B2;padding:16px 32px;text-align:center;">
      <div style="font-size:20px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">Please complete your volunteer application</div>
    </td>
  </tr>
  <tr>
    <td style="padding:32px;">
      ${P("Aloha " + esc(firstName || "there") + ",")}
      ${P("Mahalo for your interest in volunteering with Leadership in Disabilities and Achievement of Hawai&#699;i" + (opportunityTitle ? " (<strong>" + esc(opportunityTitle) + "</strong>)" : "") + ". We received your quick form. The next step is LDAH&#8217;s volunteer application.")}
      ${P("It takes about 10 minutes and works well on a phone. We have already filled in your name, email and phone.")}
      ${deps._emailBtn(link, "Complete my application", { bg: "#0891B2" })}
      <p style="margin:18px 0 16px;font-size:15px;color:#555555;line-height:1.55;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:6px;padding:12px 14px;">
        This link is just for you. Everything you enter is confidential.
      </p>
      ${P("Questions? Call us at <a href=\"tel:+18085369684\" style=\"color:#1a73e8;text-decoration:none;\">" + OFFICE_PHONE + "</a>.")}
      <p style="margin:0 0 4px;font-size:15px;color:#333333;line-height:1.5;">Mahalo,</p>
      <p style="margin:0 0 0;font-size:15px;color:#333333;line-height:1.5;"><strong>The LDAH Volunteer Team</strong></p>
      ${deps._emailLinkFooter([{ label: "Your volunteer application", href: link }])}
    </td>
  </tr>
  ${deps.orgFooterHtml || ""}
</table>
</td></tr>
</table>
</body>
</html>`;
}

// "Finish your LDAH volunteer application": the applicant asked for this
// themselves from Step 2 ("Email me a link to finish on another device").
function buildFinishEmailHtml({ firstName, link, deps }) {
  const esc = deps._emailEsc;
  const P = (s) => '<p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.55;">' + s + "</p>";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Finish your LDAH volunteer application</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
  <tr>
    <td style="background-color:#ffffff;padding:28px 32px 20px;text-align:center;">
      <img src="https://www.ldahawaii.org/logo_blue.png" alt="Leadership in Disabilities &amp; Achievement of Hawai&#699;i" width="150" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;">
    </td>
  </tr>
  <tr>
    <td style="background-color:#0891B2;padding:16px 32px;text-align:center;">
      <div style="font-size:20px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">Finish your volunteer application</div>
    </td>
  </tr>
  <tr>
    <td style="padding:32px;">
      ${P("Aloha " + esc(firstName || "there") + ",")}
      ${P("You asked us for a link so you can finish your LDAH volunteer application on another device. Your answers so far are saved with it.")}
      ${P("Open the button below on your computer, tablet or phone to pick up where you left off.")}
      ${deps._emailBtn(link, "Finish my application", { bg: "#0891B2" })}
      <p style="margin:18px 0 16px;font-size:15px;color:#555555;line-height:1.55;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:6px;padding:12px 14px;">
        This link is just for you, so please do not forward it. Everything you enter is confidential. Saved answers are kept for 30 days.
      </p>
      ${P("Did not ask for this? You can ignore this email. Questions? Call us at <a href=\"tel:+18085369684\" style=\"color:#1a73e8;text-decoration:none;\">" + OFFICE_PHONE + "</a>.")}
      <p style="margin:0 0 4px;font-size:15px;color:#333333;line-height:1.5;">Mahalo,</p>
      <p style="margin:0 0 0;font-size:15px;color:#333333;line-height:1.5;"><strong>The LDAH Volunteer Team</strong></p>
      ${deps._emailLinkFooter([{ label: "Your volunteer application", href: link }])}
    </td>
  </tr>
  ${deps.orgFooterHtml || ""}
</table>
</td></tr>
</table>
</body>
</html>`;
}

// The volunteer's existing token (so older emails keep working), else a new one
// added to the batch.
async function getOrCreateApplyToken(db, volunteerId, batch) {
  let token = null;
  const existing = await db.collection(TOKENS).where("volunteerId", "==", volunteerId).get();
  existing.forEach((t) => { if (!token && (t.data() || {}).token) token = t.data().token; });
  if (!token) {
    token = newToken();
    batch.set(db.collection(TOKENS).doc(hashToken(token)), { volunteerId, token, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  }
  return token;
}

async function resolveApplyToken(db, token) {
  const t = String(token || "").trim();
  if (!/^[a-f0-9]{64}$/.test(t)) return null;
  const snap = await db.collection(TOKENS).doc(hashToken(t)).get();
  if (!snap.exists) return null;
  const volunteerId = (snap.data() || {}).volunteerId;
  return volunteerId ? { volunteerId } : null;
}

function badLink() {
  return new functions.https.HttpsError("not-found",
    "This link is not valid any more. Please call LDAH at " + OFFICE_PHONE + " and we will send you a new one.");
}

function build(deps) {
  const d = deps || {};
  const secrets = d.EMAIL_SECRETS || ["RESEND_API_KEY", "SMTP_FROM"];

  // Staff: email the applicant their personal Step 2 link. superAdmin / admin only.
  const sendVolunteerApplicationLink = functions
    .runWith({ timeoutSeconds: 60, maxInstances: 3, secrets })
    .https.onCall(async (data, context) => {
      if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Please sign in.");
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const roleSnap = await db.collection("userRoles").doc(context.auth.uid).get();
      const roleDoc = roleSnap.exists ? (roleSnap.data() || {}) : {};
      if (["superAdmin", "admin"].indexOf(roleDoc.role || "") === -1) {
        throw new functions.https.HttpsError("permission-denied", "Only a Super Admin or Admin can send the application link.");
      }
      const volunteerId = cleanText((data || {}).volunteerId, 128);
      if (!volunteerId || volunteerId.indexOf("/") !== -1) throw new functions.https.HttpsError("invalid-argument", "Missing volunteer.");

      const vRef = db.collection("volunteers").doc(volunteerId);
      const [vSnap, appSnap] = await Promise.all([vRef.get(), db.collection("volunteerApplicationDetails").doc(volunteerId).get()]);
      if (!vSnap.exists) throw new functions.https.HttpsError("not-found", "That application no longer exists.");
      const v = vSnap.data() || {};
      // Already done: say so (not an error) so the dashboard can show it.
      if (appSnap.exists) return { ok: false, alreadyCompleted: true };
      const email = String(v.email || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new functions.https.HttpsError("failed-precondition", "This applicant has no valid email address.");
      const lastMs = v.applyLinkSentAt && v.applyLinkSentAt.toMillis ? v.applyLinkSentAt.toMillis() : 0;
      if (lastMs && Date.now() - lastMs < RESEND_COOLDOWN_MS) {
        throw new functions.https.HttpsError("resource-exhausted", "The link was sent less than 2 minutes ago. Please wait before sending it again.");
      }
      const name = [v.firstName, v.lastName].filter(Boolean).join(" ").trim() || email;

      // Reuse the applicant's existing link so an older email keeps working.
      let token = null;
      const existing = await db.collection(TOKENS).where("volunteerId", "==", volunteerId).get();
      existing.forEach((t) => { if (!token && (t.data() || {}).token) token = t.data().token; });
      const batch = db.batch();
      if (!token) {
        token = newToken();
        batch.set(db.collection(TOKENS).doc(hashToken(token)), { volunteerId, token, createdAt: FieldValue.serverTimestamp() });
      }
      // Stamp BEFORE sending, so a second click inside the cooldown is refused.
      batch.set(vRef, { applyLinkSentAt: FieldValue.serverTimestamp(), applyLinkSendCount: FieldValue.increment(1) }, { merge: true });
      await batch.commit();

      let opportunityTitle = "";
      if (v.opportunityId) {
        try { const o = await db.collection("volunteerOpportunities").doc(String(v.opportunityId)).get(); opportunityTitle = o.exists ? String((o.data() || {}).title || "") : ""; } catch (e) { /* title is optional */ }
      }
      const link = applyLink(token);
      const orgFooterHtml = d.getOrgFooterHtml ? await d.getOrgFooterHtml() : "";
      const html = buildApplyEmailHtml({
        firstName: v.firstName || "", link, opportunityTitle,
        deps: { _emailEsc: d._emailEsc, _emailBtn: d._emailBtn, _emailLinkFooter: d._emailLinkFooter, orgFooterHtml },
      });
      try {
        await d.sendEmailViaResend({
          from: d.lifecycleFromAddress ? d.lifecycleFromAddress() : ("LDAH <" + (process.env.SMTP_FROM || "") + ">"),
          to: [email],
          subject: "Please complete your LDAH volunteer application",
          html,
          type: "volunteerApplicationLink",
          recipientName: name,
        });
      } catch (e) {
        // Un-stamp so staff can retry straight away.
        await vRef.set({ applyLinkSentAt: lastMs ? v.applyLinkSentAt : FieldValue.delete(), applyLinkSendCount: FieldValue.increment(-1) }, { merge: true }).catch(() => {});
        throw new functions.https.HttpsError("internal", "The email could not be sent: " + String(e.message || e).slice(0, 200));
      }
      return { ok: true, email, sentAt: new Date().toISOString(), resent: !!lastMs };
    });

  // Public (token): what Step 2 needs to open pre-filled.
  const getVolunteerApplicationPrefill = functions
    .runWith({ timeoutSeconds: 30, maxInstances: 10 })
    .https.onCall(async (data) => {
      if ((data || {}).warm === true) return { warm: true };
      const db = admin.firestore();
      const tok = await resolveApplyToken(db, (data || {}).token);
      if (!tok) throw badLink();
      const [vSnap, appSnap] = await Promise.all([
        db.collection("volunteers").doc(tok.volunteerId).get(),
        db.collection("volunteerApplicationDetails").doc(tok.volunteerId).get(),
      ]);
      if (!vSnap.exists) throw badLink();
      const v = vSnap.data() || {};
      let opportunityTitle = "";
      if (v.opportunityId) {
        try { const o = await db.collection("volunteerOpportunities").doc(String(v.opportunityId)).get(); opportunityTitle = o.exists ? String((o.data() || {}).title || "") : ""; } catch (e) { /* optional */ }
      }
      // Answers saved by "Email me a link to finish on another device" (2026-10-03).
      // Only ever returned here, behind a valid token.
      let draft = null, draftPart = 0;
      if (!appSnap.exists) {
        try {
          const dSnap = await db.collection(DRAFTS).doc(tok.volunteerId).get();
          if (dSnap.exists) {
            const dd = dSnap.data() || {};
            const clean = sanitizeDraft(dd.draft, dd.part);
            if (clean) { draft = clean.draft; draftPart = clean.part; }
          }
        } catch (e) { /* the draft is a bonus; the page still opens pre-filled */ }
      }
      return {
        volunteerId: tok.volunteerId,
        firstName: String(v.firstName || ""), lastName: String(v.lastName || ""),
        email: String(v.email || ""), phone: String(v.phone || ""),
        opportunityId: String(v.opportunityId || ""), opportunityTitle,
        alreadyCompleted: appSnap.exists,
        draft, draftPart,
      };
    });

  // Public: the applicant taps "Email me a link to finish on another device" in
  // Step 2. Saves their answers so far server-side and emails the address ON
  // FILE their personal ?apply= link. Never returns the draft.
  const emailMyApplicationLink = functions
    .runWith({ timeoutSeconds: 60, maxInstances: 5, secrets })
    .https.onCall(async (data, context) => {
      // Warm-up from the page when Step 2 opens: one tiny read opens the
      // Firestore channel, so the real tap does not pay for it.
      if ((data || {}).warm === true) { await admin.firestore().collection(SELF_REQUESTS).limit(1).get().catch(() => {}); return { warm: true }; }
      const volunteerId = cleanText((data || {}).volunteerId, 40);
      if (!/^[A-Za-z0-9]{10,40}$/.test(volunteerId)) throw new functions.https.HttpsError("invalid-argument", "We could not find your application. Please call LDAH at " + OFFICE_PHONE + ".");
      const clean = sanitizeDraft((data || {}).draft, (data || {}).part);
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const nowMs = Date.now();

      // IP limit first (every call counts), so a script cannot hammer drafts.
      const req = context && context.rawRequest;
      const ip = req ? String((req.headers && req.headers["x-forwarded-for"]) || req.ip || "").split(",")[0].trim() : "";
      if (ip) {
        const iRef = db.collection(SELF_REQUESTS).doc("i_" + hashToken(ip));
        const ipOk = await db.runTransaction(async (tx) => {
          const snap = await tx.get(iRef);
          const dec = rateDecision(snap.exists ? snap.data() : null, nowMs, { windowMs: 3600 * 1000, max: SELF_IP_HOUR_MAX });
          tx.set(iRef, dec.next);
          return dec.allowed;
        });
        if (!ipOk) throw new functions.https.HttpsError("resource-exhausted", "Too many requests from this connection. Please try again in an hour, or call LDAH at " + OFFICE_PHONE + ".");
      }

      const vRef = db.collection("volunteers").doc(volunteerId);
      const [vSnap, appSnap] = await Promise.all([vRef.get(), db.collection("volunteerApplicationDetails").doc(volunteerId).get()]);
      if (!vSnap.exists) throw new functions.https.HttpsError("not-found", "We could not find your application. Please call LDAH at " + OFFICE_PHONE + ".");
      if (appSnap.exists) return { ok: false, alreadyCompleted: true };
      const v = vSnap.data() || {};
      const email = String(v.email || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new functions.https.HttpsError("failed-precondition", "We do not have an email address for you. Please call LDAH at " + OFFICE_PHONE + ".");
      const emailMasked = maskEmail(email);

      // Always keep the newest answers, even inside the cooldown, so the link
      // already in their inbox opens with what they typed last.
      if (clean) await db.collection(DRAFTS).doc(volunteerId).set({ draft: clean.draft, part: clean.part, savedAt: FieldValue.serverTimestamp() });

      const vrRef = db.collection(SELF_REQUESTS).doc("v_" + hashToken(volunteerId));
      const dec = await db.runTransaction(async (tx) => {
        const snap = await tx.get(vrRef);
        const r = rateDecision(snap.exists ? snap.data() : null, nowMs, { windowMs: 24 * 3600 * 1000, max: SELF_DAY_MAX, cooldownMs: SELF_COOLDOWN_MS });
        tx.set(vrRef, r.next);
        return r;
      });
      if (!dec.allowed) {
        return dec.tooSoon
          ? { ok: false, cooldown: true, retryAfterSec: dec.retryAfterSec, emailMasked, draftSaved: !!clean }
          : { ok: false, dailyLimit: true, emailMasked, draftSaved: !!clean };
      }

      const batch = db.batch();
      const token = await getOrCreateApplyToken(db, volunteerId, batch);
      await batch.commit();

      const link = applyLink(token);
      const name = [v.firstName, v.lastName].filter(Boolean).join(" ").trim() || email;
      const orgFooterHtml = d.getOrgFooterHtml ? await d.getOrgFooterHtml() : "";
      const html = buildFinishEmailHtml({
        firstName: v.firstName || "", link,
        deps: { _emailEsc: d._emailEsc, _emailBtn: d._emailBtn, _emailLinkFooter: d._emailLinkFooter, orgFooterHtml },
      });
      try {
        await d.sendEmailViaResend({
          from: d.lifecycleFromAddress ? d.lifecycleFromAddress() : ("LDAH <" + (process.env.SMTP_FROM || "") + ">"),
          to: [email],
          subject: "Finish your LDAH volunteer application",
          html,
          type: "volunteerApplicationFinishLink",
          recipientName: name,
        });
      } catch (e) {
        console.error("emailMyApplicationLink send failed", volunteerId, String(e.message || e).slice(0, 300));
        // Give the attempt back so they can retry straight away.
        await vrRef.set({ lastAt: 0, dayCount: FieldValue.increment(-1) }, { merge: true }).catch(() => {});
        throw new functions.https.HttpsError("unavailable", "We could not send the email just now. Your answers are still saved on this device. Please try again in a moment.");
      }
      return { ok: true, emailMasked, draftSaved: !!clean };
    });

  // The full application exists: the carried-over draft is no longer needed.
  const deleteVolunteerDraftOnApply = functions.firestore
    .document("volunteerApplicationDetails/{id}")
    .onCreate(async (snap, context) => {
      await admin.firestore().collection(DRAFTS).doc(context.params.id).delete().catch((e) => {
        console.error("deleteVolunteerDraftOnApply", context.params.id, String(e.message || e).slice(0, 200));
      });
      return null;
    });

  // Daily 3:40 AM HST: drafts older than 30 days, and rate-limit counters idle 2+ days.
  const purgeVolunteerApplicationDrafts = functions
    .runWith({ timeoutSeconds: 120 })
    .pubsub.schedule("40 3 * * *").timeZone("Pacific/Honolulu")
    .onRun(async () => {
      const db = admin.firestore();
      const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - DRAFT_MAX_DAYS * 864e5);
      const [old, idle] = await Promise.all([
        db.collection(DRAFTS).where("savedAt", "<", cutoff).limit(400).get(),
        db.collection(SELF_REQUESTS).where("lastAt", "<", Date.now() - 2 * 864e5).limit(400).get(),
      ]);
      const batch = db.batch();
      old.forEach((s) => batch.delete(s.ref));
      idle.forEach((s) => batch.delete(s.ref));
      if (old.size || idle.size) await batch.commit();
      console.log("purgeVolunteerApplicationDrafts: drafts", old.size, "counters", idle.size);
      return null;
    });

  return { sendVolunteerApplicationLink, getVolunteerApplicationPrefill, emailMyApplicationLink, deleteVolunteerDraftOnApply, purgeVolunteerApplicationDrafts };
}

module.exports = build;
module.exports._pure = {
  APPLY_PAGE_URL, TOKENS, DRAFTS, SELF_REQUESTS, SELF_COOLDOWN_MS, SELF_DAY_MAX, SELF_IP_HOUR_MAX, DRAFT_MAX_BYTES, DRAFT_STRING_KEYS,
  hashToken, applyLink, maskEmail, sanitizeDraft, rateDecision, buildApplyEmailHtml, buildFinishEmailHtml,
};
