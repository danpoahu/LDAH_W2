// Exercises the IT_Help auto-answer's conversation handling — the rule that
// decides what gets sent to the model, and the line every reply must end with.
// No Firestore, no deploy, no live data, no API call.
//   node functions/test/ithelp-history.test.js
//
// Background: three of the first eighteen live attempts produced no answer at
// all, logged as
//   "This model does not support assistant message prefill.
//    The conversation must end with a user message."
// One of them was a real person, a Pacific partner, who asked for help and got
// silence back. The cause: the function waits a minute before answering so a
// human gets first refusal, and if a SECOND automatic reply landed during that
// wait — which is what happens when somebody asks two questions in quick
// succession — the history ended on an assistant turn and the API refused it.
//
// So the conversation is now repaired before the call, and the reply always says
// Daniel has been notified too (his instruction, 2026-09-04).
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __itHelpTest } = require('../itHelpAssistant.js');
const { buildApiMessages, withNotifiedLine, answerFromHistory,
        NOTIFIED_LINE, FALLBACK_MESSAGE } = __itHelpTest;

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  fail++;
  console.error(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`);
}
function checkTrue(name, cond) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL ${name}`);
}

const ask = (text) => ({ text, fromHelpdesk: false });
const bot = (text) => ({ text, fromHelpdesk: true });

// ── 1. A history ending on an assistant turn is repaired ──────────────────
// This is the live failure exactly: question, our reply, second question, and a
// second automatic reply that landed while we were waiting.
{
  const got = buildApiMessages([
    ask('How do I print the case advocacy report?'),
    bot('Open Reports, choose Case Advocacy, then Print.'),
    ask('And how do I filter it by island?'),
    bot('Use the island picker at the top of the report.'),
  ]);
  check('a trailing automatic reply is dropped', got, [
    { role: 'user', content: 'How do I print the case advocacy report?' },
    { role: 'assistant', content: 'Open Reports, choose Case Advocacy, then Print.' },
    { role: 'user', content: 'And how do I filter it by island?' },
  ]);
  check('the repaired conversation ends on the person', got[got.length - 1].role, 'user');
}

// Several assistant turns stacked on the end are all dropped, not just the last.
{
  const got = buildApiMessages([ask('Where is the roster?'), bot('one'), bot('two'), bot('three')]);
  check('every trailing automatic reply is dropped', got,
    [{ role: 'user', content: 'Where is the roster?' }]);
}

// ── 2. A history already ending on a user turn is left alone ──────────────
{
  const history = [
    ask('Cannot work — I am locked out of the dashboard.'),
    bot('Try signing out and back in.'),
    ask('Still locked out.'),
  ];
  const got = buildApiMessages(history);
  check('a conversation ending on the person is untouched', got, [
    { role: 'user', content: 'Cannot work — I am locked out of the dashboard.' },
    { role: 'assistant', content: 'Try signing out and back in.' },
    { role: 'user', content: 'Still locked out.' },
  ]);
  check('the source history is not mutated', history.length, 3);
}

// A single question, nothing else, is the commonest case of all.
{
  check('one question passes straight through',
    buildApiMessages([ask('How do I add a contact?')]),
    [{ role: 'user', content: 'How do I add a contact?' }]);
}

// The first message must be a person's, so a leading automatic reply goes too.
{
  check('a leading automatic reply is dropped',
    buildApiMessages([bot('Anything else I can help with?'), ask('Yes — how do I export?')]),
    [{ role: 'user', content: 'Yes — how do I export?' }]);
}

// Blank messages (a bare screenshot) are not turns.
{
  check('empty messages are not sent as turns',
    buildApiMessages([ask('  '), ask('How do I print?'), bot('')]),
    [{ role: 'user', content: 'How do I print?' }]);
}

