#!/usr/bin/env node
// One-off backfill: 2026-05-14
//
// Follow-up to d6b0b24 (Learning Lab 2026-05-13 split fix). The collection-
// wide scan in that backfill reported 4 ISO-shaped sessionDate values in
// Connect-Gen (recurringEvents/CmkPXEpPwfAQ5sR377K2):
//   2026-04-27, 2026-04-30, 2026-05-04, 2026-05-07
//
// Connect-Gen verbatim shape is a 3-part pipe-delimited string stored on
// the SIGNUP doc's selectedSessions array, e.g.:
//   "2026-05-07|Hawai'i -- Neighborhood Place of Kona|9:00 AM -- 11:00 AM"
// (zoom vs in-person mix per session, per feedback_isSessionVirtual-required).
//
// Strategy: for each ISO feedback doc, read the referenced signup, find the
// selectedSessions entry whose first pipe segment matches the ISO date, and
// rewrite sessionDate to that verbatim string. Skip (warn) any doc with
// zero or multiple matches -- Daniel will eyeball.
//
// DRY-RUN by default. Pass --commit to write. Idempotent: re-running on
// already-verbatim docs no-ops (query filters by ISO regex).
//
// Usage:
//   node backfill-feedback-sessiondate-connect-gen-2026-05-14.js
//   node backfill-feedback-sessiondate-connect-gen-2026-05-14.js --commit

const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');

admin.initializeApp({ credential: applicationDefault(), projectId: 'ldah-932d5' });
const db = admin.firestore();

const COMMIT = process.argv.includes('--commit');
const EVENT_ID = 'CmkPXEpPwfAQ5sR377K2'; // Connect-Gen
const COLLECTION = 'recurringEvents';
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

(async () => {
  // 1. Pull all eventFeedback docs for Connect-Gen, then filter to
  //    ISO-shaped sessionDate values. (eventFeedback is small; a single
  //    `==` query per ISO date would also work but this is simpler and
  //    matches the scan in the May 13 LL backfill.)
  const fbSnap = await db.collection('eventFeedback')
    .where('eventId', '==', EVENT_ID)
    .get();

  const targets = [];
  fbSnap.forEach((doc) => {
    const d = doc.data() || {};
    if (typeof d.sessionDate === 'string' && ISO_RE.test(d.sessionDate)) {
      targets.push({ id: doc.id, ref: doc.ref, data: d });
    }
  });

  console.log(`Connect-Gen eventFeedback docs with ISO sessionDate: ${targets.length}`);
  if (targets.length === 0) {
    console.log('Nothing to backfill.');
    process.exit(0);
  }

  // 2. For each target, load the signup and find the verbatim match.
  const updates = []; // { ref, oldVal, newVal, docId }
  const warnings = []; // { docId, oldVal, reason }

  for (const t of targets) {
    const { id: docId, ref, data } = t;
    const signupId = data.signupId;
    const iso = data.sessionDate;

    if (!signupId) {
      warnings.push({ docId, oldVal: iso, reason: 'missing signupId on feedback doc' });
      continue;
    }

    const signupRef = db.collection(COLLECTION).doc(EVENT_ID)
      .collection('signups').doc(signupId);
    const signupSnap = await signupRef.get();
    if (!signupSnap.exists) {
      warnings.push({ docId, oldVal: iso, reason: `signup ${signupId} not found` });
      continue;
    }
    const signup = signupSnap.data() || {};
    const selectedSessions = Array.isArray(signup.selectedSessions)
      ? signup.selectedSessions : [];

    if (selectedSessions.length === 0) {
      warnings.push({ docId, oldVal: iso, reason: `signup ${signupId} has empty selectedSessions` });
      continue;
    }

    const matches = selectedSessions.filter((s) => {
      if (typeof s !== 'string') return false;
      const first = s.split('|')[0].trim();
      return first === iso;
    });

    if (matches.length === 0) {
      warnings.push({
        docId, oldVal: iso,
        reason: `no selectedSessions entry on signup ${signupId} matches ${iso}; entries: [${selectedSessions.join(' | ')}]`,
      });
      continue;
    }
    if (matches.length > 1) {
      warnings.push({
        docId, oldVal: iso,
        reason: `${matches.length} selectedSessions entries on signup ${signupId} match ${iso}: [${matches.join(' || ')}]`,
      });
      continue;
    }

    updates.push({ ref, docId, oldVal: iso, newVal: matches[0] });
  }

  // 3. Print plan.
  console.log('\n--- PLAN ---');
  updates.forEach((u) => {
    console.log(`  ${u.docId} | "${u.oldVal}"  ->  "${u.newVal}"`);
  });
  if (warnings.length > 0) {
    console.log('\n--- WARNINGS (skipped) ---');
    warnings.forEach((w) => {
      console.log(`  ${w.docId} | "${w.oldVal}" | ${w.reason}`);
    });
  }
  console.log(`\nUpdates planned: ${updates.length}`);
  console.log(`Warnings: ${warnings.length}`);

  if (!COMMIT) {
    console.log('\nDRY RUN. Re-run with --commit to apply.');
    process.exit(0);
  }

  if (updates.length === 0) {
    console.log('\nNothing to commit.');
    process.exit(0);
  }

  // 4. Commit.
  console.log('\nCOMMITTING...');
  let written = 0;
  for (const u of updates) {
    await u.ref.update({
      sessionDate: u.newVal,
      backfilledSessionDateAt: admin.firestore.FieldValue.serverTimestamp(),
      backfillReason: '2026-05-14 Connect-Gen verbatim normalization (3-part pipe)',
    });
    written++;
    console.log(`  updated ${u.docId}`);
  }
  console.log(`\nWrote ${written} doc(s).`);

  // 5. Verify zero Connect-Gen ISO docs remain.
  const verifySnap = await db.collection('eventFeedback')
    .where('eventId', '==', EVENT_ID)
    .get();
  let remaining = 0;
  verifySnap.forEach((doc) => {
    const d = doc.data() || {};
    if (typeof d.sessionDate === 'string' && ISO_RE.test(d.sessionDate)) remaining++;
  });
  console.log(`\nVerify (Connect-Gen ISO sessionDate remaining): ${remaining} (should be ${warnings.length})`);

  // 6. Collection-wide scan: ANY ISO sessionDate left anywhere?
  const allSnap = await db.collection('eventFeedback').get();
  const byEvent = {};
  allSnap.forEach((doc) => {
    const d = doc.data() || {};
    if (!d.sessionDate || typeof d.sessionDate !== 'string') return;
    if (!ISO_RE.test(d.sessionDate)) return;
    const key = `${d.eventCollection || '?'}/${d.eventId}`;
    if (!byEvent[key]) byEvent[key] = { count: 0, dates: new Set() };
    byEvent[key].count++;
    byEvent[key].dates.add(d.sessionDate);
  });
  const keys = Object.keys(byEvent);
  console.log('\n--- Collection-wide ISO scan (post-backfill) ---');
  if (keys.length === 0) {
    console.log('Zero ISO-shaped sessionDate docs anywhere. Clean.');
  } else {
    console.log(`ISO docs still present in ${keys.length} event(s):`);
    keys.forEach((k) => {
      const info = byEvent[k];
      console.log(`  ${k}  count=${info.count}  dates=[${Array.from(info.dates).join(', ')}]`);
    });
  }

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
