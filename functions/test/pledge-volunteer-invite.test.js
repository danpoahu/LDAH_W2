// sendPledgeVolunteerInvite (2026-10-03): who may be invited, and who may call it.
// No network, no live data: firebase-admin auth + firestore are stubbed.
//   node functions/test/pledge-volunteer-invite.test.js
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const admin = require('firebase-admin');
const fns = require('../index.js');
const { pledgeInviteSkipReason: why, buildPledgeVolunteerInviteHtml } = fns.__test;

let pass = 0, fail = 0;
const eq = (a, e, n) => { if (a === e) pass++; else { fail++; console.error(`FAIL ${n}\n  expected ${JSON.stringify(e)}\n  actual   ${JSON.stringify(a)}`); } };

// ── Pure eligibility filter ──────────────────────────────────────────
const ctx = {
  volunteerEmails: new Set(['vol@example.com']),
  optedOutEmails: new Set(['gone@example.com']),
  includeStudents: false,
};
const P = (o) => Object.assign({ name: 'Kai Parent', email: 'kai@example.com', role: 'Parent' }, o);

eq(why(P(), ctx), '', 'ordinary parent is eligible');
eq(why(P({ role: 'Professional' }), ctx), '', 'professional is eligible');
eq(why(P({ role: 'Both' }), ctx), '', 'both is eligible');
eq(why(P({ email: '' }), ctx), 'no email', 'blank email');
eq(why(P({ email: undefined }), ctx), 'no email', 'missing email');
eq(why(P({ email: 'not-an-email' }), ctx), 'no email', 'malformed email');
eq(why(P({ email: 'a@x.com, b@y.com' }), ctx), 'no email', 'two addresses in one field');
eq(why(P({ email: 'someone@ldahawaii.org' }), ctx), 'staff', 'staff address');
eq(why(P({ email: ' Someone@LDAHawaii.org ' }), ctx), 'staff', 'staff address, mixed case + spaces');
eq(why(P({ name: 'Test Pledge' }), ctx), 'test entry', 'name contains test');
eq(why(P({ name: 'TEST' }), ctx), 'test entry', 'name is TEST');
eq(why(P({ name: 'Testa Kealoha' }), ctx), '', '"Testa" is not a test entry (word boundary)');
eq(why(P({ name: 'Contest Winner' }), ctx), '', '"Contest" is not a test entry');
eq(why(P({ email: 'VOL@Example.com ' }), ctx), 'already a volunteer', 'volunteer match ignores case/space');
eq(why(P({ email: 'gone@example.com' }), ctx), 'unsubscribed', 'opted-out contact');
eq(why(P({ volunteerInviteSentAt: { seconds: 1 } }), ctx), 'already invited', 'already invited');
eq(why(P({ role: 'Student' }), ctx), 'student', 'student excluded by default');
eq(why(P({ role: 'Student' }), Object.assign({}, ctx, { includeStudents: true })), '', 'student allowed with includeStudents');
eq(why(P(), Object.assign({}, ctx, { contactEmails: new Set(['kai@example.com']) })), '', 'has contact card');
eq(why(P(), Object.assign({}, ctx, { contactEmails: new Set() })), 'no contact card', 'no contact card when set supplied');
eq(why(P({ email: 'someone@ldahawaii.org', name: 'Test' }), ctx), 'staff', 'staff outranks test entry');
eq(why(P({ email: 'vol@example.com', role: 'Student' }), ctx), 'already a volunteer', 'volunteer outranks student');
eq(why(P(), {}), '', 'empty context does not throw');

// ── Email builder ────────────────────────────────────────────────────
const html = buildPledgeVolunteerInviteHtml({ firstName: 'Kalani', unsubscribeUrl: 'https://u.example/?token=abc', signatureHtml: '<p>SIG</p>', orgFooterHtml: '<tr><td>FOOT</td></tr>' });
eq(html.includes('Aloha Kalani,'), true, 'greeting uses first name');
eq(html.includes('https://www.ldahawaii.org/volunteer.html#volunteer'), true, 'volunteer button link');
eq(html.includes('Join our volunteer roster'), true, 'button label');
eq(html.includes('https://u.example/?token=abc'), true, 'unsubscribe link');
eq(html.includes('Mahalo,') && html.includes('<p>SIG</p>') && html.includes('FOOT'), true, 'sign-off, signature, footer');
eq(/Learning Disabilities Association/i.test(html), false, 'never the old org name');
eq(/donate/i.test(html), false, 'no donate block');
eq(buildPledgeVolunteerInviteHtml({ firstName: '', unsubscribeUrl: '' }).includes('Aloha,'), true, 'no name -> "Aloha,"');
eq(buildPledgeVolunteerInviteHtml({ firstName: '<b>x', unsubscribeUrl: '' }).includes('<b>x'), false, 'first name is escaped');

