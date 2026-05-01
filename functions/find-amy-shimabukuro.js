#!/usr/bin/env node
/**
 * Find Amy Shimabukuro's Connect-Gen signup so we can fire the F-1
 * reschedule email retroactively (she was moved to May 4 before the
 * trigger fix went live).
 */

const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');

admin.initializeApp({ credential: applicationDefault(), projectId: 'ldah-932d5' });
const db = admin.firestore();

(async () => {
  const hits = [];
  for (const col of ['events', 'recurringEvents']) {
    const evts = await db.collection(col).get();
    for (const e of evts.docs) {
      const signups = await e.ref.collection('signups').get();
      signups.forEach(d => {
        const s = d.data();
        const name = (s.name || '').toLowerCase();
        if (name.includes('shimabukuro') || (name.includes('amy') && name.includes('shima'))) {
          hits.push({
            collection: col,
            eventId: e.id,
            eventTitle: e.data().title,
            signupId: d.id,
            name: s.name,
            email: s.email || '',
            status: s.status || '',
            archived: s.archived === true,
            selectedSessions: s.selectedSessions || [],
            selectedDates: s.selectedDates || [],
            adminNotes: s.adminNotes || '',
            lifecycleEmail_reschedule_lastKey: s.lifecycleEmail_reschedule_lastKey || null,
            lifecycleEmail_reschedule_sentAt: s.lifecycleEmail_reschedule_sentAt || null
          });
        }
      });
    }
  }
  console.log('Amy Shimabukuro signups found:', hits.length);
  hits.forEach(h => console.log(JSON.stringify(h, null, 2)));
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
