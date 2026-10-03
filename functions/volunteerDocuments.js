// ═══════════════════════════════════════════════════════════════════════════
// Volunteer onboarding documents (2026-10-02)
//
// Once a volunteer is ACCEPTED (they sit on the Int Volunteers -> Roster tab),
// staff press "Send volunteer documents" on the roster detail popup. The
// volunteer gets ONE personal link and completes, on their phone:
//
//   1. Confidentiality Agreement (paper 2018)  - read, print name, sign, tick
//   2. Drug-Free Workplace Policy (paper 2017) - read, print name, sign, tick
//   3. Emergency Contact Form (paper 2017)     - up to 3 contacts + optional box
//   4. Volunteer Service Log (Rev 10/04/18)    - ONGOING: add entries any time
//
// The same link stays valid so the volunteer keeps logging hours from it.
//
// STORAGE (Admin SDK only; the page never writes Firestore directly):
//   volunteerOnboarding/{volunteerId}            staff-readable (rules: superAdmin/admin)
//     tokenHash, sentAt, lastSentAt, sendCount, sentByUid, sentByName,
//     supervisorName, volunteerName, volunteerEmail,
//     docs.confidentiality / docs.drugFree  { printedName, signature, certified,
//                                             signedAt, version, text, supervisorName }
//     docs.emergency  { contacts[], additionalInfo, submittedAt, updatedAt }
//     logTotals       { ldah, pti, srp, total, count, lastEntryAt }
//   volunteerOnboarding/{volunteerId}/logs/{id}  service-log entries
//   volunteerOnboardingTokens/{sha256(token)}    SERVER ONLY (no rules match = denied)
//     { volunteerId, token, createdAt }  - the raw token is kept here, and only
//     here, so a Resend can re-send the SAME link instead of breaking the one
//     the volunteer already logs hours from.
//
// Emails go through index.js's sendEmailViaResend (injected below), so every
// send lands in emailLog like every other system email.
//
// The agreement text lives HERE, versioned, and the exact text signed is stored
// with each signature, so changing the wording later never rewrites history.
// ═══════════════════════════════════════════════════════════════════════════

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");

// Live page (promoted to root with W2 v63.0, 2026-10-02).
const DOCS_PAGE_URL = "https://www.ldahawaii.org/volunteer-documents.html";
const COLLECTION = "volunteerOnboarding";
const TOKENS = "volunteerOnboardingTokens";
const DEFAULT_SUPERVISOR = "Rosie Rowe";
const ORG_NAME = "Leadership in Disabilities and Achievement of Hawaiʻi";
const RESEND_COOLDOWN_MS = 2 * 60 * 1000;   // a double-click guard; the UI state is not one
const MAX_CONTACTS = 3;
const MAX_ENTRY_HOURS = 16;
const SERVICE_TYPES = ["IEP meeting", "Training", "Community event", "Office help", "Outreach", "Other"];

// ── Agreement text ────────────────────────────────────────────────────────
// Blocks: { t:'p', text } paragraph · { t:'li', text, sub:[...] } bullet.
// {SUPERVISOR} is filled in per volunteer.
const AGREEMENTS = {
  confidentiality: {
    title: "Confidentiality Agreement",
    version: "2018; web v1",
    intro: "I, {NAME}, understand and/or agree to the following:",
    blocks: [
      { t: "li", text: "To enforce the confidentiality policy of client matters and access to client records." },
      { t: "li", text: "My volunteer work may include access to information (verbal, written, electronic, etc.) with:", sub: [
        "Names, addresses, telephone numbers and other personally identifiable information about children and/or adults receiving services;",
        "Information regarding the disabling condition, diagnosis, medical condition, history, treatment or other needs;",
        "Information regarding income status, ethnicity, race, religion, sexual preference, marital or family status;",
        "Information about educational status, progress or services received or not received;",
        "Any other information that is personally identifiable.",
      ] },
      { t: "li", text: "NOT to disclose any of the above information (regardless of source) about a student, child, or adult currently receiving services or who has received services to anyone outside of LDAH." },
      { t: "li", text: "NOT to disclose any information about anyone contacting LDAH for assistance." },
      { t: "li", text: "Any questions I have regarding this Confidentiality Agreement, will be addressed by: {SUPERVISOR} (staff person supervising volunteer)." },
    ],
  },
  drugFree: {
    title: "Drug-Free Workplace Policy",
    version: "2017; web v1",
    heading: "Drug-Free Workplace Policy Statement",
    blocks: [
      { t: "p", text: "It is our policy to maintain a drug-free workplace and to comply with the Drug Free Workplace Act of 1988, 34 CFR Part 85, Subpart F." },
      // The 2017 paper form names the organisation by its retired name. The
      // current legal name is used instead (standing order, 2026-08-18).
      { t: "p", text: "Unlawful manufacture, distribution, dispensing, possession, and/or use of a controlled substance is prohibited in the workplace. This includes the main office and any other sites where employees and/or volunteers may be performing tasks associated with their job or on behalf of " + ORG_NAME + "." },
      { t: "p", text: "Volunteers are required to comply with the agency’s Drug-Free Workplace Policy and all appropriate statutes. Any employee and/or volunteer who is found to be manufacturing and/or dispensing controlled substances in the workplace will be terminated immediately; no prior warning is required." },
      { t: "h", text: "Drug-Free Workplace Policy for Volunteers" },
      { t: "p", text: "I, {NAME}, have read the Drug-Free Workplace Policy and agree to the conditions, requirements, and penalties stated therein." },
    ],
  },
};

