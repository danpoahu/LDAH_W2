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

// ── Email shell + bodies (no emojis per LDAH rules) ───────────────
function wrap(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LDAH Photo Release</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;max-width:600px;width:100%;">
          <tr>
            <td style="background:#005f73;padding:24px 32px;">
              <p style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">
                Leadership in Disabilities &amp; Achievement of Hawai&#699;i
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
${bodyHtml}
            </td>
          </tr>
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

const P = "margin:0 0 16px;font-size:16px;color:#222222;line-height:1.5;";

function verifyPartnerHtml(release) {
  return wrap(`
              <p style="${P}">Aloha,</p>
              <p style="${P}">All photo releases have been signed, so your photo for
                <strong>${release.island}</strong> (slot ${release.slot}) is now live on the LDAH
                Pacific page.</p>
              <p style="${P}">Our team will verify the photo on the live site. If anything looks
                incorrect, it can be reverted. No further action is needed from you.</p>
              <p style="${P}">Mahalo for helping us keep our website current.</p>`);
}

function stallPartnerHtml(release, missing) {
  const list = (missing || []).map((e) => `<li style="margin:0 0 4px;">${e}</li>`).join("");
  return wrap(`
              <p style="${P}">Aloha,</p>
              <p style="${P}">The photo release for <strong>${release.island}</strong>
                (slot ${release.slot}) is still incomplete after 30 days. The following
                ${(missing || []).length} person/people have not yet signed:</p>
              <ul style="${P}padding-left:20px;">${list}</ul>
              <p style="${P}">We have flagged this for our team to follow up. You may wish to
                remind those listed above, or contact us at
                <a href="mailto:${LAA_EMAIL}" style="color:#005f73;">${LAA_EMAIL}</a>.</p>`);
}

function progressPartnerHtml(release, signedCount) {
  return wrap(`
              <p style="${P}">Aloha,</p>
              <p style="${P}">A photo release was just signed for <strong>${release.island}</strong>
                (slot ${release.slot}). So far <strong>${signedCount}</strong> of
                <strong>${release.subjectCount}</strong> people have signed.</p>
              <p style="${P}">Once everyone has signed, the photo will be published automatically and
                we will let you know.</p>`);
}

function reminderHtml(signLink) {
  return wrap(`
              <p style="${P}">Aloha,</p>
              <p style="${P}">This is a friendly reminder that LDAH is still waiting for your
                signature on a photo release. Your signature takes only a moment and is securely
                recorded.</p>
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
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
              </p>`);
}

function reminderPartnerHtml(release, missing) {
  const list = (missing || []).map((s) => `<li style="margin:0 0 4px;">${s.email}</li>`).join("");
  return wrap(`
              <p style="${P}">Aloha,</p>
              <p style="${P}">The photo release for <strong>${release.island}</strong>
                (slot ${release.slot}) is still pending. The following
                ${(missing || []).length} person/people have not yet signed:</p>
              <ul style="${P}padding-left:20px;">${list}</ul>
              <p style="${P}">We have sent them a reminder. No action is required from you at this
                time.</p>`);
}

// ── Task 3: getPhotoRelease ───────────────────────────────────────
exports.getPhotoRelease = functions
  .runWith({ timeoutSeconds: 60, maxInstances: 5 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "3600");

    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    const token = (req.query && req.query.token) ? String(req.query.token) : "";
    if (!token) { res.status(200).json({ status: "notfound" }); return; }

    const snap = await admin.firestore().collection("photoReleases")
      .where("tokenIndex", "array-contains", token).limit(1).get();
    if (snap.empty) { res.status(200).json({ status: "notfound" }); return; }

    const doc = snap.docs[0].data();
    const subject = (doc.subjects || []).find((s) => s.token === token);
    if (!subject) { res.status(200).json({ status: "notfound" }); return; }

    if (subject.status === "signed" || doc.state !== "awaiting") {
      res.status(200).json({ status: "used" });
      return;
    }

    res.status(200).json({
      status: "ok",
      consentText: PHOTO_RELEASE_TEXT,
      version: PHOTO_RELEASE_VERSION,
      requestedByName: doc.requestedByName,
      island: doc.island,
    });
  });

