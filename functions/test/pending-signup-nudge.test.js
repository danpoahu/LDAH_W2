// Exercises _pendingSignupNudgeDecision() and _pendingNudgeFamilyKey() — the
// pure rule behind the pending-signup phone nudge. No Firestore, no deploy, no
// live data, no email, and no task is ever created by running this.
//   node functions/test/pending-signup-nudge.test.js
//
// The feature raises ONE task telling staff to phone a family who signed up and
// went quiet. Four guards carry almost all the risk, and most assertions below
// aim at one of them:
//
//   * ONE TASK PER FAMILY. A family with three pending signups is one phone
//     call. The rule takes the family's AGGREGATE state, so the third signup
//     cannot raise a third task.
//   * NO SECOND TASK WHILE ONE IS OPEN. A task nobody has actioned for a week
//     must not be joined by a second.
//   * PAST EVENTS ARE NEVER CHASED. Ringing a family to offer help with a
//     session that already ran is the visible embarrassment, and it is also
//     what turns 3 real pending signups into dozens of tasks.
//   * THE CAP. Four calls, then the system goes quiet.
//
// And one piece of arithmetic. The sweep runs ONCE a day at 5am HST, so the
// thresholds are rounded down — 18 hours, not 24; 39, not 48 — because against
// a single daily run a strict 24-hour test means "the second morning", not "a
// day later". The consecutive-5am-runs block at the bottom is the assertion
// that actually pins that: four calls on four expected mornings and silence on
// every morning between.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');

const decide = __test._pendingSignupNudgeDecision;
const familyKey = __test._pendingNudgeFamilyKey;
const eventKeyOf = __test._pendingSignupNudgeEventDateKey;
const FIRST_H = __test.PENDING_SIGNUP_FIRST_NUDGE_HOURS_ROUNDED_DOWN;
const REPEAT_H = __test.PENDING_SIGNUP_REPEAT_NUDGE_HOURS_ROUNDED_DOWN;
const MAX_NUDGES = __test.PENDING_SIGNUP_MAX_NUDGES;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  if (actual === expected) { pass++; return; }
  fail++; console.error(`FAIL ${name}\n  expected ${expected}\n  actual   ${actual}`);
}

const H = (h) => h * 3600 * 1000;
const NOW = Date.UTC(2026, 8, 4, 18, 0, 0);        // 2026-09-04 08:00 HST
const TODAY = '2026-09-04';
const SOON = '2026-09-20';                          // an upcoming event
const GONE = '2026-08-20';                          // an event that already ran
const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });

// A placeholder family. No real name, address or number appears in this file.
const signup = (o = {}) => Object.assign({
  name: 'Test Family A',
  email: 'family-a@example.invalid',
  phone: '8085550100',
  linkedContactId: 'CONTACT_A',
  status: 'pending',
  timestamp: ts(NOW - H(FIRST_H + 1)),
}, o);

const NO_TASKS = { openTaskCount: 0, nudgeCount: 0, lastNudgeAtMs: 0 };

const run = (s, fam, evKey, nowMs) => decide({
  signup: s,
  eventDateKey: evKey === undefined ? SOON : evKey,
  family: fam || NO_TASKS,
  todayKey: TODAY,
  nowMs: nowMs === undefined ? NOW : nowMs,
});
const nudged = (...a) => run(...a).nudge;
const why = (...a) => run(...a).reason;

// ── the first call: 18 hours, rounded down from "a day" ─────────────────────
check('fires at exactly 18h',
  nudged(signup({ timestamp: ts(NOW - H(18)) })), true);
check('and the reason names it as the first call',
  why(signup({ timestamp: ts(NOW - H(18)) })), 'firstNudge');
check('the first call is call 1',
  run(signup({ timestamp: ts(NOW - H(18)) })).nudgeNumber, 1);
check('does not fire at 17h',
  nudged(signup({ timestamp: ts(NOW - H(17)) })), false);
check('and says why',
  why(signup({ timestamp: ts(NOW - H(17)) })), 'signupTooNew');
check('does not fire a second before 18h',
  nudged(signup({ timestamp: ts(NOW - H(FIRST_H) + 1000) })), false);
check('does not fire on a signup made moments ago',
  nudged(signup({ timestamp: ts(NOW - 60000) })), false);
check('the first-call gap is 18 hours, NOT 24 — see the rounding note above',
  FIRST_H, 18);
