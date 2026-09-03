// Exercises _cgWorksheetAsked() — the guard deciding whether a Connect-Gen family
// has been asked for their Parent Report Worksheet, and may therefore be chased
// about it. No Firestore, no deploy, no live data.
//   node functions/test/cg-worksheet-asked.test.js
//
// Background: sendCgWorksheetReminders guarded on cgWorksheetRequestEmailSentAt
// alone. That stamp is written on exactly one path — the in-person branch of
// maybeSendRegistrationConfirmation — so virtual families were asked for the
// worksheet by the "consent received, here's what's left" email and then never
// chased. The guard now accepts either path's stamp.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const asked = __test._cgWorksheetAsked;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  if (actual === expected) { pass++; return; }
  fail++;
  console.error(`FAIL ${name}\n  expected ${expected}\n  actual   ${actual}`);
}

const ts = { toMillis: () => 1788000000000 };

check('in-person family asked via the worksheet-request email',
  asked({ cgWorksheetRequestEmailSentAt: ts }), true);

check('virtual family asked via the consent-received email',
  asked({ cgConsentReceivedEmailSentAt: ts }), true);

check('a family carrying both stamps is asked once',
  asked({ cgWorksheetRequestEmailSentAt: ts, cgConsentReceivedEmailSentAt: ts }), true);

check('a family who has been told nothing is not chased',
  asked({}), false);

check('null signup is not chased',
  asked(null), false);

check('undefined signup is not chased',
  asked(undefined), false);

// The stamps are Firestore Timestamps in production, but a half-written doc or a
// migration can leave a null. Presence must mean a real value, or the cron would
// start chasing families nobody ever wrote to.
check('an explicitly null stamp does not count as asked',
  asked({ cgWorksheetRequestEmailSentAt: null }), false);

check('both stamps null does not count as asked',
  asked({ cgWorksheetRequestEmailSentAt: null, cgConsentReceivedEmailSentAt: null }), false);

// A confirmation email is not a worksheet request — it must not open the gate.
check('a generic confirmation stamp is not a worksheet request',
  asked({ confirmationEmailSentAt: ts }), false);

// ── _cgWorksheetLastContact — the cadence baseline ──────────────────────────
// The reminder gap counts from here. If it misses the consent-received stamp a
// virtual family reads as "last contacted at epoch 0" and is chased immediately.
const lastContact = __test._cgWorksheetLastContact;
const A = { toMillis: () => 1 }, B = { toMillis: () => 2 }, C = { toMillis: () => 3 };

check('a sent reminder wins over both request stamps',
  lastContact({ cgWorksheetReminderLastSentAt: C, cgWorksheetRequestEmailSentAt: A,
                cgConsentReceivedEmailSentAt: B }), C);

check('in-person request stamp is used when no reminder has gone yet',
  lastContact({ cgWorksheetRequestEmailSentAt: A, cgConsentReceivedEmailSentAt: B }), A);

check('virtual family falls back to the consent-received stamp',
  lastContact({ cgConsentReceivedEmailSentAt: B }), B);

check('a family with nothing on file returns null, not undefined',
  lastContact({}), null);

check('null signup returns null', lastContact(null), null);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
