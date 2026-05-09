// One-shot patch: bring Teresa's auto-created follow-up interaction
// (and any other early test interactions with source*=event-feedback-auto)
// in line with the canonical schema:
//   - followUpDate = today + 2 days HST
//   - owner = '' (Unassigned), ownerUid = ''
//   - strip source / sourceFeedbackId / sourceEventId / sourceEventCollection / sourceSessionDate
//
// Usage:
//   node patch-teresa-followup-2026-05-08.js --dry   # list what would change
//   node patch-teresa-followup-2026-05-08.js          # apply

const admin = require("firebase-admin");
const { applicationDefault } = require("firebase-admin/app");
admin.initializeApp({ credential: applicationDefault(), projectId: "ldah-932d5" });
const db = admin.firestore();

const DRY_RUN = process.argv.includes("--dry");

function toHstDateKey(value) {
  const d = value || new Date();
  const tzStr = d.toLocaleDateString("en-CA", { timeZone: "Pacific/Honolulu" });
  return /^\d{4}-\d{2}-\d{2}$/.test(tzStr) ? tzStr : "";
}
function addDaysHst(ymd, days) {
  const d = new Date(ymd + "T00:00:00-10:00");
  d.setDate(d.getDate() + days);
  return toHstDateKey(d);
}

async function main() {
  const followUpDate = addDaysHst(toHstDateKey(new Date()), 2);
  const snap = await db.collection("interactions")
    .where("source", "==", "event-feedback-auto")
    .get();

  console.log(`Found ${snap.size} matching interaction(s).`);

  let patched = 0;
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    console.log(`\n• ${doc.id} — ${d.contactName || "?"} — ${d.summary || ""}`);
    console.log(`  current followUpDate: '${d.followUpDate || ""}', owner: '${d.owner || ""}'`);

    if (DRY_RUN) continue;

    await doc.ref.update({
      followUpDate: followUpDate,
      owner: "",
      ownerUid: "",
      // Strip the legacy source fields
      source: admin.firestore.FieldValue.delete(),
      sourceFeedbackId: admin.firestore.FieldValue.delete(),
      sourceEventId: admin.firestore.FieldValue.delete(),
      sourceEventCollection: admin.firestore.FieldValue.delete(),
      sourceSessionDate: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`  → patched: followUpDate=${followUpDate}, owner=Unassigned, source* removed`);
    patched++;
  }

  console.log(`\n${DRY_RUN ? "DRY RUN" : "Patched"}: ${patched} of ${snap.size} interaction(s).`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