// The whole point of 18: an 11am signup is 18 hours old at the next 5am and
// must fire THAT morning, not the one after.
check('a signup 18h old fires on the next daily run rather than waiting a day',
  nudged(signup({ timestamp: ts(NOW - H(18)) })), true);
check('the threshold is rounded DOWN from 24, never up', FIRST_H < 24, true);
check('and the repeat is rounded DOWN from 48', REPEAT_H < 48, true);

// ── the repeat: 39 hours, rounded down from "every other day" ───────────────
{
  const old = signup({ timestamp: ts(NOW - H(30 * 24)) });
  const after = (h, n) => ({ openTaskCount: 0, nudgeCount: n || 1, lastNudgeAtMs: NOW - H(h) });

  check('repeats at exactly 39h since the last call', nudged(old, after(39)), true);
  check('and the reason names it as a repeat', why(old, after(39)), 'repeatNudge');
  check('the second call is call 2', run(old, after(39)).nudgeNumber, 2);
  check('does not repeat at 38h', nudged(old, after(38)), false);
  check('and says why', why(old, after(38)), 'repeatIntervalNotElapsed');
  check('does not repeat a second early',
    nudged(old, { openTaskCount: 0, nudgeCount: 1, lastNudgeAtMs: NOW - H(REPEAT_H) + 1000 }), false);
  check('does not repeat 24h after the first call — 24h clears neither gap',
    nudged(old, after(24)), false);
  check('does repeat at 72h', nudged(old, after(72)), true);
  check('the repeat gap is 39 hours, NOT 48 — see the rounding note above',
    REPEAT_H, 39);
  // 39 exists so consecutive-morning arithmetic works: two 5am runs are 48
  // hours apart, and a call raised at 5am is 48h old two mornings later, which
  // clears 39 comfortably but would only just clear a strict 48.
  check('two mornings after a call clears the repeat gap', nudged(old, after(48)), true);
  check('one morning after a call does not', nudged(old, after(24)), false);

  // The repeat is measured from the last call actually raised, not from the
  // signup date, so a run that was delayed still gets its full gap.
  check('a family nudged an hour ago is not nudged again however old the signup is',
    nudged(signup({ timestamp: ts(NOW - H(365 * 24)) }), after(1)), false);
}

// ── ONE task per family ─────────────────────────────────────────────────────
// The rule takes the family's aggregate state, so three pending signups are
// three calls to decide() sharing one family context. Only the first can fire,
// because the sweep stops at the first signup that says yes.
{
  const three = [
    signup({ timestamp: ts(NOW - H(FIRST_H + 5)) }),
    signup({ timestamp: ts(NOW - H(FIRST_H + 3)) }),
    signup({ timestamp: ts(NOW - H(FIRST_H + 1)) }),
  ];
  const fam = { openTaskCount: 0, nudgeCount: 0, lastNudgeAtMs: 0 };

  // What the sweep does: walk the family's signups, stop at the first yes.
  let fired = 0;
  for (const s of three) {
    const d = run(s, fam);
    if (d.nudge) { fired++; fam.openTaskCount = 1; }   // the task it just raised
  }
  check('a family with 3 pending signups gets ONE task', fired, 1);

  // And they are one family in the first place, because the key is shared.
  check('three signups from one family share a family key',
    new Set(three.map(familyKey)).size, 1);
}

// ── no second task while an earlier one is open ─────────────────────────────
check('no second task while an earlier one is still open',
  nudged(signup({ timestamp: ts(NOW - H(30 * 24)) }), { openTaskCount: 1, nudgeCount: 1, lastNudgeAtMs: NOW - H(10 * 24) }), false);
check('and says why',
  why(signup({ timestamp: ts(NOW - H(30 * 24)) }), { openTaskCount: 1, nudgeCount: 1, lastNudgeAtMs: NOW - H(10 * 24) }), 'taskAlreadyOpen');
check('an open task blocks even the very first call',
  nudged(signup(), { openTaskCount: 1, nudgeCount: 0, lastNudgeAtMs: 0 }), false);
check('an open task blocks even after months',
  nudged(signup({ timestamp: ts(NOW - H(200 * 24)) }), { openTaskCount: 1, nudgeCount: 2, lastNudgeAtMs: NOW - H(90 * 24) }), false);
