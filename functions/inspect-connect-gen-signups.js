#!/usr/bin/env node
/**
 * Pull event's updatedAt and audit trail entries related to Connect-Gen,
 * to check if schedule was recently edited.
 */

const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');

admin.initializeApp({
  credential: applicationDefault(),
  projectId: 'ldah-932d5'
});
const db = admin.firestore();

(async () => {
  const EVENT_ID = 'CmkPXEpPwfAQ5sR377K2';
  const cg = await db.collection('recurringEvents').doc(EVENT_ID).get();
  const data = cg.data();

  console.log('=== EVENT META ===');
  function fmt(ts) {
    if (!ts) return '(none)';
    if (ts._seconds !== undefined) return new Date(ts._seconds * 1000).toISOString();
    if (ts.toDate) return ts.toDate().toISOString();
    return String(ts);
  }
  console.log('title:', data.title);
  console.log('createdAt:', fmt(data.createdAt));
  console.log('updatedAt:', fmt(data.updatedAt));
  console.log();

  console.log('=== CURRENT SCHEDULES ===');
  (data.schedules || []).forEach((s, i) => {
    console.log(`[${i}] ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][s.dayOfWeek]} ${s.startTime}-${s.endTime} freq=${s.frequency}${s.weekOfMonth?' wk'+s.weekOfMonth:''} @ ${s.location} / ${s.venue || ''}`);
  });
  console.log();

  // Audit log — look for entries referencing Connect-Gen
  console.log('=== AUDIT LOG ENTRIES (last 30 matching "Connect" or event id) ===');
  try {
    const audit = await db.collection('auditLog')
      .orderBy('timestamp', 'desc')
      .limit(200)
      .get();
    const matches = [];
    audit.forEach(d => {
      const a = d.data();
      const blob = JSON.stringify(a);
      if (blob.toLowerCase().includes('connect') || blob.includes(EVENT_ID)) {
        matches.push({ id: d.id, ...a });
      }
    });
    console.log('found', matches.length, 'matching entries');
    matches.slice(0, 40).forEach(m => {
      console.log('-', fmt(m.timestamp), '|', m.action || '(no action)', '|', m.details || m.targetId || '');
    });
  } catch (err) {
    console.log('audit log query failed:', err.message);
  }

  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
