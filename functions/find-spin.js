const admin = require("firebase-admin");
const { applicationDefault } = require("firebase-admin/app");
admin.initializeApp({ credential: applicationDefault(), projectId: "ldah-932d5" });

(async () => {
  const snap = await admin.firestore().collection("resources").get();
  snap.forEach((d) => {
    const data = d.data();
    if (data.archived === true) return;
    const blob = JSON.stringify(data).toLowerCase();
    if (blob.includes("spin") || blob.includes("special parent")) {
      console.log(`id=${d.id}`);
      console.log(`  name="${data.name}"  email="${data.email}"  updateToken=${data.updateToken || "(none)"}  reqAt=${data.updateRequestedAt && data.updateRequestedAt.toDate ? data.updateRequestedAt.toDate().toISOString() : "(none)"}  submittedAt=${data.updateSubmittedAt && data.updateSubmittedAt.toDate ? data.updateSubmittedAt.toDate().toISOString() : "(none)"}`);
    }
  });
})().catch((e) => { console.error(e); process.exit(1); });
