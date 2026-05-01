#!/usr/bin/env node
/**
 * READ-ONLY — trace every Roxanne Lane signup across every event to
 * figure out why she appears in "Understanding Evaluations" when my
 * script only added her to Chapter 60.
 */
const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');
admin.initializeApp({ credential: applicationDefault(), projectId: 'ldah-932d5' });
const db = admin.firestore();

function fmt(ts) {
  if (!ts) return '';
  if (ts._seconds !== undefined) return new Date(ts._seconds * 1000).toISOString();
  if (ts.toDate) return ts.toDate().toISOString();
  return String(ts);
}

(async () => {
  const hits = [];
  for (const col of ['events', 'recurringEvents']) {
    const evts = await db.collection(col).get();
    for (const e of evts.docs) {
      const eData = e.data();
      const signups = await e.ref.collection('signups').get();
      signups.forEach(d => {
        const s = d.data();
        const name = (s.name || '').toLowerCase();
        if (name.includes('roxanne') || name.includes('lane')) {
          hits.push({
            collection: col,
            eventId: e.id,
            eventTitle: eData.title,
            eventSignupDates: eData.signupDates || [],
            signupId: d.id,
            signupName: s.name,
            email: s.email || '',
            status: s.status || '',
            selectedDates: s.selectedDates || [],
            linkedContactId: s.linkedContactId || '',
            additionalComments: s.additionalComments || '',
            registrationStatus: s.registration ? 'has-registration' : 'no-registration',
            timestamp: fmt(s.timestamp),
            registrationCompletedAt: fmt(s.registrationCompletedAt),
            registrationEmailSentAt: fmt(s.registrationEmailSentAt),
          });
        }
      });
    }
  }

  console.log('=== All Roxanne signups in DB ===');
  console.log('Total:', hits.length, '\n');
  hits.forEach((h, i) => {
    console.log(`--- #${i+1} ---`);
    console.log('Collection/EventId:', h.collection + '/' + h.eventId);
    console.log('Event title:', h.eventTitle);
    console.log('Event\'s current signupDates:', JSON.stringify(h.eventSignupDates));
    console.log('Signup id:', h.signupId);
    console.log('Signup name:', h.signupName);
    console.log('Email:', h.email);
    console.log('Status:', h.status);
    console.log('Selected dates on this signup:', JSON.stringify(h.selectedDates));
    console.log('Registration state:', h.registrationStatus);
    console.log('LinkedContactId:', h.linkedContactId);
    console.log('Timestamp:', h.timestamp);
    console.log('RegistrationCompletedAt:', h.registrationCompletedAt);
    console.log('Additional comments:', h.additionalComments);
    console.log('');
  });

  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
