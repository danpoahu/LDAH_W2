#!/usr/bin/env node
/**
 * READ-ONLY — pull a recent confirmed signup from LL Chapter 60 to
 * see exact field shape, and list Cloud Function triggers that fire
 * on new signups.
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
  const EVENT_ID = '2MK6bnM3kapMZZIFLH8y';

  const signups = await db.collection('events').doc(EVENT_ID).collection('signups')
    .orderBy('timestamp', 'desc').limit(3).get();

  console.log('=== Recent 3 signups for LL Chapter 60 ===');
  signups.forEach(d => {
    const s = d.data();
    console.log('\n--- signup id:', d.id, '---');
    console.log('keys:', Object.keys(s).sort().join(', '));
    console.log('status:', s.status);
    console.log('name:', s.name);
    console.log('email:', s.email);
    console.log('phone:', s.phone);
    console.log('timestamp:', fmt(s.timestamp));
    console.log('selectedDates:', s.selectedDates);
    console.log('eventTitle:', s.eventTitle);
    console.log('registrantType:', s.registrantType);
    console.log('registration keys:', s.registration ? Object.keys(s.registration) : '(none)');
  });

  // Grep the functions index.js for signup triggers
  console.log('\n=== Inspecting Cloud Function triggers ===');
  const fs = require('fs');
  const idx = fs.readFileSync(__dirname + '/index.js', 'utf8');
  const lines = idx.split('\n');
  const triggerLines = [];
  lines.forEach((l, i) => {
    if (/onCreate|onWrite|onUpdate/.test(l) && /signup/i.test(l)) {
      triggerLines.push(`L${i+1}: ${l.trim()}`);
    }
    if (/exports\.\w+\s*=\s*function/i.test(l) || /^exports\./.test(l)) {
      triggerLines.push(`L${i+1}: ${l.trim().substring(0, 120)}`);
    }
  });
  triggerLines.slice(0, 40).forEach(l => console.log(l));

  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
