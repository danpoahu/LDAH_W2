// ═══════════════════════════════════════════════════════════════════════════
// Volunteer application link (2026-10-02)
//
// Someone who sent only the quick volunteer form (Step 1 on volunteer.html)
// has a volunteers/{id} doc but no full application. Staff press "Resend
// application link" on their Int Applications card; the applicant gets a
// branded LDAH email with ONE personal link that opens Step 2 directly, pre-
// filled, on ANY device:
//
//   https://www.ldahawaii.org/STAGE/volunteer.html?apply=<token>
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
// ═══════════════════════════════════════════════════════════════════════════

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");

// The Step 2 page is on STAGE only for now. Change to the root path when promoted.
const APPLY_PAGE_URL = "https://www.ldahawaii.org/STAGE/volunteer.html";
const TOKENS = "volunteerApplyTokens";
const RESEND_COOLDOWN_MS = 2 * 60 * 1000;
const OFFICE_PHONE = "(808) 536-9684";

function hashToken(token) { return crypto.createHash("sha256").update(String(token)).digest("hex"); }
function newToken() { return crypto.randomBytes(32).toString("hex"); }
function cleanText(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max || 200);
}
function applyLink(token) { return APPLY_PAGE_URL + "?apply=" + token; }

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
      return {
        volunteerId: tok.volunteerId,
        firstName: String(v.firstName || ""), lastName: String(v.lastName || ""),
        email: String(v.email || ""), phone: String(v.phone || ""),
        opportunityId: String(v.opportunityId || ""), opportunityTitle,
        alreadyCompleted: appSnap.exists,
      };
    });

  return { sendVolunteerApplicationLink, getVolunteerApplicationPrefill };
}

module.exports = build;
module.exports._pure = { APPLY_PAGE_URL, TOKENS, hashToken, applyLink, buildApplyEmailHtml };