// ── Endpoint: auth + preview contract (stubbed Firestore) ────────────
const roles = { uAdmin: 'admin', uSuper: 'superAdmin', uSP: 'superPartner', uArch: 'admin' };
const fakeAuth = { verifyIdToken: async (t) => { if (t && t.startsWith('tok-')) return { uid: t.slice(4), email: t.slice(4) + '@example.com' }; throw new Error('bad'); } };
const docs = (arr) => ({ forEach: (f) => arr.forEach((d) => f({ id: d.id, ref: {}, data: () => d.data })) });
const data = {
  pledges: [
    { id: 'p1', data: { name: 'Kai Parent', email: 'kai@example.com', role: 'Parent' } },
    { id: 'p2', data: { name: 'Lei Student', email: 'lei@example.com', role: 'Student' } },
    { id: 'p3', data: { name: 'No Card', email: 'nocard@example.com', role: 'Professional' } },
    { id: 'p4', data: { name: 'Kai Again', email: 'KAI@example.com', role: 'Both' } },
  ],
  volunteers: [],
  contacts: [
    { id: 'c1', data: { email: 'kai@example.com', marketingOptOut: false, unsubscribeToken: 'tok1234567890' } },
    { id: 'c2', data: { email: 'lei@example.com', marketingOptOut: false, unsubscribeToken: 'tok2234567890' } },
  ],
};
const fakeDb = { collection: (c) => ({
  doc: (id) => ({ get: async () => (c === 'userRoles'
    ? { exists: !!roles[id], data: () => ({ role: roles[id], isArchived: id === 'uArch' }) }
    : { exists: false, data: () => ({}) }) }),
  get: async () => docs(data[c] || []),
  select: () => ({ get: async () => docs(data[c] || []) }),
}) };
Object.defineProperty(admin, 'auth', { value: () => fakeAuth, configurable: true });
Object.defineProperty(admin, 'firestore', { value: Object.assign(() => fakeDb, { FieldValue: {} }), configurable: true });

async function call(headers, body, method) {
  let status = 200, out = null;
  const res = { set() {}, status(c) { status = c; return this; }, json(j) { out = j; return this; }, send() { return this; } };
  const req = { method: method || 'POST', headers, get: (h) => headers[h] || headers[h.toLowerCase()], body };
  await fns.sendPledgeVolunteerInvite(req, res);
  return { status, out };
}

(async () => {
  const B = { mode: 'preview' };
  eq((await call({}, B)).status, 401, 'no token -> 401');
  eq((await call({ Authorization: 'Bearer nope' }, B)).status, 401, 'bad token -> 401');
  eq((await call({ Authorization: 'Bearer tok-uSP' }, B)).status, 403, 'superPartner -> 403');
  eq((await call({ Authorization: 'Bearer tok-uArch' }, B)).status, 403, 'archived admin -> 403');
  eq((await call({ Authorization: 'Bearer tok-uAdmin' }, { mode: 'blast' })).status, 400, 'bad mode -> 400');
  eq((await call({}, B, 'OPTIONS')).status, 204, 'OPTIONS -> 204');

  const r = await call({ Authorization: 'Bearer tok-uSuper' }, B);
  eq(r.status, 200, 'superAdmin preview -> 200');
  eq(JSON.stringify(r.out.eligible), JSON.stringify([{ id: 'p1', name: 'Kai Parent', role: 'Parent', email: 'kai@example.com' }]), 'preview eligible shape');
  const reasons = Object.fromEntries(r.out.skipped.map((s) => [s.id, s.reason]));
  eq(reasons.p2, 'student', 'student skipped');
  eq(reasons.p3, 'no contact card', 'pledger with no contact skipped');
  eq(reasons.p4, 'duplicate email', 'second pledge from same address skipped');
  eq(Object.keys(r.out.skipped[0]).join(','), 'id,name,role,reason', 'skipped entry shape');

  const r2 = await call({ Authorization: 'Bearer tok-uAdmin' }, { mode: 'preview', includeStudents: true, pledgeIds: ['p2', 'p3'] });
  eq(r2.out.eligible.map((e) => e.id).join(','), 'p2', 'pledgeIds + includeStudents');
  eq(r2.out.skipped.map((e) => e.id).join(','), 'p3', 'only requested ids considered');

  console.log(`pledge-volunteer-invite: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
