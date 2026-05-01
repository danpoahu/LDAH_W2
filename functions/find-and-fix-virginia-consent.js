// One-off: find Virginia O'Toole's Connect-Gen signup(s) where status is
// 'confirmed' but consentSignedAt is missing, and flip them back to
// 'pending' so the CMS reflects reality until consent is on file.
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "ldah-932d5" });
const db = admin.firestore();

async function main() {
  const snap = await db.collectionGroup("signups").get();
  const matches = [];
  snap.forEach((doc) => {
    const d = doc.data() || {};
    const nm = (d.name || "").toLowerCase();
    if (nm.indexOf("virginia") === -1 || nm.indexOf("toole") === -1) return;
    matches.push({ ref: doc.ref, data: d });
  });
  console.log(`Found ${matches.length} signup(s) for Virginia O'Toole.`);

  for (const m of matches) {
    const path = m.ref.path;
    const parts = path.split("/");
    const collection = parts[0];
    const eventId = parts[1];
    const evSnap = await db.collection(collection).doc(eventId).get();
    const ev = evSnap.exists ? (evSnap.data() || {}) : {};
    const isConnectGen = ev.zoomMode === "program";
    console.log(`  ${path}`);
    console.log(`    event: "${ev.title}" (zoomMode=${ev.zoomMode || "—"})`);
    console.log(`    status=${m.data.status}, consentSignedAt=${m.data.consentSignedAt ? "yes" : "no"}, consentRequiredEmailSentAt=${m.data.consentRequiredEmailSentAt ? "yes" : "no"}`);

    if (isConnectGen && m.data.status === "confirmed" && !m.data.consentSignedAt) {
      await m.ref.update({ status: "pending" });
      console.log(`    → flipped status to 'pending' (consent still outstanding).`);
    } else {
      console.log(`    → no change needed.`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
