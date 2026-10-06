// Bulk screening results: completeness (copy of readiness/results.html) + status buckets.
//   node functions/test/screening-bulk.test.js
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const { _screeningParts: parts, _screeningIsComplete: done, _screeningMissing: missing,
  _screeningSendStatus: status, _screeningBulkBuckets: buckets } = __test;
let pass = 0, fail = 0;
const check = (n, a, e) => { if (JSON.stringify(a) === JSON.stringify(e)) pass++; else { fail++; console.error(`FAIL ${n}\n  expected ${JSON.stringify(e)}\n  actual   ${JSON.stringify(a)}`); } };

const P = (r, l) => ({ right: r, left: l });
const full = (o = {}) => ({ vision: { distance: P('Pass', 'Pass') },
  hearing: Object.assign({ otoscopy: P('Clear', 'Clear'), oae: P('Pass', 'Pass') }, o) });

check('empty → both todo', parts({}), { vision: 'todo', hearing: 'todo' });
check('null → both todo', parts(null), { vision: 'todo', hearing: 'todo' });
check('full results (entry) → complete', done({ results: full() }), true);
check('full results (object directly) → complete', done(full()), true);
check('vision one eye only → vision todo', parts({ results: { vision: { distance: P('Pass', '') }, hearing: full().hearing } }), { vision: 'todo', hearing: 'done' });
check('whitespace counts as empty', parts({ results: { vision: { distance: P('Pass', '  ') } } }).vision, 'todo');
check('Could not test counts', done({ results: { vision: { distance: P('Could not test', 'Could not test') }, hearing: { otoscopy: P('Could not test', 'Clear'), oae: P('Could not test', 'Pass') } } }), true);
check('no otoscopy → hearing todo', parts({ results: { vision: full().vision, hearing: { oae: P('Pass', 'Pass') } } }).hearing, 'todo');
check('OAE right Fail, no tymp → hearing todo', parts({ results: full({ oae: P('Fail', 'Pass') }) }).hearing, 'todo');
check('OAE right Fail, tymp right → done', parts({ results: full({ oae: P('Fail', 'Pass'), tympanometry: { right: 'Type A' } }) }).hearing, 'done');
check('OAE both Fail, tymp right only → todo', parts({ results: full({ oae: P('Fail', 'Fail'), tympanometry: { right: 'Type A' } }) }).hearing, 'todo');
check('OAE Refer (not Fail) needs no tymp', parts({ results: full({ oae: P('Refer', 'Pass') }) }).hearing, 'done');
check('missing lists both', missing({}), ['vision', 'hearing']);
check('missing hearing only', missing({ results: { vision: full().vision } }), ['hearing']);
check('missing none', missing({ results: full() }), []);

const c = { email: 'a@x.org' };
check('status sent wins over incomplete', status(c, { results: { resultsSentAt: { _seconds: 1 } } }), 'sent');
check('status incomplete', status(c, { results: { vision: full().vision } }), 'incomplete');
check('status incomplete when no results', status(c, {}), 'incomplete');
check('status noEmail', status({ email: '' }, { results: full() }), 'noEmail');
check('status noEmail for junk email', status({ email: 'none' }, { results: full() }), 'noEmail');
check('second parent email alone is enough', status({ secondParent: { email: 'b@x.org' } }, { results: full() }), 'ready');
check('status ready', status(c, { results: full() }), 'ready');

const docs = [
  { id: 'c1', data: { firstName: 'Ann', lastName: 'Lee', email: 'ann@x.org', screenings: [
    { id: 's1', location: 'Pali View', classroom: 'B', child: { firstName: 'Zed', lastName: 'Lee' }, results: full() },
    { id: 's2', location: 'Other School', classroom: 'B', child: { firstName: 'Amy', lastName: 'Lee' }, results: full() },
  ] } },
  { id: 'c2', data: { displayName: 'Bo Kim', email: '', screenings: [
    { id: 's3', location: 'Pali View', classroom: 'A', child: { firstName: 'Kai', lastName: 'Kim' }, results: full() } ] } },
  { id: 'c3', data: { firstName: 'Cy', email: 'cy@x.org', screenings: [
    { id: 's4', location: 'Pali View', classroom: 'A', child: { firstName: 'Mo', lastName: 'Ako' }, results: { vision: full().vision } },
    { id: 's5', location: 'Pali View', classroom: 'A', child: { firstName: 'Lu', lastName: 'Ako' }, results: full() },
    { id: 's6', location: 'Pali View', classroom: 'B', child: { firstName: 'Al', lastName: 'Ako' }, results: Object.assign(full(), { resultsSentAt: { _seconds: 1760000000 } }) },
  ] } },
  { id: 'sb', data: { sandbox: true, sandboxViewers: ['dan'], email: 's@x.org', screenings: [
    { id: 's7', location: 'Pali View', classroom: 'A', child: { firstName: 'Te', lastName: 'St' }, results: full() } ] } },
];
const ids = (rows) => rows.map((r) => r.screeningId);
let b = buckets(docs, { location: 'Pali View', classroom: '', uid: 'someone' });
check('ready sorted by classroom then last name', ids(b.ready), ['s5', 's1']);
check('incomplete', ids(b.incomplete), ['s4']);
check('incomplete carries missing', b.incomplete[0].missing, ['hearing']);
check('noEmail', ids(b.noEmail), ['s3']);
check('sent', ids(b.sent), ['s6']);
check('sentAt iso', b.sent[0].sentAt, new Date(1760000000 * 1000).toISOString());
check('parentName from displayName', b.noEmail[0].parentName, 'Bo Kim');
check('ready row shape', b.ready[1], { contactId: 'c1', screeningId: 's1', child: { firstName: 'Zed', lastName: 'Lee' }, classroom: 'B', parentName: 'Ann Lee', email: 'ann@x.org', emails: ['ann@x.org'] });
b = buckets(docs, { location: 'Pali View', classroom: 'A', uid: 'dan' });
check('classroom filter + sandbox viewer sees test child', ids(b.ready), ['s5', 's7']);
check('classroom filter drops B', ids(b.sent), []);
b = buckets(docs, { location: 'pali view', classroom: '', uid: '' });
check('location is exact match', ids(b.ready).length, 0);

console.log(`screening-bulk: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