check('the open-task list form is accepted too',
  nudged(signup(), { openTasks: ['IX1'], nudgeCount: 0, lastNudgeAtMs: 0 }), false);
check('an empty open-task list does not block',
  nudged(signup(), { openTasks: [], nudgeCount: 0, lastNudgeAtMs: 0 }), true);

// ── only pending signups are ever chased ────────────────────────────────────
check('a confirmed signup is never chased', nudged(signup({ status: 'confirmed' })), false);
check('a cancelled signup is never chased', nudged(signup({ status: 'cancelled' })), false);
check('a completed signup is never chased', nudged(signup({ status: 'completed' })), false);
check('and the reason names the status',
  why(signup({ status: 'confirmed' })), 'notPending:confirmed');
check('"new" is the older synonym for pending and IS chased',
  nudged(signup({ status: 'new' })), true);
check('status matching is case- and whitespace-insensitive',
  nudged(signup({ status: '  Pending ' })), true);
check('an archived pending signup is never chased',
  nudged(signup({ archived: true })), false);

// ── past events are not chased ──────────────────────────────────────────────
check('the default is to exclude past events',
  __test.PENDING_SIGNUP_NUDGE_INCLUDE_PAST_EVENTS, false);
check('a signup for an event that already happened is not chased',
  nudged(signup(), NO_TASKS, GONE), false);
check('and says why',
  why(signup(), NO_TASKS, GONE), 'eventAlreadyHappened');
check('an event yesterday is past',
  nudged(signup(), NO_TASKS, '2026-09-03'), false);
check('an event TODAY is not past — the family can still be helped',
  nudged(signup(), NO_TASKS, TODAY), true);
check('an event tomorrow is chased',
  nudged(signup(), NO_TASKS, '2026-09-05'), true);
// Fails CLOSED: "we could not date this event" must not become "phone them".
check('an event with no usable date is not chased',
  nudged(signup(), NO_TASKS, ''), false);
check('and says why', why(signup(), NO_TASKS, ''), 'noEventDate');
check('a malformed event date is not chased',
  nudged(signup(), NO_TASKS, 'next Tuesday'), false);

// The last date the family is expected at is what counts, so a multi-session
// event stays upcoming while any session remains.
check('the latest signup session date is the one used',
  eventKeyOf({ eventDate: '2026-08-01' },
    { selectedDates: ['2026-09-05', '2026-09-19', '2026-09-12'] }), '2026-09-19');
check('the event date is used when the signup names no session',
  eventKeyOf({ eventDate: '2026-09-19' }, { status: 'pending' }), '2026-09-19');
check('a dateless event yields no key',
  eventKeyOf({}, {}), '');
check('a null event and null signup yield no key',
  eventKeyOf(null, null), '');

// ── the cap ─────────────────────────────────────────────────────────────────
{
  const old = signup({ timestamp: ts(NOW - H(60 * 24)) });
  const atCount = (n) => ({ openTaskCount: 0, nudgeCount: n, lastNudgeAtMs: NOW - H(REPEAT_H + 1) });

  check('the cap is 4', MAX_NUDGES, 4);
  check('call 2 is allowed', nudged(old, atCount(1)), true);
  check('call 3 is allowed', nudged(old, atCount(2)), true);
  check('call 4 is allowed', nudged(old, atCount(MAX_NUDGES - 1)), true);
  check('call 4 is numbered 4', run(old, atCount(MAX_NUDGES - 1)).nudgeNumber, MAX_NUDGES);
  check('call 5 is not', nudged(old, atCount(MAX_NUDGES)), false);
  check('and says why', why(old, atCount(MAX_NUDGES)), 'nudgeCapReached');
  check('a family already over the cap is left alone',
    nudged(old, atCount(MAX_NUDGES + 3)), false);
}

// ── what counts as one family ───────────────────────────────────────────────
check('linkedContactId is the family key when present',
  familyKey({ linkedContactId: 'C9', email: 'x@example.invalid' }), 'contact:C9');
check('email is the fallback',
  familyKey({ email: 'Family-B@Example.INVALID' }), 'email:family-b@example.invalid');
check('two signups with the same email are one family',
  familyKey({ email: 'a@example.invalid' }) === familyKey({ email: 'A@example.invalid ' }), true);
check('phone is the next fallback',
  familyKey({ phone: '(808) 555-0100' }), 'phone:8085550100');
