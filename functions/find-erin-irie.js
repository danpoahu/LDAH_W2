#!/usr/bin/env node
/**
 * Find Erin Irie signups and check registration data.
 * Focus: Learning Labs Chapter 60 for 2026-04-22.
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
      const signups = await e.ref.collection('signups').get();
      signups.forEach(d => {
        const s = d.data();
        const name = (s.name || '').toLowerCase();
        const email = (s.email || '').toLowerCase();
        if (name.includes('irie') || name.includes('erin') || email.includes('irie')) {
          hits.push({
            collection: col,
            eventId: e.id,
            eventTitle: e.data().title,
            signupId: d.id,
            data: s
          });
        }
      });
    }
  }

  console.log('=== Erin Irie signups found:', hits.length, '===\n');
  hits.forEach(h => {
    console.log(`--- ${h.collection}/${h.eventId} "${h.eventTitle}" / signups/${h.signupId} ---`);
    console.log('name:', h.data.name);
    console.log('email:', h.data.email || '(none)');
    console.log('phone:', h.data.phone || '(none)');
    console.log('status:', h.data.status || '(none)');
    console.log('archived:', h.data.archived === true);
    console.log('signupDates:', h.data.signupDates || h.data.sessionKey || '(none)');
    console.log('timestamp:', fmt(h.data.timestamp) || fmt(h.data.createdAt));
    console.log('registration present:', !!h.data.registration);
    if (h.data.registration) {
      console.log('registration keys:', Object.keys(h.data.registration));
      console.log('registration:', JSON.stringify(h.data.registration, null, 2));
    }
    console.log('registrantType (flat):', h.data.registrantType || '(none)');
    console.log('full doc:', JSON.stringify(h.data, null, 2));
    console.log('');
  });

  // Also look up the contact record if any
  console.log('=== Checking contacts collection ===');
  const contacts = await db.collection('contacts').get();
  const cHits = [];
  contacts.forEach(d => {
    const c = d.data();
    const name = ((c.firstName || '') + ' ' + (c.lastName || '')).toLowerCase();
    const email = (c.email || '').toLowerCase();
    if (name.includes('irie') || name.includes('erin') || email.includes('irie')) {
      cHits.push({ id: d.id, data: c });
    }
  });
  console.log('Contacts matches:', cHits.length);
  cHits.forEach(h => {
    console.log(`contacts/${h.id}:`, JSON.stringify(h.data, null, 2));
  });

  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