const CERTIFY_TEXT = "I have read this document and I agree to it. Typing my name above is my electronic signature.";

// ── Pure helpers (exported for tests) ─────────────────────────────────────
function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function newToken() {
  return crypto.randomBytes(32).toString("hex");   // 64 characters
}

function cleanText(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max || 200);
}

function normName(v) {
  return String(v || "").toLowerCase().replace(/[^a-zÀ-ɏʻ' -]/g, "").replace(/\s+/g, " ").trim();
}

function fillAgreement(key, opts) {
  const a = AGREEMENTS[key];
  if (!a) return null;
  const sup = (opts && opts.supervisorName) || DEFAULT_SUPERVISOR;
  const name = (opts && opts.name) || "________";
  const fill = (s) => String(s).replace(/\{SUPERVISOR\}/g, sup).replace(/\{NAME\}/g, name);
  return {
    key, title: a.title, version: a.version, heading: a.heading || a.title,
    intro: a.intro ? fill(a.intro) : "",
    blocks: a.blocks.map((b) => ({ t: b.t, text: fill(b.text), sub: (b.sub || []).map(fill) })),
  };
}

// Plain-text copy of exactly what was signed, stored with the signature.
function agreementPlainText(filled) {
  const lines = [filled.heading];
  if (filled.intro) lines.push(filled.intro);
  filled.blocks.forEach((b) => {
    lines.push((b.t === "li" ? "• " : "") + b.text);
    (b.sub || []).forEach((s) => lines.push("    o " + s));
  });
  return lines.join("\n");
}

function parseHHMM(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || "").trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }

// Hours between two HH:MM times on the same day. null when invalid.
function hoursBetween(timeIn, timeOut) {
  const a = parseHHMM(timeIn), b = parseHHMM(timeOut);
  if (a == null || b == null || b <= a) return null;
  return round2((b - a) / 60);
}

// Validates one service-log entry. Returns { ok, entry } or { ok:false, error }.
// The split defaults to all-LDAH. PTI and SRP are taken as given and LDAH is
// whatever remains, so the three always add up to the total.
function validateLogEntry(d, todayKey) {
  const x = d || {};
  const serviceDate = String(x.serviceDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return { ok: false, error: "Pick the date you volunteered." };
  if (serviceDate < "2018-01-01") return { ok: false, error: "That date looks too early. Check the year." };
  if (todayKey && serviceDate > todayKey) return { ok: false, error: "That date is in the future. Log hours after you have done them." };
  let serviceType = cleanText(x.serviceType, 60);
  if (!serviceType) return { ok: false, error: "Choose what kind of service it was." };
  const detail = cleanText(x.serviceDetail, 120);
  const hours = hoursBetween(x.timeIn, x.timeOut);
  if (hours == null) return { ok: false, error: "Time out must be later than time in." };
  if (hours > MAX_ENTRY_HOURS) return { ok: false, error: "That is more than " + MAX_ENTRY_HOURS + " hours. Please split it into separate days." };
  const num = (v) => (v === "" || v == null) ? 0 : Number(v);
  const pti = round2(num(x.pti)), srp = round2(num(x.srp));
  if (!isFinite(pti) || !isFinite(srp) || pti < 0 || srp < 0) return { ok: false, error: "Hours for PTI and SRP must be 0 or more." };
  const ldah = round2(hours - pti - srp);
  if (ldah < -0.001) return { ok: false, error: "PTI and SRP hours add up to more than the " + hours + " hours you worked." };
  return { ok: true, entry: {
    serviceDate, serviceType, serviceDetail: detail,
    timeIn: String(x.timeIn).trim(), timeOut: String(x.timeOut).trim(),
    hours, ldah: Math.max(0, ldah), pti, srp,
  } };
}

function sumTotals(entries) {
  const t = { ldah: 0, pti: 0, srp: 0, total: 0, count: 0 };
  (entries || []).forEach((e) => {
    t.ldah += Number(e.ldah) || 0; t.pti += Number(e.pti) || 0; t.srp += Number(e.srp) || 0;
    t.total += Number(e.hours) || 0; t.count += 1;
  });
  t.ldah = round2(t.ldah); t.pti = round2(t.pti); t.srp = round2(t.srp); t.total = round2(t.total);
  return t;
}

function cleanPhone(v) {
  const s = cleanText(v, 40);
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  return (digits.length >= 7 && digits.length <= 15) ? s : null;   // null = invalid
}

// Validates the emergency form. At least one contact with a name and a phone.
function validateEmergency(d) {
  const x = d || {};
  const raw = Array.isArray(x.contacts) ? x.contacts.slice(0, MAX_CONTACTS) : [];
  const contacts = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] || {};
    const row = {
      name: cleanText(c.name, 100), relationship: cleanText(c.relationship, 60),
      homePhone: cleanPhone(c.homePhone), workPhone: cleanPhone(c.workPhone), cellPhone: cleanPhone(c.cellPhone),
    };
    const any = row.name || row.relationship || c.homePhone || c.workPhone || c.cellPhone;
    if (!any) continue;
    if (row.homePhone === null || row.workPhone === null || row.cellPhone === null) {
      return { ok: false, error: "Contact " + (i + 1) + ": a phone number looks incomplete." };
    }
    if (!row.name) return { ok: false, error: "Contact " + (i + 1) + ": add a name." };
    if (!row.homePhone && !row.workPhone && !row.cellPhone) return { ok: false, error: "Contact " + (i + 1) + ": add at least one phone number." };
    contacts.push(row);
  }
  if (!contacts.length) return { ok: false, error: "Add at least one emergency contact." };
  return { ok: true, value: { contacts, additionalInfo: cleanText(x.additionalInfo, 2000) } };
}

