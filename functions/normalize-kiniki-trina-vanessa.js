#!/usr/bin/env node
/**
 * One-off: normalize Kiniki / Trina / Vanessa's Connect-Gen selectedSessions
 * to W2 pipe format so capacity counting matches.
 *
 * Target key: "2026-04-20|All Islands Virtual \u2013 Zoom Meeting|3:00 PM \u2013 5:00 PM"
 *
 * Removes any "Monday Oahu Kukui" Apr-20 entries (user intent is Zoom) and any
 * em-dash reschedule-format Apr-20 entries, replacing with a single pipe-format
 * Apr-20 Zoom entry.
 */

const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');

admin.initializeApp({
  credential: applicationDefault(),
  projectId: 'ldah-932d5'
});
const db = admin.firestore();

const EVENT_ID = 'CmkPXEpPwfAQ5sR377K2';
const TARGET_KEY = '2026-04-20|All Islands Virtual \u2013 Zoom Meeting|3:00 PM \u2013 5:00 PM';
const TARGETS = [
  '8ryS7tmdyL6IrgZwqtKe', // Kiniki Carlson
  'KIJhl5bi9LrqXgr2Fb7p', // Trina Emond (main)
  'ihqEf4YdGlmeEVYGtRUG'  // Vanessa Dasmarina
];

function isApr20EmDashOrOahu(key) {
  if (!key.includes('2026-04-20')) return false;
  // em-dash reschedule format: has " — " and " @ "
  if (key.includes(' \u2014 ') && key.includes(' @ ')) return true;
  // old Oahu Kukui pipe format for Apr 20
  if (key.includes('|Oahu')) return true;
  return false;
}

(async () => {
  for (const id of TARGETS) {
    const ref = db.collection('recurringEvents').doc(EVENT_ID).collection('signups').doc(id);
    const snap = await ref.get();
    if (!snap.exists) { console.log('SKIP', id, '(not found)'); continue; }
    const s = snap.data();
    const before = s.selectedSessions || [];
    // Keep everything that is NOT a matched-to-replace Apr 20 entry
    const kept = before.filter(k => !isApr20EmDashOrOahu(k));
    // Always add the canonical target
    if (!kept.includes(TARGET_KEY)) kept.push(TARGET_KEY);

    console.log('---', s.name, '---');
    console.log('BEFORE:', JSON.stringify(before, null, 2));
    console.log('AFTER :', JSON.stringify(kept, null, 2));

    const noteLine = 'Sessions normalized to pipe format (4/16/2026): [' + before.join(' | ') + '] -> [' + kept.join(' | ') + ']';
    await ref.update({
      selectedSessions: kept,
      adminNotes: (s.adminNotes ? s.adminNotes + '\n' : '') + noteLine
    });
    await db.collection('auditLog').add({
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      action: 'Normalized signup sessions',
      details: (s.name || id) + ' \u2014 Connect-Gen \u2014 pipe format, Apr 20 Zoom',
      performedBy: 'danpellegrini63@gmail.com (script)',
      performedByRole: 'superAdmin'
    });
  }
  console.log('\nDone.');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
