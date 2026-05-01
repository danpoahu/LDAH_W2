#!/usr/bin/env node
/**
 * One-off: replace Kiniki Carlson's Connect-Gen selectedSessions with a
 * single Monday April 20 All Islands Virtual / Zoom Meeting entry.
 *
 * Authorized by user (2026-04-16).
 */

const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');

admin.initializeApp({
  credential: applicationDefault(),
  projectId: 'ldah-932d5'
});
const db = admin.firestore();

const EVENT_ID = 'CmkPXEpPwfAQ5sR377K2';
const SIGNUP_ID = '8ryS7tmdyL6IrgZwqtKe';
const NEW_SESSION = 'Monday, 2026-04-20 \u2014 3:00 PM - 5:00 PM @ All Islands Virtual (Zoom Meeting)';
const TODAY = new Date().toLocaleDateString('en-US');

(async () => {
  const ref = db.collection('recurringEvents').doc(EVENT_ID).collection('signups').doc(SIGNUP_ID);
  const snap = await ref.get();
  if (!snap.exists) { console.error('Signup not found'); process.exit(1); }
  const s = snap.data();

  console.log('=== BEFORE ===');
  console.log('name:', s.name);
  console.log('selectedSessions:', JSON.stringify(s.selectedSessions, null, 2));

  const oldJoined = (s.selectedSessions || []).join(' | ');
  const noteLine = 'Sessions replaced with April 20 Zoom only (' + TODAY + '). Previous: ' + oldJoined;
  const newNotes = (s.adminNotes ? s.adminNotes + '\n' : '') + noteLine;

  await ref.update({
    selectedSessions: [NEW_SESSION],
    adminNotes: newNotes
  });

  await db.collection('auditLog').add({
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    action: 'Replaced signup sessions',
    details: (s.name || SIGNUP_ID) + ' \u2014 Connect-Gen \u2014 set to: ' + NEW_SESSION + ' (from: ' + oldJoined + ')',
    performedBy: 'danpellegrini63@gmail.com (script)',
    performedByRole: 'superAdmin'
  });

  const after = await ref.get();
  console.log('\n=== AFTER ===');
  console.log('selectedSessions:', JSON.stringify(after.data().selectedSessions, null, 2));
  console.log('adminNotes tail:', after.data().adminNotes.split('\n').slice(-1)[0]);
  console.log('\nDone.');

  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
