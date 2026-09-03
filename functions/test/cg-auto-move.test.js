// Exercises _cgAutoMoveDestination() — where an unprepared Connect-Gen family
// gets moved when their session starts. No Firestore, no deploy, no sending.
//   node functions/test/cg-auto-move.test.js
//
// Daniel's rule is "a week forward in the same location". That is literally true
// for Oahu Thursdays and virtual Mondays, which run weekly. Hilo and Kona run
// MONTHLY, so for them the next session at their location is about a month out —
// and that is the decision: they keep their island, and the move email offers
// sooner alternatives they can choose themselves. A Kona family silently rolled
// onto a Zoom session has not been rescheduled, they have been moved to a
// different programme.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const dest = __test._cgAutoMoveDestination;
const normLoc = __test._cgNormLoc;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  if (actual === expected) { pass++; return; }
  fail++; console.error(`FAIL ${name}\n  expected ${expected}\n  actual   ${actual}`);
}
function checkTrue(name, cond) { if (cond) { pass++; return; } fail++; console.error(`FAIL ${name}`); }

const EVENT = { zoomMode: 'program', schedules: [
  { id: 's0', location: 'All Islands Virtual', venue: 'Zoom Meeting', frequency: 'weekly',
    dayOfWeek: 1, startTime: '15:00', endTime: '17:00', weekOfMonth: 1 },
  { id: 's1', location: 'Oahu', venue: '245 N. Kukui Street, Suite 205', frequency: 'weekly',
    dayOfWeek: 4, startTime: '11:00', endTime: '13:00', weekOfMonth: 1 },
  { id: 's2', location: 'Hilo', venue: 'Easter Seals', frequency: 'monthly-nth',
    dayOfWeek: 4, startTime: '09:00', endTime: '11:00', weekOfMonth: 2 },
  { id: 's3', location: 'Kona', venue: 'Neighborhood Place of Kona', frequency: 'monthly-nth',
    dayOfWeek: 4, startTime: '09:00', endTime: '11:00', weekOfMonth: 3 },
]};
const on = (k, lv) => ({ selectedSessions: [`${k}|${lv}|9:00 AM – 11:00 AM`] });
const days = (a, b) => Math.round(
  (Date.parse(b + 'T00:00:00-10:00') - Date.parse(a + 'T00:00:00-10:00')) / 86400000);

// ── weekly locations roll a week ────────────────────────────────────────────
{
  const d = dest(EVENT, on('2026-09-17', 'Oahu – 245 N. Kukui Street, Suite 205'), '2026-09-17', '2026-09-17');
  checkTrue('an Oahu family gets a destination', !!d);
  check('...at Oahu', d && normLoc(d.location), 'oahu');
  check('...a week later', d && days('2026-09-17', d.dateKey), 7);
}
{
  const d = dest(EVENT, on('2026-09-14', 'All Islands Virtual – Zoom Meeting'), '2026-09-14', '2026-09-14');
  check('a virtual family stays virtual', d && normLoc(d.location), 'all islands virtual');
  check('...a week later', d && days('2026-09-14', d.dateKey), 7);
}

// ── monthly locations roll to their own next session, NOT to virtual ────────
{
  const d = dest(EVENT, on('2026-09-17', 'Kona – Neighborhood Place of Kona'), '2026-09-17', '2026-09-17');
  checkTrue('a Kona family gets a destination', !!d);
  check('...still at Kona, never Zoom', d && normLoc(d.location), 'kona');
  checkTrue('...roughly a month later, not a week', d && days('2026-09-17', d.dateKey) > 20);
}
{
  const d = dest(EVENT, on('2026-09-10', 'Hilo – Easter Seals'), '2026-09-10', '2026-09-10');
  check('a Hilo family stays at Hilo', d && normLoc(d.location), 'hilo');
  checkTrue('...and is never sent to Oahu or Kona',
    d && ['oahu', 'kona'].indexOf(normLoc(d.location)) === -1);
}

// ── never onto a session starting the same day ─────────────────────────────
{
  // 2026-09-10 carries BOTH Hilo 09:00 and Oahu 11:00. A Hilo family moved on
  // the 10th must not land on the Oahu session hours later that same day.
  const d = dest(EVENT, on('2026-09-10', 'Hilo – Easter Seals'), '2026-09-10', '2026-09-10');
  checkTrue('the destination is a later DAY', d && d.dateKey > '2026-09-10');
}

// ── degenerate input returns null rather than inventing a destination ──────
check('no schedules yields no destination',
  dest({ zoomMode: 'program', schedules: [] }, on('2026-09-17', 'Kona'), '2026-09-17', '2026-09-17'), null);
check('a null event yields no destination', dest(null, on('2026-09-17', 'Kona'), '2026-09-17', '2026-09-17'), null);
check('a null signup yields no destination', dest(EVENT, null, '2026-09-17', '2026-09-17'), null);
check('a signup with no location yields no destination',
  dest(EVENT, { selectedSessions: [] }, '2026-09-17', '2026-09-17'), null);

// A location that no longer exists on the schedule must yield null, so the cron
// leaves the family where they are instead of moving them somewhere arbitrary.
check('a retired location yields no destination',
  dest(EVENT, on('2026-09-17', 'Molokai – Community Centre'), '2026-09-17', '2026-09-17'), null);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
