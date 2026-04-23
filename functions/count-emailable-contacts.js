#!/usr/bin/env node
/** READ-ONLY — count contacts eligible for event announcement blasts. */
const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');
admin.initializeApp({ credential: applicationDefault(), projectId: 'ldah-932d5' });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('contacts').get();
  let total = 0, withEmail = 0, uniqueEmails = new Set(), missingEmail = 0, alreadyOptedOut = 0;
  const emailCounts = {};
  snap.forEach(d => {
    total++;
    const s = d.data();
    const e = (s.email || '').trim().toLowerCase();
    if (!e) { missingEmail++; return; }
    withEmail++;
    uniqueEmails.add(e);
    emailCounts[e] = (emailCounts[e] || 0) + 1;
    if (s.marketingOptOut === true) alreadyOptedOut++;
  });
  const duplicates = Object.entries(emailCounts).filter(([,n]) => n > 1);

  console.log('Contacts total:', total);
  console.log('With email:', withEmail);
  console.log('Unique emails:', uniqueEmails.size);
  console.log('Missing email:', missingEmail);
  console.log('Already opted out (marketingOptOut=true):', alreadyOptedOut);
  console.log('Duplicate-email contact records:', duplicates.length);
  if (duplicates.length) {
    console.log('Top dupes:');
    duplicates.sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([e,n]) => console.log(`  ${n}x ${e}`));
  }
  console.log('\nEstimated eligible recipients for a blast:', uniqueEmails.size);
  console.log('At 50/day throttle, a full blast would take ~' + Math.ceil(uniqueEmails.size / 50) + ' days.');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
