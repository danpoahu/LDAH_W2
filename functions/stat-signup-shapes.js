#!/usr/bin/env node
/** READ-ONLY — distribution of signup statuses and archive shapes across all events. */
const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');
admin.initializeApp({ credential: applicationDefault(), projectId: 'ldah-932d5' });
const db = admin.firestore();

(async () => {
  const stats = {
    byStatus: {},
    archiveShape: { 'archived:true': 0, 'archived:false': 0, 'archived:undefined': 0 },
    byStatusAndArchived: {},
    emptyDates: { confirmed: 0, pending: 0, other: 0 },
  };
  let totalEvents = 0, totalSignups = 0;

  for (const col of ['events', 'recurringEvents']) {
    const evts = await db.collection(col).get();
    for (const e of evts.docs) {
      totalEvents++;
      const signupsSnap = await e.ref.collection('signups').get();
      signupsSnap.forEach(d => {
        totalSignups++;
        const s = d.data();
        const status = s.status || '(unset)';
        stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

        const archiveKey = s.archived === true ? 'archived:true' : s.archived === false ? 'archived:false' : 'archived:undefined';
        stats.archiveShape[archiveKey]++;

        const combo = status + ' + ' + archiveKey;
        stats.byStatusAndArchived[combo] = (stats.byStatusAndArchived[combo] || 0) + 1;

        const sel = Array.isArray(s.selectedDates) ? s.selectedDates : [];
        if (sel.length === 0) {
          if (status === 'confirmed') stats.emptyDates.confirmed++;
          else if (status === 'pending') stats.emptyDates.pending++;
          else stats.emptyDates.other++;
        }
      });
    }
  }

  console.log('Events:', totalEvents, 'Signups:', totalSignups);
  console.log('\nBy status:'); Object.entries(stats.byStatus).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(' ', k,'=',v));
  console.log('\nBy archived field:'); Object.entries(stats.archiveShape).forEach(([k,v])=>console.log(' ', k,'=',v));
  console.log('\nStatus x archived:'); Object.entries(stats.byStatusAndArchived).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(' ', k,'=',v));
  console.log('\nEmpty selectedDates by status:'); Object.entries(stats.emptyDates).forEach(([k,v])=>console.log(' ', k,'=',v));

  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
