// Exercises the PURE parts of functions/advocacyReadiness.js — scoring rules,
// clamp/cap/floor/gates, the forward-only item selection and the
// unrated-meeting checkpoint rule. No Firestore, no model call, no deploy.
//   node functions/test/advocacy-readiness.test.js
//
// All fixture data is invented. Nothing here is a real family.

const R = require('../advocacyReadiness.js');

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '\n      got  ' + JSON.stringify(got) + '\n      want ' + JSON.stringify(want)); }
}
function ok(label, cond) { eq(label, !!cond, true); }

const HST = 10 * 3600 * 1000;
const D = (y, m, d, h = 12) => Date.UTC(y, m - 1, d, h) + HST;   // HST wall-clock -> ms
const ts = (ms) => ({ toMillis: () => ms });
const NO_GATES = { goldCert: false, parentLedMeeting: false };
const BOTH = { goldCert: true, parentLedMeeting: true };

console.log('\nclamp / cap / floor / rounding');
eq('round to 0.5 (2.26 -> 2.5)', R.roundHalf(2.26), 2.5);
eq('round to 0.5 (2.24 -> 2)', R.roundHalf(2.24), 2);
eq('cap 9.5 without both gates', R.clampScore(11, 3, NO_GATES), 9.5);
eq('cap 9.5 with only gold', R.clampScore(11, 3, { goldCert: true, parentLedMeeting: false }), 9.5);
eq('cap 10 with both gates', R.clampScore(11, 3, BOTH), 10);
eq('floor at start', R.clampScore(1, 3, NO_GATES), 3);
eq('confirmed start above cap wins', R.clampScore(10, 10, NO_GATES), 10);
eq('never below 0', R.clampScore(-4, 0, NO_GATES), 0);

console.log('\neffectiveStart / computeCurrentScore');
eq('confirmed start beats suggestion', R.effectiveStart({ startScore: 4, startSuggested: { score: 2 } }), 4);
eq('suggestion when unconfirmed', R.effectiveStart({ startScore: null, startSuggested: { score: 2 } }), 2);
eq('0 when neither', R.effectiveStart({}), 0);
eq('current = start + sumDelta', R.computeCurrentScore({ startScore: 3, sumDelta: 2.5, gates: NO_GATES }), 5.5);
eq('current capped', R.computeCurrentScore({ startScore: 6, sumDelta: 5, gates: NO_GATES }), 9.5);
eq('staff raises start after checks', R.computeCurrentScore({ startScore: 5, startSuggested: { score: 3 }, sumDelta: 2, gates: NO_GATES }), 7);

console.log('\nfinalizeScore');
eq('plain add', R.finalizeScore({ startScore: 3, sumDelta: 1, gates: NO_GATES }, 1.5, NO_GATES),
  { scoreBefore: 4, scoreAfter: 5.5, delta: 1.5, sumDelta: 2.5 });
eq('negative never below start', R.finalizeScore({ startScore: 3, sumDelta: 0.5, gates: NO_GATES }, -1.5, NO_GATES),
  { scoreBefore: 3.5, scoreAfter: 3, delta: -0.5, sumDelta: 0 });
eq('gates open the last half point', R.finalizeScore({ startScore: 5, sumDelta: 4.5, gates: NO_GATES }, 1, BOTH),
  { scoreBefore: 9.5, scoreAfter: 10, delta: 0.5, sumDelta: 5 });
{
  const doc = { startScore: 2, sumDelta: 0, gates: NO_GATES };
  const f = R.finalizeScore(doc, 2, NO_GATES);
  eq('invariant: currentScore === computeCurrentScore(updated doc)',
    R.computeCurrentScore(Object.assign({}, doc, { sumDelta: f.sumDelta })), f.scoreAfter);
}

console.log('\nworkshop cap');
{
  const items = [1, 2, 3, 4].map((n) => ({ kind: 'workshop', ref: 'events/E' + n + '/signups/S', at: D(2026, 9, n), meta: { title: 'LL ' + n } }));
  const r = R.applyRules({ items, proposal: { entries: [] }, state: { workshopPoints: 1.5, meetingLedger: [] } });
  eq('points per workshop until cap', r.entries.map((e) => e.points), [0.5, 0.5, 0, 0]);
  eq('workshopPoints stops at 2.5', r.workshopPoints, 2.5);
  eq('raw total', r.rawPoints, 1);
  ok('capped entry says so', /cap/.test(r.entries[3].text));
}
{
  const items = [{ kind: 'workshop', ref: 'w1', at: D(2026, 9, 1), meta: { title: 'LL' } }];
  const r = R.applyRules({ items, proposal: { entries: [{ ref: 'w1', text: 'Attended LL', points: 5 }] }, state: { workshopPoints: 0 } });
  eq('model cannot inflate a workshop', r.entries[0].points, 0.5);
}

