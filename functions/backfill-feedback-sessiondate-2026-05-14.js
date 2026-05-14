#!/usr/bin/env node
// One-off backfill: 2026-05-14
//
// Yesterday (2026-05-13) the Learning Lab feedback ingestion split into two
// groups because some eventFeedback docs wrote `sessionDate` as ISO
// ("2026-05-13") via the sendDayOfReminders URL, and other docs wrote the
// verbatim event.signupDates entry ("May 13, 2026, 5:00 pm - 6:00 pm").
//
// Verbatim is canonical (per feedback_canonical-sessiondate.md). This script
// flips the 4 ISO-shaped docs for the May 13 Learning Lab session over to
// the verbatim shape so the Feedback Report shows a single group of 8.
//
// DRY-RUN by default — prints the writes it WOULD perform. Pass --commit to
// actually update. Idempotent: re-running after commit is a no-op because
// the docs no longer match `sessionDate == "2026-05-13"`.
//
// Also scans the whole eventFeedback collection for any OTHER ISO-shaped
// sessionDate strings and LISTS them (does NOT auto-fix; other events may
// have a different canonical verbatim shape that needs manual matching).
//
// Usage:
//   node backfill-feedback-sessiondate-2026-05-14.js          # dry run
//   node backfill-feedback-sessiondate-2026-05-14.js --commit # writes

const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');

admin.initializeApp({ credential: applicationDefault(), projectId: 'ldah-932d5' });
const db = admin.firestore();

const COMMIT = process.argv.includes('--commit');
const EVENT_ID = 'm3fOhXTTKYQ1AiXQoxOd';   // Learning Lab event
const ISO_TARGET = '2026-05-13';

// Parse "Month DD, YYYY" out of a verbatim string and return "YYYY-MM-DD".
// Defensive: tolerates "May 13, 2026, 5:00 pm - 6:00 pm" or "May 13, 2026 -- ...".
function extractIsoFromVerbatim(verbatim) {
  if (!verbatim || typeof verbatim !== 'string') return null;
  const m = verbatim.match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return null;
  const months = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  const mo = months[m[1].toLowerCase()];
  if (mo == null) return null;
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  const dt = new Date(Date.UTC(year, mo, day));
  return dt.getUTCFullYear() + '-' +
         String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' +
         String(dt.getUTCDate()).padStart(2, '0');
}

