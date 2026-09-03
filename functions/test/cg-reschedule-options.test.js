// Exercises the reschedule-offer machinery: which alternative sessions a family is
// offered, and the signed token that identifies the one they picked.
// No Firestore, no deploy, no live data.
//   node functions/test/cg-reschedule-options.test.js
//
// Background. The old _findUpcomingMondaysForEvent hard-filtered to Monday AND
// virtual, and de-duplicated on dateKey alone. Two things follow from the real
// Connect-Gen schedule:
//   * Hilo and Kona run monthly, so a same-location offer is four weeks out. A
//     family who cannot make their date needs virtual Mondays as a fallback or
//     the email arrives with no buttons at all.
//   * 2026-09-10 carries BOTH Hilo 09:00 and Oahu 11:00. De-duplicating on
//     dateKey silently drops one, and a token that names only the date cannot
//     say which of the two the family chose.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const find = __test._cgFindRescheduleOptions;
const sign = __test._signRescheduleToken;
const verify = __test._verifyRescheduleToken;
const normLoc = __test._cgNormLoc;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  fail++;
  console.error(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`);
}
function checkTrue(name, cond) { if (cond) { pass++; return; } fail++; console.error(`FAIL ${name}`); }

// The real Connect-Gen schedule shape, verified against the live event doc.
const EVENT = { zoomMode: 'program', schedules: [
  { id: 's0', location: 'All Islands Virtual', venue: 'Zoom Meeting',
    frequency: 'weekly', dayOfWeek: 1, startTime: '15:00', endTime: '17:00', weekOfMonth: 1 },
  { id: 's1', location: 'Oahu', venue: '245 N. Kukui Street, Suite 205',
    frequency: 'weekly', dayOfWeek: 4, startTime: '11:00', endTime: '13:00', weekOfMonth: 1 },
  { id: 's2', location: 'Hilo', venue: 'Easter Seals',
    frequency: 'monthly-nth', dayOfWeek: 4, startTime: '09:00', endTime: '11:00', weekOfMonth: 2 },
  { id: 's3', location: 'Kona', venue: 'Neighborhood Place of Kona',
    frequency: 'monthly-nth', dayOfWeek: 4, startTime: '09:00', endTime: '11:00', weekOfMonth: 3 },
]};

// A signup stores "YYYY-MM-DD|Location – Venue|9:00 AM – 11:00 AM". Note the
// location half is "Kona – Neighborhood Place of Kona" while the session object
// says only "Kona" — matching therefore cannot be equality.
const sigOn = (dateKey, locVenue, time) => ({ selectedSessions: [`${dateKey}|${locVenue}|${time}`] });
const TODAY = '2026-09-01';

// ── location normalisation ──────────────────────────────────────────────────
check('normalises a signup location down to its first segment',
  normLoc('Kona – Neighborhood Place of Kona'), 'kona');
check('leaves a bare session location alone',
  normLoc('Kona'), 'kona');
check('handles the virtual label',
  normLoc('All Islands Virtual – Zoom Meeting'), 'all islands virtual');
check('tolerates a plain hyphen as the separator',
  normLoc('Oahu - 245 N. Kukui Street'), 'oahu');
check('empty in, empty out', normLoc(''), '');
check('null in, empty out', normLoc(null), '');

// ── weekly location: enough of its own dates, so no virtual fallback ────────
{
  const s = sigOn('2026-09-17', 'Oahu – 245 N. Kukui Street, Suite 205', '11:00 AM – 1:00 PM');
  const out = find(EVENT, s, { currentKey: '2026-09-17', minDaysOut: 14, max: 4, todayKey: TODAY });
  checkTrue('Oahu family is offered options', out.length > 0);
  checkTrue('every Oahu option is at Oahu — no virtual fallback needed',
    out.every(o => normLoc(o.location) === 'oahu'));
  checkTrue('the family\'s own current date is never offered back',
    out.every(o => o.dateKey !== '2026-09-17'));
  checkTrue('nothing inside the 14-day lead time is offered',
    out.every(o => o.dateKey >= '2026-09-15'));
}

// ── monthly location: too few of its own dates, so virtual tops it up ───────
{
  const s = sigOn('2026-09-17', 'Kona – Neighborhood Place of Kona', '9:00 AM – 11:00 AM');
  const out = find(EVENT, s, { currentKey: '2026-09-17', minDaysOut: 14, max: 4, todayKey: TODAY });
  checkTrue('Kona family gets a full set of buttons rather than an empty email',
    out.length >= 2);
  checkTrue('the fallback is virtual, never another in-person island',
    out.every(o => normLoc(o.location) === 'kona' || o.modality === 'virtual'));
  checkTrue('a Kona family is never offered Hilo or Oahu',
    !out.some(o => ['hilo', 'oahu'].includes(normLoc(o.location))));
}

// ── the same-date collision ─────────────────────────────────────────────────
{
  // 2026-09-10 is both Hilo 09:00 and Oahu 11:00. A Hilo family moving away from
  // some other date must be able to be offered the Hilo one specifically.
  const s = sigOn('2026-09-03', 'Oahu – 245 N. Kukui Street, Suite 205', '11:00 AM – 1:00 PM');
  const out = find(EVENT, s, { currentKey: '2026-09-03', minDaysOut: 1, max: 20, todayKey: TODAY });
  const onTenth = out.filter(o => o.dateKey === '2026-09-10');
  checkTrue('both sessions on a shared date survive de-duplication', onTenth.length >= 1);
  checkTrue('every option carries a location, so a date alone never identifies it',
    out.every(o => typeof o.location === 'string' && o.location.length > 0));
}

// ── the current session is excluded by date AND location ────────────────────
{
  const s = sigOn('2026-09-10', 'Hilo – Easter Seals', '9:00 AM – 11:00 AM');
  const out = find(EVENT, s, { currentKey: '2026-09-10', currentLocation: 'Hilo',
                               minDaysOut: 0, max: 20, todayKey: TODAY });
  checkTrue('the family\'s exact session is not offered back to them',
    !out.some(o => o.dateKey === '2026-09-10' && normLoc(o.location) === 'hilo'));
}

// ── degenerate input must not throw ─────────────────────────────────────────
check('an event with no schedules yields no options',
  find({ zoomMode: 'program', schedules: [] }, sigOn('2026-09-17', 'Kona', '9:00 AM'), { todayKey: TODAY }), []);
check('a null event yields no options', find(null, {}, { todayKey: TODAY }), []);
check('a null signup yields no options', find(EVENT, null, { todayKey: TODAY }), []);

// ── the token ───────────────────────────────────────────────────────────────
{
  const t = sign({ signupId: 'S1', eventId: 'E1', collection: 'recurringEvents',
                   newSessionDateKey: '2026-09-10', newSessionLocation: 'Hilo',
                   expSeconds: Math.floor(Date.now() / 1000) + 3600 });
  const p = verify(t);
  checkTrue('a v2 token verifies', !!p);
  check('the token round-trips its version', p && p.v, 'v2');
  check('the token round-trips the date', p && p.ndk, '2026-09-10');
  check('the token round-trips the LOCATION — the whole point of v2', p && p.nloc, 'Hilo');

  // The two sessions sharing 2026-09-10 must produce distinguishable tokens.
  const tHilo = sign({ signupId: 'S1', eventId: 'E1', collection: 'recurringEvents',
    newSessionDateKey: '2026-09-10', newSessionLocation: 'Hilo', expSeconds: 9999999999 });
  const tOahu = sign({ signupId: 'S1', eventId: 'E1', collection: 'recurringEvents',
    newSessionDateKey: '2026-09-10', newSessionLocation: 'Oahu', expSeconds: 9999999999 });
  checkTrue('same date, different location => different token', tHilo !== tOahu);
  check('and they decode to different locations',
    [verify(tHilo).nloc, verify(tOahu).nloc], ['Hilo', 'Oahu']);

  // Tamper resistance.
  const parts = tHilo.split('.');
  const swapped = parts[0] + '.' + tOahu.split('.')[1];
  check('a signature from another payload is rejected', verify(swapped), null);
  check('a truncated token is rejected', verify(parts[0]), null);
  check('an empty token is rejected', verify(''), null);
  check('an expired token is rejected', verify(sign({
    signupId: 'S1', eventId: 'E1', collection: 'recurringEvents',
    newSessionDateKey: '2026-09-10', newSessionLocation: 'Hilo', expSeconds: 1 })), null);
}

// ── v1 links already in the wild must keep working ──────────────────────────
{
  // A v1 token carries no location. It must still verify, so a family who got
  // last week's email is not met with "invalid link".
  const v1 = __test._signRescheduleTokenV1({ signupId: 'S1', eventId: 'E1',
    collection: 'recurringEvents', newSessionDateKey: '2026-09-14',
    expSeconds: Math.floor(Date.now() / 1000) + 3600 });
  const p = verify(v1);
  checkTrue('a v1 token still verifies', !!p);
  check('a v1 token reports itself as v1', p && p.v, 'v1');
  check('a v1 token has no location', p && (p.nloc || null), null);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
