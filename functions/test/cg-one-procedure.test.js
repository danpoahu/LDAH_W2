// Exercises _cgRequirements() after the 2026-09-03 collapse: one intake
// procedure for every Connect-Gen family, in person or virtual.
//   node functions/test/cg-one-procedure.test.js
//
// Until this change, in-person families (Oahu Thursday, Hilo, Kona) owed the
// worksheet only and signed consent on arrival, while Monday-virtual families
// owed consent + documents + worksheet. The whole point of these assertions is
// that NOTHING about the session can change what a family owes any more.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const reqs = __test._cgRequirements;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  fail++; console.error(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`);
}
function checkTrue(name, cond) { if (cond) { pass++; return; } fail++; console.error(`FAIL ${name}`); }

const EVENT = { zoomMode: 'program', schedules: [
  { id: 's0', location: 'All Islands Virtual', venue: 'Zoom Meeting', frequency: 'weekly',
    dayOfWeek: 1, startTime: '15:00', endTime: '17:00', weekOfMonth: 1 },
  { id: 's1', location: 'Oahu', venue: '245 N. Kukui Street, Suite 205', frequency: 'weekly',
    dayOfWeek: 4, startTime: '11:00', endTime: '13:00', weekOfMonth: 1 },
  { id: 's3', location: 'Kona', venue: 'Neighborhood Place of Kona', frequency: 'monthly-nth',
    dayOfWeek: 4, startTime: '09:00', endTime: '11:00', weekOfMonth: 3 },
]};
const ALL = ['consent', 'documents', 'worksheet'];
const on = (dateKey, locVenue, time) => ({ selectedSessions: [`${dateKey}|${locVenue}|${time}`] });

// ── every session type owes the same three things ───────────────────────────
check('a Monday virtual family owes all three',
  reqs(on('2026-09-14', 'All Islands Virtual – Zoom Meeting', '3:00 PM – 5:00 PM'), EVENT).required, ALL);
check('an Oahu Thursday family owes all three',
  reqs(on('2026-09-17', 'Oahu – 245 N. Kukui Street, Suite 205', '11:00 AM – 1:00 PM'), EVENT).required, ALL);
check('a Kona family owes all three',
  reqs(on('2026-09-17', 'Kona – Neighborhood Place of Kona', '9:00 AM – 11:00 AM'), EVENT).required, ALL);
check('a signup with no session at all still owes all three',
  reqs({}, EVENT).required, ALL);

// ── an in-person family holding ONLY a worksheet is no longer ready ─────────
// Worksheet columns A-E are stored as a..e, and "n/a" is a valid answer for D
// and E by design — parents are not expected to know assessments or
// interventions, which is what the session is for.
// This is the behaviour change. Before today this family was confirmed.
{
  const worksheetOnly = Object.assign(
    on('2026-09-17', 'Kona – Neighborhood Place of Kona', '9:00 AM – 11:00 AM'),
    { parentWorksheet: { concerns: [{ a: 'Reading', b: 'slow and laborious', c: 'no phonics', d: 'n/a', e: 'n/a' }] } });
  const r = reqs(worksheetOnly, EVENT);
  checkTrue('the worksheet registers as done', r.hasWorksheet === true);
  checkTrue('but the family is NOT ready', r.ready === false);
  check('and they are told what is missing', r.outstanding, ['consent', 'documents']);
}

// ── a fully-prepared in-person family IS ready ──────────────────────────────
{
  const complete = Object.assign(
    on('2026-09-17', 'Kona – Neighborhood Place of Kona', '9:00 AM – 11:00 AM'),
    { consentSignedAt: { toMillis: () => 1 },
      connectGenDocuments: { iep: [{ storagePath: 'a' }], evaluation: [{ storagePath: 'b' }] },
      parentWorksheet: { concerns: [{ a: 'Reading', b: 'slow and laborious', c: 'no phonics', d: 'n/a', e: 'n/a' }] } });
  const r = reqs(complete, EVENT);
  checkTrue('a fully prepared in-person family is ready', r.ready === true);
  check('with nothing outstanding', r.outstanding, []);
}

