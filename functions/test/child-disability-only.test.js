// Exercises _placeChildEntry: where an incoming child entry lands on a
// contact's children[]. Pure function — no Firestore, no deploy, no sending.
//   node functions/test/child-disability-only.test.js
//
// The bug (2026-10-06): the one-off gathering form sends a signup carrying only
// the first child's disability categories. The enrichment could not match a
// nameless, ageless, genderless entry to anything and appended a second child
// holding only the disability, on every one-off attendee.
//
// All names here are invented. This repo is public.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const place = __test._placeChildEntry;
const merge = __test._mergeChildEntries;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  fail++; console.error(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`);
}

const ASD = 'Autism Spectrum (ASD)';
const disOnly = (key, dis) => ({
  disabilityCategories: dis || [ASD], sourceSignupId: key, sourceSignupIds: [key],
});
const fullChild = {
  ageRange: '6-12', gender: 'Female', ethnicity: 'Hispanic',
  disabilityCategories: [ASD],
};

// 1. One child on file: the disability-only entry merges into it.
{
  const list = [Object.assign({}, fullChild)];
  check('one child: merge index', place(list, disOnly('sigA')), 0);
  const merged = merge(list[0], disOnly('sigA', [ASD, 'Speech or Language Impairment']));
  check('one child: disabilities unioned', merged.disabilityCategories, [ASD, 'Speech or Language Impairment']);
  check('one child: source key recorded', merged.sourceSignupIds, ['sigA']);
  check('one child: age kept', merged.ageRange, '6-12');
  check('one child: gender kept', merged.gender, 'Female');
}

// One NAMED child on file: still merges (it is the only child we know of).
check('one named child: merge', place([{ name: 'Lani', ageRange: '3-5', gender: 'Female' }], disOnly('sigB')), 0);

// Inherited ethnicity on the entry does not stop it counting as disability-only.
check('ethnicity riding along: still merges',
  place([Object.assign({}, fullChild)], Object.assign(disOnly('sigC'), { ethnicity: 'Hispanic' })), 0);

// 2. No children on file: create it.
check('zero children: append', place([], disOnly('sigD')), -1);
check('missing list: append', place(undefined, disOnly('sigE')), -1);

// 3. Two or more children: cannot tell which, add nothing.
{
  const sibs = [
    { name: 'Kai', ageRange: '6-12', gender: 'Male', disabilityCategories: [ASD] },
    { name: 'Noa', ageRange: '13-17', gender: 'Female' },
  ];
  check('two children: skip', place(sibs, disOnly('sigF')), null);
  check('three children: skip', place(sibs.concat([{ name: 'Ike', ageRange: '0-2', gender: 'Male' }]), disOnly('sigG')), null);
}

// 4. Normal entries are unaffected.
{
  const sibs = [
    { name: 'Kai Akana', ageRange: '6-12', gender: 'Male' },
    { name: 'Noa Akana', ageRange: '13-17', gender: 'Female' },
  ];
  check('named child: exact-name match', place(sibs, { name: 'noa akana', disabilityCategories: [ASD] }), 1);
  check('named child: new sibling appends', place(sibs, { name: 'Ike Akana', ageRange: '0-2', gender: 'Male' }), -1);
  check('named child: never merged into a lone child by the disability rule',
    place([Object.assign({}, fullChild)], { name: 'Ike', disabilityCategories: [ASD] }), -1);
  check('unnamed with age only: appends', place(sibs, { ageRange: '3-5' }), -1);
  check('unnamed twin (age + gender) merges',
    place([{ ageRange: 'Adult', gender: 'Female' }], { ageRange: 'Adult', gender: 'Female', disabilityCategories: [ASD] }), 0);
  check('unnamed, different age band: appends',
    place([{ ageRange: 'Adult', gender: 'Female' }], { ageRange: '6-12', gender: 'Female', disabilityCategories: [ASD] }), -1);
  check('disability-only matches a bare unnamed row among siblings',
    place([{ name: 'Kai', ageRange: '6-12', gender: 'Male' }, { disabilityCategories: ['Other'] }], disOnly('sigH')), 1);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