// ── Task 5: internal helpers (not exported as triggers) ───────────
async function createTask({ ownerUid, owner, summary, followUpDate, workflowStep, photoReleaseId, notesExtra }) {
  const ref = await admin.firestore().collection("interactions").add({
    channel: "System",
    interactionType: "Photo Release",
    summary,
    notes: notesExtra || "",
    status: "Open",
    ownerUid,
    owner,
    followUpDate,
    workflowStep,
    photoReleaseId,
    createdBy: "System",
    createdByUid: "system",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

async function notify(uid, name, title, message, interactionId) {
  return admin.firestore().collection("notifications").add({
    recipientUid: uid,
    recipientName: name || "",
    type: "photo-release",
    title,
    message: message || "",
    interactionId: interactionId || "",
    changeRequestId: "",
    editUnlockId: "",
    editUsed: false,
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

function hstToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Honolulu" });
}

async function createVerifyTasks(releaseId, release) {
  const laaUid = await lookupUidByEmail(LAA_EMAIL);
  if (laaUid) {
    const taskId = await createTask({
      ownerUid: laaUid,
      owner: "La'a Salvani",
      summary: "Verify new photo on the live Pacific page (" + release.island + ", slot " + release.slot + ")",
      followUpDate: hstToday(),
      workflowStep: "photoReleaseVerify",
      photoReleaseId: releaseId,
      notesExtra: "Auto-published after all photo releases were signed. Use Review / Revert to keep or roll back.",
    });
    await notify(
      laaUid,
      "La'a Salvani",
      "Photo released and published",
      "A photo for " + release.island + " (slot " + release.slot + ") is now live. Please verify or revert.",
      taskId
    );
  }

  const partnerTaskId = await createTask({
    ownerUid: release.requestedBy,
    owner: release.requestedByName,
    summary: "Verify your new photo on the live site (" + release.island + ", slot " + release.slot + ")",
    followUpDate: hstToday(),
    workflowStep: "photoReleaseVerify",
    photoReleaseId: releaseId,
  });
  await notify(
    release.requestedBy,
    release.requestedByName,
    "Photo released and published",
    "Your photo for " + release.island + " (slot " + release.slot + ") is now live. Please verify or revert.",
    partnerTaskId
  );

  await sendMail({
    to: release.requestedByEmail,
    subject: "Your LDAH photo is now live",
    html: verifyPartnerHtml(release),
    type: "photo-release-live",
    photoReleaseId: releaseId,
  });
}

async function createStallTask(releaseId, release, missingEmails) {
  const laaUid = await lookupUidByEmail(LAA_EMAIL);
  const summary = "Photo release stalled — " + missingEmails.length + " still unsigned (" + release.island + ", slot " + release.slot + ")";
  const notesExtra = "Still unsigned after 30 days: " + missingEmails.join(", ");

  if (laaUid) {
    const taskId = await createTask({
      ownerUid: laaUid,
      owner: "La'a Salvani",
      summary,
      followUpDate: hstToday(),
      workflowStep: "photoReleaseStall",
      photoReleaseId: releaseId,
      notesExtra,
    });
    await notify(
      laaUid,
      "La'a Salvani",
      "Photo release stalled",
      summary,
      taskId
    );
  }

  const partnerTaskId = await createTask({
    ownerUid: release.requestedBy,
    owner: release.requestedByName,
    summary,
    followUpDate: hstToday(),
    workflowStep: "photoReleaseStall",
    photoReleaseId: releaseId,
    notesExtra,
  });
  await notify(
    release.requestedBy,
    release.requestedByName,
    "Photo release stalled",
    summary,
    partnerTaskId
  );

  await sendMail({
    to: release.requestedByEmail,
    subject: "Photo release still incomplete after 30 days",
    html: stallPartnerHtml(release, missingEmails),
    type: "photo-release-stall",
    photoReleaseId: releaseId,
  });
}

// ── Task 4: submitPhotoRelease ────────────────────────────────────
exports.submitPhotoRelease = functions
  .runWith({
    timeoutSeconds: 120,
    maxInstances: 5,
    secrets: ["RESEND_API_KEY", "SMTP_FROM"],
  })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "3600");

    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const { token, typedName, agree } = req.body || {};

    if (agree !== true || typeof typedName !== "string" || !typedName.trim()) {
      res.status(400).json({ error: "You must agree and provide your typed name." });
      return;
    }
    if (!token) { res.status(200).json({ status: "notfound" }); return; }

    const snap = await admin.firestore().collection("photoReleases")
      .where("tokenIndex", "array-contains", token).limit(1).get();
    if (snap.empty) { res.status(200).json({ status: "notfound" }); return; }

    const ref = snap.docs[0].ref;
    const signedIp = (req.headers["x-forwarded-for"] || req.ip || "").toString();

    let signedThisCall = false;
    let alreadyUsed = false;
    let allSigned = false;
    let signedCount = 0;
    let release = null;

    await admin.firestore().runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      const data = fresh.data();
      const subjects = (data.subjects || []).map((s) => Object.assign({}, s));
      const idx = subjects.findIndex((s) => s.token === token);

      if (idx === -1) { alreadyUsed = true; return; }
      if (subjects[idx].status === "signed" || data.state !== "awaiting") {
        alreadyUsed = true;
        return;
      }

      subjects[idx].status = "signed";
      subjects[idx].signedAt = admin.firestore.Timestamp.now();
      subjects[idx].signedName = typedName.trim();
      subjects[idx].signedIp = signedIp;

      tx.update(ref, { subjects });

      signedThisCall = true;
      allSigned = subjects.every((s) => s.status === "signed");
      signedCount = subjects.filter((s) => s.status === "signed").length;
      release = data;
    });

    if (!signedThisCall) {
      res.status(200).json({ status: "used" });
      return;
    }

    // Progress email to the partner
    await sendMail({
      to: release.requestedByEmail,
      subject: "A photo release was signed (" + signedCount + " of " + release.subjectCount + ")",
      html: progressPartnerHtml(release, signedCount),
      type: "photo-release-progress",
      photoReleaseId: ref.id,
    });

    if (allSigned) {
      // Publish the new photo into pageContent
      await admin.firestore().collection("pageContent").doc(release.pageKey || "pacific").set({
        [release.fieldKey]: release.newPhotoUrl,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      await ref.update({
        state: "live",
        publishedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await createVerifyTasks(ref.id, {
        island: release.island,
        slot: release.slot,
        fieldKey: release.fieldKey,
        pageKey: release.pageKey,
        newPhotoUrl: release.newPhotoUrl,
        subjectCount: release.subjectCount,
        requestedBy: release.requestedBy,
        requestedByEmail: release.requestedByEmail,
        requestedByName: release.requestedByName,
      });
    }

    res.status(200).json({ status: "signed", complete: allSigned });
  });

// ── Task 6: photoReleaseReminders (scheduled cron) ────────────────
exports.photoReleaseReminders = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1, secrets: ["RESEND_API_KEY", "SMTP_FROM"] })
  .pubsub.schedule("0 7 * * *").timeZone("Pacific/Honolulu")
  .onRun(async () => {
    const now = Date.now();
    const DAY = 86400000;
    const SLACK = 0.5 * DAY;

    const snap = await admin.firestore().collection("photoReleases")
      .where("state", "==", "awaiting").get();

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const ref = docSnap.ref;
      const id = docSnap.id;

      const missing = (data.subjects || []).filter((s) => s.status !== "signed");
      if (missing.length === 0) continue;

      if (!data.requestedAt || !data.requestedAt.toDate) continue;
      const ageMs = now - data.requestedAt.toDate().getTime();

      if (ageMs >= 30 * DAY - SLACK && !data.stall30TaskAt) {
        await createStallTask(id, data, missing.map((s) => s.email));
        await ref.update({ stall30TaskAt: admin.firestore.FieldValue.serverTimestamp() });
      } else if (ageMs >= 15 * DAY - SLACK && !data.reminder15SentAt) {
        for (const s of missing) {
          await sendMail({
            to: s.email,
            subject: "Reminder: please sign your LDAH photo release",
            html: reminderHtml(SIGNING_BASE_URL + "?token=" + s.token),
            type: "photo-release-reminder15",
            photoReleaseId: id,
          });
        }
        await sendMail({
          to: data.requestedByEmail,
          subject: "Photo release still pending",
          html: reminderPartnerHtml(data, missing),
          type: "photo-release-reminder15-partner",
          photoReleaseId: id,
        });
        await ref.update({ reminder15SentAt: admin.firestore.FieldValue.serverTimestamp() });
      }
    }

    return null;
  });

module.exports = Object.assign(module.exports, {
  PHOTO_RELEASE_VERSION,
  PHOTO_RELEASE_TEXT,
  SIGNING_BASE_URL,
  LAA_EMAIL,
  newToken,
  lookupUidByEmail,
});
