// Usage: node check-virginia-reminder.js
// Finds Virginia O'Toole's Connect-Gen signup for 4/27/26 and checks if
// a 5-day reminder was already sent. Prints signup + event + emailLog.

const admin = require("firebase-admin");
const { applicationDefault } = require("firebase-admin/app");
admin.initializeApp({ credential: applicationDefault(), projectId: "ldah-932d5" });
const db = admin.firestore();

const TARGET_DATE = "2026-04-27"; // the session date we care about

function includesVirginia(s) {
  const blob = JSON.stringify(s || {}).toLowerCase();
  return blob.includes("virginia") && blob.includes("toole");
}

async function findSignup() {
  // Connect-Gen lives under recurringEvents. Pull all recurringEvents and
  // scan signups subcollection for a Virginia match.
  const events = await db.collection("recurringEvents").get();
  for (const ev of events.docs) {
    const ed = ev.data() || {};
    const title = String(ed.title || "").toLowerCase();
    if (!title.includes("connect")) continue;
    console.log(`\n=== ${ev.id} · ${ed.title} ===`);
    const signups = await ev.ref.collection("signups").get();
    for (const s of signups.docs) {
      const sd = s.data() || {};
      if (!includesVirginia(sd)) continue;
      console.log(`\n  ✔ Signup match: ${s.id}`);
      console.log("  name:", sd.name, sd.firstName, sd.lastName);
      console.log("  email:", sd.email);
      console.log("  status:", sd.status);
      console.log("  selectedDates:", sd.selectedDates);
      console.log("  sessionKeys:", sd.sessionKeys || sd.selectedSessions);
      console.log("  modeOverrides:", JSON.stringify(sd.modeOverrides || {}, null, 2));
      console.log("  remindersSent:", JSON.stringify(sd.remindersSent || {}, null, 2));

      // Pull emailLog for this signup
      const log = await db.collection("emailLog")
        .where("relatedSignupId", "==", s.id)
        .limit(20)
        .get()
        .catch(e => { console.log("  emailLog query err:", e.message); return null; });
      if (log) {
        console.log(`\n  emailLog entries (${log.size}):`);
        log.forEach(d => {
          const ld = d.data();
          const ts = ld.sentAt && ld.sentAt.toDate ? ld.sentAt.toDate().toISOString() : ld.sentAt;
          console.log(`   · ${ts} · type=${ld.type} · to=${ld.to} · subj=${ld.subject}`);
        });
      }
      console.log("\n  (event id for sending: recurringEvents/%s)", ev.id);
    }
  }
}

async function scanByEmail() {
  console.log("\n\n=== All emailLog entries for containerscapes@gmail.com ===");
  const log = await db.collection("emailLog")
    .where("to", "==", "containerscapes@gmail.com")
    .limit(50).get()
    .catch(e => { console.log("to-query err:", e.message); return null; });
  if (log) {
    console.log(`Found ${log.size}:`);
    log.forEach(d => {
      const ld = d.data();
      const ts = ld.sentAt && ld.sentAt.toDate ? ld.sentAt.toDate().toISOString() : ld.sentAt;
      console.log(`  · ${ts} · type=${ld.type} · subj=${ld.subject}`);
    });
  }
}

findSignup().then(scanByEmail).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
