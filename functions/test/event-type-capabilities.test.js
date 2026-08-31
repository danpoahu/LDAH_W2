// Exercises the event-type capability table added 2026-08-31 — the single
// declared answer to "what does this kind of event trigger". Pure functions
// only: no Firestore, no deploy, no live data.
//   node functions/test/event-type-capabilities.test.js
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const type = __test._lcEventType;
const can  = __test._lcCan;
const CAPS = __test.EVENT_TYPE_CAPABILITIES;

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; return; }
  fail++;
  console.error(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── 1. Derivation: an un-stamped legacy doc still resolves to the right type ──
console.log('derivation from flags (documents with no eventType stamped)');
eq(type({ specialEvent: true }), 'outreach_booth', 'specialEvent -> outreach_booth');
eq(type({ specialEvent: true, specialFormConfig: { screening: true } }), 'screening', 'screening config -> screening');
eq(type({ infoOnly: true }), 'flyer', 'infoOnly -> flyer');
eq(type({ remoteSignup: true }), 'remote_signup', 'remoteSignup -> remote_signup');
eq(type({ zoomMode: 'parent_talk_cafe' }), 'parent_talk_cafe', 'zoomMode -> parent_talk_cafe');
eq(type({ title: 'Parent Talk Cafe — August' }), 'parent_talk_cafe', 'title -> parent_talk_cafe');
eq(type({ title: 'Connect-Gen Hilo' }), 'connect_gen', 'title -> connect_gen');
eq(type({}), 'learning_labs', 'bare doc -> learning_labs');
eq(type({}, 'recurringEvents'), 'connect_gen', 'recurring -> connect_gen');
eq(type({ flyerOnly: true }, 'recurringEvents'), 'flyer', 'recurring flyerOnly -> flyer');
// A stamped eventType always wins over flag derivation.
eq(type({ eventType: 'screening', infoOnly: true }), 'screening', 'stamped eventType wins');

// ── 2. The regressions Daniel flagged on 2026-08-31 ──────────────────────────
console.log('the tasks that used to fire and should not');
const booth     = { specialEvent: true };
const screening = { specialEvent: true, specialFormConfig: { screening: true } };
const flyer     = { infoOnly: true };

[['outreach booth', booth], ['screening', screening], ['flyer', flyer]].forEach(([name, ev]) => {
  eq(can(ev, 'presenter'),  false, `${name}: no Assign Presenter / Present Event`);
  eq(can(ev, 'attendance'), false, `${name}: no Take Attendance`);
  eq(can(ev, 'slides'),     false, `${name}: no Send Zoom Link / Send Slides`);
});
// Neither booth type announces: both are a table at somebody else's event, so
// there is no audience of ours to mail. A flyer does not announce either — it
// publishes itself to the W2 home page and the public calendar.
eq(can(booth, 'announce'),     false, 'outreach booth: no Send Announcements (nobody to send to)');
eq(can(screening, 'announce'), false, 'screening: no Send Announcements (nobody to send to)');
eq(can(flyer, 'announce'),     false, 'flyer: no Send Announcements (it publishes itself)');
eq(can(flyer, 'summary'),      false, 'flyer: no Event Summary');

// A flyer is now the one type that does NOTHING but Verify Display. Assert the
// whole row, so a stray `true` can never creep back in unnoticed.
['presenter', 'attendance', 'summary', 'announce', 'slides'].forEach((c) => {
  eq(can(flyer, c), false, `flyer: ${c} off — Verify Display is its only task`);
});

// ── 3. What must SURVIVE. A booth still has to be counted. ───────────────────
console.log('what must keep firing');
eq(can(booth, 'summary'),     true, 'outreach booth: Event Summary still raised');
eq(can(screening, 'summary'), true, 'screening: Event Summary still raised');

const ll     = {};
const ptc    = { zoomMode: 'parent_talk_cafe' };
const remote = { remoteSignup: true };
const cg     = {};
['presenter', 'attendance', 'summary', 'announce'].forEach((c) => {
  eq(can(ll, c),                     true, `learning labs: ${c} unchanged`);
  eq(can(ptc, c),                    true, `parent talk cafe: ${c} unchanged`);
  eq(can(remote, c),                 true, `remote signup: ${c} unchanged`);
  eq(can(cg, c, 'recurringEvents'),  true, `connect-gen: ${c} unchanged`);
});
eq(can(ll, 'slides'), true, 'learning labs: slides/Zoom still sent');
// The three that were firing Zoom tasks for events with no Zoom.
eq(can(ptc, 'slides'),    false, 'parent talk cafe: no Zoom link to send');
eq(can(remote, 'slides'), false, 'remote signup: in-person, no Zoom link to send');

// ── 4. Fail-open. A type nobody has declared must behave as it does today. ───
console.log('unknown types fail open');
const unknown = { eventType: 'some_future_type' };
['presenter', 'attendance', 'summary', 'announce', 'slides'].forEach((c) => {
  eq(can(unknown, c), true, `unknown type: ${c} falls through to current behaviour`);
});
eq(can(null, 'presenter'), true, 'null event falls open');

// ── 5. The table itself covers every type the CMS can stamp. ────────────────
console.log('table completeness');
['learning_labs', 'parent_talk_cafe', 'connect_gen', 'remote_signup',
 'screening', 'outreach_booth', 'flyer'].forEach((t) => {
  eq(!!CAPS[t], true, `table has a row for ${t}`);
  if (CAPS[t]) {
    ['presenter', 'attendance', 'summary', 'announce', 'slides'].forEach((c) => {
      eq(typeof CAPS[t][c], 'boolean', `${t}.${c} is declared`);
    });
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
