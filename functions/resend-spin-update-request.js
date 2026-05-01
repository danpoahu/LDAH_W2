// One-shot: re-send the resource update request to SPIN with the FIXED
// email template (solid background-color fallback so the button renders
// even on email clients that strip CSS gradients). Regenerates the token
// so the original broken-button email's link is invalidated.
//
// Run:  node resend-spin-update-request.js          (dry run)
//       node resend-spin-update-request.js --send   (regenerate token + send)

const admin = require("firebase-admin");
const { applicationDefault } = require("firebase-admin/app");
const { execSync } = require("child_process");
const crypto = require("crypto");

admin.initializeApp({ credential: applicationDefault(), projectId: "ldah-932d5" });
const db = admin.firestore();

const SPIN_RESOURCE_ID = "VqkCDfrU6bMq706TyoOu";
const ADMIN_EMAIL = "danpellegrini63@gmail.com";
const RESOURCE_UPDATE_FORM_BASE = "https://www.ldahawaii.org/update-resource.html";
const SEND = process.argv.includes("--send");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
function link(token) {
  return RESOURCE_UPDATE_FORM_BASE + "?token=" + encodeURIComponent(token);
}

function buildEmailHtml({ resource, token }) {
  const orgName = esc((resource && resource.name) || "your organization");
  const heading = "Time for your semi-annual update";
  const headerLabel = "Resource Card Update";
  const headerGradient = "linear-gradient(135deg,#1e40af,#0891B2)";
  const headerColor = "#1e40af";
  const lead = "Twice a year we ask each partner organization to take a couple of minutes to review the resource card we keep for you on the LDAH website. This keeps the families and individuals who rely on our resource directory pointed to current information for " + orgName + ".";

  let bodyHtml =
    '<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.6">' + lead + '</p>' +
    '<p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6">' +
      'Click the button below to review your card. If everything looks good, you can confirm in one tap. If anything needs to change, edit the fields and submit &mdash; our team will review and post the update.' +
    '</p>' +
    '<p style="text-align:center;margin:32px 0">' +
      '<a href="' + link(token) + '" style="background-color:#0891B2;background:linear-gradient(135deg,#0891B2,#0E7490);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block">Review Your Card</a>' +
    '</p>' +
    '<p style="margin:0 0 16px;font-size:14px;color:#64748b;line-height:1.6">' +
      'If your logo has changed since we last spoke, please email the new file to <a href="mailto:LSalvani@ldahawaii.org" style="color:#1a73e8;text-decoration:none;">LSalvani@ldahawaii.org</a> and we\'ll update it for you.' +
    '</p>' +
    '<p style="margin:24px 0 4px;font-size:15px;color:#333333;line-height:1.5;">If you have any questions, please contact us.</p>' +
    '<p style="margin:0 0 4px;font-size:15px;color:#333333;line-height:1.5;">With gratitude,</p>' +
    '<p style="margin:0 0 16px;font-size:15px;color:#333333;line-height:1.5;"><strong>LDAH Team</strong></p>' +
    '<p style="margin:16px 0 2px;font-size:14px;color:#555555;line-height:1.5;">' +
      '<strong>La\'a Salvani</strong><br>' +
      'Administrative Assistant<br>' +
      'Leadership in Disabilities &amp; Achievement of Hawai\'i<br>' +
      '245 N. Kukui St. Ste. 205, Honolulu, HI 96817<br>' +
      'Phone: (808) 536-9684<br>' +
      'Email: <a href="mailto:LSalvani@ldahawaii.org" style="color:#1a73e8;text-decoration:none;">LSalvani@ldahawaii.org</a><br>' +
      '<a href="https://www.ldahawaii.org" style="color:#1a73e8;text-decoration:none;">LDAHawaii.org</a>' +
    '</p>';

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(heading) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1f2937">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff">' +
    '<div style="background-color:' + headerColor + ';background:' + headerGradient + ';padding:18px 24px 22px;text-align:center;color:#fff">' +
    '<img src="https://www.ldahawaii.org/logo_blue.png" alt="LDAH" width="120" style="display:block;margin:0 auto 10px;background:#fff;border-radius:10px;padding:8px 14px;border:0;outline:none;text-decoration:none;">' +
    '<h1 style="margin:0;font-size:22px;font-weight:700">' + esc(headerLabel) + '</h1></div>' +
    '<div style="padding:32px 24px">' +
    '<p style="margin:0 0 16px;font-size:16px">Aloha ' + orgName + ' team,</p>' +
    '<h2 style="margin:0 0 16px;color:#004E7C;font-size:22px">' + esc(heading) + '</h2>' +
    bodyHtml +
    '</div>' +
    '<div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;font-size:12px;color:#94a3b8;text-align:center">' +
    '<p style="margin:0">Leadership in Disabilities and Achievement of Hawai\'i</p>' +
    '</div></div></body></html>';
}

(async () => {
  const ref = db.collection("resources").doc(SPIN_RESOURCE_ID);
  const snap = await ref.get();
  if (!snap.exists) { console.error("SPIN doc not found"); process.exit(1); }
  const resource = snap.data();
  console.log("Found:", resource.name, "<" + resource.email + ">");
  console.log("Old token:", resource.updateToken);

  const newToken = crypto.randomBytes(16).toString("hex");
  console.log("New token:", newToken);
  console.log("New link: ", link(newToken));

  if (!SEND) {
    console.log("\n(dry run — re-run with --send to actually send)");
    process.exit(0);
  }

  // Update the resource doc with the new token, mirroring sendResourceUpdateRequests.
  await ref.update({
    updateToken: newToken,
    updateRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
    updateRequestedBy: ADMIN_EMAIL,
    updateNudgeCount: 0,
    lastUpdateNudgeAt: null,
    updateSubmittedAt: null,
    pendingUpdate: null,
  });

  const html = buildEmailHtml({ resource, token: newToken });

  const apiKey = execSync("firebase functions:secrets:access RESEND_API_KEY --project ldah-932d5", { encoding: "utf8" }).trim();
  const fromAddr = "LDAH <registration@ldahawaii.org>";

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromAddr,
      to: [resource.email],
      subject: "Action Required: Update your LDAH Resource Card",
      html,
    }),
  });
  const text = await resp.text();
  if (!resp.ok) {
    console.error("Resend error:", resp.status, text);
    await db.collection("emailLog").add({
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      from: fromAddr, to: resource.email, bcc: "", subject: "Action Required: Update your LDAH Resource Card",
      html, type: "resource-update-request-resend", relatedEventId: "", relatedSignupId: "",
      recipientName: resource.name || "", success: false, error: "Resend " + resp.status + ": " + text, resendId: null,
    });
    process.exit(1);
  }
  const result = JSON.parse(text);
  console.log("\nResend OK, id:", result.id);

  await db.collection("emailLog").add({
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    from: fromAddr, to: resource.email, bcc: "", subject: "Action Required: Update your LDAH Resource Card",
    html, type: "resource-update-request", relatedEventId: "", relatedSignupId: "",
    recipientName: resource.name || "", success: true, error: null, resendId: result.id,
  });
  console.log("Logged to emailLog.");
})().catch((err) => { console.error("Error:", err); process.exit(1); });
