#!/usr/bin/env node
// One-off: write La'a Salvani's auth uid onto system/emailPersonas so the
// returning-Connect-Gen CF can stamp interactions with the canonical
// ownerUid that LDAH-Int recognises as her account.
const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');
admin.initializeApp({ credential: applicationDefault(), projectId: 'ldah-932d5' });
const db = admin.firestore();

const LAA_UID = 'hj6YnfnZ66Yul9mtnULRW5FTWKH3';

(async () => {
  const ref = db.collection('system').doc('emailPersonas');
  await ref.set(
    { personas: { resourceCoordinator: { uid: LAA_UID } } },
    { merge: true },
  );
  const snap = await ref.get();
  const got = ((snap.data() || {}).personas || {}).resourceCoordinator || {};
  console.log('resourceCoordinator after write:', JSON.stringify(got, null, 2));
  if (got.uid !== LAA_UID) {
    console.error('FAILED: uid not set correctly');
    process.exit(1);
  }
  console.log('OK: uid written successfully');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
