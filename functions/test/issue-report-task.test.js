// Exercises the IT_Help issue-report trigger's decision logic — the pure part
// of exports.onChatHelpRequest. No Firestore, no deploy, no sending.
//   node functions/test/issue-report-task.test.js
//
// The feature exists because `helpRequest` was written onto chat messages and
// read by nothing: a staff member filled the form, the message scrolled away,
// and no task was ever raised. So the property these tests care about most is
// not correctness of any one field — it is that NOTHING IS EVER DROPPED. A v1
// payload, a v2 payload, a shape nobody has seen before, a dedupe query that
// throws, an empty object: every one of them must still produce a task.
//
// The second property is that the task never touches the OSEP lookup lists.
// `lookupLists/interactionTypes` holds the four grant Tiers. A Tier on an IT
// issue would corrupt the funder reporting, so interactionType must be EMPTY
// on every path, and the channel must never be "Internal Chat" — that value is
// filtered out of My Day, so the task would exist and be invisible.
//
// All names here are invented. This repo is public.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');

const D = __test._issueReportDecision;
const N = __test._issueReportNormalize;
const findOpen = __test._issueReportFindOpenTask;
const rawOf = __test._issueReportRaw;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  if (actual === expected) { pass++; return; }
  fail++; console.error(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
}
function checkTrue(name, cond) { if (cond) { pass++; return; } fail++; console.error(`FAIL ${name}`); }

const TODAY = '2026-09-04';
const IN_TWO = '2026-09-06';

// ── fixtures ────────────────────────────────────────────────────────────────
const msgFrom = (name, uid) => ({ senderId: uid, senderName: name, text: 'Something is wrong.' });

const v2 = (over) => Object.assign({
  v: 2,
  branch: 'cannot-save',
  branchLabel: 'Cannot save something',
  detail: 'contact-save',
  detailLabel: 'Saving a contact does nothing',
  note: 'The Save button spins and then the page goes back to the list.',
  blocked: true,
  wantsCall: false,
  severity: 'blocked',
  context: {
    uid: 'uidA', displayName: 'Staff One', role: 'staff', partnerIsland: '',
    section: 'Contacts', version: 'v148.63', stale: false,
    ua: 'Mozilla/5.0 (Windows NT 10.0)', screenW: 1366, screenH: 768,
    tz: 'Pacific/Honolulu', localTime: '09:14', hstTime: '09:14', online: true,
    errors: ['TypeError: save is not a function'],
    breadcrumbs: ['opened Contacts', 'opened a contact', 'pressed Save'],
    isAnonymous: false, viewingAs: '',
  },
  source: 'button-tree',
}, over || {});

const v1 = (over) => Object.assign({
  doing: 'add a new contact',
  where: 'Contacts',
  happened: 'nothing happened when I pressed Save',
  urgency: 'Cannot work — blocked',
  source: 'intake-form',
}, over || {});

// A tiny in-memory Firestore that answers exactly the one query
// _issueReportFindOpenTask makes: a single equality filter, then a limit.
function fakeDb(store, opts) {
  return {
    collection() {
      return {
        where(field, op, value) {
          return {
            limit() { return this; },
            get() {
              if (opts && opts.throwOnQuery) {
                return Promise.reject(new Error('The query requires an index.'));
              }
              const docs = Object.keys(store)
                .filter((id) => store[id][field] === value)
                .map((id) => ({ id, data: () => store[id] }));
              return Promise.resolve({ forEach: (f) => docs.forEach(f) });
            },
          };
        },
      };
    },
  };
}

// The trigger's own flow, minus the writes: probe for the dedupe key, look for
// an open task (FAILING CLOSED if that throws), decide, apply. Uses the real
// _issueReportFindOpenTask and the real _issueReportDecision, so a change to
// either is caught here.
let seq = 0;
async function simulate(helpRequest, message, store, opts) {
  const probe = D({ helpRequest, message, convId: 'CONV1', msgId: 'MSG' + (++seq), todayKey: TODAY });
  let existing = null;
  try {
    existing = await findOpen(fakeDb(store, opts), probe.dedupeKey);
  } catch (e) {
    existing = null;                       // fail closed — a duplicate beats a loss
  }
  const decision = D({
    helpRequest, message, convId: 'CONV1', msgId: 'MSG' + seq,
    todayKey: TODAY, reportId: 'REP' + seq, existing,
  });
  if (decision.mode === 'create') {
    store['TASK' + seq] = Object.assign({}, decision.task);
  } else {
    Object.assign(store[decision.taskId], decision.taskUpdate);
  }
  return decision;
}

