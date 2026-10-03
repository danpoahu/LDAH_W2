// ensurePledgeContact: match by email, create for adults, leave Students alone.
const fns = require('../index.js');
const { ensurePledgeContact } = fns.__test;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
function fakeDb(existing) {
  const added = [];
  return {
    added,
    collection: () => ({
      where: (f, op, v) => ({ limit: () => ({ get: async () => {
        const hit = existing.filter(e => e.email === v);
        return { empty: !hit.length, docs: hit.map(h => ({ id: h.id })) };
      } }) }),
      add: async (doc) => { added.push(doc); return { id: 'new' + added.length }; },
    }),
  };
}
function fakeRef() { const r = { updates: [] }; r.update = async (u) => { r.updates.push(u); }; return r; }
(async () => {
  let db = fakeDb([{ id: 'c1', email: 'pat@example.com' }]), ref = fakeRef();
  let r = await ensurePledgeContact(db, ref, { name: 'Pat Doe', email: ' Pat@Example.com ', role: 'Parent' });
  ok(r && r.contactId === 'c1' && !r.created, 'links existing card by lowercased email');
  ok(db.added.length === 0, 'does not create when matched');
  ok(ref.updates[0].contactId === 'c1' && ref.updates[0].contactCreated === false, 'stamps pledge with contactId');

  db = fakeDb([]); ref = fakeRef();
  r = await ensurePledgeContact(db, ref, { name: 'Lee Ann Kim', email: 'lee@example.com', role: 'Professional', zip: '96817' });
  ok(r && r.created && r.contactId === 'new1', 'creates a card');
  const d = db.added[0];
  ok(d.firstName === 'Lee' && d.lastName === 'Ann Kim' && d.displayName === 'Lee Ann Kim', 'splits name');
  ok(d.type === 'Professional' && d.zipCode === '96817' && d.email === 'lee@example.com', 'type/zip/email');
  ok(d.source === 'anti-bullying-pledge', 'source tag');

  db = fakeDb([]); ref = fakeRef();
  r = await ensurePledgeContact(db, ref, { name: 'Sam', email: 'sam@example.com', role: 'Both' });
  ok(db.added[0].type === 'Parent/Guardian' && db.added[0].lastName === '', 'Both -> Parent/Guardian, single name');

  db = fakeDb([]); ref = fakeRef();
  r = await ensurePledgeContact(db, ref, { name: 'Kid', email: 'kid@example.com', role: 'Student' });
  ok(r === null && db.added.length === 0 && ref.updates.length === 0, 'Student: nothing created or stamped');

  r = await ensurePledgeContact(fakeDb([]), fakeRef(), { name: 'X', email: '', role: 'Parent' });
  ok(r === null, 'no email: skipped');
  r = await ensurePledgeContact(fakeDb([]), fakeRef(), { name: 'X', email: 'x@example.com', role: 'Parent', contactId: 'already' });
  ok(r === null, 'already linked: skipped');

  console.log(`pledge-contact: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
