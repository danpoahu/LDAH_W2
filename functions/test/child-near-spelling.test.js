// Exercises the near-spelling rule in _childMatches (2026-11-18).
// Pure: no Firestore, no deploy, no sending. All names are invented; the repo is public.
//   node functions/test/child-near-spelling.test.js
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const m = __test._childMatches;
const place = __test._placeChildEntry;
let pass = 0, fail = 0;
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; return; }
  fail++; console.error(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
}
const k = (name, ageRange, gender, extra) => Object.assign({ name, ageRange, gender }, extra || {});

// Should merge
check('one letter added in first name', m(k('Rocky Pelo-Kanoa', '13-17', 'Male'), k('Rockey Pelo-Kanoa', 'High School', 'Male')), true);
check('one letter changed in last name', m(k('Mason Akoni Taylen', '13-17', 'Male'), k('Mason Akoni Taylan', 'High School', 'Male')), true);
check('spacing only', m(k('LouElly Kim', '3-5', 'Female'), k('Lou Elly Kim', '3-5', 'Female')), true);
check('two letters swapped', m(k('Kaleo Pua', '6-12', 'Male'), k('Kaloe Pua', '6-12', 'Male')), true);
check('same birthdate is fine', m(k('Rocky Pelo', '13-17', 'Male', { birthdate: '2010-03-24' }), k('Rockey Pelo', '13-17', 'Male', { birthdate: '2010-03-24' })), true);
check('placed onto the existing child', place([k('Rocky Pelo', '13-17', 'Male')], k('Rockey Pelo', 'High School', 'Male')), 0);

// Must stay apart
check('short twin names', m(k('Ana Lee', '3-5', 'Female'), k('Ava Lee', '3-5', 'Female')), false);
check('two letters different (twins)', m(k('Zane Uto', '3-5', 'Male'), k('Zion Uto', '3-5', 'Male')), false);
check('different gender', m(k('Jordan Pua', '6-12', 'Male'), k('Jordin Pua', '6-12', 'Female')), false);
check('different age band', m(k('Rocky Pelo', '6-12', 'Male'), k('Rockey Pelo', '13-17', 'Male')), false);
check('age missing on one side', m(k('Rocky Pelo', '', 'Male'), k('Rockey Pelo', '13-17', 'Male')), false);
check('gender missing on one side', m(k('Rocky Pelo', '13-17', ''), k('Rockey Pelo', '13-17', 'Male')), false);
check('birthdates differ', m(k('Rocky Pelo', '13-17', 'Male', { birthdate: '2010-03-24' }), k('Rockey Pelo', '13-17', 'Male', { birthdate: '2011-01-02' })), false);
check('two words differ', m(k('Rocky Pelo', '13-17', 'Male'), k('Rockey Pele', '13-17', 'Male')), false);
check('different word count', m(k('Rocky Pelo', '13-17', 'Male'), k('Rockey Ana Pelo', '13-17', 'Male')), false);
check('High School vs Adult', m(k('Rocky Pelo', 'Adult', 'Male'), k('Rockey Pelo', 'High School', 'Male')), false);
check('appended when no match', place([k('Ana Lee', '3-5', 'Female')], k('Ava Lee', '3-5', 'Female')), -1);

console.log(`child-near-spelling: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
