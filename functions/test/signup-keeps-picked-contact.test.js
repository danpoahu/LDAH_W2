// handleSignupCreated must keep a contact staff already picked (2026-09-19).
// No Firestore: a fake db records what the handler writes.
//   node functions/test/signup-keeps-picked-contact.test.js
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const handle = __test.handleSignupCreated;
let pass = 0, fail = 0;
const check = (n, a, e) => { if (a === e) pass++; else { fail++; console.error(`FAIL ${n}\n  expected ${e}\n  actual   ${a}`); } };

// contacts: id -> data
function fakeDb(contacts) {
  const created = [];
  const q = (docs) => ({ size: docs.length, empty: !docs.length, docs, forEach: (f) => docs.forEach(f) });
  const chain = (filter) => ({
    where: (f, op, v) => chain((c) => (filter ? filter(c) : true) && c.data[f] === v),
    orderBy: () => chain(filter), limit: () => chain(filter),
    get: async () => q(Object.entries(contacts).map(([id, data]) => ({ id, data: () => data, ref: {} , _d: data })).filter((d) => (filter ? filter({ data: d._d }) : true))),
  });
  const db = {
    created,
    collection: (name) => {
      if (name === 'contacts') return Object.assign(chain(null), {
        doc: (id) => ({ get: async () => ({ exists: !!contacts[id], data: () => contacts[id] }), set: async () => {}, update: async () => {} }),
        add: async (d) => { const id = 'new' + created.length; created.push(d); contacts[id] = d; return { id }; },
      });
      // events / recurringEvents / anything else: inert
      const inert = { doc: () => inert, collection: () => inert, update: async () => {}, set: async () => {}, get: async () => q([]), where: () => inert, limit: () => inert, orderBy: () => inert };
      return inert;
    },
  };
  return db;
}
const admin = require('firebase-admin');
async function run(name, signup, contacts) {
  const db = fakeDb(contacts);
  const orig = admin.firestore;
  Object.defineProperty(admin, 'firestore', { value: Object.assign(() => db, orig), configurable: true });
  let written;
  const snap = { data: () => signup, ref: { update: async (u) => { if ('linkedContactId' in u) written = u.linkedContactId; }, path: 'events/E/signups/S' } };
  try { await handle(snap, { params: { eventId: 'E', signupId: 'S' } }, 'events'); }
  finally { Object.defineProperty(admin, 'firestore', { value: orig, configurable: true }); }
  return { written, created: db.created.length };
}
(async () => {
  const contacts = () => ({
    cErnie: { displayName: 'Ernie Sevaaetasi', email: '', phone: '' },
    cJasmine: { displayName: 'Jasmine Scanlan', email: 'sandysamoa2@gmail.com', phone: '' },
    cSandy: { displayName: 'Sandra Scanlan', email: 'sandysamoa2@gmail.com', phone: '' },
  });
  let r = await run('no email', { name: 'Ernie Sevaaetasi', email: '', phone: '', linkedContactId: 'cErnie', status: 'pending' }, contacts());
  check('picked contact kept when the attendee has no email/phone', r.written, 'cErnie');
  r = await run('shared email', { name: 'Sandra Scanlan', email: 'sandysamoa2@gmail.com', linkedContactId: 'cSandy', status: 'pending' }, contacts());
  check('picked contact kept when the email is shared', r.written, 'cSandy');
  check('...and no contact is created', r.created, 0);
  r = await run('stale id', { name: 'X', email: 'x@y.org', linkedContactId: 'gone', status: 'pending' }, contacts());
  check('a stale picked id falls through to normal matching (creates)', r.created, 1);
  r = await run('public signup', { name: 'Jasmine Scanlan', email: 'sandysamoa2@gmail.com', status: 'pending' }, { cJasmine: { displayName: 'Jasmine Scanlan', email: 'sandysamoa2@gmail.com' } });
  check('a signup with no picked contact still matches by email', r.written, 'cJasmine');
  console.log(`signup-keeps-picked-contact: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