console.log('\nmeeting outcome points');
const mtg = (ref, day, outcome, parentLed = false, summary = 'IEP reading goals') =>
  ({ kind: 'meeting', ref, at: D(2026, 9, day), meta: { outcome, parentLed, summary, body: '' } });
{
  const r = R.applyRules({
    items: [mtg('m1', 1, 'worked'), mtg('m2', 2, 'partly'), mtg('m3', 3, 'didnt'), mtg('m4', 4, 'worked', true), mtg('m5', 5, 'didnt', true)],
    proposal: { entries: [{ ref: 'm1', text: 'x', points: 99 }] }, state: {},
  });
  eq('worked 1.5 / partly 0.5 / didnt 0 / worked+led 2.5 / didnt+led 1', r.entries.map((e) => e.points), [1.5, 0.5, 0, 2.5, 1]);
  eq('ledger records base outcome points', r.meetingLedger.map((m) => m.points), [1.5, 0.5, 0, 1.5, 0]);
}
eq('normOutcome variants', ['worked', 'Partly', "didn't", 'DIDNT', '', 'maybe'].map(R.normOutcome), ['worked', 'partly', 'didnt', 'didnt', null, null]);

console.log("\n'didnt' take-back");
{
  const state = { meetingLedger: [{ ref: 'old', date: '2026-08-01', outcome: 'worked', points: 1.5, takenBack: 0, issue: 'reading' }] };
  const r = R.applyRules({ items: [mtg('m9', 9, 'didnt')], proposal: { entries: [{ ref: 'm9', text: 'Same reading issue, no progress', points: -3, sameIssueAsRef: 'old', takeBack: 3 }] }, state });
  eq('take-back limited to earlier meeting points', r.entries[0].points, -1.5);
  eq('earlier meeting marked taken back', r.meetingLedger[0].takenBack, 1.5);
  const again = R.applyRules({ items: [mtg('m10', 10, 'didnt')], proposal: { entries: [{ ref: 'm10', text: 'x', points: -1, sameIssueAsRef: 'old', takeBack: 1 }] }, state: { meetingLedger: r.meetingLedger } });
  eq('cannot take back the same points twice', again.entries[0].points, 0);
  const bogus = R.applyRules({ items: [mtg('m11', 11, 'didnt')], proposal: { entries: [{ ref: 'm11', text: 'x', points: -1, sameIssueAsRef: 'nope', takeBack: 1 }] }, state });
  eq('unknown earlier meeting -> no take-back', bogus.entries[0].points, 0);
  const onWorked = R.applyRules({ items: [mtg('m12', 12, 'worked')], proposal: { entries: [{ ref: 'm12', text: 'x', points: 0, sameIssueAsRef: 'old', takeBack: 1 }] }, state });
  eq('take-back only on a didnt', onWorked.entries[0].points, 1.5);
  // never below start overall
  const doc = { startScore: 3, sumDelta: 1.5, gates: NO_GATES };
  const f = R.finalizeScore(doc, r.rawPoints - 1, NO_GATES);
  eq('take-back never drops below effectiveStart', f.scoreAfter, 3);
}
{
  // same-batch: earlier meeting in the SAME check can be taken back
  const r = R.applyRules({ items: [mtg('a', 1, 'worked'), mtg('b', 2, 'didnt')], proposal: { entries: [{ ref: 'b', text: 'x', points: -1.5, sameIssueAsRef: 'a', takeBack: 1.5 }] }, state: {} });
  eq('take-back against a meeting from the same batch', r.entries.map((e) => e.points), [1.5, -1.5]);
}

