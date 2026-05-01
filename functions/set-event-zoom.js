// One-off: write the new Event Zoom values into settings/zoomDefault.eventZoom.
// Daniel can update the passcode later via List Management → Event Zoom in -Int.
const admin = require("firebase-admin");
const { applicationDefault } = require("firebase-admin/app");

admin.initializeApp({
  credential: applicationDefault(),
  projectId: "ldah-932d5",
});

const eventZoom = {
  meetingUrl: "https://us02web.zoom.us/j/88250259373?pwd=tiuM52z81hNSahbb4jmv9ZbrCBrukH.1",
  meetingId: "882 5025 9373",
  passcode: "", // Daniel will fill in via List Management once Rosie shares it
};

(async () => {
  const db = admin.firestore();
  const ref = db.collection("settings").doc("zoomDefault");
  const before = await ref.get();
  console.log("Before:", JSON.stringify(before.exists ? before.data() : null, null, 2));

  await ref.set({
    eventZoom,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: "set-event-zoom.js (Claude Code, on Daniel's behalf)",
  }, { merge: true });

  const after = await ref.get();
  console.log("\nAfter:", JSON.stringify(after.data(), null, 2));
})().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
