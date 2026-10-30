// Connect-Gen document check (2026-10-30): requirement rule, date windows,
// grandfathering, fail-open, email key, signature fallback.
//   node --test functions/test/cg-doc-check.test.js
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const test = require('node:test');
const assert = require('node:assert');
const dc = require('../cgDocCheck');
const { __test } = require('../index.js');
const reqs = __test._cgRequirements;

const EVENT = { zoomMode: 'program' };
const NOW = Date.parse('2026-10-30T12:00:00-10:00');
const SESSION = '2026-11-09|All Islands Virtual – Zoom Meeting|3:00 PM – 5:00 PM';

let n = 0;
function file(slot, extra) {
  n++;
  return Object.assign({ storagePath: `connectGen/E/S/${slot}-${n}.pdf`, originalFilename: `${slot}-${n}.pdf`,
    mimeType: 'application/pdf', uploadedAt: '2026-10-30T05:00:00Z' }, extra || {});
}
function signup(iep, evaluation, checksBy, extra) {
  const s = Object.assign({
    status: 'pending', consentSignedAt: 'x', cgDocCheckVersion: 1,
    selectedSessions: [SESSION],
    parentWorksheet: { concerns: [{ a: '1', b: '1', c: '1', d: '1', e: '1' }] },
    connectGenDocuments: { iep, evaluation }, cgDocChecks: {},
  }, extra || {});
  for (const [rec, chk] of checksBy) s.cgDocChecks[dc.docKey(rec.storagePath)] = chk;
  return s;
}
const done = (docType, documentDate, more) => Object.assign({ status: 'done', docType, documentDate, otherKind: '' }, more || {});

test('date windows: IEP 12 months, evaluation 3 years, measured from the later of today and the session', () => {
  const ref = dc.referenceMillis('2026-11-09', NOW);
  assert.ok(ref > NOW, 'session after today is the reference');
  assert.equal(dc.isCurrent('iep', '2026-01-15', ref), true);
  assert.equal(dc.isCurrent('iep', '2025-11-08', ref), false, 'current today but lapses before the session');
  assert.equal(dc.isCurrent('iep', '2022-09-28', ref), false);
  assert.equal(dc.isCurrent('evaluation', '2023-11-29', ref), true);
  assert.equal(dc.isCurrent('evaluation', '2023-11-08', ref), false);
  assert.equal(dc.isCurrent('evaluation', '', ref), false);
  assert.equal(dc.referenceMillis('2026-01-01', NOW), NOW, 'a past session falls back to today');
});

test('a current IEP and a current evaluation complete documents', () => {
  const i = file('iep'), e = file('evaluation');
  const r = reqs(signup([i], [e], [[i, done('iep', '2026-01-15')], [e, done('evaluation', '2023-11-29')]]), EVENT, NOW);
  assert.equal(r.hasDocs, true);
  assert.equal(r.ready, true);
});

test('the Jardine shape: an old progress report and an undated section are harmless beside current ones; duplicates fine', () => {
  const i1 = file('iep'), i2 = file('iep'), e1 = file('evaluation'), e2 = file('evaluation'), e3 = file('evaluation');
  const r = reqs(signup([i1, i2], [e1, e2, e3], [
    [i1, done('iep', '2026-01-15')],
    [i2, done('other', '', { otherKind: 'progress report' })],
    [e1, done('evaluation', '2023-11-20')],
    [e2, done('evaluation', '')],
    [e3, done('evaluation', '2023-11-29', { duplicateOf: 'x' })],
  ]), EVENT, NOW);
  assert.equal(r.hasDocs, true);
  assert.deepEqual(r.docCheck.problems, []);
});

test('an old IEP and letters filed as evaluations keep documents outstanding, and are named', () => {
  const i = file('iep'), e1 = file('evaluation'), e2 = file('evaluation');
  const r = reqs(signup([i], [e1, e2], [
    [i, done('iep', '2022-09-28')],
    [e1, done('other', '', { otherKind: 'letter to the school' })],
    [e2, done('other', '', { otherKind: 'Prior Written Notice' })],
  ]), EVENT, NOW);
  assert.equal(r.hasDocs, false);
  assert.deepEqual(r.outstanding, ['documents']);
  assert.deepEqual(r.docCheck.missing, ['iep', 'evaluation']);
  assert.deepEqual(r.docCheck.problems.map((p) => p.why).sort(), ['old', 'other', 'other']);
  assert.match(dc.problemSentence(r.docCheck.problems.find((p) => p.why === 'old')), /dated September 2022\. We need the IEP from the last 12 months/);
  assert.match(dc.problemSentence(r.docCheck.problems.find((p) => p.otherKind === 'letter to the school')), /looks like a letter to the school, not an IEP or an evaluation/);
});

test('a file counts by what it is, not the slot it was put in', () => {
  const i = file('iep'), i2 = file('iep'), e = file('evaluation');
  const r = reqs(signup([i, i2], [e], [
    [i, done('iep', '2026-03-01')], [i2, done('evaluation', '2025-02-01')], [e, done('other', '', { otherKind: 'report card' })],
  ]), EVENT, NOW);
  assert.equal(r.hasDocs, true);
});

test('checks still running keep documents outstanding', () => {
  const i = file('iep'), e = file('evaluation');
  const r = reqs(signup([i], [e], [[i, done('iep', '2026-01-15')], [e, { status: 'pending', claimedAtMs: NOW }]]), EVENT, NOW);
  assert.equal(r.hasDocs, false);
  assert.equal(r.docCheck.pending, 1);
  const r2 = reqs(signup([i], [e], [[i, done('iep', '2026-01-15')]]), EVENT, NOW);
  assert.equal(r2.hasDocs, false, 'no entry yet = pending');
});

