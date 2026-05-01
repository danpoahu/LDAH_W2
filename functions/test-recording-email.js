// One-off test: send the IDEA/Chapter 60 recording + slides email to
// Daniel and Leilani so they can verify formatting + delivery.
// Uploads the PDF to recordings/ in Storage and triggers the live
// sendEventRecordingEmail Cloud Function.

const admin = require("firebase-admin");
const { applicationDefault } = require("firebase-admin/app");
const fs = require("fs");
const path = require("path");

admin.initializeApp({
  credential: applicationDefault(),
  projectId: "ldah-932d5",
  storageBucket: "ldah-932d5.firebasestorage.app",
});
const bucket = admin.storage().bucket();

const PDF_PATH = "/Users/danielpellegrini/Downloads/IDEA_CH60PDFw notes.pdf";
const RECORDING_URL = "https://us02web.zoom.us/rec/share/inPCLqLGEnIExfJUOjL00K3cLuKhKZfGWxUd6gJnFojLutbTcnefOkOzkLRZZ6SD.onPsTGFE20b4nbez";
const PASSCODE = "2gi=UL+@";

const RECIPIENTS = [
  { signupId: "test-daniel",  email: "danpellegrini63@gmail.com", name: "Daniel Pellegrini (TEST)" },
  { signupId: "test-leilani", email: "LKailiawa@ldahawaii.org",  name: "Leilani Kailiawa (TEST)" },
];

const EVENT_ID = "test-idea-ch60-" + Date.now();
const EVENT_TITLE = "Learning Labs: IDEA/Chapter 60 (TEST)";
const SESSION_KEY = "2026-04-22";

async function main() {
  if (!fs.existsSync(PDF_PATH)) throw new Error("PDF not found: " + PDF_PATH);
  const stat = fs.statSync(PDF_PATH);
  const mb = stat.size / (1024 * 1024);
  console.log("PDF size:", mb.toFixed(2), "MB");

  const fileName = path.basename(PDF_PATH);
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ts = Date.now();
  const storagePath = `recordings/${EVENT_ID}/${SESSION_KEY}/${ts}_${safeName}`;

  // Generate a Firebase-style download token so the public URL works
  // exactly like the ones the browser SDK's getDownloadURL() returns.
  const { randomUUID } = require("crypto");
  const downloadToken = randomUUID();

  console.log("Uploading to:", storagePath);
  await bucket.upload(PDF_PATH, {
    destination: storagePath,
    metadata: {
      contentType: "application/pdf",
      metadata: { firebaseStorageDownloadTokens: downloadToken },
    },
  });

  const encodedPath = encodeURIComponent(storagePath);
  const signedUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;
  console.log("Download URL ready.");

  const body = [
    "Aloha, Everyone.",
    "",
    "Mahalo nui loa for taking the time to attend IDEA/Chapter 60. We sincerely appreciate the participation and engagement each of you brought to the session.",
    "",
    "We hope the information shared was helpful and provided strategies and insight to support you in advocating for your keiki.",
    "",
    "If you have any questions or would like additional resources, please feel free to reach out. We also welcome feedback as we continue to strengthen future sessions.",
    "",
    "Mahalo for completing the evaluation survey.",
    "",
    "We look forward to connecting with you again at our next Learning Lab on May 6 - Understanding Evaluations and May 13 - Developing the IEP.",
    "",
    "I have included the PowerPoint Slide in PDF format, and this is the link to the zoom recording, which will be available for two weeks.",
    "",
    "Mahalo again for your time and commitment.",
  ].join("\n");

  const payload = {
    collection: "events",
    eventId: EVENT_ID,
    sessionKey: SESSION_KEY,
    sessionDate: SESSION_KEY,
    eventTitle: EVENT_TITLE,
    subject: "TEST -- Mahalo: Learning Labs: IDEA/Chapter 60 -- Recording & Slides",
    body: body,
    recordingUrl: RECORDING_URL,
    passcode: PASSCODE,
    pdfStoragePath: storagePath,
    pdfDownloadUrl: signedUrl,
    pdfFileName: fileName,
    recipients: RECIPIENTS,
  };

  console.log("\nPosting to sendEventRecordingEmail...");
  const resp = await fetch("https://us-central1-ldah-932d5.cloudfunctions.net/sendEventRecordingEmail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await resp.json();
  console.log("\nResult:", JSON.stringify(result, null, 2));

  if (!result.success) process.exit(1);
  console.log(`\nDONE: sent=${result.sent}, failed=${result.failed}`);
  console.log("Storage path (auto-delete in 15 days):", storagePath);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