// ── 4. The notified line ──────────────────────────────────────────────────
{
  checkTrue('the notified line names Daniel', /Daniel/.test(NOTIFIED_LINE));
  checkTrue('the notified line promises no response time',
    !/hour|minute|today|tomorrow|shortly|soon/i.test(NOTIFIED_LINE));
  checkTrue('the fallback notice carries the notified line too',
    FALLBACK_MESSAGE.indexOf(NOTIFIED_LINE) !== -1);
  checkTrue('nothing user-facing describes a future state',
    !/coming soon/i.test(NOTIFIED_LINE + ' ' + FALLBACK_MESSAGE));
  // eslint-disable-next-line no-misleading-character-class
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  checkTrue('no emoji in the notified line', !emoji.test(NOTIFIED_LINE));
  checkTrue('no emoji in the fallback notice', !emoji.test(FALLBACK_MESSAGE));

  check('the line is added once, not twice',
    withNotifiedLine('Open Reports and click Print.\n\n' + NOTIFIED_LINE),
    'Open Reports and click Print.\n\n' + NOTIFIED_LINE);
  checkTrue('an ordinary answer gains the line',
    withNotifiedLine('Open Reports and click Print.').indexOf(NOTIFIED_LINE) !== -1);
  check('an empty answer stays empty, so nothing is posted', withNotifiedLine(''), '');
}

// ── 3 and 4, through the real call path, with a stand-in for the API ──────
function fakeClient(reply) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        return reply;
      },
    },
  };
}

const CFG = { model: 'claude-opus-5', maxTokens: 1024, effort: 'low', knowledge: 'Test knowledge.' };

async function main() {
  // 3. A thread holding nothing but our own replies must exit cleanly, with a
  //    reason, and must NOT spend an API call.
  {
    const client = fakeClient(null);
    const r = await answerFromHistory(CFG, [bot('First reply.'), bot('Second reply.')], 'A staff member', client);
    checkTrue('an all-automatic history is skipped', r.skipped === true);
    checkTrue('the skip carries a plain reason', typeof r.reason === 'string' && r.reason.length > 0);
    check('no API call is made for an all-automatic history', client.calls.length, 0);
  }
  {
    const client = fakeClient(null);
    const r = await answerFromHistory(CFG, [], 'A staff member', client);
    checkTrue('an empty history is skipped', r.skipped === true);
    check('no API call is made for an empty history', client.calls.length, 0);
  }

  // 4. A normal reply carries the notified line, and the conversation sent to
  //    the API ends on the person.
  {
    const client = fakeClient({
      content: [{ type: 'text', text: 'Open Reports, choose Case Advocacy, then Print.' }],
      usage: { input_tokens: 120, output_tokens: 30 },
      stop_reason: 'end_turn',
    });
    const r = await answerFromHistory(
      CFG,
      [ask('How do I print the report?'), bot('An earlier reply.'), ask('Sorry, where exactly?'), bot('A reply that landed while we waited.')],
      'A staff member',
      client
    );
    checkTrue('a normal reply is produced', !r.skipped && typeof r.text === 'string');
    checkTrue('the reply ends by saying Daniel was notified too',
      r.text.indexOf(NOTIFIED_LINE) !== -1);
    checkTrue('the answer itself is still there',
      r.text.indexOf('Open Reports, choose Case Advocacy, then Print.') !== -1);
    check('exactly one API call is made', client.calls.length, 1);
    const sent = client.calls[0].messages;
    check('the conversation sent to the API ends on the person', sent[sent.length - 1].role, 'user');
    check('the conversation sent to the API starts with the person', sent[0].role, 'user');
    check('usage is passed back for the cost report', r.usage.input_tokens, 120);
  }

  // A refusal is reported, not swallowed — the caller posts the notice instead.
  {
    const client = fakeClient({ content: [], usage: {}, stop_reason: 'refusal' });
    const r = await answerFromHistory(CFG, [ask('Something it will not answer.')], 'A staff member', client);
    check('a refusal is reported as such', r.stopReason, 'refusal');
    check('a refusal produces no text to post', r.text, '');
  }

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