check('name is the last resort',
  familyKey({ firstName: 'Test', lastName: 'Family C' }), 'name:test family c');
check('a contact id can never collide with an email',
  familyKey({ linkedContactId: 'a@example.invalid' }) === familyKey({ email: 'a@example.invalid' }), false);
check('a signup with nothing identifying has no family key', familyKey({}), '');
check('a null signup has no family key', familyKey(null), '');
check('a short phone fragment is not a family key', familyKey({ phone: '555' }), '');

// ── degenerate input must not throw ─────────────────────────────────────────
check('a null signup does not throw', decide({ signup: null }).nudge, false);
check('and says why', decide({ signup: null }).reason, 'noSignup');
check('an entirely empty call does not throw', decide({}).nudge, false);
check('no arguments at all does not throw', decide({ family: null }).nudge, false);
check('a signup with no status is not chased',
  nudged(signup({ status: undefined })), false);
check('and says why', why(signup({ status: undefined })), 'noStatus');
check('a blank status is not chased', nudged(signup({ status: '   ' })), false);
check('a non-string status is not chased', nudged(signup({ status: 7 })), false);
check('a signup with no timestamp is not chased',
  nudged(signup({ timestamp: undefined })), false);
check('and says why', why(signup({ timestamp: undefined })), 'noCreationStamp');
check('a broken timestamp object is not chased',
  nudged(signup({ timestamp: { toMillis: () => { throw new Error('boom'); } } })), false);
check('createdAt stands in for a missing timestamp',
  nudged(signup({ timestamp: undefined, createdAt: ts(NOW - H(FIRST_H + 1)) })), true);
check('a {seconds} literal timestamp is understood',
  nudged(signup({ timestamp: { seconds: (NOW - H(FIRST_H + 1)) / 1000 } })), true);
check('a Date timestamp is understood',
  nudged(signup({ timestamp: new Date(NOW - H(FIRST_H + 1)) })), true);
check('a missing today key is not chased',
  decide({ signup: signup(), eventDateKey: SOON, family: NO_TASKS, nowMs: NOW }).nudge, false);
check('a malformed today key is not chased',
  decide({ signup: signup(), eventDateKey: SOON, family: NO_TASKS, todayKey: 'today', nowMs: NOW }).nudge, false);
check('a null family context does not throw',
  decide({ signup: signup(), eventDateKey: SOON, family: null, todayKey: TODAY, nowMs: NOW }).nudge, true);
check('a garbage family context does not throw',
  decide({ signup: signup(), eventDateKey: SOON, family: { nudgeCount: 'lots' }, todayKey: TODAY, nowMs: NOW }).nudge, true);
check('a NaN clock falls back rather than throwing',
  typeof decide({ signup: signup(), eventDateKey: SOON, family: NO_TASKS, todayKey: TODAY, nowMs: NaN }).nudge, 'boolean');