const taskCount = (store) => Object.keys(store).length;

// Every task this feature can produce, whatever the input, must satisfy these.
// Called on every decision below rather than tested once, because the ways a
// task gets built (create vs attach, v1 vs v2 vs unknown) are exactly where a
// forbidden value would sneak in.
function assertSafe(label, task) {
  checkTrue(label + ': has a task', !!task);
  if (!task) return;
  check(label + ': NO Tier — interactionType is empty', task.interactionType, '');
  check(label + ': channel is Other', task.channel, 'Other');
  checkTrue(label + ': channel is never Internal Chat', task.channel !== 'Internal Chat');
  check(label + ': owned by Daniel', task.ownerUid, 'YmGV2TlBGqR01dVdxZ0rtFLEFCG3');
  check(label + ': status Open', task.status, 'Open');
  check(label + ': marked as an issue report', task.workflowStep, 'issueReport');
  checkTrue(label + ': summary is non-empty', !!task.summary && task.summary.length > 0);
  checkTrue(label + ': notes are non-empty', !!task.notes && task.notes.length > 0);
  const fu = task.followUpDate;
  checkTrue(label + ': followUpDate is an HST date key or empty',
    fu === '' || /^\d{4}-\d{2}-\d{2}$/.test(fu));
  if (fu) {
    const days = Math.round((Date.parse(fu + 'T00:00:00-10:00') -
      Date.parse(TODAY + 'T00:00:00-10:00')) / 86400000);
    checkTrue(label + ': followUpDate is inside My Day\'s 14-day horizon', days >= 0 && days <= 14);
  }
}

