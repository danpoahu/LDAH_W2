// Exercises _cgUploadExpiryMillis() — the pure rule deciding how long a family's
// document-upload link stays alive. No Firestore, no deploy, no live data.
//   node functions/test/cg-upload-expiry.test.js
//
// Background: the link used to die 7 days after consent was signed. A family who
// signed promptly and then took a fortnight to find the IEP could not upload at
// all, and nothing told them why. The rule is now "live until the day after the
// session", floored at the old 7 days so the window can never get SHORTER than
// it is today.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const expiry = __test._cgUploadExpiryMillis;
const FLOOR_MS = __test.CONNECT_GEN_UPLOAD_FLOOR_MS;

const DAY = 24 * 60 * 60 * 1000;
// A Monday, 3:00 PM HST = 01:00 UTC the next day.
const NOW = Date.UTC(2026, 8, 2, 20, 0, 0);              // 2026-09-02 10:00 HST

let pass = 0, fail = 0;
function check(name, actual, expected) {
  if (actual === expected) { pass++; return; }
  fail++;
  console.error(`FAIL ${name}\n  expected ${expected} (${new Date(expected).toISOString()})` +
                `\n  actual   ${actual} (${new Date(actual).toISOString()})`);
}
function checkTrue(name, cond) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL ${name}`);
}

// getSignupSessions() is what the real helper consults. Fake it by handing the
// helper a signup whose selectedSessions carry the canonical pipe format.
const signupOn = (dateKey, loc, time) => ({
  selectedSessions: [`${dateKey}|${loc}|${time}`],
});

// 1. Session comfortably in the future -> day after the session, not 7 days.
{
  const s = signupOn('2026-10-15', 'Kona – Neighborhood Place of Kona', '9:00 AM – 11:00 AM');
  const got = expiry(s, NOW);
  const expected = Date.parse('2026-10-16T00:00:00-10:00');
  check('far-future session expires the day after the session', got, expected);
  checkTrue('far-future session beats the 7-day floor', got > NOW + FLOOR_MS);
}

// 2. Session TOMORROW -> the 7-day floor wins, so the window never shortens.
{
  const s = signupOn('2026-09-03', 'Oahu – 245 N. Kukui Street, Suite 205', '11:00 AM – 1:00 PM');
  const got = expiry(s, NOW);
  check('imminent session falls back to the 7-day floor', got, NOW + FLOOR_MS);
}

// 3. No session on the signup at all -> the floor, never null/NaN.
{
  const got = expiry({}, NOW);
  check('no session date falls back to the 7-day floor', got, NOW + FLOOR_MS);
}

// 4. Session already past -> the floor (staff re-upload path stays usable).
{
  const s = signupOn('2026-08-20', 'Kona – Neighborhood Place of Kona', '9:00 AM – 11:00 AM');
  const got = expiry(s, NOW);
  check('past session falls back to the 7-day floor', got, NOW + FLOOR_MS);
}

// 5. Garbage in the session string must not produce NaN.
{
  const got = expiry({ selectedSessions: ['not-a-date|somewhere|whenever'] }, NOW);
  check('unparseable session falls back to the 7-day floor', got, NOW + FLOOR_MS);
  checkTrue('unparseable session is a real number', Number.isFinite(got));
}

// 6. Multi-session signup uses the LAST session, so the link outlives them all.
{
  const s = {
    selectedSessions: [
      '2026-09-10|Hilo – Easter Seals|9:00 AM – 11:00 AM',
      '2026-10-15|Hilo – Easter Seals|9:00 AM – 11:00 AM',
    ],
  };
  const got = expiry(s, NOW);
  const expected = Date.parse('2026-10-16T00:00:00-10:00');
  check('multi-session signup uses the last session', got, expected);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