(async () => {
  // 1. Load the Learning Lab event to find the verbatim signupDates entry
  //    whose date prefix matches 2026-05-13.
  let collectionUsed = null;
  let eventSnap = await db.collection('recurringEvents').doc(EVENT_ID).get();
  if (eventSnap.exists) {
    collectionUsed = 'recurringEvents';
  } else {
    eventSnap = await db.collection('events').doc(EVENT_ID).get();
    if (eventSnap.exists) collectionUsed = 'events';
  }
  if (!eventSnap.exists) {
    console.error(`ERROR: event ${EVENT_ID} not found in events or recurringEvents`);
    process.exit(1);
  }
  const event = eventSnap.data() || {};
  const signupDates = Array.isArray(event.signupDates) ? event.signupDates : [];
  console.log(`Event found in ${collectionUsed}: "${event.title || '(no title)'}"`);
  console.log(`signupDates entries: ${signupDates.length}`);

  const verbatimMatches = signupDates.filter((s) => extractIsoFromVerbatim(s) === ISO_TARGET);
  console.log(`signupDates entries whose date prefix == ${ISO_TARGET}:`);
  verbatimMatches.forEach((s) => console.log(`  - "${s}"`));

  if (verbatimMatches.length === 0) {
    console.error(`ERROR: no signupDates entry matches ${ISO_TARGET}. Aborting.`);
    process.exit(1);
  }
  if (verbatimMatches.length > 1) {
    console.error(`ERROR: ${verbatimMatches.length} signupDates entries match ${ISO_TARGET}; ambiguous. Aborting.`);
    process.exit(1);
  }
  const VERBATIM = verbatimMatches[0];
  console.log(`\nCanonical verbatim string: "${VERBATIM}"\n`);

  // 2. Find the ISO-shaped feedback docs for this event + date.
  const targetSnap = await db.collection('eventFeedback')
    .where('eventId', '==', EVENT_ID)
    .where('sessionDate', '==', ISO_TARGET)
    .get();

  console.log(`Target docs (eventId=${EVENT_ID}, sessionDate=${ISO_TARGET}): ${targetSnap.size}`);
  targetSnap.forEach((doc) => {
    const d = doc.data() || {};
    console.log(`  - ${doc.id} | signupId=${d.signupId} | submittedBy=${d.submittedByName || d.email || '(unknown)'} `);
  });

  if (targetSnap.size === 0) {
    console.log('\nNothing to backfill. Either already done or the ISO docs are missing.');
  } else if (!COMMIT) {
    console.log(`\nDRY RUN. Would update ${targetSnap.size} doc(s):`);
    console.log(`  sessionDate: "${ISO_TARGET}"  ->  "${VERBATIM}"`);
    console.log(`  + backfilledSessionDateAt: serverTimestamp()`);
    console.log(`  + backfillReason: "2026-05-14 verbatim normalization"`);
    console.log('\nRe-run with --commit to apply.');
  } else {
    console.log(`\nCOMMITTING update on ${targetSnap.size} doc(s)...`);
    let written = 0;
    for (const doc of targetSnap.docs) {
      await doc.ref.update({
        sessionDate: VERBATIM,
        backfilledSessionDateAt: admin.firestore.FieldValue.serverTimestamp(),
        backfillReason: '2026-05-14 verbatim normalization (split Feedback Report group)',
      });
      written++;
      console.log(`  updated ${doc.id}`);
    }
    console.log(`\nWrote ${written} doc(s).`);

    // Re-query to verify.
    const verifySnap = await db.collection('eventFeedback')
      .where('eventId', '==', EVENT_ID)
      .where('sessionDate', '==', ISO_TARGET)
      .get();
    console.log(`\nVerification: docs still matching ISO ${ISO_TARGET} for this event: ${verifySnap.size} (should be 0)`);
  }

  // 3. Scan the WHOLE eventFeedback collection for any other ISO-shaped
  //    sessionDate values. Report only — different events may have different
  //    canonical verbatim shapes that need manual review.
  console.log('\n--- Scanning entire eventFeedback collection for ISO-shaped sessionDate ---');
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  const allSnap = await db.collection('eventFeedback').get();
  const byEvent = {};
  allSnap.forEach((doc) => {
    const d = doc.data() || {};
    if (!d.sessionDate || typeof d.sessionDate !== 'string') return;
    if (!isoRe.test(d.sessionDate)) return;
    if (d.eventId === EVENT_ID && d.sessionDate === ISO_TARGET && COMMIT) return; // just-backfilled
    const key = `${d.eventCollection || '?'}/${d.eventId}`;
    if (!byEvent[key]) byEvent[key] = { count: 0, dates: new Set(), examples: [] };
    byEvent[key].count++;
    byEvent[key].dates.add(d.sessionDate);
    if (byEvent[key].examples.length < 3) byEvent[key].examples.push(doc.id);
  });
  const eventKeys = Object.keys(byEvent);
  if (eventKeys.length === 0) {
    console.log('No other ISO-shaped sessionDate docs found.');
  } else {
    console.log(`Found ISO-shaped sessionDate in ${eventKeys.length} event(s):`);
    eventKeys.forEach((k) => {
      const info = byEvent[k];
      console.log(`  ${k}  count=${info.count}  dates=[${Array.from(info.dates).join(', ')}]  e.g. ${info.examples.join(', ')}`);
    });
    console.log('\n(Listed only — no automatic backfill. Decide per-event whether to normalize.)');
  }

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
