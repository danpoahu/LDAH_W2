// sendEventAnnouncement must refuse anyone but a signed-in Super Admin (2026-09-19).
// No network: firebase-admin auth + firestore are stubbed.
//   node functions/test/announce-requires-superadmin.test.js
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const admin = require('firebase-admin');
const fns = require('../index.js');
let pass = 0, fail = 0;
const check = (n, a, e) => { if (a === e) pass++; else { fail++; console.error(`FAIL ${n}\n  expected ${e}\n  actual   ${a}`); } };
const roles = { uAdmin: 'admin', uSuper: 'superAdmin', uPartner: 'partner' };
const fakeAuth = { verifyIdToken: async (t) => { if (t && t.startsWith('tok-')) return { uid: t.slice(4) }; throw new Error('bad'); } };
const fakeDb = { collection: (c) => ({ doc: (id) => ({ get: async () => (
  c === 'userRoles' ? { exists: !!roles[id], data: () => ({ role: roles[id] }) } : { exists: false, data: () => ({}) }) }) }) };
Object.defineProperty(admin, 'auth', { value: () => fakeAuth, configurable: true });
Object.defineProperty(admin, 'firestore', { value: Object.assign(() => fakeDb, { FieldValue: {} }), configurable: true });
async function call(headers, body) {
  let status = 200;
  const res = { set() {}, status(c) { status = c; return this; }, json() { return this; }, send() { return this; } };
  const req = { method: 'POST', headers, get: (h) => headers[h] || headers[h.toLowerCase()], body };
  await fns.sendEventAnnouncement(req, res);
  return status;
}
(async () => {
  const body = { eventId: 'E', collection: 'events', dryRun: true };
  check('no token -> 401', await call({}, body), 401);
  check('garbage token -> 401', await call({ Authorization: 'Bearer nope' }, body), 401);
  check('partner -> 403', await call({ Authorization: 'Bearer tok-uPartner' }, body), 403);
  check('admin -> 403 (Announce is Super Admin only)', await call({ Authorization: 'Bearer tok-uAdmin' }, body), 403);
  check('super admin via Bearer passes auth (then 404: no such event)', await call({ Authorization: 'Bearer tok-uSuper' }, body), 404);
  check('super admin via body.idToken passes auth', await call({}, Object.assign({ idToken: 'tok-uSuper' }, body)), 404);
  console.log(`announce-requires-superadmin: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
