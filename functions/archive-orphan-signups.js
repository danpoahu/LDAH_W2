#!/usr/bin/env node
/**
 * Archive all active Connect-Gen signups whose selectedSessions don't match
 * any current-schedule session (90-day window, forward-looking from today).
 *
 * - Preserves status (doesn't cancel — user said these folks attended).
 * - Sets archived=true so they drop out of the "Not matched" warning
 *   and appear under "Show Archived (N)".
 * - adminNotes gets a line recording the action.
 * - Also archives Trina's legacy-CSV duplicate (source=google-form-import)
 *   automatically via the orphan check.
 *
 * Pass --apply to write; default is dry run.
 */

const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');

admin.initializeApp({
  credential: applicationDefault(),
  projectId: 'ldah-932d5'
});
const db = admin.firestore();

const EVENT_ID = 'CmkPXEpPwfAQ5sR377K2';
const APPLY = process.argv.includes('--apply');

// Mirror of LDAH-Int cmsGenerateSessionDates logic (forward-only)
function generateSessions(schedules, cancelledDates, days) {
  const sessions = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(today); end.setDate(end.getDate() + days);
  const cancelled = (cancelledDates || []).reduce((m, cd) => { m[cd.date] = true; return m; }, {});
  (schedules || []).forEach(sch => {
    const d = new Date(today);
    while (d <= end) {
      const dow = d.getDay();
      let hit = false;
      if (sch.frequency === 'weekly' && dow === sch.dayOfWeek) hit = true;
      if (sch.frequency === 'monthly-nth' && dow === sch.dayOfWeek) {
        const weekNum = Math.ceil(d.getDate() / 7);
        if (weekNum === sch.weekOfMonth) hit = true;
      }
      if (hit) {
        const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
        const iso = `${y}-${m}-${dd}`;
        if (!cancelled[iso]) sessions.push({ date: iso, location: sch.location || '' });
      }
      d.setDate(d.getDate() + 1);
    }
  });
  return sessions;
}

function isMatched(signup, sessions) {
  const sd = signup.selectedSessions || [];
  if (!sd.length) return false;
  return sd.some(k => sessions.some(sess => {
    if (!String(k).includes(sess.date)) return false;
    if (sess.location && (k.indexOf('|') !== -1 || k.indexOf('@ ') !== -1)) {
      return k.indexOf(sess.location) !== -1;
    }
    return true;
  }));
}

(async () => {
  const evt = await db.collection('recurringEvents').doc(EVENT_ID).get();
  const sessions = generateSessions(evt.data().schedules, evt.data().cancelledDates, 90);

  const snap = await evt.ref.collection('signups').get();
  const toArchive = [];
  snap.forEach(doc => {
    const s = doc.data();
    if (s.archived) return;
    if (s.status === 'cancelled') return;
    if (isMatched(s, sessions)) return;
    toArchive.push({ id: doc.id, name: s.name, sessions: s.selectedSessions || [], source: s.source || '' });
  });

  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (pass --apply to write) ===');
  console.log('will archive', toArchive.length, 'signups:\n');
  toArchive.forEach(x => {
    console.log('- ' + x.name + (x.source ? ' [' + x.source + ']' : '') + '  id=' + x.id);
    console.log('    sessions:', JSON.stringify(x.sessions));
  });

  if (!APPLY) { process.exit(0); }

  for (const x of toArchive) {
    const ref = evt.ref.collection('signups').doc(x.id);
    const cur = (await ref.get()).data();
    const note = 'Auto-archived as orphan (4/16/2026). Not matched to current Connect-Gen schedule. Sessions: [' + (cur.selectedSessions || []).join(' | ') + ']';
    await ref.update({
      archived: true,
      adminNotes: (cur.adminNotes ? cur.adminNotes + '\n' : '') + note
    });
    await db.collection('auditLog').add({
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      action: 'Archived signup',
      details: (x.name || x.id) + ' \u2014 Connect-Gen \u2014 auto-archived (orphan)',
      performedBy: 'danpellegrini63@gmail.com (script)',
      performedByRole: 'superAdmin'
    });
  }

  console.log('\nDone. Archived', toArchive.length, 'signups.');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