test('fail-open: a file that could not be read counts for its slot and is reported', () => {
  const i = file('iep'), e = file('evaluation');
  const r = reqs(signup([i], [e], [[i, done('iep', '2026-01-15')], [e, { status: 'error', error: 'password-protected PDF' }]]), EVENT, NOW);
  assert.equal(r.hasDocs, true);
  assert.equal(r.docCheck.failOpen.length, 1);
  const r2 = reqs(signup([i], [e], [[i, done('iep', '2026-01-15')], [e, { status: 'skipped' }]]), EVENT, NOW);
  assert.equal(r2.hasDocs, true, 'switched off = counted as given, no report');
  assert.equal(r2.docCheck.failOpen.length, 0);
});

test('staff uploads count as given', () => {
  const i = file('iep', { uploadedByStaff: 'staff@x' }), e = file('evaluation', { uploadedByStaff: 'staff@x' });
  assert.equal(reqs(signup([i], [e], []), EVENT, NOW).hasDocs, true);
});

test('grandfathering: no cgDocCheckVersion = the old any-file rule', () => {
  const i = file('iep'), e = file('evaluation');
  const s = signup([i], [e], [[i, done('iep', '2019-01-01')]], { cgDocCheckVersion: undefined });
  delete s.cgDocCheckVersion;
  const r = reqs(s, EVENT, NOW);
  assert.equal(r.hasDocs, true);
  assert.equal(r.docCheck, null);
});

test('staff override: cgDocsAcceptedAt completes documents whatever the check says', () => {
  const i = file('iep'), e = file('evaluation');
  const r = reqs(signup([i], [e], [[i, done('iep', '2019-01-01')], [e, done('other', '')]], { cgDocsAcceptedAt: 'x', cgDocsAcceptedBy: 'presenter@x' }), EVENT, NOW);
  assert.equal(r.hasDocs, true);
});

test('override never invents files: an empty slot is still outstanding', () => {
  const i = file('iep');
  const r = reqs(signup([i], [], [[i, done('iep', '2026-01-15')]], { cgDocsAcceptedAt: 'x' }), EVENT, NOW);
  assert.equal(r.hasDocs, false);
});

test('email key: stable across re-runs, changes when the findings change', () => {
  const a = { missing: ['iep'], problems: [{ key: 'k1', why: 'old' }] };
  const b = { missing: ['iep'], problems: [{ key: 'k1', why: 'old' }] };
  const c = { missing: ['iep'], problems: [{ key: 'k1', why: 'old' }, { key: 'k2', why: 'other' }] };
  assert.equal(dc.problemsKey(a), dc.problemsKey(b));
  assert.notEqual(dc.problemsKey(a), dc.problemsKey(c));
  const reordered = { missing: ['iep'], problems: [{ key: 'k2', why: 'other' }, { key: 'k1', why: 'old' }] };
  assert.equal(dc.problemsKey(c), dc.problemsKey(reordered));
});

test('signature: presenter phone, else the 9685 consultant line, else the team', () => {
  const withPhone = __test._cgPresenterSignatureHtml({ displayName: 'Pat Presenter', title: 'Director', phone: '8085551234' });
  assert.match(withPhone, /Pat Presenter/);
  assert.match(withPhone, /Director/);
  assert.match(withPhone, /\(808\) 555-1234/);
  const noPhone = __test._cgPresenterSignatureHtml({ displayName: 'Sam Staff' });
  assert.match(noPhone, /Sam Staff/);
  assert.match(noPhone, /\(808\) 536-9685/);
  const none = __test._cgPresenterSignatureHtml(null);
  assert.match(none, /Parent Consultant Team/);
  assert.match(none, /\(808\) 536-9685/);
  assert.equal(__test._cgPresenterCallLine({ displayName: 'Sam Staff' }), 'please call Sam at (808) 536-9685');
});

test('family email: names files, upload button, never "cancel" and never mentions AI', () => {
  const html = __test.buildConnectGenDocsNotCurrentEmailHtml({
    name: 'Alex Example', eventTitle: 'Connect-Gen', datesPhrase: ' on Monday, November 9',
    missing: ['iep', 'evaluation'],
    problems: [{ originalFilename: 'old IEP.pdf', why: 'old', docType: 'iep', documentDate: '2022-09-28' },
               { originalFilename: 'letter.pdf', why: 'other', otherKind: 'letter to the school' }],
    uploadUrl: 'https://example.test/upload?upload=t', signatureHtml: __test._cgPresenterSignatureHtml(null),
    callLine: 'please call our Parent Consultant Team at (808) 536-9685',
  });
  assert.match(html, /old IEP\.pdf/);
  assert.match(html, /letter\.pdf/);
  assert.match(html, /Upload IEP &amp; Evaluations/);
  assert.match(html, /536-9685/);
  assert.doesNotMatch(html, /cancel/i);
  assert.doesNotMatch(html, /\bAI\b|artificial|automated|Claude/);
});

test('model output is normalised defensively', () => {
  const r = dc.normaliseResult({ docType: 'IEP!', documentDate: 'Jan 2022', confidence: 'sure' });
  assert.equal(r.docType, 'other');
  assert.equal(r.documentDate, '');
  assert.equal(r.confidence, 'low');
});
