// Recover Leilani's May 4 Connect-Gen signup — the consent email never
// went out because the maybeSendRegistrationConfirmation 5-day window
// skip fired before the Connect-Gen branch (now fixed). This script
// regenerates her consentToken and re-sends the consent-required email
// using the already-deployed buildConsentRequiredEmailHtml helper.
//
// Usage: node recover-leilani-consent.js [--send]

const admin = require("firebase-admin");
const { applicationDefault } = require("firebase-admin/app");
const { execSync } = require("child_process");
const crypto = require("crypto");
admin.initializeApp({ credential: applicationDefault(), projectId: "ldah-932d5" });
const db = admin.firestore();
const SEND = process.argv.includes("--send");

// Connect-Gen recurringEvents id (from earlier audit).
const CONNECT_GEN_ID = "CmkPXEpPwfAQ5sR377K2";

(async () => {
  const sigs = await db.collection("recurringEvents").doc(CONNECT_GEN_ID).collection("signups").get();
  const candidates = [];
  sigs.forEach((s) => {
    const d = s.data() || {};
    if (d.consentSignedAt) return;
    if ((d.email || "").toLowerCase() !== "lkailiawa@ldahawaii.org") return;
    candidates.push({ id: s.id, data: d });
  });
  if (!candidates.length) { console.error("No unsigned signup for lkailiawa@ldahawaii.org found."); process.exit(1); }
  console.log("Candidates:");
  candidates.forEach((c) => {
    console.log("  -", c.id, "| selectedDates:", c.data.selectedDates || c.data.selectedSessions, "| consentRequiredEmailSentAt:", !!c.data.consentRequiredEmailSentAt);
  });
  // Daniel referenced the May 4 signup. Find the one whose selectedDates
  // include "2026-05-04".
  const target = candidates.find(c => JSON.stringify(c.data.selectedDates || c.data.selectedSessions || "").includes("2026-05-04"))
    || candidates.find(c => !c.data.consentRequiredEmailSentAt)
    || candidates[0];
  console.log("\nSelected:", target.id);

  console.log("Found signup:", target.id);
  console.log("  email:", target.data.email);
  console.log("  consentRequiredEmailSentAt:", target.data.consentRequiredEmailSentAt || "(none)");
  console.log("  selectedDates:", target.data.selectedDates || target.data.selectedSessions);

  const newToken = crypto.randomBytes(16).toString("hex");
  const consentUrl = "https://www.ldahawaii.org/connect-gen-consent.html" +
    "?token=" + encodeURIComponent(newToken) +
    "&e=" + encodeURIComponent(CONNECT_GEN_ID) +
    "&s=" + encodeURIComponent(target.id) +
    "&c=" + encodeURIComponent("recurringEvents");

  console.log("\nNew consent URL:", consentUrl);

  if (!SEND) {
    console.log("\n(dry run — re-run with --send to actually send)");
    process.exit(0);
  }

  // Update signup with the new token + clear stale flags.
  await db.collection("recurringEvents").doc(CONNECT_GEN_ID).collection("signups").doc(target.id).update({
    consentToken: newToken,
    consentRequiredEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Build email body inline (mirrors buildConsentRequiredEmailHtml).
  const safeName = (target.data.name || "there").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const eventTitle = "Connect-Gen";
  const dates = (target.data.selectedDates || target.data.selectedSessions || []);
  const datesPhrase = (dates.length ? ", on " + dates.join(", ") : "");

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1f2937">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff">' +
    '<div style="background-color:#1e40af;background:linear-gradient(135deg,#1e40af,#0891B2);padding:18px 24px 22px;text-align:center;color:#fff">' +
    '<img src="https://www.ldahawaii.org/logo_blue.png" alt="LDAH" width="120" style="display:block;margin:0 auto 10px;background:#fff;border-radius:10px;padding:8px 14px;">' +
    '<h1 style="margin:0;font-size:22px;font-weight:700">Action Required</h1></div>' +
    '<div style="padding:32px 24px">' +
    '<p style="margin:0 0 16px;font-size:16px">Aloha ' + safeName + ',</p>' +
    '<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.6">Mahalo for signing up for <strong>' + eventTitle + '</strong>' + datesPhrase + '. Before we can confirm your appointment, we need a signed consent form on file.</p>' +
    '<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.6">The consent gives LDAH permission to view and discuss your child\'s confidential documents (IEP and Evaluation/Assessment) during the session. Please read it carefully and sign by clicking the button below.</p>' +
    '<p style="text-align:center;margin:32px 0">' +
    '<a href="' + consentUrl + '" style="background-color:#0891B2;background:linear-gradient(135deg,#0891B2,#0E7490);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block">Read &amp; Sign the Consent Form</a>' +
    '</p>' +
    '<p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6"><strong>Until we receive your signed consent, this appointment is not yet confirmed.</strong> Once signed, we will send you a confirmation along with the prep documents you should review before the meeting.</p>' +
    '<p style="margin:24px 0 4px;font-size:15px;color:#333;line-height:1.5;">Questions? Reach out anytime.</p>' +
    '<p style="margin:0 0 4px;font-size:15px;color:#333;line-height:1.5;">With gratitude,</p>' +
    '<p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.5;"><strong>Leilani Kailiawa</strong><br>Leadership in Disabilities &amp; Achievement of Hawai\'i<br>(808) 536-9684</p>' +
    '</div></div></body></html>';

  const apiKey = execSync("firebase functions:secrets:access RESEND_API_KEY --project ldah-932d5", { encoding: "utf8" }).trim();
  const fromAddr = "LDAH <registration@ldahawaii.org>";

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromAddr,
      to: [target.data.email],
      subject: "Action needed -- consent form for Connect-Gen",
      html,
    }),
  });
  const text = await resp.text();
  if (!resp.ok) { console.error("Resend error:", resp.status, text); process.exit(1); }
  const result = JSON.parse(text);
  console.log("\nSent. Resend id:", result.id);

  await db.collection("emailLog").add({
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    from: fromAddr, to: target.data.email, bcc: "", subject: "Action needed -- consent form for Connect-Gen",
    html, type: "connect-gen-consent-required", relatedEventId: CONNECT_GEN_ID, relatedSignupId: target.id,
    recipientName: target.data.name || "", success: true, error: null, resendId: result.id,
  });
  console.log("Logged.");
})().catch((e) => { console.error(e); process.exit(1); });