// ── non-Connect-Gen events are untouched ───────────────────────────────────
{
  const r = reqs(on('2026-09-17', 'Somewhere', '9:00 AM'), { zoomMode: 'event' });
  checkTrue('a normal event is out of scope', r.isConnectGen === false);
  checkTrue('and is treated as ready', r.ready === true);
  check('with no requirements', r.required, []);
}

// ── the consent text a family signs ─────────────────────────────────────────
// It is stored verbatim on the signup at signing time, so a mistake here is
// permanent for every family who signs afterwards.
{
  const t = __test.CONSENT_TEXT;
  checkTrue('the consent text no longer says "virtual attendance"',
    t.indexOf('virtual attendance') === -1);
  checkTrue('it no longer directs families to fax or post',
    t.indexOf('fax') === -1 && t.indexOf('postal') === -1);
  checkTrue('it names the secure upload link', t.indexOf('secure upload link') > -1);
  checkTrue('it keeps a route for a family who cannot upload',
    t.indexOf('another way to receive them') > -1);
  checkTrue('the 48-hour determination is unchanged', t.indexOf('within 48 hours') > -1);
  checkTrue('the 4-day destruction promise is unchanged',
    t.indexOf('destroyed within 4 days of attendance date') > -1);
  checkTrue('it carries no third-party or AI wording',
    t.toLowerCase().indexOf('automated') === -1 && t.toLowerCase().indexOf('third party') === -1);
  check('the revision marker was bumped', __test.CONSENT_TEXT_VERSION, '09/2026; RR');
}

// ── the first email a family receives ───────────────────────────────────────
// It used to mention consent alone, so a family signed, then discovered
// documents, then discovered a worksheet — three surprises with the clock
// running. It must now set out all three and carry the real deadline.
//
// The tone assertion that matters most is the negative one: NOTHING moves a
// family automatically. The ladder emails alternative dates and they pick one.
// Promising an automatic transfer would be a false statement to a family.
{
  const build = __test.buildConsentRequiredEmailHtml;
  const html = build({
    name: 'Parent', eventTitle: 'Connect-Gen', datesPhrase: ' on Thursday, September 17',
    consentUrl: 'https://example.org/consent?token=x',
    worksheetUrl: 'https://example.org/worksheet?token=y',
    deadlineLabel: 'Wednesday, September 16 at 11:00 AM',
    signatureHtml: '', donateHtml: '',
  });
  checkTrue('all three steps are named — consent', html.indexOf('consent form') > -1);
  checkTrue('...documents', html.indexOf('IEP') > -1 && html.indexOf('Evaluation') > -1);
  checkTrue('...and the worksheet', html.indexOf('Parent Report Worksheet') > -1);
  checkTrue('the deadline is stated', html.indexOf('Wednesday, September 16 at 11:00 AM') > -1);
  checkTrue('the worksheet can be started immediately', html.indexOf('example.org/worksheet') > -1);
  checkTrue('consent is the single call to action', html.indexOf('example.org/consent') > -1);
  checkTrue('it never promises an automatic transfer',
    html.toLowerCase().indexOf('transfer') === -1);
  checkTrue('it says WE will help them move',
    html.indexOf('move you across') > -1);
  checkTrue('it invites a reply when something is hard',
    html.indexOf('reply to this email') > -1);
  checkTrue('no British spelling', html.indexOf('programme') === -1);

  // With no session on file the deadline sentence must degrade, not print blank.
  const noDate = build({ name: 'Parent', consentUrl: '#', signatureHtml: '', donateHtml: '' });
  checkTrue('a family with no session still gets a coherent deadline line',
    noDate.indexOf('a day before your session') > -1);
  checkTrue('and no empty placeholder', noDate.indexOf('by <strong></strong>') === -1);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
