#!/usr/bin/env node
// One-off: find Daniel's contact unsubscribeToken so we can build a STAGE
// test URL for the announcement-prefill flow.
const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');
admin.initializeApp({ credential: applicationDefault(), projectId: 'ldah-932d5' });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('contacts').get();
  const hits = [];
  snap.forEach(d => {
    const c = d.data() || {};
    const email = (c.email || '').toLowerCase();
    if (email.includes('danpellegrini') || email.includes('oahuappdesign') || email.includes('dpellegrini')) {
      hits.push({
        id: d.id,
        name: c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' '),
        email: c.email,
        unsubscribeToken: c.unsubscribeToken || null,
        marketingOptOut: c.marketingOptOut === true,
      });
    }
  });
  console.log('Daniel contacts found:', hits.length);
  hits.forEach(h => console.log(JSON.stringify(h, null, 2)));
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
