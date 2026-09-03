// Exercises _cgLadderDecision() — which rung of the chase ladder, if any, a
// Connect-Gen family is due today. No Firestore, no deploy, no sending.
//   node functions/test/cg-ladder-decision.test.js
//
// The ladder is T-7 offer, T-4 firm reminder, T-1 last call. Two hazards drive
// most of these assertions:
//
//   * Today the rungs are exact-day matches with no minimum signup age. That is
//     accidentally safe only because there is no T-1 rung: a family registering
//     25 hours out matches nothing. Add T-1 and the same family matches on the
//     very next 08:00 run, minutes after registering.
//   * The T-4 rung already proceeds when there is no offer stamp, so a family
//     who registers four days out is told "we still haven't received..." on
//     their first day in the system. That is the same bug, quieter.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const decide = __test._cgLadderDecision;
const MIN_AGE = __test.CG_LADDER_MIN_SIGNUP_AGE_MS;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  if (actual === expected) { pass++; return; }
  fail++; console.error(`FAIL ${name}\n  expected ${expected}\n  actual   ${actual}`);
}

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 3, 18, 0, 0);        // 2026-09-03 08:00 HST
const TODAY = '2026-09-03';
const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });

// A family old enough to be chased, owing their worksheet.
const base = (o = {}) => Object.assign({
  timestamp: ts(NOW - 20 * DAY),
}, o);
const owes = (list) => ({ isConnectGen: true, ready: false, outstanding: list });
const ready = { isConnectGen: true, ready: true, outstanding: [] };

const rung = (signup, reqs, sessionKey, nowMs) =>
  decide({ signup, requirements: reqs, sessionKey, todayKey: TODAY, nowMs: nowMs || NOW }).rung;

// ── the three rungs fire on their days ──────────────────────────────────────
check('T-7 offers a reschedule',        rung(base(), owes(['documents']), '2026-09-10'), 'offer');
check('T-4 sends the firm reminder',    rung(base(), owes(['documents']), '2026-09-07'), 'reminder');
check('T-1 sends the last call',        rung(base(), owes(['worksheet']), '2026-09-04'), 'final');

// ── and only on their days ──────────────────────────────────────────────────
check('T-6 is not a rung',  rung(base(), owes(['documents']), '2026-09-09'), null);
check('T-2 is not a rung',  rung(base(), owes(['documents']), '2026-09-05'), null);
check('the day itself is not a rung', rung(base(), owes(['documents']), TODAY), null);
check('a past session is not a rung',  rung(base(), owes(['documents']), '2026-08-27'), null);

// ── a family who owes nothing is never chased ───────────────────────────────
check('a ready family gets no offer',    rung(base(), ready, '2026-09-10'), null);
check('a ready family gets no reminder', rung(base(), ready, '2026-09-07'), null);
check('a ready family gets no last call',rung(base(), ready, '2026-09-04'), null);
check('a non-Connect-Gen signup is out of scope',
  rung(base(), { isConnectGen: false, ready: true, outstanding: [] }, '2026-09-10'), null);

// ── THE registration-age guard ──────────────────────────────────────────────
// A family who registered 25 hours before their session must not be told
// "you cannot make it" on the next morning's run.
{
  const justRegistered = base({ timestamp: ts(NOW - 1 * DAY) });
  check('a family who registered yesterday is not chased at T-1',
    rung(justRegistered, owes(['documents']), '2026-09-04'), null);
  check('a family who registered yesterday is not chased at T-4',
    rung(justRegistered, owes(['documents']), '2026-09-07'), null);
  check('a family who registered yesterday is not chased at T-7',
    rung(justRegistered, owes(['documents']), '2026-09-10'), null);

  const exactlyAtTheLine = base({ timestamp: ts(NOW - MIN_AGE) });
  check('a family exactly at the minimum age IS chased',
    rung(exactlyAtTheLine, owes(['documents']), '2026-09-10'), 'offer');

  const aMomentTooYoung = base({ timestamp: ts(NOW - MIN_AGE + 1000) });
  check('a family a second too young is not',
    rung(aMomentTooYoung, owes(['documents']), '2026-09-10'), null);

  check('a signup with no creation stamp is left alone rather than guessed at',
    rung({ }, owes(['documents']), '2026-09-10'), null);
}

