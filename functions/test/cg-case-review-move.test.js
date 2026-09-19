// A family that MOVES session with unchanged documents keeps its review, but
// the new session's presenter must still get a task (2026-09-19: Rodlyn Muro
// and Sierra Rehrer moved 9-14 -> 9-21 and Chassidy never heard).
// No Firestore, no API calls:  node functions/test/cg-case-review-move.test.js
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const maybe = __test._cgMaybeGenerateCaseReview;
const fingerprint = __test._cgCaseReviewFingerprint;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  if (actual === expected) { pass++; return; }
  fail++; console.error(`FAIL ${name}\n  expected ${expected}\n  actual   ${actual}`);
}

function fakeDb(existingTasks) {
  const added = [];
  const db = {
    added,
    doc: () => ({ get: async () => ({ data: () => ({ cgCaseReviewEnabled: true, cgCaseReviewPresenterUids: ['uidNoe', 'uidChassidy'] }) }) }),
    collection: (name) => {
      if (name === 'interactions') {
        const filters = {};
        const q = {
          where: (f, _op, v) => { filters[f] = v; return q; },
          limit: () => q,
          get: async () => {
            const hit = existingTasks.some((t) => t.path === filters.cgCaseReviewSignupPath && t.session === filters.cgCaseReviewSessionKey);
            return { empty: !hit };
          },
          add: async (doc) => { added.push(doc); return { id: 'new' }; },
        };
        return q;
      }
      if (name === 'userRoles') return { doc: (uid) => ({ get: async () => ({ data: () => ({ displayName: uid === 'uidChassidy' ? 'Chassidy Kruse' : 'Noelani' }) }) }) };
      throw new Error('unexpected collection ' + name);
    },
  };
  return db;
}

const ts = (ms) => ({ toMillis: () => ms });
const RAW21 = '2026-09-21|All Islands Virtual – Zoom Meeting|3:00 PM – 5:00 PM';
const signup = {
  name: 'Rodlyn Muro', linkedContactId: 'c1', status: 'confirmed',
  selectedSessions: [RAW21],
  connectGenDocuments: { iep: [{ storagePath: 'a/iep.pdf', sizeBytes: 1 }], evaluation: [{ storagePath: 'a/ev.pdf', sizeBytes: 2 }] },
  parentWorksheet: { concerns: [{ a: 'x', b: 'y', c: 'z', d: 'n/a', e: 'n/a' }], lastEditedAt: ts(5) },
};
signup.caseSummary = { html: '<p>review</p>', docsFingerprint: fingerprint(signup) };
const event = {
  zoomMode: 'program',
  schedules: [{ location: 'All Islands Virtual', venue: 'Zoom Meeting', frequency: 'weekly', dayOfWeek: '1', startTime: '15:00', endTime: '17:00', id: 'sch_v' }],
  sessionSummaries: {
    '2026-09-14|All Islands Virtual|15:00-17:00': { presenterUid: 'uidNoe' },
    '2026-09-21|All Islands Virtual|15:00-17:00': { presenterUid: 'uidChassidy' },
  },
};
const signupRef = { path: 'recurringEvents/E/signups/S', set: async () => {} };

(async () => {
  // Moved: a task exists for 9-14 only.
  let db = fakeDb([{ path: signupRef.path, session: '2026-09-14' }]);
  let r = await maybe({ db, collection: 'recurringEvents', eventId: 'E', signupRef, signup, event, reason: 'sweep' });
  check('unchanged documents do not regenerate', r, false);
  check('the new session gets exactly one task', db.added.length, 1);
  check('...owned by the new presenter', db.added[0] && db.added[0].ownerUid, 'uidChassidy');
  check('...keyed to the new session', db.added[0] && db.added[0].cgCaseReviewSessionKey, '2026-09-21');

  // Next day's sweep: task already there -> nothing new.
  db = fakeDb([{ path: signupRef.path, session: '2026-09-14' }, { path: signupRef.path, session: '2026-09-21' }]);
  await maybe({ db, collection: 'recurringEvents', eventId: 'E', signupRef, signup, event, reason: 'sweep' });
  check('no duplicate on the next sweep', db.added.length, 0);

  console.log(`cg-case-review-move: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
