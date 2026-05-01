// Inspect what's actually in events + recurringEvents so we can find the
// right field/flag to distinguish Connect-Gen (Program Zoom) from
// Learning Labs / Parent Talk Cafe (Event Zoom).
const admin = require("firebase-admin");
const { applicationDefault } = require("firebase-admin/app");
admin.initializeApp({ credential: applicationDefault(), projectId: "ldah-932d5" });
const db = admin.firestore();

(async () => {
  console.log("=== events collection (one-off) ===");
  const ev = await db.collection("events").get();
  ev.forEach((d) => {
    const data = d.data();
    if (data.archived === true) return;
    console.log(`- id=${d.id}  title="${data.title || data.name || ''}"  type="${data.type || data.eventType || data.category || ''}"  programType="${data.programType || ''}"  isProgram=${data.isProgram}  active=${data.active}`);
  });

  console.log("\n=== recurringEvents collection (programs/recurring) ===");
  const rec = await db.collection("recurringEvents").get();
  rec.forEach((d) => {
    const data = d.data();
    if (data.archived === true) return;
    console.log(`- id=${d.id}  title="${data.title || data.name || ''}"  type="${data.type || data.eventType || data.category || ''}"  programType="${data.programType || ''}"  isProgram=${data.isProgram}  active=${data.active}`);
  });

  // Inspect one full doc of each collection to see all fields available.
  console.log("\n=== sample events doc (full) ===");
  const sampleE = ev.docs.find((d) => !(d.data() && d.data().archived === true));
  if (sampleE) console.log(JSON.stringify(sampleE.data(), null, 2));

  console.log("\n=== sample recurringEvents doc (full) ===");
  const sampleR = rec.docs.find((d) => !(d.data() && d.data().archived === true));
  if (sampleR) console.log(JSON.stringify(sampleR.data(), null, 2).slice(0, 2000));
})().catch((e) => { console.error(e); process.exit(1); });
