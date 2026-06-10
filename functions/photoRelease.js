const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");

const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const PHOTO_RELEASE_VERSION = "06/2026; v1";
const PHOTO_RELEASE_TEXT = `__DRAFT_DELIVERED_TO_DANIEL_BEFORE_LIVE__`; // replaced in Task 11 with approved copy

// Base URL for the public signing link (STAGE value; switched to live in Task 11)
const SIGNING_BASE_URL = "https://danpoahu.github.io/LDAH_W2/STAGE/photo-release.html";

const LAA_EMAIL = "LSalvani@LDAHawaii.org";

function newToken() { return crypto.randomBytes(16).toString("hex"); }

async function lookupUidByEmail(email) {
  const snap = await admin.firestore().collection("userRoles")
    .where("email", "==", email).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

// ── Local Resend helper ────────────────────────────────────────────
// Self-contained version scoped to this module. Uses the same Resend
// endpoint and emailLog pattern as index.js's sendEmailViaResend.
// Node 20 provides global fetch — no node-fetch needed.
async function sendMail({ to, subject, html, type, photoReleaseId }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.SMTP_FROM || "onboarding@resend.dev";
  let ok = false, errorBody = null, resendId = null;
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    ok = resp.ok;
    if (ok) {
      const j = await resp.json().catch(() => null);
      resendId = j && j.id;
    } else {
      errorBody = await resp.text();
    }
  } catch (e) {
    errorBody = e.message;
  }
  await admin.firestore().collection("emailLog").add({
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    from,
    to,
    bcc: "",
    subject,
    html,
    type,
    photoReleaseId: photoReleaseId || "",
    success: ok,
    error: errorBody,
    resendId,
  }).catch(() => {});
  return ok;
}

// ── Email body ────────────────────────────────────────────────────
// Plain, clean HTML using inline styles. No emojis per LDAH rules.
function releaseEmailHtml(signLink, requesterName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Photo Release Request</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#005f73;padding:24px 32px;">
              <p style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">
                Leadership in Disabilities &amp; Achievement of Hawai&#699;i
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px;font-size:16px;color:#222222;line-height:1.5;">
                Aloha,
              </p>
              <p style="margin:0 0 16px;font-size:16px;color:#222222;line-height:1.5;">
                <strong>${requesterName}</strong> would like to display a photo that includes you
                on the LDAH website. Before the photo is published, we are required to obtain your
                written permission.
              </p>
              <p style="margin:0 0 16px;font-size:16px;color:#222222;line-height:1.5;">
                By signing the release below, you grant LDAH permission to use the photo on our
                website and related digital materials. Your signature takes only a moment and is
                securely recorded.
              </p>
              <p style="margin:0 0 24px;font-size:16px;color:#222222;line-height:1.5;">
                If you have any questions before signing, please contact us at
                <a href="mailto:${LAA_EMAIL}" style="color:#005f73;">${LAA_EMAIL}</a>.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
                <tr>
                  <td style="background:#005f73;border-radius:4px;">
                    <a href="${signLink}"
                       style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;">
                      Review and Sign the Photo Release
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:14px;color:#555555;line-height:1.5;">
                If the button above does not work, copy and paste the link below into your browser:
              </p>
              <p style="margin:0;font-size:13px;color:#005f73;word-break:break-all;">
                <a href="${signLink}" style="color:#005f73;">${signLink}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f0f0f0;padding:16px 32px;border-top:1px solid #dddddd;">
              <p style="margin:0;font-size:12px;color:#888888;line-height:1.5;">
                This message was sent by Leadership in Disabilities &amp; Achievement of Hawai&#699;i (LDAH).
                If you believe you received this in error, please disregard it or contact us at
                <a href="mailto:${LAA_EMAIL}" style="color:#555555;">${LAA_EMAIL}</a>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Cloud Function: createPhotoReleaseRequest ─────────────────────
exports.createPhotoReleaseRequest = functions
  .runWith({
    timeoutSeconds: 120,
    maxInstances: 5,
    secrets: ["RESEND_API_KEY", "SMTP_FROM"],
  })
  .https.onRequest(async (req, res) => {
    // CORS
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "3600");

    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const {
      pageKey, island, fieldKey, slot, newPhotoUrl, previousPhotoUrl,
      requestedBy, requestedByEmail, requestedByName, emails,
    } = req.body || {};

    // Validate required fields
    if (!newPhotoUrl || !island || !fieldKey) {
      res.status(400).json({ error: "Missing required fields: newPhotoUrl, island, fieldKey" });
      return;
    }
    if (!Array.isArray(emails) || emails.length === 0) {
      res.status(400).json({ error: "emails must be a non-empty array" });
      return;
    }
    const trimmedEmails = emails.map((e) => (typeof e === "string" ? e.trim() : "")).filter(Boolean);
    if (trimmedEmails.length === 0) {
      res.status(400).json({ error: "emails array contains no valid addresses" });
      return;
    }

    // Build subject entries and token index
    const subjects = trimmedEmails.map((email) => ({
      email,
      token: newToken(),
      status: "pending",
    }));
    const tokenIndex = subjects.map((s) => s.token);

    // Write photoReleases doc
    // NOTE: serverTimestamp() must NOT appear inside the subjects array (Firestore rejects it).
    const docRef = await admin.firestore().collection("photoReleases").add({
      pageKey: pageKey || "",
      island,
      fieldKey,
      slot: typeof slot === "number" ? slot : Number(slot) || 0,
      requestedBy: requestedBy || "",
      requestedByEmail: requestedByEmail || "",
      requestedByName: requestedByName || "",
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      newPhotoUrl,
      previousPhotoUrl: previousPhotoUrl || "",
      subjectCount: subjects.length,
      subjects,
      tokenIndex,
      state: "awaiting",
      consentVersion: PHOTO_RELEASE_VERSION,
    });

    // Send release request emails
    const senderName = requestedByName || "An LDAH partner";
    for (const s of subjects) {
      const signLink = SIGNING_BASE_URL + "?token=" + s.token;
      await sendMail({
        to: s.email,
        subject: "Please sign a photo release for LDAH",
        html: releaseEmailHtml(signLink, senderName),
        type: "photo-release-request",
        photoReleaseId: docRef.id,
      });
    }

    res.status(200).json({ releaseId: docRef.id });
  });

module.exports = Object.assign(module.exports, {
  PHOTO_RELEASE_VERSION,
  PHOTO_RELEASE_TEXT,
  SIGNING_BASE_URL,
  LAA_EMAIL,
  newToken,
  lookupUidByEmail,
});
