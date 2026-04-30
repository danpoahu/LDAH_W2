// Backfill: any signup with consentSignedAt set should have its consent
// mirrored onto the linked contact doc. The original CF used `s.contactId`
// (wrong field) and silently dropped the mirror, leaving contact cards
// without the Connect-Gen block. This re-mirrors using `linkedContactId`.

const admin = require("firebase-admin");
const { applicationDefault } = require("firebase-admin/app");
admin.initializeApp({ credential: applicationDefault(), projectId: "ldah-932d5" });
const db = admin.firestore();

(async () => {
  const colNames = ["recurringEvents", "events"];
  let mirrored = 0;
  let skipped = 0;

  for (const col of colNames) {
    const events = await db.collection(col).get();
    for (const ev of events.docs) {
      const sigs = await db.collection(col).doc(ev.id).collection("signups").get();
      for (const s of sigs.docs) {
        const d = s.data() || {};
        if (!d.consentSignedAt) continue;
        if (!d.linkedContactId) {
          console.warn(`Signup ${col}/${ev.id}/signups/${s.id} has consent but no linkedContactId — skipping.`);
          skipped++;
          continue;
        }
        try {
          await db.collection("contacts").doc(d.linkedContactId).update({
            connectGenConsent: {
              signedAt: d.consentSignedAt,
              signedName: d.consentSignedName || "",
              version: d.consentVersion || "",
              eventId: ev.id,
              signupId: s.id,
            },
          });
          console.log(`Mirrored: ${col}/${ev.id}/${s.id} -> contact ${d.linkedContactId}`);
          mirrored++;
        } catch (err) {
          console.error(`Mirror failed for ${col}/${ev.id}/${s.id}:`, err.message);
        }
      }
    }
  }

  console.log(`\nDone. Mirrored: ${mirrored}, skipped (no linkedContactId): ${skipped}`);
})().catch((e) => { console.error(e); process.exit(1); });