console.log('\ncertification');
{
  const items = [
    { kind: 'cert', ref: 'contacts/C1/certification/progress#lesson:b1', at: D(2026, 9, 1), meta: { tier: 'bronze', type: 'lesson', lesson: 'b1' } },
    { kind: 'cert', ref: 'contacts/C1/certification/progress#lesson:b2', at: D(2026, 9, 2), meta: { tier: 'bronze', type: 'lesson', lesson: 'b2' } },
    { kind: 'cert', ref: 'contacts/C1/certificates/bronze', at: D(2026, 9, 3), meta: { tier: 'bronze', type: 'tier' } },
  ];
  const progress = { lessons: { b1: D(2026, 9, 1), b2: D(2026, 9, 2), b3: D(2026, 8, 1) } };
  const r = R.applyRules({ items, proposal: { entries: [] }, state: {}, progress });
  eq('tier +1, lessons 0 (one line per tier)', r.entries.map((e) => [e.points, e.text]),
    [[0, 'Completed 2 Bronze lessons (3/6 done).'], [1, 'Earned the Bronze certificate.']]);
  eq('certSummary', R.certSummary(progress, { }), { bronze: '3/6', silver: '0/6', gold: '0/6' });
  eq('certSummary done', R.certSummary({ tiers: { silver: { completedAt: ts(D(2026, 9, 1)) } } }, { bronze: {} }), { bronze: 'done', silver: 'done', gold: '0/6' });
}

console.log('\ngates');
eq('gold gate from certificate', R.computeGates({ certificates: { gold: {} }, progress: {}, interactions: [] }), { goldCert: true, parentLedMeeting: false });
eq('parent-led needs a RATED meeting', R.computeGates({ certificates: {}, interactions: [
  { channel: 'Out of office meeting', meetingParentLed: true },
] }), { goldCert: false, parentLedMeeting: false });
eq('parent-led meeting, case-insensitive channel', R.computeGates({ certificates: {}, interactions: [
  { channel: 'OUT OF OFFICE MEETING', meetingParentLed: true, meetingOutcome: 'partly' },
] }), { goldCert: false, parentLedMeeting: true });

console.log('\nnotes: +/-0.5 per check, verbatim quote required');
{
  const note = (ref, day, body) => ({ kind: 'note', ref, at: D(2026, 9, day), meta: { body } });
  const items = [
    note('n1', 1, 'Mom said she wrote her own email to the principal asking for the eval.'),
    note('n2', 2, 'Parent drafted the meeting agenda herself and sent it to the SPED teacher.'),
    note('n3', 3, 'Left a voicemail.'),
  ];
  const proposal = { entries: [
    { ref: 'n1', text: 'Wrote her own email to the school', points: 0.5, quote: 'wrote her own email to the principal' },
    { ref: 'n2', text: 'Drafted the agenda', points: 0.5, quote: 'drafted the meeting agenda herself' },
    { ref: 'n3', text: 'Invented', points: 0.5, quote: 'she ran the whole IEP meeting' },
  ] };
  const r = R.applyRules({ items, proposal, state: {} });
  eq('only first note fits inside +0.5 total', r.entries.map((e) => [e.ref, e.points]), [['n1', 0.5]]);
  ok('entry text carries the quote', /"wrote her own email to the principal"/.test(r.entries[0].text));
  const big = R.applyRules({ items: [items[0]], proposal: { entries: [{ ref: 'n1', text: 'x', points: 3, quote: 'wrote her own email to the principal' }] }, state: {} });
  eq('single note clamped to 0.5', big.entries[0].points, 0.5);
  const noQuote = R.applyRules({ items: [items[2]], proposal: { entries: [proposal.entries[2]] }, state: {} });
  eq('unverified quote -> no entry, no points', noQuote.entries.length, 0);
  const neg = R.applyRules({ items: [note('n4', 4, 'Parent asked us to go to the meeting and speak for her again.')], proposal: { entries: [{ ref: 'n4', text: 'x', points: -2, quote: 'speak for her again' }] }, state: {} });
  eq('negative note clamped to -0.5', neg.entries[0].points, -0.5);
}

console.log('\nPII stripping');
eq('email + phone stripped', R.stripPii('call 808-555-1234 or (808) 555 9876, mail mom@example.com'), 'call [phone] or [phone], mail [email]');

console.log('\nnote stamps / appended blocks');
eq('stamp parses to end of minute HST', R.parseNoteStamp('Sep 3, 2026 10:15 AM'), Date.UTC(2026, 8, 3, 10, 15, 59, 999) + HST);
eq('PM stamp', R.parseNoteStamp('Sep 3, 2026 02:05 PM'), Date.UTC(2026, 8, 3, 14, 5, 59, 999) + HST);
{
  const created = D(2026, 8, 20);
  const notes = 'Intake: parent new to IEPs.\n---\n[Chassidy K — Sep 3, 2026 10:15 AM]\nMom emailed teacher herself.\n---\n[Noe D — garbled]\nSecond append.';
  const b = R.parseNoteBlocks(notes, created);
  eq('three blocks', b.map((x) => [x.index, x.who, x.text]), [[0, '', 'Intake: parent new to IEPs.'], [1, 'Chassidy K', 'Mom emailed teacher herself.'], [2, 'Noe D', 'Second append.']]);
  eq('unparseable stamp inherits previous date', b[2].at, b[1].at);
}

