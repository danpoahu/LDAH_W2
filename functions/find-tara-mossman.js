#!/usr/bin/env node
/**
 * Find all Tara Mossman signups across every event + recurringEvent to
 * confirm what's actually in Firestore (vs. what the modal shows).
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
        if (name.includes('mossman') || name.includes('tara')) {
          hits.push({
            collection: col,
            eventId: e.id,
            eventTitle: e.data().title,
            signupId: d.id,
            name: s.name,
            email: s.email || '',
            phone: s.phone || '',
            status: s.status || '',
            archived: s.archived === true,
            timestamp: fmt(s.timestamp) || fmt(s.createdAt)
          });
        }
      });
    }
  }
  console.log('Tara Mossman signups found:', hits.length);
  hits.forEach(h => console.log(JSON.stringify(h, null, 2)));
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