function validateSignature(d) {
  const x = d || {};
  const printedName = cleanText(x.printedName, 100);
  const signature = cleanText(x.signature, 100);
  if (normName(printedName).replace(/[^a-zÀ-ɏ]/g, "").length < 2) return { ok: false, error: "Print your full name." };
  if (!signature) return { ok: false, error: "Type your name to sign." };
  if (normName(signature) !== normName(printedName)) return { ok: false, error: "Type your signature exactly as your printed name." };
  if (x.certified !== true) return { ok: false, error: "Tick the box to confirm you agree." };
  return { ok: true, value: { printedName, signature } };
}

// The full application (volunteerApplicationDetails/{id}) holds two emergency
// contacts. Its field names are read defensively: an array, numbered objects,
// or flat numbered fields all work, so a rename there degrades to "no pre-fill"
// rather than an error.
function contactsFromApplication(app) {
  const a = app || {};
  const out = [];
  const push = (c) => {
    if (!c || typeof c !== "object") return;
    // The full application (volunteer.html Step 2) stores { name, relationship, dayPhone }.
    const phone = c.dayPhone || c.phone || c.phoneNumber || c.mobile || c.cell || c.cellPhone || "";
    const row = {
      name: String(c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || "").trim(),
      relationship: String(c.relationship || c.relation || "").trim(),
      homePhone: String(c.homePhone || c.home || "").trim(),
      workPhone: String(c.workPhone || c.work || "").trim(),
      cellPhone: String(c.cellPhone || (c.homePhone || c.workPhone ? "" : phone) || "").trim(),
    };
    if (row.name || row.homePhone || row.workPhone || row.cellPhone) out.push(row);
  };
  const ec = a.emergencyContacts || a.emergency || (a.full && a.full.emergencyContacts);
  if (Array.isArray(ec)) ec.forEach(push);
  else if (ec && typeof ec === "object") Object.keys(ec).sort().forEach((k) => push(ec[k]));
  if (!out.length) {
    [1, 2, 3].forEach((n) => {
      push(a["emergencyContact" + n] || a["emergency" + n] || a["ec" + n]);
      if (a["ec" + n + "Name"] || a["emergency" + n + "Name"]) {
        push({
          name: a["ec" + n + "Name"] || a["emergency" + n + "Name"],
          relationship: a["ec" + n + "Relationship"] || a["emergency" + n + "Relationship"],
          phone: a["ec" + n + "Phone"] || a["emergency" + n + "Phone"],
        });
      }
    });
  }
  return out.slice(0, MAX_CONTACTS);
}