// ── idempotence: each rung fires once ───────────────────────────────────────
check('an offer already sent is not resent',
  rung(base({ rescheduleOfferSentAt: ts(NOW - 5 * DAY) }), owes(['documents']), '2026-09-10'), null);
check('a firm reminder already sent is not resent',
  rung(base({ firmReminderSentAt: ts(NOW - 1 * DAY), rescheduleOfferSentAt: ts(NOW - 5 * DAY) }),
       owes(['documents']), '2026-09-07'), null);
check('a last call already sent is not resent',
  rung(base({ finalReminderSentAt: ts(NOW - 1000) }), owes(['documents']), '2026-09-04'), null);

// ── the T-4 rung must not pile onto a fresh offer ───────────────────────────
check('a firm reminder waits at least 3 days after the offer',
  rung(base({ rescheduleOfferSentAt: ts(NOW - 1 * DAY) }), owes(['documents']), '2026-09-07'), null);
check('and fires once the offer is 3 days old',
  rung(base({ rescheduleOfferSentAt: ts(NOW - 3 * DAY) }), owes(['documents']), '2026-09-07'), 'reminder');

// ── the existing bug: T-4 with no offer on file ──────────────────────────────
// A family who registers 4 days out has no offer stamp. The old code sent the
// firm reminder anyway, so their first contact was "we still haven't received".
{
  const registeredAtTMinus4 = base({ timestamp: ts(NOW - 2 * DAY) });
  check('a family who registered 2 days ago gets no firm reminder',
    rung(registeredAtTMinus4, owes(['documents']), '2026-09-07'), null);

  const oldEnoughButNeverOffered = base({ timestamp: ts(NOW - 10 * DAY) });
  check('a long-standing family with no offer on file still gets the firm reminder',
    rung(oldEnoughButNeverOffered, owes(['documents']), '2026-09-07'), 'reminder');
}

// ── degenerate input must not throw ─────────────────────────────────────────
check('no session key yields no rung', rung(base(), owes(['documents']), ''), null);
check('a malformed session key yields no rung', rung(base(), owes(['documents']), 'soon'), null);
check('missing requirements yields no rung', rung(base(), null, '2026-09-10'), null);
check('an empty call does not throw', decide({}).rung, null);

// ── _cgSessionCutoffMillis — the 24-hour registration cut-off ───────────────
// Shared by the reschedule accept handler and the server-side late-signup
// guard. The offset must be explicit: without it the same session would close
// at a different moment for a family browsing from the mainland.
const cutoff = __test._cgSessionCutoffMillis;
const DEFAULT_H = __test.CG_SIGNUP_CUTOFF_HOURS_DEFAULT;
const SESSION = { dateKey: '2026-09-10', startTime: '09:00' };
const START = Date.parse('2026-09-10T09:00:00-10:00');

check('the cut-off is the default hours before the start',
  cutoff(SESSION, '2026-09-10'), START - DEFAULT_H * 3600000);
check('the default is 24 hours', DEFAULT_H, 24);
check('the hours are overridable',
  cutoff(SESSION, '2026-09-10', 72), START - 72 * 3600000);

// Anchoring: the computed instant must not move with the machine's timezone.
check('the start instant is timezone-independent', START, Date.parse('2026-09-10T19:00:00Z'));

// Fail OPEN on bad data — a CMS omission must not lock families out.
check('a session with no start time has no cut-off',
  cutoff({ dateKey: '2026-09-10' }, '2026-09-10'), null);
check('a malformed start time has no cut-off',
  cutoff({ dateKey: '2026-09-10', startTime: '9am' }, '2026-09-10'), null);
check('a malformed date has no cut-off',
  cutoff({ startTime: '09:00' }, 'soon'), null);
check('a null session has no cut-off', cutoff(null, null), null);

// The boundary itself.
check('23 hours out is past the cut-off', START - 23 * 3600000 >= cutoff(SESSION, '2026-09-10'), true);
check('25 hours out is not', START - 25 * 3600000 >= cutoff(SESSION, '2026-09-10'), false);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
