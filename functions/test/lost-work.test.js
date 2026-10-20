// The nightly "lost work" sweep: which records have fallen out of everyone's view.
//   node functions/test/lost-work.test.js
//
// The whole value of this sweep is that it cries wolf rarely. Ten of the twelve
// ownerless records on the live database are readiness-kiosk consent logs, which
// have no owner BY DESIGN — an unauthenticated kiosk wrote them. If those are
// reported every night the digest is noise and gets ignored, which is exactly the
// failure it exists to prevent.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const cl = __test._lostWorkReason;

const ENV = {
  validUids: new Set(['uidStaffA', 'uidDan', 'uidStaffB']),
  archivedUids: new Set(['uidGone']),
  knownContactIds: new Set(['c1', 'c2']),
};
const base = { status: 'Open', ownerUid: 'uidStaffA', followUpDate: '2026-09-21', contactId: 'c1' };
const T = (o) => cl(Object.assign({}, base, o), ENV);

let pass = 0, fail = 0;
const check = (n, a, e) => { if (a === e) pass++; else { fail++; console.error(`FAIL ${n}\n  expected ${e}\n  actual   ${a}`); } };

// A healthy task is not lost.
check('owned, dated, real contact', T({}), null);

// Closed records are history, never chased.
check('closed with no owner', T({ status: 'Closed', ownerUid: '' }), null);
check('closed with no date', T({ status: 'Closed', followUpDate: '' }), null);

// THE EVELYN CASE: a real task, named owner, but no uid — invisible to everyone.
check('open, no ownerUid', T({ ownerUid: '', owner: 'Staff A' }), 'no-owner');

// ...but a kiosk consent log is SUPPOSED to be ownerless. Never report it.
check('kiosk consent log', T({ ownerUid: '', source: 'readiness-kiosk' }), null);
check('any system source', T({ ownerUid: '', source: 'lions-screening' }), null);
check('system-created', T({ ownerUid: '', createdBy: 'system' }), null);

// Open, owned, but no follow-up date: My Day filters on the date, so it never shows.
check('open, no followUpDate', T({ followUpDate: '' }), 'no-date');
check('open, blank followUpDate', T({ followUpDate: '   ' }), 'no-date');

// The owner left, or was archived.
check('owner not on the roster', T({ ownerUid: 'uidStranger' }), 'owner-gone');
check('owner archived', T({ ownerUid: 'uidGone' }), 'owner-gone');

// The family record it points at is gone.
check('contact deleted', T({ contactId: 'cMissing' }), 'contact-gone');
check('no contact at all is fine', T({ contactId: '' }), null);

// One reason per record, most serious first, so a digest line is unambiguous.
check('no owner beats no date', T({ ownerUid: '', followUpDate: '' }), 'no-owner');
check('owner gone beats no date', T({ ownerUid: 'uidStranger', followUpDate: '' }), 'owner-gone');

// Garbage in, silence out.
check('null record', cl(null, ENV), null);
check('empty record', cl({}, ENV), null);

console.log(`lost-work: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
