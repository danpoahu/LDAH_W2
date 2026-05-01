#!/usr/bin/env node
/**
 * READ-ONLY — find Roxanne Lane's event request and today's LL Chapter 60 event.
 * Also pull a recent successful signup from LL60 so we know what shape to mirror.
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
  // 1. Find Roxanne in eventRequests
  console.log('=== Searching eventRequests for Roxanne ===');
  const reqs = await db.collection('eventRequests').get();
  const roxanneReqs = [];
  reqs.forEach(d => {
    const r = d.data();
    const name = (r.name || '').toLowerCase();
    if (name.includes('roxanne') || name.includes('lane')) {
      roxanneReqs.push({ id: d.id, ...r, _timestamp: fmt(r.submittedAt || r.timestamp || r.createdAt) });
    }
  });
  console.log('Event requests found:', roxanneReqs.length);
  roxanneReqs.forEach(r => console.log(JSON.stringify(r, null, 2)));

  // 2. Find LL Chapter 60 events (search both events and recurringEvents)
  console.log('\n=== Searching for LL Chapter 60 ===');
  for (const col of ['events', 'recurringEvents']) {
    const evts = await db.collection(col).get();
    evts.forEach(e => {
      const d = e.data();
      const title = (d.title || '').toLowerCase();
      if ((title.includes('chapter') && title.includes('60')) ||
          title.includes('ll 60') || title.includes('ll60') ||
          title.includes('learning labs 60')) {
        console.log(`Match in ${col}:`, e.id);
        console.log('  title:', d.title);
        console.log('  date:', d.date || d.startDate || d.signupDates || '(none)');
        console.log('  signupDates:', d.signupDates || '(none)');
        console.log('  location:', d.location || '(none)');
        console.log('  locationType:', d.locationType || '(none)');
      }
    });
  }

  // 3. Also search for 'chapter 60' more broadly
  console.log('\n=== Broad search for "chapter 60" in all event titles ===');
  for (const col of ['events', 'recurringEvents']) {
    const evts = await db.collection(col).get();
    evts.forEach(e => {
      const d = e.data();
      const title = (d.title || '').toLowerCase();
      if (title.includes('60')) {
        console.log(`${col}/${e.id}: "${d.title}"`);
      }
    });
  }

  // 4. Also look for today's events generally (today = 2026-04-22)
  console.log('\n=== Events with signupDates including 2026-04-22 ===');
  for (const col of ['events', 'recurringEvents']) {
    const evts = await db.collection(col).get();
    evts.forEach(e => {
      const d = e.data();
      const dates = d.signupDates || [];
      const hits = (Array.isArray(dates) ? dates : []).filter(s => String(s).includes('2026-04-22') || String(s).includes('April 22'));
      if (hits.length) {
        console.log(`${col}/${e.id}: "${d.title}" — dates:`, hits);
      }
    });
  }

  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
