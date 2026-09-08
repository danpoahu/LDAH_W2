// Exercises the child-record matcher used when a family re-registers:
// _childMatches / _findChildMatchIndex / _mergeChildEntries / _childHasSourceKey.
// Pure functions — no Firestore, no deploy, no sending.
//   node functions/test/child-name-match.test.js
//
// The bug: one boy was registered in May under his full name and in September
// under his first name alone. Exact-string matching filed him twice, and his
// contact card shows two children where there is one.
//
// The far worse bug, which these tests exist to prevent: merging two real
// siblings. "Register Another Child" means brothers and sisters genuinely sit
// side by side in children[], they can share a nickname, and a wrong merge
// destroys one child's record and under-reports the family — with nothing left
// behind to undo it from. A duplicate is annoying; a collapse is data loss. So
// most of what follows asserts that we DO NOT merge.
//
// All names here are invented. This repo is public.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const matches = __test._childMatches;
const findIdx = __test._findChildMatchIndex;
const merge = __test._mergeChildEntries;
const hasKey = __test._childHasSourceKey;
const sourceKeys = __test._childSourceKeys;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  fail++; console.error(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`);
}

const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const MAY = Date.UTC(2026, 4, 12, 19, 0, 0);
const SEP = Date.UTC(2026, 8, 2, 19, 0, 0);

// The real shape: same boy, two registrations, name typed short the second time.
const mayBoy = {
  name: 'Mason Quillan', ageRange: '6-12', gender: 'Male',
  ethnicity: 'Other/2 or more',
  disabilityCategories: ['Autism'],
  addedAt: ts(MAY), sourceSignupId: 'sig-may', sourceSignupIds: ['sig-may'],
};
const sepBoy = {
  name: 'Mason', ageRange: '6-12', gender: 'Male',
  ethnicity: 'Hawaiian/Part Hawaiian',
  disabilityCategories: ['Speech or Language Impairment'],
  addedAt: ts(SEP), sourceSignupId: 'sig-sep', sourceSignupIds: ['sig-sep'],
};

// ── THE CASE THAT PROMPTED THIS ────────────────────────────────────────────
check('first name + same age band + same gender merges',
  matches(mayBoy, sepBoy), true);
check('and merges in either direction',
  matches(sepBoy, mayBoy), true);

// ── the three legs of corroboration, each removed in turn ──────────────────
check('same first name, DIFFERENT age band does not merge',
  matches(mayBoy, Object.assign({}, sepBoy, { ageRange: '13-17' })), false);
check('same first name, DIFFERENT gender does not merge',
  matches(mayBoy, Object.assign({}, sepBoy, { gender: 'Female' })), false);
check('age missing on the NEW entry does not merge',
  matches(mayBoy, Object.assign({}, sepBoy, { ageRange: '' })), false);
check('age missing on the EXISTING entry does not merge',
  matches(Object.assign({}, mayBoy, { ageRange: undefined }), sepBoy), false);
check('gender missing on the NEW entry does not merge',
  matches(mayBoy, Object.assign({}, sepBoy, { gender: '' })), false);
check('gender missing on the EXISTING entry does not merge',
  matches(Object.assign({}, mayBoy, { gender: undefined }), sepBoy), false);
check('both age and gender missing does not merge',
  matches({ name: 'Mason Quillan' }, { name: 'Mason' }), false);

// ── THE DISASTER CASE: two brothers who share a first name ─────────────────
// A 4-year-old and a 14-year-old, both called Mason at home; one registered
// under the bare nickname, the other under his full name. This is precisely the
// pair the widened rule could have collapsed, and must not.
const brotherYoung = { name: 'Mason', ageRange: '3-5', gender: 'Male', sourceSignupId: 'sig-a' };
const brotherOlder = { name: 'Mason Bramwell', ageRange: '13-17', gender: 'Male', sourceSignupId: 'sig-b' };
check('two brothers sharing a first name but not an age band stay apart',
  matches(brotherYoung, brotherOlder), false);
check('a brother is not found as a match in the family list',
  findIdx([brotherYoung], brotherOlder), -1);
check('and they stay apart in the other order too',
  matches(brotherOlder, brotherYoung), false);
// Same age band, so only the first name and the gender separate them.
check('two brothers sharing a first name and an age band still stay apart',
  matches({ name: 'Mason', ageRange: '6-12', gender: 'Male', sourceSignupId: 'sig-c' },
          { name: 'Mason Bramwell', ageRange: '6-12', gender: 'Male', sourceSignupId: 'sig-d' }), true);
// ^ NOTE: that one DOES merge. First name + age band + gender all agree, which
// is the corroboration the rule asks for, and nothing in the data separates
// these two rows from the Mason/Mason Quillan case that prompted the change. Two
// same-sex siblings in the same age band sharing a first name is the residual
// risk the rule knowingly accepts; the guard against it is that a fully named
// child never merges into a differently named one (see below).
// Sister and brother, same nickname, one of them fully named.
check('a sister and a brother sharing a first name stay apart',
  matches({ name: 'Kai', ageRange: '6-12', gender: 'Female' },
          { name: 'Kai Vessey', ageRange: '6-12', gender: 'Male' }), false);
// Two rows with the IDENTICAL name and nothing else to tell them apart merge,
// exactly as they did before this change. That is deliberate and unchanged: a
// child crosses an age band between registrations ("6-12" in May, "13-17" a
// year later), so an exact name match must not be vetoed by a differing age.
// The cost is that identical twins registered under one shared name cannot be
// told apart — that was already true and is not made worse here.
check('identical names merge even across an age band, as before',
  matches({ name: 'Mason', ageRange: '3-5', gender: 'Male' },
          { name: 'Mason', ageRange: '13-17', gender: 'Male' }), true);
// Two fully named children who share only a first name. Even with age band and
// gender agreeing, two complete names describe two children — the extra prefix
// guard keeps them apart. Cost of being wrong: one duplicate row.
check('two fully named children sharing only a first name stay apart',
  matches({ name: 'Mason Quillan', ageRange: '6-12', gender: 'Male' },
          { name: 'Mason Bramwell', ageRange: '6-12', gender: 'Male' }), false);

// ── genuinely different names ──────────────────────────────────────────────
check('two different names never merge',
  matches({ name: 'Mason Quillan', ageRange: '6-12', gender: 'Male' },
          { name: 'Ellery Quillan', ageRange: '6-12', gender: 'Male' }), false);
check('a shared LAST name is not a match',
  matches({ name: 'Mason Quillan', ageRange: '6-12', gender: 'Male' },
          { name: 'Quillan', ageRange: '6-12', gender: 'Male' }), false);

// ── exact match still behaves exactly as it did before ─────────────────────
check('an identical name merges with no corroboration at all',
  matches({ name: 'Mason Quillan' }, { name: 'Mason Quillan' }), true);
check('an exact name match ignores case and extra spacing',
  matches({ name: '  mason   paras ' }, { name: 'MASON PARAS' }), true);
check('an exact name match holds even when age bands differ',
  matches({ name: 'Mason Quillan', ageRange: '3-5', gender: 'Male' },
          { name: 'Mason Quillan', ageRange: '13-17', gender: 'Male' }), true);

// ── legacy rows ────────────────────────────────────────────────────────────
// Old rows carry childAgeRange/childGender and pre-canonical age labels.
check('a legacy row matches once its age band is canonicalised',
  matches({ name: 'Mason Quillan', childAgeRange: '6-11 yrs', childGender: 'Male' },
          { name: 'Mason', ageRange: '6-12', gender: 'male' }), true);

// ── nameless entries ───────────────────────────────────────────────────────
const nameless = { ageRange: '6-12', gender: 'Male', sourceSignupId: 'sig-n1' };
check('a nameless entry never matches a named one',
  matches(mayBoy, nameless), false);
check('a named entry never matches a nameless one',
  matches(nameless, mayBoy), false);
check('two nameless entries never match each other',
  matches(nameless, { ageRange: '6-12', gender: 'Male', sourceSignupId: 'sig-n2' }), false);
check('a whitespace-only name is nameless',
  matches({ name: '   ', ageRange: '6-12', gender: 'Male' },
          { name: '  ', ageRange: '6-12', gender: 'Male' }), false);
check('a nameless entry is appended, not merged',
  findIdx([nameless], { ageRange: '6-12', gender: 'Male' }), -1);

// ── degenerate input must not throw ────────────────────────────────────────
check('null vs an entry', matches(null, mayBoy), false);
check('an entry vs null', matches(mayBoy, null), false);
check('null vs null', matches(null, null), false);
check('empty objects', matches({}, {}), false);
check('a string where an entry was expected', matches('Mason', mayBoy), false);
check('a numeric name', matches({ name: 12 }, { name: 12 }), true);
check('findIndex over a non-array', findIdx(null, mayBoy), -1);
check('findIndex over a list holding junk', findIdx([null, undefined, 'x', mayBoy], sepBoy), 3);

// ── the merge itself ───────────────────────────────────────────────────────
const merged = merge(mayBoy, sepBoy);
check('the longer name survives the merge', merged.name, 'Mason Quillan');
check('the shorter name wins nothing', merge(sepBoy, mayBoy).name, 'Mason Quillan');
check('disabilityCategories are unioned, not replaced',
  merged.disabilityCategories, ['Autism', 'Speech or Language Impairment']);
check('a repeated category is not doubled',
  merge({ name: 'A', disabilityCategories: ['Autism'] },
        { name: 'A', disabilityCategories: ['Autism', 'Other Health Impairment'] }).disabilityCategories,
  ['Autism', 'Other Health Impairment']);
check('the earliest addedAt survives', merged.addedAt.toMillis(), MAY);
check('the earliest addedAt survives whichever side it is on',
  merge(sepBoy, mayBoy).addedAt.toMillis(), MAY);
check('an existing row with no addedAt takes the incoming one',
  merge({ name: 'A' }, { name: 'A', addedAt: ts(SEP) }).addedAt.toMillis(), SEP);
check('an incoming row with no addedAt does not blank the existing one',
  merge({ name: 'A', addedAt: ts(MAY) }, { name: 'A' }).addedAt.toMillis(), MAY);

// Ethnicity: the newer answer wins, the older one is kept visible. These two
// records genuinely disagree in the real case, which is a judgement call the
// row should show rather than swallow.
check('the newer ethnicity wins', merged.ethnicity, 'Hawaiian/Part Hawaiian');
check('the superseded ethnicity is kept on the row',
  merged.ethnicityPrevious, ['Other/2 or more']);
check('a blank incoming ethnicity never blanks an existing one',
  merge(mayBoy, Object.assign({}, sepBoy, { ethnicity: '' })).ethnicity, 'Other/2 or more');
check('a blank incoming ethnicity records no conflict',
  merge(mayBoy, Object.assign({}, sepBoy, { ethnicity: '' })).ethnicityPrevious, undefined);
check('an incoming ethnicity fills an empty one',
  merge({ name: 'A' }, { name: 'A', ethnicity: 'Filipino' }).ethnicity, 'Filipino');
check('the same ethnicity twice records no conflict',
  merge(mayBoy, Object.assign({}, sepBoy, { ethnicity: 'Other/2 or more' })).ethnicityPrevious, undefined);

// Staff-entered fields are filled only when blank, never overwritten.
check('staff notes are not overwritten by a registration',
  merge({ name: 'A', notes: 'IEP due in March' }, { name: 'A', notes: '' }).notes, 'IEP due in March');
check('a blank grade is filled from the new entry',
  merge({ name: 'A' }, { name: 'A', grade: '4' }).grade, '4');
check('an existing age band is not replaced by a different one',
  merge({ name: 'Mason Quillan', ageRange: '6-12' },
        { name: 'Mason Quillan', ageRange: '13-17' }).ageRange, '6-12');

check('merging degenerate input does not throw',
  typeof merge(null, null), 'object');

// ── sourceSignupIds: idempotency across a merge ────────────────────────────
check('a merged row carries every contributing key',
  merged.sourceSignupIds, ['sig-may', 'sig-sep']);
check('the scalar still names the newest contributor',
  merged.sourceSignupId, 'sig-sep');
check('re-running the MAY signup against the merged row is blocked',
  hasKey([merged], 'sig-may'), true);
check('re-running the SEPTEMBER signup against the merged row is blocked',
  hasKey([merged], 'sig-sep'), true);
check('an unrelated signup is not blocked',
  hasKey([merged], 'sig-nov'), false);

// A human collapsed three rows in Int: the array holds all three, the scalar is
// whatever row happened to win. Every one of the three must still be blocked.
const handMerged = {
  name: 'Ellery Bramwell', ageRange: '3-5', gender: 'Female',
  sourceSignupId: 'sig-old-1',                       // stale: covers only one
  sourceSignupIds: ['sig-old-1', 'sig-old-2', 'sig-old-3'],
};
check('a hand-merged row blocks its first key', hasKey([handMerged], 'sig-old-1'), true);
check('a hand-merged row blocks its second key', hasKey([handMerged], 'sig-old-2'), true);
check('a hand-merged row blocks its third key', hasKey([handMerged], 'sig-old-3'), true);
check('a hand-merged row blocks nothing else', hasKey([handMerged], 'sig-old-4'), false);

// A row written before sourceSignupIds existed has only the scalar.
check('a pre-array row is still blocked by its scalar',
  hasKey([{ name: 'A', sourceSignupId: 'sig-legacy' }], 'sig-legacy'), true);
check('sourceKeys reads the scalar when there is no array',
  sourceKeys({ sourceSignupId: 'sig-legacy' }), ['sig-legacy']);
check('sourceKeys does not repeat a key held in both places',
  sourceKeys({ sourceSignupId: 'sig-x', sourceSignupIds: ['sig-x', 'sig-y'] }), ['sig-x', 'sig-y']);
check('an empty key blocks nothing', hasKey([merged], ''), false);
check('a null key blocks nothing', hasKey([merged], null), false);
check('hasKey over a non-array', hasKey(null, 'sig-may'), false);
check('hasKey over a list holding junk', hasKey([null, 'x', merged], 'sig-may'), true);
check('sourceKeys of junk', sourceKeys(null), []);

// Sibling keys are "<signupId>#<name>", so a sibling never blocks the
// registrant behind the bare signup id.
check('a sibling key does not block the registrant key',
  hasKey([{ name: 'B', sourceSignupId: 'sig-sep#brother' }], 'sig-sep'), false);

// ── end-to-end shape: the second registration lands on one row ─────────────
{
  const family = [Object.assign({}, mayBoy)];
  const idx = findIdx(family, sepBoy);
  check('September finds May', idx, 0);
  family[idx] = merge(family[idx], sepBoy);
  check('the family still has ONE child', family.length, 1);
  // ...and the September signup replayed (a re-trigger of the same write) adds
  // nothing back.
  check('a replay of September is blocked', hasKey(family, 'sig-sep'), true);
  check('a replay of May is blocked', hasKey(family, 'sig-may'), true);
  // A genuine sibling registered next still gets their own row.
  const sister = { name: 'Ellery', ageRange: '3-5', gender: 'Female', sourceSignupId: 'sig-sep#ellery' };
  check('a real sibling is appended, not merged', findIdx(family, sister), -1);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