function hstTodayKey(nowMs) {
  // Hawaii has no DST: UTC-10 always.
  return new Date((nowMs || Date.now()) - 10 * 3600 * 1000).toISOString().slice(0, 10);
}

function tsIso(v) {
  try { return v && v.toDate ? v.toDate().toISOString() : (v || null); } catch (e) { return null; }
}

// ── Email ─────────────────────────────────────────────────────────────────
function buildDocumentsEmailHtml({ firstName, link, supervisorName, isResend, deps }) {
  const esc = deps._emailEsc;
  const P = (s) => '<p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.55;">' + s + "</p>";
  const item = (n, t, d) =>
    '<tr><td style="padding:7px 12px 7px 0;vertical-align:top;width:30px;">' +
      '<div style="width:26px;height:26px;border-radius:13px;background:#E0F2FE;color:#0369A1;font-weight:700;font-size:14px;text-align:center;line-height:26px;font-family:Arial,Helvetica,sans-serif;">' + n + "</div></td>" +
    '<td style="padding:7px 0;font-family:Arial,Helvetica,sans-serif;"><div style="font-size:15px;font-weight:700;color:#1E293B;">' + t + '</div><div style="font-size:13px;color:#64748B;line-height:1.45;">' + d + "</div></td></tr>";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Your volunteer documents</title></head>
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
      <div style="font-size:20px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">Your volunteer documents</div>
    </td>
  </tr>
  <tr>
    <td style="padding:32px;">
      ${P("Aloha " + esc(firstName || "there") + ",")}
      ${P(isResend
        ? "Here is your personal link to your LDAH volunteer documents again. It is the same link as before."
        : "Mahalo for volunteering with Leadership in Disabilities and Achievement of Hawai&#699;i. Before you start, we need a few short documents from you. They take about 10 minutes and work well on a phone.")}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
        ${item(1, "Confidentiality Agreement", "Read it, then sign by typing your name.")}
        ${item(2, "Drug-Free Workplace Policy", "Read it, then sign by typing your name.")}
        ${item(3, "Emergency Contact Form", "Who we should call if something happens while you volunteer.")}
        ${item(4, "Volunteer Service Log", "Log your volunteer hours whenever you help. Keep coming back to it.")}
      </table>
      ${deps._emailBtn(link, "Open my volunteer documents", { bg: "#0891B2" })}
      <p style="margin:18px 0 16px;font-size:15px;color:#555555;line-height:1.55;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:6px;padding:12px 14px;">
        <strong>Keep this email.</strong> This link is just for you. Use it any time to log your volunteer hours.
      </p>
      ${P("Your supervising staff person is <strong>" + esc(supervisorName) + "</strong>. If you have any questions, call us at <a href=\"tel:+18085369684\" style=\"color:#1a73e8;text-decoration:none;\">(808) 536-9684</a>.")}
      <p style="margin:0 0 4px;font-size:15px;color:#333333;line-height:1.5;">Mahalo,</p>
      <p style="margin:0 0 0;font-size:15px;color:#333333;line-height:1.5;"><strong>The LDAH Volunteer Team</strong></p>
      ${deps._emailLinkFooter([{ label: "Your volunteer documents", href: link }])}
    </td>
  </tr>
  ${deps.orgFooterHtml || ""}
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Firestore helpers ─────────────────────────────────────────────────────
async function resolveToken(db, token) {
  const t = String(token || "").trim();
  if (!/^[a-f0-9]{64}$/.test(t)) return null;
  const snap = await db.collection(TOKENS).doc(hashToken(t)).get();
  if (!snap.exists) return null;
  const volunteerId = (snap.data() || {}).volunteerId;
  return volunteerId ? { volunteerId, tokenHash: snap.id } : null;
}

function notFound() {
  return new functions.https.HttpsError("not-found",
    "This link is not valid any more. Please contact LDAH at (808) 536-9684 and we will send you a new one.");
}

function signedSummary(rec) {
  if (!rec || !rec.signedAt) return { signed: false };
  return { signed: true, signedAt: tsIso(rec.signedAt), printedName: rec.printedName || "" };
}

// ── Factory: index.js injects the shared email helpers ────────────────────
function build(deps) {
  const d = deps || {};
  const secrets = d.EMAIL_SECRETS || ["RESEND_API_KEY", "SMTP_FROM"];

  // Staff: send (or resend) the documents link. superAdmin / admin only.
  const sendVolunteerDocuments = functions
    .runWith({ timeoutSeconds: 60, maxInstances: 3, secrets })
    .https.onCall(async (data, context) => {
      if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Please sign in.");
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const roleSnap = await db.collection("userRoles").doc(context.auth.uid).get();
      const roleDoc = roleSnap.exists ? (roleSnap.data() || {}) : {};
      if (["superAdmin", "admin"].indexOf(roleDoc.role || "") === -1) {
        throw new functions.https.HttpsError("permission-denied", "Only a Super Admin or Admin can send volunteer documents.");
      }
      const volunteerId = cleanText((data || {}).volunteerId, 128);
      if (!volunteerId || volunteerId.indexOf("/") !== -1) throw new functions.https.HttpsError("invalid-argument", "Missing volunteer.");
      const supervisorName = cleanText((data || {}).supervisorName, 80) || DEFAULT_SUPERVISOR;
      const wantNewLink = (data || {}).newLink === true;

      const vSnap = await db.collection("volunteers").doc(volunteerId).get();
      if (!vSnap.exists) throw new functions.https.HttpsError("not-found", "That volunteer no longer exists.");
      const v = vSnap.data() || {};
      if (v.status !== "accepted") throw new functions.https.HttpsError("failed-precondition", "Only accepted volunteers can be sent documents.");
      if (v.archived === true) throw new functions.https.HttpsError("failed-precondition", "This volunteer is archived.");
      const email = String(v.email || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new functions.https.HttpsError("failed-precondition", "This volunteer has no valid email address.");
      const volunteerName = [v.firstName, v.lastName].filter(Boolean).join(" ").trim() || email;

      const ref = db.collection(COLLECTION).doc(volunteerId);
      const cur = await ref.get();
      const prev = cur.exists ? (cur.data() || {}) : {};
      const lastMs = prev.lastSentAt && prev.lastSentAt.toMillis ? prev.lastSentAt.toMillis() : 0;
      if (lastMs && Date.now() - lastMs < RESEND_COOLDOWN_MS) {
        throw new functions.https.HttpsError("resource-exhausted", "The documents were sent less than 2 minutes ago. Please wait before sending again.");
      }

      // Reuse the volunteer's existing link unless a new one is asked for.
      let token = null;
      const existing = await db.collection(TOKENS).where("volunteerId", "==", volunteerId).get();
      if (!wantNewLink) {
        existing.forEach((t) => { if (!token && (t.data() || {}).token) token = t.data().token; });
      }
      const batch = db.batch();
      if (!token) {
        token = newToken();
        existing.forEach((t) => batch.delete(t.ref));   // a new link retires the old one
        batch.set(db.collection(TOKENS).doc(hashToken(token)), {
          volunteerId, token, createdAt: FieldValue.serverTimestamp(),
        });
      }
      const isResend = !!prev.sentAt;
      // Stamp BEFORE sending, so a second click inside the cooldown is refused.
      const stamp = {
        volunteerId, volunteerName, volunteerEmail: email,
        tokenHash: hashToken(token), supervisorName,
        lastSentAt: FieldValue.serverTimestamp(),
        sendCount: FieldValue.increment(1),
        sentByUid: context.auth.uid, sentByName: roleDoc.displayName || roleDoc.name || roleDoc.email || "",
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (!isResend) stamp.sentAt = FieldValue.serverTimestamp();
      batch.set(ref, stamp, { merge: true });
      await batch.commit();

      const link = DOCS_PAGE_URL + "?t=" + token;
      const orgFooterHtml = d.getOrgFooterHtml ? await d.getOrgFooterHtml() : "";
      const html = buildDocumentsEmailHtml({
        firstName: v.firstName || "", link, supervisorName, isResend,
        deps: { _emailEsc: d._emailEsc, _emailBtn: d._emailBtn, _emailLinkFooter: d._emailLinkFooter, orgFooterHtml },
      });
      try {
        await d.sendEmailViaResend({
          from: d.lifecycleFromAddress ? d.lifecycleFromAddress() : ("LDAH <" + (process.env.SMTP_FROM || "") + ">"),
          to: [email],
          subject: isResend ? "Your LDAH volunteer documents (link inside)" : "Welcome to LDAH: your volunteer documents",
          html,
          type: "volunteerDocuments",
          recipientName: volunteerName,
        });
      } catch (e) {
        await ref.set({ lastSendError: String(e.message || e).slice(0, 300), lastSendErrorAt: FieldValue.serverTimestamp() }, { merge: true });
        throw new functions.https.HttpsError("internal", "The email could not be sent: " + String(e.message || e).slice(0, 200));
      }
      await ref.set({ lastSendError: FieldValue.delete() }, { merge: true });
      return { ok: true, resent: isResend, email };
    });

  // Public (token): everything the documents page needs.
  const getVolunteerDocuments = functions
    .runWith({ timeoutSeconds: 30, maxInstances: 10 })
    .https.onCall(async (data) => {
      if ((data || {}).warm === true) return { warm: true };
      const db = admin.firestore();
      const tok = await resolveToken(db, (data || {}).token);
      if (!tok) throw notFound();
      const ref = db.collection(COLLECTION).doc(tok.volunteerId);
      const [onbSnap, vSnap, appSnap, logSnap] = await Promise.all([
        ref.get(),
        db.collection("volunteers").doc(tok.volunteerId).get(),
        db.collection("volunteerApplicationDetails").doc(tok.volunteerId).get().catch(() => null),
        ref.collection("logs").orderBy("serviceDate", "desc").limit(500).get(),
      ]);
      if (!onbSnap.exists || !vSnap.exists) throw notFound();
      const o = onbSnap.data() || {};
      if (o.tokenHash !== tok.tokenHash) throw notFound();
      const v = vSnap.data() || {};
      const name = [v.firstName, v.lastName].filter(Boolean).join(" ").trim();
      const docs = o.docs || {};
      const supervisorName = o.supervisorName || DEFAULT_SUPERVISOR;

      const agreements = {};
      ["confidentiality", "drugFree"].forEach((k) => {
        const signed = docs[k] && docs[k].signedAt;
        const filled = fillAgreement(k, {
          supervisorName: signed ? (docs[k].supervisorName || supervisorName) : supervisorName,
          name: signed ? docs[k].printedName : "",
        });
        agreements[k] = Object.assign(filled, signedSummary(docs[k]));
      });

      const em = docs.emergency || null;
      const prefill = (!em && appSnap && appSnap.exists) ? contactsFromApplication(appSnap.data()) : [];
      const entries = [];
      logSnap.forEach((s) => {
        const e = s.data() || {};
        entries.push({ id: s.id, serviceDate: e.serviceDate, serviceType: e.serviceType, serviceDetail: e.serviceDetail || "",
          timeIn: e.timeIn, timeOut: e.timeOut, hours: e.hours, ldah: e.ldah, pti: e.pti, srp: e.srp });
      });
      return {
        ok: true,
        volunteer: { firstName: v.firstName || "", name },
        supervisorName,
        certifyText: CERTIFY_TEXT,
        agreements,
        emergency: em
          ? { done: true, submittedAt: tsIso(em.submittedAt), updatedAt: tsIso(em.updatedAt), contacts: em.contacts || [], additionalInfo: em.additionalInfo || "", prefilled: false }
          : { done: false, contacts: prefill, additionalInfo: "", prefilled: prefill.length > 0 },
        log: { entries, totals: sumTotals(entries) },
        serviceTypes: SERVICE_TYPES,
        today: hstTodayKey(),
      };
    });

  // Public (token): save one document, or add / remove one log entry.
  //   doc: 'confidentiality' | 'drugFree' | 'emergency' | 'log' | 'logDelete'
  const submitVolunteerDocument = functions
    .runWith({ timeoutSeconds: 30, maxInstances: 10 })
    .https.onCall(async (data) => {
      /* SPEED (2026-10-02): the page sends {warm:true} when it loads, so this
         instance is up before the volunteer presses a button. */
      if ((data || {}).warm === true) return { warm: true };
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const tok = await resolveToken(db, (data || {}).token);
      if (!tok) throw notFound();
      const ref = db.collection(COLLECTION).doc(tok.volunteerId);
      const onb = await ref.get();
      if (!onb.exists || (onb.data() || {}).tokenHash !== tok.tokenHash) throw notFound();
      const o = onb.data() || {};
      const docKey = String((data || {}).doc || "");
      const payload = (data || {}).data || {};
      const bad = (msg) => new functions.https.HttpsError("invalid-argument", msg);

      if (docKey === "confidentiality" || docKey === "drugFree") {
        if (o.docs && o.docs[docKey] && o.docs[docKey].signedAt) {
          return { ok: true, alreadySigned: true, signedAt: tsIso(o.docs[docKey].signedAt) };
        }
        const sig = validateSignature(payload);
        if (!sig.ok) throw bad(sig.error);
        const supervisorName = o.supervisorName || DEFAULT_SUPERVISOR;
        const filled = fillAgreement(docKey, { supervisorName, name: sig.value.printedName });
        await ref.set({ docs: { [docKey]: {
          printedName: sig.value.printedName, signature: sig.value.signature,
          certified: true, certifyText: CERTIFY_TEXT,
          signedAt: FieldValue.serverTimestamp(),
          version: filled.version, text: agreementPlainText(filled),
          heading: filled.heading, intro: filled.intro, blocks: filled.blocks,
          supervisorName: docKey === "confidentiality" ? supervisorName : null,
        } }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return { ok: true, doc: docKey, signedAt: new Date().toISOString() };
      }

      if (docKey === "emergency") {
        const r = validateEmergency(payload);
        if (!r.ok) throw bad(r.error);
        const first = !(o.docs && o.docs.emergency && o.docs.emergency.submittedAt);
        const rec = { contacts: r.value.contacts, additionalInfo: r.value.additionalInfo, updatedAt: FieldValue.serverTimestamp() };
        if (first) rec.submittedAt = FieldValue.serverTimestamp();
        await ref.set({ docs: { emergency: rec }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return { ok: true, doc: "emergency" };
      }

      if (docKey === "log" || docKey === "logDelete") {
        let added = null;
        if (docKey === "log") {
          const r = validateLogEntry(payload, hstTodayKey());
          if (!r.ok) throw bad(r.error);
          added = r.entry;
        }
        const delId = docKey === "logDelete" ? cleanText(payload.entryId, 64) : "";
        if (docKey === "logDelete" && (!delId || delId.indexOf("/") !== -1)) throw bad("Missing entry.");
        const logs = ref.collection("logs");
        const newRef = added ? logs.doc() : null;
        const totals = await db.runTransaction(async (tx) => {
          const all = await tx.get(logs);
          const list = [];
          let found = false;
          all.forEach((s) => { if (s.id === delId) { found = true; return; } list.push(s.data() || {}); });
          if (docKey === "logDelete" && !found) throw new functions.https.HttpsError("not-found", "That entry was already removed.");
          if (added) list.push(added);
          const t = sumTotals(list);
          if (added) tx.set(newRef, Object.assign({}, added, { createdAt: FieldValue.serverTimestamp() }));
          if (delId) tx.delete(logs.doc(delId));
          tx.set(ref, { logTotals: Object.assign({}, t, { lastEntryAt: FieldValue.serverTimestamp() }), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          return t;
        });
        return { ok: true, doc: docKey, entryId: newRef ? newRef.id : delId, entry: added, totals };
      }

      throw bad("Unknown document.");
    });

  return { sendVolunteerDocuments, getVolunteerDocuments, submitVolunteerDocument };
}

module.exports = build;
module.exports._pure = {
  AGREEMENTS, SERVICE_TYPES, DEFAULT_SUPERVISOR, CERTIFY_TEXT, DOCS_PAGE_URL,
  hashToken, newToken, fillAgreement, agreementPlainText, hoursBetween, validateLogEntry,
  sumTotals, validateEmergency, validateSignature, contactsFromApplication, hstTodayKey,
  buildDocumentsEmailHtml,
};
