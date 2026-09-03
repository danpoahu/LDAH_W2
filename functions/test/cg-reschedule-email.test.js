// Exercises _buildCgRescheduleEmailHtml() — the copy a family reads when they are
// not ready for their session. No Firestore, no deploy, no sending.
//   node functions/test/cg-reschedule-email.test.js
//
// This email is the one place the system tells a family something factual about
// their own session, so the failure mode here is not a broken page — it is a
// confident false statement. The old copy hardcoded "Monday" in a dozen places
// and promised "we won't be able to send you the Zoom meeting link", which is
// nonsense for a family driving to Kona. It also only ever mentioned documents,
// while a family may equally owe consent or the worksheet.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const build = __test._buildCgRescheduleEmailHtml;

let pass = 0, fail = 0;
function has(name, html, needle) {
  if (html.indexOf(needle) !== -1) { pass++; return; }
  fail++; console.error(`FAIL ${name}\n  expected to find: ${needle}`);
}
function lacks(name, html, needle) {
  if (html.indexOf(needle) === -1) { pass++; return; }
  fail++; console.error(`FAIL ${name}\n  expected NOT to find: ${needle}`);
}

const URLS = {
  consent: 'https://example.org/consent?token=c',
  upload: 'https://example.org/upload?upload=u',
  worksheet: 'https://example.org/worksheet?token=p',
};
const OPTS_INPERSON = [
  { label: 'Thursday, September 17', url: 'https://example.org/r?token=1', location: 'Kona', modality: 'in-person' },
  { label: 'Thursday, October 15', url: 'https://example.org/r?token=2', location: 'Kona', modality: 'in-person' },
];
const OPTS_MIXED = [
  { label: 'Thursday, October 15', url: 'https://example.org/r?token=1', location: 'Kona', modality: 'in-person' },
  { label: 'Monday, September 14', url: 'https://example.org/r?token=2', location: 'All Islands Virtual', modality: 'virtual' },
];

// ── an in-person family must never be told about Monday or Zoom ─────────────
{
  const html = build({
    mode: 'reminder', firstName: 'Parent',
    sessionDateLabel: 'Thursday, September 17', sessionLocation: 'Kona',
    sessionModality: 'in-person',
    outstanding: ['documents'], actionUrls: URLS, options: OPTS_INPERSON,
    signatureHtml: '',
  });
  lacks('in-person reminder never says Monday', html, 'Monday,');
  lacks('in-person reminder never promises a Zoom link', html, 'Zoom');
  has('in-person reminder names their actual day', html, 'Thursday, September 17');
  has('in-person reminder names their location', html, 'Kona');
}

// ── the email names what is actually outstanding, not always documents ──────
{
  const consentOnly = build({
    mode: 'offer', firstName: 'Parent', sessionDateLabel: 'Thursday, September 17',
    sessionLocation: 'Kona', sessionModality: 'in-person',
    outstanding: ['consent'], actionUrls: URLS, options: OPTS_INPERSON, signatureHtml: '',
  });
  has('a family owing consent is told so', consentOnly, 'signed consent form');
  lacks('a family owing only consent is not chased for the worksheet', consentOnly, 'Parent Report Worksheet');
  has('a family owing consent gets the consent link', consentOnly, URLS.consent);
  lacks('a family owing only consent is not sent an upload button', consentOnly, URLS.upload);

  const all = build({
    mode: 'offer', firstName: 'Parent', sessionDateLabel: 'Monday, September 14',
    sessionLocation: 'All Islands Virtual', sessionModality: 'virtual',
    outstanding: ['consent', 'documents', 'worksheet'], actionUrls: URLS,
    options: OPTS_MIXED, signatureHtml: '',
  });
  has('a family owing everything is told all three', all, 'signed consent form');
  has('...documents too', all, 'IEP and Evaluation');
  has('...and the worksheet', all, 'Parent Report Worksheet');
  has('all three links appear', all, URLS.worksheet);
}

// ── a virtual family may still hear about Zoom ──────────────────────────────
{
  const html = build({
    mode: 'reminder', firstName: 'Parent', sessionDateLabel: 'Monday, September 14',
    sessionLocation: 'All Islands Virtual', sessionModality: 'virtual',
    outstanding: ['documents'], actionUrls: URLS, options: OPTS_MIXED, signatureHtml: '',
  });
  has('virtual reminder may reference the Zoom link', html, 'Zoom');
}

// ── the T-1 rung must not read as a cancellation ────────────────────────────
{
  const html = build({
    mode: 'final', firstName: 'Parent', sessionDateLabel: 'Thursday, September 17',
    sessionLocation: 'Kona', sessionModality: 'in-person',
    outstanding: ['worksheet'], actionUrls: URLS, options: OPTS_INPERSON, signatureHtml: '',
  });
  has('the last-call email says they are still welcome to attend', html, 'still welcome');
  lacks('the last-call email never says cancelled', html, 'cancel');
  has('the last-call email still offers other dates', html, 'https://example.org/r?token=1');
}

// ── option buttons carry the location, because a date alone is ambiguous ────
{
  const html = build({
    mode: 'offer', firstName: 'Parent', sessionDateLabel: 'Thursday, September 3',
    sessionLocation: 'Oahu', sessionModality: 'in-person',
    outstanding: ['documents'], actionUrls: URLS, options: OPTS_MIXED, signatureHtml: '',
  });
  has('a mixed offer labels the in-person option with its island', html, 'Kona');
  has('a mixed offer labels the virtual option', html, 'All Islands Virtual');
}

// ── no options to offer: the email must still make sense ────────────────────
{
  const html = build({
    mode: 'reminder', firstName: 'Parent', sessionDateLabel: 'Thursday, September 17',
    sessionLocation: 'Hilo', sessionModality: 'in-person',
    outstanding: ['documents'], actionUrls: URLS, options: [], signatureHtml: '',
  });
  lacks('with no dates available we do not invite them to pick one', html, 'move to one of these');
  has('but they are still asked for what is outstanding', html, URLS.upload);
}

// ── degenerate input must not throw ────────────────────────────────────────
{
  const html = build({});
  if (typeof html === 'string' && html.length > 0) { pass++; }
  else { fail++; console.error('FAIL empty input still returns an email'); }
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