(async function main() {

  // ── the v2 button-tree shape ──────────────────────────────────────────────
  {
    const store = {};
    const d = await simulate(v2(), msgFrom('Staff One', 'uidA'), store);
    check('v2 creates a task', d.mode, 'create');
    assertSafe('v2', d.task);
    check('v2 due today (blocked)', d.task.followUpDate, TODAY);
    check('v2 summary reads well', d.task.summary,
      'Issue: Cannot save something — Contacts (LDAH, blocked)');
    check('v2 keeps the branch for dedupe', d.task.issueReportBranch, 'cannot-save');
    check('v2 keeps the section for dedupe', d.task.issueReportSection, 'contacts');
    check('v2 links the detail document', d.task.workflowEventId, 'REP1');
    check('v2 names the detail collection', d.task.workflowEventCollection, 'issueReports');
    check('v2 links back to the chat thread', d.task.chatConvId, 'CONV1');
    check('v2 remembers who reported it', d.task.chatSenderUid, 'uidA');
    checkTrue('v2 notes name the reporter', d.task.notes.indexOf('Staff One') !== -1);
    checkTrue('v2 notes carry their own words', d.task.notes.indexOf('Save button spins') !== -1);
    checkTrue('v2 notes carry the build', d.task.notes.indexOf('v148.63') !== -1);
    checkTrue('v2 notes carry the error', d.task.notes.indexOf('TypeError') !== -1);
    checkTrue('v2 notes point back at Team Messages',
      d.task.notes.indexOf('Team Messages') !== -1);
    checkTrue('v2 notes name the detail document',
      d.task.notes.indexOf('issueReports/REP1') !== -1);
    check('v2 detail document keeps the shape', d.report.shape, 'v2');
    check('v2 detail document keeps the breadcrumbs', d.report.breadcrumbs.length, 3);
  }

  // ── the v1 four-field shape, which is live and must keep working ──────────
  {
    const store = {};
    const d = await simulate(v1(), msgFrom('Staff Two', 'uidB'), store);
    check('v1 creates a task', d.mode, 'create');
    assertSafe('v1', d.task);
    check('v1 maps "Cannot work — blocked" to blocked', d.task.issueReportSeverity, 'blocked');
    check('v1 blocked means due today', d.task.followUpDate, TODAY);
    check('v1 titles the card with what they were trying to do', d.task.summary,
      'Issue: add a new contact — Contacts (LDAH, blocked)');
    checkTrue('v1 notes carry what happened instead',
      d.task.notes.indexOf('nothing happened when I pressed Save') !== -1);
    check('v1 is recorded as v1', d.task.issueReportShape, 'v1');
    check('v1 uses "where" as the dedupe branch', d.task.issueReportBranch, 'contacts');
  }
  {
    const d = D({ helpRequest: v1({ urgency: 'Slowing me down' }), message: msgFrom('Staff Two', 'uidB'), todayKey: TODAY });
    check('v1 "Slowing me down" maps to slowing', d.severity, 'slowing');
    check('v1 slowing is not urgent', d.task.followUpDate, IN_TWO);
  }
  {
    const d = D({ helpRequest: v1({ urgency: 'Curious — no rush' }), message: msgFrom('Staff Two', 'uidB'), todayKey: TODAY });
    check('v1 "Curious — no rush" maps to watching', d.severity, 'watching');
    check('v1 watching is not urgent', d.task.followUpDate, IN_TWO);
  }
  {
    // A chip that has been reworded must not silently become the default.
    const d = D({ helpRequest: v1({ urgency: 'I cannot work at all' }), message: msgFrom('Staff Two', 'uidB'), todayKey: TODAY });
    check('an unlisted but obviously blocking urgency still reads as blocked', d.severity, 'blocked');
  }

  // ── a shape nobody has seen before still produces a task ───────────────────
  {
    const store = {};
    const weird = { somethingNew: true, payload: { a: 1 }, source: 'a-form-that-does-not-exist-yet' };
    const d = await simulate(weird, msgFrom('Staff Three', 'uidC'), store);
    check('an unknown shape still creates a task', d.mode, 'create');
    assertSafe('unknown shape', d.task);
    check('an unknown shape is labelled as such', d.task.issueReportShape, 'unknown');
    checkTrue('an unknown shape keeps the payload in the notes',
      d.task.notes.indexOf('somethingNew') !== -1);
    checkTrue('an unknown shape says so on the card',
      d.task.notes.indexOf('does not recognise') !== -1);
    check('an unknown shape gets the middle severity, not the calmest', d.severity, 'slowing');
    checkTrue('the raw payload is preserved on the detail document',
      rawOf(weird).raw.somethingNew === true);
  }

  // ── severity to followUpDate ──────────────────────────────────────────────
  {
    const cases = [
      ['incident', TODAY], ['blocked', TODAY], ['slowing', IN_TWO], ['watching', IN_TWO],
    ];
    cases.forEach(([sev, want]) => {
      const d = D({
        helpRequest: v2({ severity: sev, blocked: sev === 'blocked' }),
        message: msgFrom('Staff One', 'uidA'), todayKey: TODAY,
      });
      check(`${sev} is due ${want}`, d.task.followUpDate, want);
      assertSafe('severity ' + sev, d.task);
    });
  }
  {
    // A severity the form has never sent must not crash and must not be urgent.
    const d = D({ helpRequest: v2({ severity: 'catastrophic', blocked: false }), message: msgFrom('Staff One', 'uidA'), todayKey: TODAY });
    checkTrue('an unrecognised severity still produces a task', !!d.task);
    checkTrue('an unrecognised severity is one of the four known values',
      __test.ISSUE_REPORT_SEVERITIES.indexOf(d.severity) !== -1);
  }
  {
    // blocked:true with no severity at all must not become "slowing".
    const d = D({ helpRequest: v2({ severity: '', blocked: true }), message: msgFrom('Staff One', 'uidA'), todayKey: TODAY });
    check('blocked:true with no severity is treated as blocked', d.severity, 'blocked');
    check('...and is therefore due today', d.task.followUpDate, TODAY);
  }

  // ── FIVE PEOPLE, ONE OUTAGE, ONE TASK ─────────────────────────────────────
  {
    const store = {};
    const reporters = [
      ['Staff One', 'uidA'], ['Staff Two', 'uidB'], ['Staff Three', 'uidC'],
      ['Staff Four', 'uidD'], ['Staff Five', 'uidE'],
    ];
    const decisions = [];
    for (const [name, uid] of reporters) {
      decisions.push(await simulate(v2({ note: name + ' saw it too.' }), msgFrom(name, uid), store));
    }
    check('five reports of one issue produce exactly one task', taskCount(store), 1);
    check('the first report creates', decisions[0].mode, 'create');
    check('the second attaches', decisions[1].mode, 'attach');
    check('the fifth attaches', decisions[4].mode, 'attach');
    const task = store[Object.keys(store)[0]];
    assertSafe('deduped task', task);
    check('the task counts all five', task.issueReportCount, 5);
    checkTrue('the summary says how many reported it',
      task.summary.indexOf('5 reports') !== -1);
    checkTrue('the summary is not stacked with repeated counts',
      task.summary.match(/reports/g).length === 1);
    reporters.forEach(([name]) => {
      checkTrue('the notes carry ' + name, task.notes.indexOf(name) !== -1);
    });
    checkTrue('every reporter gets their own detail document',
      decisions.every((d) => !!d.report));
  }
  {
    // A different section on the same day is a different problem.
    const store = {};
    await simulate(v2(), msgFrom('Staff One', 'uidA'), store);
    await simulate(v2({ context: Object.assign({}, v2().context, { section: 'Reports' }) }),
      msgFrom('Staff Two', 'uidB'), store);
    check('a different section raises its own task', taskCount(store), 2);
  }
  {
    // As is a different branch in the same section.
    const store = {};
    await simulate(v2(), msgFrom('Staff One', 'uidA'), store);
    await simulate(v2({ branch: 'wrong-numbers', branchLabel: 'The numbers look wrong' }),
      msgFrom('Staff Two', 'uidB'), store);
    check('a different branch raises its own task', taskCount(store), 2);
  }
  {
    // Severity ratchets UP on attach and the due date only moves earlier — a
    // "just curious" arriving after a "blocked" must not calm the task down.
    const store = {};
    const first = await simulate(v2({ severity: 'watching', blocked: false }), msgFrom('Staff One', 'uidA'), store);
    check('the calm first report is not due today', first.task.followUpDate, IN_TWO);
    const second = await simulate(v2({ severity: 'blocked', blocked: true }), msgFrom('Staff Two', 'uidB'), store);
    check('the urgent second report attaches', second.mode, 'attach');
    const task = store[Object.keys(store)[0]];
    check('the task escalates to blocked', task.issueReportSeverity, 'blocked');
    check('the task is pulled forward to today', task.followUpDate, TODAY);
    const third = await simulate(v2({ severity: 'watching', blocked: false }), msgFrom('Staff Three', 'uidC'), store);
    check('a later calm report still attaches', third.mode, 'attach');
    check('...and does NOT de-escalate the severity', store[Object.keys(store)[0]].issueReportSeverity, 'blocked');
    check('...and does NOT push the due date back out', store[Object.keys(store)[0]].followUpDate, TODAY);
  }
  {
    // A closed task is not reopened by a new report — it raises a fresh one.
    const store = {};
    await simulate(v2(), msgFrom('Staff One', 'uidA'), store);
    store[Object.keys(store)[0]].status = 'Closed';
    const d = await simulate(v2(), msgFrom('Staff Two', 'uidB'), store);
    check('a report after the task was closed raises a new task', d.mode, 'create');
    check('...so there are now two', taskCount(store), 2);
  }

  // ── the dedupe query failing must never cost a report ─────────────────────
  {
    const store = {};
    await simulate(v2(), msgFrom('Staff One', 'uidA'), store);
    const d = await simulate(v2(), msgFrom('Staff Two', 'uidB'), store, { throwOnQuery: true });
    check('a dedupe query that throws still creates a task', d.mode, 'create');
    assertSafe('dedupe failed', d.task);
    check('...so the second report exists as its own task', taskCount(store), 2);
  }
  {
    // And the query itself really does throw, rather than the simulation
    // quietly returning null for some other reason.
    let threw = false;
    try { await findOpen(fakeDb({}, { throwOnQuery: true }), 'k'); } catch (e) { threw = true; }
    checkTrue('the dedupe lookup propagates its error to the caller', threw);
  }

  // ── no Tier, ever, on any path ────────────────────────────────────────────
  {
    const shapes = [v2(), v1(), { junk: 1 }, {}, { v: 2 }, { doing: 'x' }];
    shapes.forEach((hr, i) => {
      const d = D({ helpRequest: hr, message: msgFrom('Staff One', 'uidA'), todayKey: TODAY });
      check('shape ' + i + ' sets no interactionType', d.task.interactionType, '');
      check('shape ' + i + ' uses channel Other', d.task.channel, 'Other');
      checkTrue('shape ' + i + ' has no Tier anywhere in the document',
        JSON.stringify(d.task).indexOf('Tier') === -1);
    });
    // The attach path writes a different set of fields — it must not
    // reintroduce either value.
    const attach = D({
      helpRequest: v2(), message: msgFrom('Staff Two', 'uidB'), todayKey: TODAY,
      existing: { id: 'T1', notes: 'n', summary: 's', count: 1, followUpDate: TODAY, severity: 'blocked' },
    });
    check('the attach path writes no interactionType at all',
      Object.prototype.hasOwnProperty.call(attach.taskUpdate, 'interactionType'), false);
    check('the attach path writes no channel at all',
      Object.prototype.hasOwnProperty.call(attach.taskUpdate, 'channel'), false);
    check('the attach path keeps the task Open', attach.taskUpdate.status, 'Open');
  }

  // ── degenerate input must not throw ───────────────────────────────────────
  {
    const nasties = [
      undefined, null, {}, [], 'a string', 42, true,
      { context: null }, { context: 'not an object' }, { context: [] },
      { v: 2, branch: null, branchLabel: undefined, context: { errors: 'not an array' } },
      { v: 2, context: { errors: [null, undefined, { deep: { deeper: 1 } }], breadcrumbs: 'nope' } },
      { doing: null, where: null, happened: null, urgency: null },
      { v: 'two', severity: 99, blocked: 'true', wantsCall: 'yes' },
      { branchLabel: 'x'.repeat(5000), note: 'y'.repeat(50000), context: { section: 'z'.repeat(5000) } },
    ];
    nasties.forEach((hr, i) => {
      let d = null, threw = null;
      try {
        d = D({ helpRequest: hr, message: msgFrom('Staff One', 'uidA'), todayKey: TODAY });
      } catch (e) { threw = e; }
      check('degenerate input ' + i + ' does not throw', threw ? threw.message : "no throw", "no throw");
      if (d) assertSafe('degenerate ' + i, d.task);
    });
    // …and with no message either.
    let threw = null;
    try { D({}); } catch (e) { threw = e; }
    check('a completely empty call does not throw', threw ? threw.message : "no throw", "no throw");
    const bare = D({});
    assertSafe('a completely empty call', bare.task);
    check('a completely empty call still names a reporter', bare.task.notes.indexOf('a staff member') !== -1, true);
  }
  {
    // A todayKey we cannot trust must not become a guessed due date. My Day
    // shows open tasks with NO follow-up date, so the task is still visible.
    ['', 'not-a-date', '2026-13-99', null, 12345].forEach((bad, i) => {
      const d = D({ helpRequest: v2(), message: msgFrom('Staff One', 'uidA'), todayKey: bad });
      check('bad todayKey ' + i + ' yields no invented due date', d.task.followUpDate, '');
      assertSafe('bad todayKey ' + i, d.task);
    });
  }
  {
    // Very long input must not produce a card that cannot be read, or a
    // document Firestore would reject.
    const d = D({
      helpRequest: v2({ branchLabel: 'B'.repeat(4000), note: 'N'.repeat(90000) }),
      message: msgFrom('Staff One', 'uidA'), todayKey: TODAY,
    });
    checkTrue('a runaway summary is capped', d.task.summary.length <= 150);
    checkTrue('runaway notes are capped', d.task.notes.length <= 8000);
    checkTrue('a runaway raw payload is kept as a truncated string',
      typeof rawOf(v2({ note: 'N'.repeat(90000) })).rawJson === 'string');
  }

  // ── normalisation details worth pinning ───────────────────────────────────
  {
    const n = N(v2({ context: Object.assign({}, v2().context, { partnerIsland: 'Molokaʻi' }) }),
      msgFrom('Staff One', 'uidA'));
    check('a partner island is carried through', n.island, 'Molokaʻi');
    const d = D({
      helpRequest: v2({ context: Object.assign({}, v2().context, { partnerIsland: 'Molokaʻi' }) }),
      message: msgFrom('Staff One', 'uidA'), todayKey: TODAY,
    });
    checkTrue('the island is on the card', d.task.summary.indexOf('Molokaʻi') !== -1);
    checkTrue('a partner island changes nothing about ownership',
      d.task.ownerUid === 'YmGV2TlBGqR01dVdxZ0rtFLEFCG3');
  }
  {
    const d = D({
      helpRequest: v2({ context: Object.assign({}, v2().context, { stale: true }) }),
      message: msgFrom('Staff One', 'uidA'), todayKey: TODAY,
    });
    checkTrue('a stale build is called out — they may not be running current code',
      d.task.notes.indexOf('STALE') !== -1);
  }
  {
    const d = D({
      helpRequest: v2({ wantsCall: true }), message: msgFrom('Staff One', 'uidA'), todayKey: TODAY,
    });
    checkTrue('a request for a call back is on the card',
      d.task.notes.indexOf('call back') !== -1);
  }
  {
    const n = N(v2(), { senderId: 'uidZ', senderName: 'Staff Nine', text: 'hi' });
    check('the chat message wins over the form context for who sent it', n.reporterUid, 'uidZ');
    check('...for the name too', n.reporterName, 'Staff Nine');
  }

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('TEST HARNESS THREW:', e && e.stack || e);
  process.exit(1);
});
