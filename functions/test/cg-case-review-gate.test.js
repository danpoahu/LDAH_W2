// Exercises the gates around the AI Case Review: who gets one, and whether
// anything has changed since the last. No Firestore, no API calls, no spend.
//   node functions/test/cg-case-review-gate.test.js
//
// These matter because the expensive, irreversible thing (sending a child's
// records to an API) sits directly behind them.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const allowed = __test._cgCaseReviewPresenterAllowed;
const fingerprint = __test._cgCaseReviewFingerprint;
const worksheetText = __test._cgWorksheetText;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  if (actual === expected) { pass++; return; }
  fail++; console.error(`FAIL ${name}\n  expected ${expected}\n  actual   ${actual}`);
}
function checkTrue(name, cond) { if (cond) { pass++; return; } fail++; console.error(`FAIL ${name}`); }

// ── the presenter gate ──────────────────────────────────────────────────────
// Fails CLOSED on every degenerate input: an unset flag must mean nobody's
// records go anywhere, not everybody's.
const THREE = ['uidRosie', 'uidNoe', 'uidChassidy'];
check('a presenter on the list is allowed', allowed(THREE, 'uidNoe'), true);
check('a presenter not on the list is not', allowed(THREE, 'uidLeilani'), false);
check('an unassigned presenter is not', allowed(THREE, ''), false);
check('a null presenter is not', allowed(THREE, null), false);
check('an unset roster allows nobody', allowed(undefined, 'uidNoe'), false);
check('an empty roster allows nobody', allowed([], 'uidNoe'), false);
check('a non-array roster allows nobody', allowed('uidNoe', 'uidNoe'), false);

// ── the fingerprint ─────────────────────────────────────────────────────────
// Decides whether we spend money re-reading a file we have already read.
const ts = (ms) => ({ toMillis: () => ms });
const sig = (o = {}) => Object.assign({
  connectGenDocuments: {
    iep: [{ storagePath: 'connectGen/e/s/iep-1.pdf', sizeBytes: 1000 }],
    evaluation: [{ storagePath: 'connectGen/e/s/eval-1.pdf', sizeBytes: 2000 }],
  },
  parentWorksheet: { concerns: [{ a: 'x', b: 'y', c: 'z', d: 'n/a', e: 'n/a' }], lastEditedAt: ts(5000) },
}, o);

const base = fingerprint(sig());
checkTrue('a fingerprint is produced', !!base && base.length === 32);
check('the same inputs give the same fingerprint', fingerprint(sig()), base);

checkTrue('a NEW document changes it', fingerprint(sig({
  connectGenDocuments: {
    iep: [{ storagePath: 'connectGen/e/s/iep-1.pdf', sizeBytes: 1000 }],
    evaluation: [
      { storagePath: 'connectGen/e/s/eval-1.pdf', sizeBytes: 2000 },
      { storagePath: 'connectGen/e/s/eval-2.pdf', sizeBytes: 3000 },
    ],
  },
})) !== base);

checkTrue('a REPLACED document of different size changes it', fingerprint(sig({
  connectGenDocuments: {
    iep: [{ storagePath: 'connectGen/e/s/iep-1.pdf', sizeBytes: 9999 }],
    evaluation: [{ storagePath: 'connectGen/e/s/eval-1.pdf', sizeBytes: 2000 }],
  },
})) !== base);

// Content, not timestamp. A staff member opening a family's worksheet and
// pressing Save without changing a word used to produce a new fingerprint, and
// the nightly sweep then paid to re-read the same documents and reach the same
// conclusions. That is money spent for nothing.
checkTrue('a NO-OP save does not change it', fingerprint(sig({
  parentWorksheet: { concerns: [{ a: 'x', b: 'y', c: 'z', d: 'n/a', e: 'n/a' }], lastEditedAt: ts(999999) },
})) === base);

checkTrue('a REAL edit to the worksheet changes it', fingerprint(sig({
  parentWorksheet: { concerns: [{ a: 'x', b: 'y CHANGED', c: 'z', d: 'n/a', e: 'n/a' }], lastEditedAt: ts(5000) },
})) !== base);

checkTrue('an ADDED concern changes it', fingerprint(sig({
  parentWorksheet: { concerns: [
    { a: 'x', b: 'y', c: 'z', d: 'n/a', e: 'n/a' },
    { a: 'second', b: 'concern', c: 'z', d: 'n/a', e: 'n/a' },
  ], lastEditedAt: ts(5000) },
})) !== base);

// Upload order must not matter, or every sweep would look like a change and
// re-bill the same documents nightly.
checkTrue('document ORDER does not change it', fingerprint(sig({
  connectGenDocuments: {
    evaluation: [{ storagePath: 'connectGen/e/s/eval-1.pdf', sizeBytes: 2000 }],
    iep: [{ storagePath: 'connectGen/e/s/iep-1.pdf', sizeBytes: 1000 }],
  },
})) === base);

check('a signup with nothing on it still fingerprints', typeof fingerprint({}), 'string');
check('a null signup does not throw', typeof fingerprint(null), 'string');

// ── the parent's own words ──────────────────────────────────────────────────
// These go to the model verbatim; the left column of the form is the family
// speaking, not us summarising them.
{
  const t = worksheetText({ parentWorksheet: { concerns: [
    { a: 'Reading is slow', b: 'takes an hour a page', c: 'no phonics taught', d: 'n/a', e: 'n/a' },
  ]}});
  checkTrue('the concern text survives verbatim', t.indexOf('Reading is slow') > -1);
  checkTrue('so does the evidence', t.indexOf('takes an hour a page') > -1);
  checkTrue('columns are labelled for the model', t.indexOf('Evidence:') > -1);
  check('no worksheet yields an empty string, not "undefined"', worksheetText({}), '');
  check('a null signup yields an empty string', worksheetText(null), '');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
