// Exercises _oneOffEmailSuppressed — the single gate that stops a "one-off"
// event (an activity hand-logged into the Event Attendance Report AFTER it
// happened) from generating automated email.
//
// The incident it exists for: on 2026-09-04 a Pacific Island partner logged a
// Zoom meeting that had already finished. Its attendees are written as real
// signups with real email addresses, so the confirmation sender fired and
// mailed "Confirmed -- <event>" to three attendees who were not her, each one
// promising a reminder "3 days before" a session that was already over.
//
// The two things these tests must protect, in order of importance:
//   1. a one-off sends NOTHING (one dated exception, below);
//   2. a NORMAL event is completely unaffected — that is the regression risk.
//
// Pure function only: no Firestore, no network, no live data.
//   node functions/test/oneoff-email-suppression.test.js
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const suppressed = __test._oneOffEmailSuppressed;
const CUTOFF = __test.ONEOFF_EMAIL_FEEDBACK_CUTOFF_DATE;
const toHstDateKey = __test.toHstDateKey;

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return; }
  fail++;
  console.error(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Every email kind that routes through the helper, minus feedback. If a new
// sender is guarded, add its kind string here so it is covered by the sweeps.
const NON_FEEDBACK_KINDS = [
  'confirmation',
  'registration',
  'reminder-3day',
  'reminder-dayof',
  'announcement',
  'no-show-reinvite',
  'event-lifecycle',
  'signup-lifecycle',
];
const ALL_KINDS = NON_FEEDBACK_KINDS.concat(['feedback']);

// The shape cmsSaveOneOff actually writes: archived by design so it never
// reaches the public calendar, empty signupDates, a date in the past.
function oneOff(eventDate) {
  return {
    title: 'Logged Activity',
    isOneOff: true,
    archived: true,
    signupDates: [],
    eventDate: eventDate,
    summary: { presenter: 'Partner Staff' },
  };
}

// ── 0. The cutoff constant is declared and is the agreed floor ──────────────
console.log('cutoff constant');
eq(CUTOFF, '2026-09-01', 'ONEOFF_EMAIL_FEEDBACK_CUTOFF_DATE is the agreed floor');
eq(toHstDateKey('2026-09-04'), '2026-09-04', 'date helper does not shift a plain YYYY-MM-DD');

// ── 1. A one-off sends no confirmation. The actual bug. ─────────────────────
console.log('a one-off sends no confirmation');
// The two live events from the 2026-09-04 incident, by shape not by name.
eq(suppressed(oneOff('2026-09-04'), 'confirmation'), true, 'same-day one-off: no confirmation');
eq(suppressed(oneOff('2026-09-02'), 'confirmation'), true, 'two-day-old one-off: no confirmation');
eq(suppressed(oneOff('2026-08-19'), 'confirmation'), true, 'backfilled one-off: no confirmation');
// A one-off dated in the FUTURE is still a one-off. Date is irrelevant here.
eq(suppressed(oneOff('2027-01-15'), 'confirmation'), true, 'future-dated one-off: still no confirmation');

// ── 2. A one-off sends no reminder / day-of / announcement / anything else ──
console.log('a one-off sends no reminder, day-of, announcement or lifecycle mail');
NON_FEEDBACK_KINDS.forEach((kind) => {
  eq(suppressed(oneOff('2026-09-04'), kind), true, `one-off after cutoff: ${kind} suppressed`);
  eq(suppressed(oneOff('2026-08-19'), kind), true, `one-off before cutoff: ${kind} suppressed`);
  eq(suppressed(oneOff('2027-01-15'), kind), true, `future-dated one-off: ${kind} suppressed`);
});
// An unknown / future kind string must be treated as "not feedback", i.e.
// suppressed. Fail closed on anything nobody has thought about yet.
eq(suppressed(oneOff('2026-09-04'), 'some-future-email'), true, 'unknown kind: suppressed');
eq(suppressed(oneOff('2026-09-04'), undefined), true, 'missing kind: suppressed');
eq(suppressed(oneOff('2026-09-04'), null), true, 'null kind: suppressed');
eq(suppressed(oneOff('2026-09-04'), 'Feedback'), true, 'kind is case-sensitive: "Feedback" is not the carve-out');

// ── 3. The one exception: feedback, strictly after the cutoff ───────────────
console.log('feedback carve-out');
eq(suppressed(oneOff('2026-09-04'), 'feedback'), false, '2026-09-04 one-off: feedback ALLOWED');
eq(suppressed(oneOff('2026-09-02'), 'feedback'), false, '2026-09-02 one-off: feedback ALLOWED');
eq(suppressed(oneOff('2026-12-31'), 'feedback'), false, 'later one-off: feedback ALLOWED');
eq(suppressed(oneOff('2026-08-19'), 'feedback'), true, '2026-08-19 one-off: feedback BLOCKED (before cutoff)');
eq(suppressed(oneOff('2026-06-01'), 'feedback'), true, 'months-old backfill: feedback BLOCKED');
// STRICTLY after — the cutoff day itself does not qualify.
eq(suppressed(oneOff('2026-09-01'), 'feedback'), true, 'exactly the cutoff day: feedback BLOCKED (strictly after)');
eq(suppressed(oneOff('2026-08-31'), 'feedback'), true, 'day before the cutoff: feedback BLOCKED');

// The carve-out must NOT be undone by an archived test somewhere else: every
// one-off is archived:true by construction, so assert the allowed case really
// does carry that flag.
const allowed = oneOff('2026-09-04');
eq(allowed.archived, true, 'the feedback-allowed fixture is archived, as every one-off is');
eq(suppressed(allowed, 'feedback'), false, 'archived:true does not block the feedback carve-out');

// `date` is accepted as a fallback when `eventDate` is absent (some older
// docs carry only `date`).
eq(suppressed({ isOneOff: true, date: '2026-09-04' }, 'feedback'), false, 'date fallback: after cutoff, allowed');
eq(suppressed({ isOneOff: true, date: '2026-08-19' }, 'feedback'), true, 'date fallback: before cutoff, blocked');

// ── 4. Fail CLOSED on an undeterminable date ───────────────────────────────
console.log('undeterminable date sends nothing at all');
const noDate = { isOneOff: true, archived: true, signupDates: [] };
ALL_KINDS.forEach((kind) => {
  eq(suppressed(noDate, kind), true, `one-off with no date: ${kind} suppressed`);
});
[
  ['empty string', ''],
  ['whitespace', '   '],
  ['not a date', 'sometime last spring'],
  ['null', null],
  ['zero', 0],
  ['false', false],
  ['NaN', NaN],
  ['a bare object', {}],
  ['an array', []],
].forEach(([label, v]) => {
  eq(suppressed({ isOneOff: true, eventDate: v }, 'feedback'), true, `unparseable eventDate (${label}): feedback blocked`);
  eq(suppressed({ isOneOff: true, eventDate: v }, 'confirmation'), true, `unparseable eventDate (${label}): confirmation blocked`);
});

// ── 5. THE REGRESSION GUARD. A normal event is completely unaffected. ───────
console.log('normal events are entirely unaffected');
const normalEvent = {
  title: 'A Real Upcoming Event',
  eventDate: '2026-10-15',
  signupDates: ['October 15, 2026, 5:00 pm-6:00 pm'],
  archived: false,
};
ALL_KINDS.forEach((kind) => {
  eq(suppressed(normalEvent, kind), false, `normal event: ${kind} NOT suppressed`);
});
// Normal events dated before the cutoff must be untouched too — the cutoff is
// a one-off concept only and must never leak into ordinary event mail.
const pastNormal = { title: 'A Past Learning Lab', eventDate: '2026-05-06', signupDates: ['May 6, 2026, 5:00 pm-6:00 pm'] };
ALL_KINDS.forEach((kind) => {
  eq(suppressed(pastNormal, kind), false, `normal event before the cutoff: ${kind} NOT suppressed`);
});
// An ARCHIVED normal event is still not a one-off. Archiving is not the test.
const archivedNormal = { title: 'An Archived Learning Lab', eventDate: '2026-05-06', archived: true };
ALL_KINDS.forEach((kind) => {
  eq(suppressed(archivedNormal, kind), false, `archived normal event: ${kind} NOT suppressed (archived is not the test)`);
});
// A normal event with no parseable date must NOT be suppressed either — the
// fail-closed rule applies only inside the one-off branch.
const datelessNormal = { title: 'Dateless', signupDates: [] };
ALL_KINDS.forEach((kind) => {
  eq(suppressed(datelessNormal, kind), false, `dateless normal event: ${kind} NOT suppressed`);
});
// A recurring program doc (Connect-Gen shape) is never a one-off.
const recurring = { title: 'A Recurring Program', zoomMode: 'program', active: true };
ALL_KINDS.forEach((kind) => {
  eq(suppressed(recurring, kind), false, `recurring program: ${kind} NOT suppressed`);
});

// ── 6. isOneOff must be strictly true — no truthiness, no strings ──────────
console.log('isOneOff is a strict boolean test');
[
  ['string "true"', 'true'],
  ['number 1', 1],
  ['string "yes"', 'yes'],
  ['false', false],
  ['null', null],
  ['undefined', undefined],
  ['zero', 0],
].forEach(([label, v]) => {
  eq(suppressed({ isOneOff: v, eventDate: '2026-05-06' }, 'confirmation'), false,
    `isOneOff = ${label}: not a one-off, nothing suppressed`);
});
eq(suppressed({ isOneOff: true, eventDate: '2026-05-06' }, 'confirmation'), true,
  'isOneOff = true (strict): suppressed');

// ── 7. Degenerate input never throws ───────────────────────────────────────
console.log('degenerate input does not throw');
[
  ['null', null],
  ['undefined', undefined],
  ['empty object', {}],
  ['a string', 'not an event'],
  ['a number', 42],
  ['an array', []],
  ['false', false],
].forEach(([label, ev]) => {
  ALL_KINDS.forEach((kind) => {
    let threw = false, result = null;
    try { result = suppressed(ev, kind); } catch (e) { threw = true; }
    eq(threw, false, `${label} + ${kind}: does not throw`);
    // Nothing here is a one-off, so nothing is suppressed.
    eq(result, false, `${label} + ${kind}: not suppressed`);
  });
});
// No arguments at all.
let threwBare = false;
try { suppressed(); } catch (e) { threwBare = true; }
eq(threwBare, false, 'no arguments: does not throw');
eq(suppressed(), false, 'no arguments: not suppressed');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
