// Exercises _mergeGrantPrograms() — how a duplicate-contact merge combines grants.
// grantPrograms is the truth; grantProgram mirrors its first value. Pure, no Firestore.
//   node functions/test/merge-grant-programs.test.js
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../index.js');
const merge = __test._mergeGrantPrograms;

test('unions both arrays, keeper order first', () => {
  assert.deepEqual(
    merge({ grantPrograms: ['HI-PTI', 'PIP'], grantProgram: 'HI-PTI' }, { grantPrograms: ['KOM', 'PIP'] }),
    ['HI-PTI', 'PIP', 'KOM']);
});

test('dedupes case-insensitively, keeper spelling wins', () => {
  assert.deepEqual(merge({ grantPrograms: ['PIP'], grantProgram: 'PIP' }, { grantPrograms: ['pip', 'KOM'] }),
    ['PIP', 'KOM']);
});

test('falls back to scalar grantProgram when the array is missing or empty', () => {
  assert.deepEqual(merge({ grantProgram: 'HI-PTI' }, { grantPrograms: [], grantProgram: 'PIP' }), ['HI-PTI', 'PIP']);
});

test('keeper with no grants takes the duplicate\'s', () => {
  assert.deepEqual(merge({}, { grantProgram: 'PIP' }), ['PIP']);
});

test('returns null when nothing changes', () => {
  assert.equal(merge({ grantPrograms: ['PIP', 'KOM'], grantProgram: 'PIP' }, { grantPrograms: ['kom'] }), null);
  assert.equal(merge({}, {}), null);
});

test('writes when keeper only had the scalar (array gets created)', () => {
  assert.deepEqual(merge({ grantProgram: 'PIP' }, {}), ['PIP']);
});

test('writes when the mirror disagrees with the array', () => {
  assert.deepEqual(merge({ grantPrograms: ['PIP'], grantProgram: 'KOM' }, {}), ['PIP']);
});
