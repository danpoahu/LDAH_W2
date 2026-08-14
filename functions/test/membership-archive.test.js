// Exercises _membershipArchiveDecision() — the pure guard that decides whether
// a dead membership lead may be archived. No Firestore, no deploy, no live data.
//   node functions/test/membership-archive.test.js
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const decide = __test._membershipArchiveDecision;
const GRACE_H = __test.MEMBERSHIP_ARCHIVE_GRACE_HOURS;

const NOW = Date.UTC(2026, 7, 30, 18, 0, 0);            // 2026-08-30
const ts = (ms) => ({ toMillis: () => ms });
const H = (h) => h * 3600 * 1000;

// Comfortably inside the sequence window (MEMBERSHIP_SEQUENCE_START = 8-10).
const CREATED = Date.UTC(2026, 7, 12, 0, 0, 0);
const LAST_NUDGE = NOW - H(GRACE_H + 24);                // grace elapsed

const member = (o = {}) => Object.assign({
  name: 'Sai Krina', email: 'saikrina0@gmail.com', amount: 500, level: 'Sponsor',
  createdAt: ts(CREATED), nudgeCount: 4, lastNudgeAt: ts(LAST_NUDGE),
  linkedContactId: 'C1',
}, o);

const contact = (o = {}) => Object.assign({
  firstName: 'Sai', lastName: 'Krina', displayName: 'Sai Krina',
  email: 'saikrina0@gmail.com', phone: '8085551234', type: 'Member',
  isMember: true, membershipLevel: 'Sponsor', membershipStatus: 'pending',
  source: 'web-membership', createdBy: 'web-membership', createdAt: ts(CREATED),
  marketingOptOut: false, unsubscribeToken: 'abc123', island: 'Oahu',
  islandSource: 'zip', hasScreenings: false,
}, o);

const NOREFS = { interactions: 0, tasks: 0, contactNotes: 0, signups: 0, otherMemberDocs: 0 };

let pass = 0, fail = 0;
function check(label, got, wantArchive, wantReason) {
  const okA = got.archive === wantArchive;
  const okR = wantReason == null || got.reason === wantReason ||
              (wantReason.endsWith(':') && got.reason.startsWith(wantReason));
  if (okA && okR) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '\n      got  archive=' + got.archive + ' reason=' + got.reason +
        '\n      want archive=' + wantArchive + ' reason=' + wantReason); }
}
const run = (m, c, r) => decide({ member: m, contact: c, refCounts: r || NOREFS, nowMs: NOW });

console.log('\n── The one case that SHOULD archive ──');
check('dead lead, full sequence, grace elapsed, clean contact',
      run(member(), contact()), true, 'deadLead');

console.log('\n── Money: never archive anyone who might have paid ──');
check('status paid',            run(member({ status: 'paid' }), contact()), false, 'paid');
check('status "Paid" (case)',   run(member({ status: 'Paid' }), contact()), false, 'paid');
check('paidAt set',             run(member({ paidAt: ts(NOW) }), contact()), false, 'hasPaymentEvidence');
check('paypalOrderId set',      run(member({ paypalOrderId: '5X9' }), contact()), false, 'hasPaymentEvidence');
check('capture failed',         run(member({ lastError: 'capture:DECLINED' }), contact()), false, 'captureFailedMayHavePaid');
check('contact membership active', run(member(), contact({ membershipStatus: 'active' })), false, 'contactMembershipActive');
check('contact membership paid',   run(member(), contact({ membershipStatus: 'paid' })),   false, 'contactMembershipActive');

console.log('\n── Timing ──');
check('only 3 nudges sent',     run(member({ nudgeCount: 3 }), contact()), false, 'sequenceNotFinished');
check('0 nudges sent',          run(member({ nudgeCount: 0 }), contact()), false, 'sequenceNotFinished');
check('grace not yet elapsed',  run(member({ lastNudgeAt: ts(NOW - H(GRACE_H - 1)) }), contact()), false, 'graceNotElapsed');
check('grace exactly elapsed',  run(member({ lastNudgeAt: ts(NOW - H(GRACE_H)) }), contact()), true, 'deadLead');
check('no lastNudgeAt stamp',   run(member({ lastNudgeAt: null }), contact()), false, 'noLastNudgeStamp');
check('predates sequence start',run(member({ createdAt: ts(Date.UTC(2026,6,1)) }), contact()), false, 'beforeSequenceStart');
check('no createdAt at all',    run(member({ createdAt: null }), contact()), false, 'beforeSequenceStart');

console.log('\n── A REAL family must be untouchable ──');
check('contact pre-existed (linked, not created)',
      run(member(), contact({ source: 'int-manual', createdBy: 'staff' })), false, 'contactNotMembershipOrigin');
check('source right but createdBy wrong',
      run(member(), contact({ createdBy: 'event-signup' })), false, 'contactNotMembershipCreated');
check('retyped as Family',      run(member(), contact({ type: 'Family' })), false, 'contactRetyped');
check('has children',           run(member(), contact({ children: [{ name: 'Kai' }] })), false, 'contactHasOtherData:');
check('has an address',         run(member(), contact({ address: '123 Ala Moana' })), false, 'contactHasOtherData:');
check('has staff notes',        run(member(), contact({ adminNotes: 'called 8/12' })), false, 'contactHasOtherData:');
check('has an advocate',        run(member(), contact({ externalAdvocateId: 'A7' })), false, 'contactHasOtherData:');
check('unknown future field',   run(member(), contact({ someFieldInventedLater: 'x' })), false, 'contactHasOtherData:');

console.log('\n── Empty values are NOT activity ──');
check('children: [] ignored',   run(member(), contact({ children: [] })), true, 'deadLead');
check('address: "" ignored',    run(member(), contact({ address: '' })), true, 'deadLead');
check('notes: null ignored',    run(member(), contact({ notes: null })), true, 'deadLead');
check('secondParent allowed',   run(member(), contact({ secondParent: { email: 'x@y.com' } })), true, 'deadLead');

console.log('\n── Referenced anywhere = leave alone ──');
for (const k of ['interactions', 'tasks', 'contactNotes', 'signups', 'otherMemberDocs']) {
  check('referenced by ' + k, run(member(), contact(), Object.assign({}, NOREFS, { [k]: 1 })),
        false, 'contactReferencedBy:' + k);
}

console.log('\n── Housekeeping ──');
check('already archived',       run(member({ archived: true }), contact()), false, 'alreadyArchived');
check('archived as STRING true',run(member({ archived: 'true' }), contact()), false, 'alreadyArchived');
check('contact already archived', run(member(), contact({ archived: true })), false, 'contactAlreadyArchived');
check('internal (@ldahawaii.org)', run(member({ email: 'la@ldahawaii.org' }), contact()), false, 'internal');
check('name contains "test"',   run(member({ name: 'Test Person' }), contact()), false, 'internal');
check('no linked contact',      run(member({ linkedContactId: null }), contact()), false, 'noLinkedContact');
check('contact missing',        decide({ member: member(), contact: null, refCounts: NOREFS, nowMs: NOW }),
      false, 'contactMissing');
check('refCounts null = fails closed? (pre-pass only)',
      decide({ member: member(), contact: contact(), refCounts: null, nowMs: NOW }), true, 'deadLead');

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
