// One-off: flag Connect-Gen as the program-zoom event.
const admin = require("firebase-admin");
const { applicationDefault } = require("firebase-admin/app");
admin.initializeApp({ credential: applicationDefault(), projectId: "ldah-932d5" });
const db = admin.firestore();

const CONNECT_GEN_ID = "CmkPXEpPwfAQ5sR377K2";

(async () => {
  const ref = db.collection("recurringEvents").doc(CONNECT_GEN_ID);
  const before = await ref.get();
  if (!before.exists) { console.error("Connect-Gen doc not found"); process.exit(1); }
  console.log("Before zoomMode:", before.data().zoomMode || "(unset)");

  await ref.update({
    zoomMode: "program",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const after = await ref.get();
  console.log("After zoomMode:", after.data().zoomMode);
})().catch((e) => { console.error(e); process.exit(1); });
