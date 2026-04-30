// One-shot: upload the 13 Connect-Gen prep PDFs to Firebase Storage
// and seed system/connectGenPrepDocs with the public download URLs.
//
// Re-runnable safely; replaces existing files at the same paths.

const admin = require("firebase-admin");
const { applicationDefault } = require("firebase-admin/app");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

admin.initializeApp({
  credential: applicationDefault(),
  projectId: "ldah-932d5",
  storageBucket: "ldah-932d5.firebasestorage.app",
});

const SRC_DIR = "/Users/danielpellegrini/Downloads/OneDrive_1_4-30-2026";
const STORAGE_PREFIX = "connect-gen-prep-docs/";
const BUCKET = admin.storage().bucket();
const db = admin.firestore();

// File names → display titles. Sorted in the order parents should review.
const DOCS = [
  { file: "Preparing for the IEP.pdf",                                title: "Preparing for the IEP" },
  { file: "Parent Report Worksheet Concerns Affecting Education.pdf", title: "Parent Report Worksheet — Concerns Affecting Education" },
  { file: "Parent Report Worksheet Initial Evaluation.pdf",           title: "Parent Report Worksheet — Initial Evaluation" },
  { file: "Parent Report Worksheet Reevaluation.pdf",                 title: "Parent Report Worksheet — Reevaluation" },
  { file: "Parent Report Worksheet Next Steps.pdf",                   title: "Parent Report Worksheet — Next Steps" },
  { file: "Parent Report Worsheet T-Chart.pdf",                       title: "Parent Report Worksheet — T-Chart" },
  { file: "Case Review.pdf",                                          title: "Case Review" },
  { file: "Laws Regarding Education.pdf",                             title: "Laws Regarding Education" },
  { file: "More Help More Information.pdf",                           title: "More Help, More Information" },
  { file: "Quick Guide_Dispute Resolution Process Comparison Chart.pdf", title: "Quick Guide — Dispute Resolution Process Comparison" },
  { file: "Resolution Meetings - A Guide for Parents - Rev June 2008.pdf", title: "Resolution Meetings — A Guide for Parents" },
  { file: "PTIs and CPRCs Resources for Parents.pdf",                 title: "PTIs and CPRCs Resources for Parents" },
  { file: "Terms & Words to Know.pdf",                                title: "Terms & Words to Know" },
];

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

(async () => {
  const out = [];
  for (const d of DOCS) {
    const localPath = path.join(SRC_DIR, d.file);
    if (!fs.existsSync(localPath)) {
      console.error("MISSING:", localPath);
      continue;
    }
    const safe = safeName(d.file);
    const dest = STORAGE_PREFIX + safe;
    const downloadToken = crypto.randomUUID();

    console.log("Uploading:", d.title);
    await BUCKET.upload(localPath, {
      destination: dest,
      metadata: {
        contentType: "application/pdf",
        cacheControl: "public, max-age=86400",
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    });

    const url = "https://firebasestorage.googleapis.com/v0/b/" +
      BUCKET.name + "/o/" +
      encodeURIComponent(dest) +
      "?alt=media&token=" + downloadToken;

    out.push({ title: d.title, filename: safe, url });
  }

  await db.collection("system").doc("connectGenPrepDocs").set({
    docs: out,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log("\nSeeded system/connectGenPrepDocs with", out.length, "docs");
  out.forEach((d) => console.log(" -", d.title, "→", d.url.slice(0, 80) + "..."));
})().catch((e) => { console.error(e); process.exit(1); });