console.log('\nfamily set mirrors the report (_carIsAdv)');
{
  const ix = [
    { id: 'f1', contactId: 'A', workflowStep: 'caseAdvocacy', status: 'Open', createdAt: ts(D(2026, 8, 12)), caseAdvocateName: 'Advocate One', caseAdvocateUid: 'u1', contactName: 'Family A' },
    { id: 'f0', contactId: 'A', workflowStep: 'caseAdvocacy', status: 'Closed', createdAt: ts(D(2026, 8, 1)), contactName: 'Family A' },
    { id: 'x1', contactId: 'B', caseAdvocacy: true, status: 'Closed', createdAt: ts(D(2026, 8, 1)), caseAdvocacyClosedAt: ts(D(2026, 9, 1)) },
    { id: 'x2', contactId: 'C', interactionType: 'Case Advocacy', status: 'Open', createdAt: ts(D(2026, 8, 5)) },
    { id: 'x3', contactId: 'D', interactionType: 'Phone', status: 'Open' },
    { id: 'x4', caseAdvocacy: true, status: 'Open' },
  ];
  const g = R.groupAdvocacyFamilies(ix);
  const by = {}; g.families.forEach((f) => { by[f.contactId] = f; });
  eq('families A,B,C (not D, not orphan)', Object.keys(by).sort(), ['A', 'B', 'C']);
  eq('anchor = OLDEST case file', by.A.caseInteractionId, 'f0');
  eq('open = any record status Open', [by.A.open, by.B.open, by.C.open], [true, false, true]);
  eq('advocate named by first named record when anchor has none', by.A.advocateName, 'Advocate One');
  eq('orphan records counted', g.orphanRecords, 1);
}

console.log('\nworkshop events + attendance');
eq('one-off excluded', R.isWorkshopEvent({ isOneOff: true }, 'events'), false);
eq('booth excluded', R.isWorkshopEvent({ specialEvent: true }, 'events'), false);
eq('Connect-Gen included', R.isWorkshopEvent({ title: 'Connect-Gen' }, 'recurringEvents'), true);
eq('missing event fails open', R.isWorkshopEvent(null, 'events'), true);
eq('per-session attended', R.attendedSessions({ sessionAttendance: { '2026-09-02': { status: 'attended' }, '2026-09-09': { status: 'no-show' } } }).map((s) => s.key), ['2026-09-02']);
eq('flat attended uses attendanceMarkedAt', R.attendedSessions({ attendanceStatus: 'attended', attendanceMarkedAt: ts(D(2026, 9, 4)) }).map((s) => s.at), [D(2026, 9, 4)]);
eq('attended===true fallback', R.attendedSessions({ attended: true, timestamp: ts(D(2026, 9, 5)) }).length, 1);