// ── consecutive 5am runs: the whole ladder, morning by morning ──────────────
// The real shape of this feature is not any single threshold, it is what a
// family experiences across a week of daily runs. This simulates the sweep
// exactly as _runPendingSignupNudges drives it: one decision per morning, the
// task left OPEN until staff close it, and the family's aggregate carried
// forward the way the marker stamps carry it in Firestore.
{
  const DAY = H(24);
  // Signs up at 11am HST on day 0 — the awkward hour that a strict 24-hour
  // test would push onto the second morning.
  const SIGNUP_AT = Date.UTC(2026, 8, 1, 21, 0, 0);          // 2026-09-01 11:00 HST
  const morning = (d) => Date.UTC(2026, 8, 1 + d, 15, 0, 0); // 05:00 HST on day d
  const dayKey = (d) => '2026-09-' + String(1 + d).padStart(2, '0');

  const s = signup({ timestamp: ts(SIGNUP_AT) });
  const fam = { openTaskCount: 0, nudgeCount: 0, lastNudgeAtMs: 0 };
  const firedOn = [];

  // Ten mornings. Staff are assumed to close each task the same day it is
  // raised — the slowest realistic ladder, and the one the cap has to bound.
  for (let d = 1; d <= 10; d++) {
    const at = morning(d);
    const d1 = decide({
      signup: s, eventDateKey: '2026-10-15', family: fam,
      todayKey: dayKey(d), nowMs: at,
    });
    if (d1.nudge) {
      firedOn.push(d);
      fam.nudgeCount = d1.nudgeNumber;
      fam.lastNudgeAtMs = at;
    }
  }

  check('exactly 4 tasks across ten daily runs', firedOn.length, MAX_NUDGES);
  // Day 1 is 18h after an 11am signup — the first morning that is roughly a
  // day out. Then every second morning, because 39 < 48.
  check('they land on mornings 1, 3, 5 and 7', firedOn.join(','), '1,3,5,7');
  check('nothing on morning 2', firedOn.indexOf(2), -1);
  check('nothing on morning 4', firedOn.indexOf(4), -1);
  check('nothing on morning 6', firedOn.indexOf(6), -1);
  check('nothing on mornings 8, 9 or 10 — the cap has been reached',
    firedOn.filter((d) => d >= 8).length, 0);

  // The first call really is the FIRST morning. A strict 24-hour test would
  // have slipped it to morning 2 and dragged the whole ladder with it.
  check('the first call is on morning 1, not morning 2', firedOn[0], 1);
  check('an 11am signup is 18h old at the next 5am, not 24h',
    Math.round((morning(1) - SIGNUP_AT) / H(1)), 18);
  check('and 42h old by the morning after that',
    Math.round((morning(2) - SIGNUP_AT) / H(1)), 42);

  // Two runs on the SAME morning must produce one task, not two. In the live
  // sweep the open task blocks the second run; here the aggregate does the
  // same job, which is the guard that survives a retry or a manual re-run.
  {
    const s2 = signup({ timestamp: ts(SIGNUP_AT) });
    const fam2 = { openTaskCount: 0, nudgeCount: 0, lastNudgeAtMs: 0 };
    const at = morning(1);
    let raised = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const d2 = decide({
        signup: s2, eventDateKey: '2026-10-15', family: fam2,
        todayKey: dayKey(1), nowMs: at,
      });
      if (d2.nudge) {
        raised++;
        fam2.nudgeCount = d2.nudgeNumber;
        fam2.lastNudgeAtMs = at;
        fam2.openTaskCount = 1;
      }
    }
    check('two runs on the same morning produce ONE task', raised, 1);

    // And with the task already closed, the repeat gap alone still holds the
    // line — the marker stamp is a second, independent brake.
    const fam3 = { openTaskCount: 0, nudgeCount: 1, lastNudgeAtMs: at };
    check('a re-run an hour later is a no-op even with the task closed',
      decide({ signup: s2, eventDateKey: '2026-10-15', family: fam3,
               todayKey: dayKey(1), nowMs: at + H(1) }).nudge, false);
    check('and so is the very next morning',
      decide({ signup: s2, eventDateKey: '2026-10-15', family: fam3,
               todayKey: dayKey(2), nowMs: morning(2) }).nudge, false);
    check('but the morning after that fires',
      decide({ signup: s2, eventDateKey: '2026-10-15', family: fam3,
               todayKey: dayKey(3), nowMs: morning(3) }).nudge, true);
  }

  // A family who confirms mid-ladder drops out immediately.
  {
    const confirmed = signup({ timestamp: ts(SIGNUP_AT), status: 'confirmed' });
    check('confirming mid-ladder stops the calls at once',
      decide({ signup: confirmed, eventDateKey: '2026-10-15',
               family: { openTaskCount: 0, nudgeCount: 2, lastNudgeAtMs: morning(3) },
               todayKey: dayKey(5), nowMs: morning(5) }).nudge, false);
  }
}

// ── this must never be armed by accident ────────────────────────────────────
/* ARMED 2026-09-04 on Daniel's explicit go-ahead, after a dry run against live
   data showed exactly 3 families (Connect-Gen x2, Learning Labs x1) and correctly
   skipped a signup 2 hours old. This assertion is kept, flipped, so that a silent
   disarm is caught the same way a silent arm would have been — either direction is
   a change of behaviour that should fail the suite until someone says so on purpose. */
check('the sweep is ARMED, deliberately', __test.PENDING_SIGNUP_NUDGE_ARMED, true);
check('the workflow step is stable', __test.PENDING_SIGNUP_NUDGE_WORKFLOW_STEP, 'pendingSignupNudge');
check('the owner is a single named constant',
  typeof __test.PENDING_SIGNUP_NUDGE_OWNER_UID === 'string' &&
  __test.PENDING_SIGNUP_NUDGE_OWNER_UID.length > 0, true);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
