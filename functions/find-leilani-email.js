const admin = require("firebase-admin");
const { applicationDefault } = require("firebase-admin/app");
admin.initializeApp({ credential: applicationDefault(), projectId: "ldah-932d5" });
const db = admin.firestore();

async function main() {
  const snap = await db.collection("userRoles").get();
  console.log("UserRoles found:", snap.size);
  snap.forEach(d => {
    const data = d.data();
    const nameBlob = JSON.stringify(data).toLowerCase();
    if (nameBlob.includes("leilani") || nameBlob.includes("kailiawa")) {
      console.log("  MATCH:", d.id, "->", JSON.stringify(data, null, 2));
    }
  });
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
