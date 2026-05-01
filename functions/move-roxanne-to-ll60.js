#!/usr/bin/env node
/**
 * WRITE — Move Roxanne K Lane from eventRequests to LL Chapter 60 signups.
 * Triggers onEventSignupCreated CF which sends the "Complete Your Registration" email.
 * Marks the original eventRequest as moved-to-signup (preserves audit trail).
 */

const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');

admin.initializeApp({ credential: applicationDefault(), projectId: 'ldah-932d5' });
const db = admin.firestore();

const EVENT_ID = '2MK6bnM3kapMZZIFLH8y';   // Learning Labs: IDEA/Chapter 60
const REQUEST_ID = 'wSMGcUaUKtNeG8odXjP4'; // Roxanne's event request

(async () => {
  // Sanity-check the event request still exists and matches what we expect
  const reqRef = db.collection('eventRequests').doc(REQUEST_ID);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) {
    console.error('ABORT: eventRequest', REQUEST_ID, 'does not exist');
    process.exit(1);
  }
  const reqData = reqSnap.data();
  if (!(reqData.name || '').toLowerCase().includes('roxanne')) {
    console.error('ABORT: request name does not match Roxanne:', reqData.name);
    process.exit(1);
  }
  if (reqData.status === 'moved-to-signup') {
    console.error('ABORT: already moved previously');
    process.exit(1);
  }
  console.log('Event request verified:', reqData.name, '/', reqData.email);

  // Create the signup (status pending → triggers registration email CF)
  const signupData = {
    name: 'Roxanne K Lane',
    email: 'roxanneklane@gmail.com',
    phone: '(808) 366-0175',
    selectedDates: ['April 22, 2026, 5:00 pm-6:00 pm'],
    eventTitle: 'Learning Labs: IDEA/Chapter 60',
    preferredContact: 'email',
    participationType: 'individual',
    status: 'pending',
    additionalComments: 'Originally submitted as an Event Request on 2026-04-22; moved to LL Chapter 60 signup by admin (source eventRequest id: ' + REQUEST_ID + ').',
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  };

  const signupRef = await db.collection('events').doc(EVENT_ID)
    .collection('signups').add(signupData);

  console.log('Signup created:', signupRef.id);
  console.log('onEventSignupCreated CF should fire within ~30s and send the registration email to', signupData.email);

  // Mark the eventRequest as moved, preserve original data
  await reqRef.update({
    status: 'moved-to-signup',
    movedToSignupAt: admin.firestore.FieldValue.serverTimestamp(),
    movedToEventId: EVENT_ID,
    movedToSignupId: signupRef.id,
    movedNote: 'Roxanne meant to sign up for LL Chapter 60 (today 4/22). Moved by admin — registration email triggered automatically.',
  });
  console.log('EventRequest', REQUEST_ID, 'marked as moved-to-signup');

  process.exit(0);
})().catch(err => { console.error('FAILED:', err); process.exit(1); });