console.log('\nforward-only selection + unrated-meeting checkpoint');
{
  const contactId = 'C1';
  const interactions = [
    { id: 'case', contactId, workflowStep: 'caseAdvocacy', createdAt: ts(D(2026, 8, 1)), notes: 'Intake note.\n---\n[Adv — Sep 10, 2026 9:00 AM]\nParent emailed school herself.' },
    { id: 'old', contactId, interactionType: 'Phone', createdAt: ts(D(2026, 8, 20)), notes: 'Old call already scored.' },
    { id: 'mRated', contactId, channel: 'Out of office meeting', meetingOutcome: 'worked', createdAt: ts(D(2026, 9, 5)), notes: 'IEP meeting.' },
    { id: 'mUnrated', contactId, channel: 'out of office meeting', createdAt: ts(D(2026, 9, 8)), notes: 'Follow-up IEP.' },
    { id: 'walk', contactId, interactionType: 'Event Attendance', relatedEventId: 'E1', sessionDate: '2026-09-12', createdAt: ts(D(2026, 9, 12)), notes: 'Walk-in attendee recorded from the Event Summary.' },
  ];
  const signups = [
    { path: 'events/E1/signups/s1', eventId: 'E1', eventCollection: 'events', event: { title: 'LL' }, data: { sessionAttendance: { '2026-09-12': { status: 'attended', markedAt: ts(D(2026, 9, 12, 15)) } } } },
    { path: 'events/E2/signups/s2', eventId: 'E2', eventCollection: 'events', event: { isOneOff: true }, data: { attendanceStatus: 'attended', attendanceMarkedAt: ts(D(2026, 9, 11)) } },
  ];
  const all = R.buildAllItems({ contactId, interactions, signups, events: { 'events/E1': { title: 'LL' } }, cert: { progress: {}, certificates: {} } });
  const sinceMs = D(2026, 9, 1);
  const nowMs = D(2026, 9, 14);
  const sel = R.selectNewItems({ allItems: all.items, unratedMeetings: all.unratedMeetings, sinceMs, nowMs, scoredRefs: [] });
  eq('new items: rated meeting, appended note, workshop (deduped, one-off excluded, old skipped)',
    sel.items.map((i) => i.kind + ':' + i.ref), ['meeting:interactions/mRated', 'note:interactions/case#note1', 'workshop:interactions/walk']);
  eq('unrated meeting held', sel.held.map((m) => m.ref), ['interactions/mUnrated']);
  eq('checkpoint = just before the unrated meeting', sel.untilMs, D(2026, 9, 8) - 1);
  const kept = R.nextScoredRefs([], sel.items, sel.untilMs);
  eq('items after the held checkpoint remembered', kept.map((r) => r.ref).sort(), ['interactions/case#note1', 'interactions/walk']);

  // Next check: the meeting is now rated. It must be read; nothing else re-read.
  interactions[3].meetingOutcome = 'partly';
  const all2 = R.buildAllItems({ contactId, interactions, signups, events: { 'events/E1': { title: 'LL' } }, cert: { progress: {}, certificates: {} } });
  const sel2 = R.selectNewItems({ allItems: all2.items, unratedMeetings: all2.unratedMeetings, sinceMs: sel.untilMs, nowMs: D(2026, 9, 16), scoredRefs: kept });
  eq('second check reads ONLY the newly rated meeting', sel2.items.map((i) => i.ref), ['interactions/mUnrated']);
  eq('checkpoint advances to now', sel2.untilMs, D(2026, 9, 16));
  eq('remembered refs pruned once passed', R.nextScoredRefs(kept, sel2.items, sel2.untilMs), []);

  // No-new-items check still advances.
  const sel3 = R.selectNewItems({ allItems: all2.items, unratedMeetings: all2.unratedMeetings, sinceMs: sel2.untilMs, nowMs: D(2026, 9, 18), scoredRefs: [] });
  eq('nothing new -> 0 items, checkpoint = now', [sel3.items.length, sel3.untilMs], [0, D(2026, 9, 18)]);
}
eq('nextCheckpoint never before since', R.nextCheckpoint(100, 500, [50]), 500);
eq('nextCheckpoint earliest of several unrated', R.nextCheckpoint(100, 500, [300, 200]), 199);

console.log('\ncadence');
{
  const now = D(2026, 9, 20);
  eq('due after 44h (lastRunAt)', R.isDue({ lastRunAt: ts(now - 45 * 3600e3), lastCheckedAt: ts(now - 1000) }, now, false), true);
  eq('not due inside 44h', R.isDue({ lastRunAt: ts(now - 20 * 3600e3) }, now, false), false);
  eq('held checkpoint alone does not make it due daily', R.isDue({ lastRunAt: ts(now - 20 * 3600e3), lastCheckedAt: ts(now - 30 * 86400e3) }, now, false), false);
  eq('force', R.isDue({ lastRunAt: ts(now) }, now, true), true);
}

console.log('\nstart suggestion validation');
{
  const blocks = [{ date: '2026-08-12', text: 'Mom has never heard of a 504 plan and is overwhelmed.', summary: '' }];
  eq('score clamped to 0..6, quote verified, date from block',
    R.validateStartSuggestion({ score: 8, quote: 'has never heard of a 504 plan', sourceDate: '2026-01-01', reasoning: 'r' }, blocks),
    { score: 6, quote: 'has never heard of a 504 plan', quoteVerified: true, sourceDate: '2026-08-12', reasoning: 'r' });
  eq('invented quote rejected', R.validateStartSuggestion({ score: 1.2, quote: 'knows IDEA inside out', sourceDate: '2026-08-12', reasoning: '' }, blocks).quoteVerified, false);
}

console.log('\nrubric is generated from the rules');
ok('rubric carries cap 2.5', R.READINESS_RUBRIC.indexOf('2.5') !== -1);
ok('rubric carries 9.5', R.READINESS_RUBRIC.indexOf('9.5') !== -1);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
