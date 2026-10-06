// Exercises runScreeningExtraction in functions/screeningReferralExtraction.js
// against a FAKE Anthropic client. No network, no Firestore, no deploy.
//   node functions/test/screening-extraction-parse.test.js
//
// What this guards: the first call uses adaptive thinking + tool_choice auto, so
// the tool_use block arrives AFTER thinking blocks and is sometimes missing
// altogether (the model answered in prose). The parser must find it among the
// blocks, retry exactly once with a forced tool and thinking off, and refuse a
// truncated response rather than hand back half a form.

const sr = require('../screeningReferralExtraction.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++; console.error(`FAIL ${name}${detail ? '\n  ' + detail : ''}`);
}

function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    messages: {
      stream(params) {
        calls.push(params);
        const r = responses[calls.length - 1];
        return { finalMessage: async () => { if (!r) throw new Error('unexpected extra call'); return r; } };
      },
    },
  };
}

const INPUT = { formType: 'vision', outcome: 'refer', consentSigned: true, confidence: 'high', uncertainFields: [] };
const toolUse = { type: 'tool_use', id: 'tu_1', name: 'record_screening_referral', input: INPUT };
const args = { model: 'claude-opus-5', system: 'sys', mediaBlock: { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } } };

(async () => {
  // 1. thinking + tool_use: found on the first call, no retry.
  {
    const c = fakeClient([{ stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '', signature: 'x' }, toolUse], usage: {} }]);
    const r = await sr.runScreeningExtraction(c, args);
    ok('thinking+tool_use returns tool input', r.toolUse.input === INPUT);
    ok('thinking+tool_use no retry', r.retried === false && c.calls.length === 1);
    const p = c.calls[0];
    ok('first call adaptive thinking', p.thinking && p.thinking.type === 'adaptive');
    ok('first call tool_choice auto', p.tool_choice && p.tool_choice.type === 'auto');
    ok('first call max_tokens 16000', p.max_tokens === 16000);
    ok('image block passed through', p.messages[0].content[0] === args.mediaBlock);
  }

  // 2. text-only reply -> one forced retry, thinking off.
  {
    const c = fakeClient([
      { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'This is a vision form...' }], usage: {} },
      { stop_reason: 'tool_use', content: [toolUse], usage: {} },
    ]);
    const r = await sr.runScreeningExtraction(c, args);
    ok('text-only retries once', c.calls.length === 2 && r.retried === true);
    ok('retry returns tool input', r.toolUse.input === INPUT);
    const p = c.calls[1];
    ok('retry forces the tool', p.tool_choice && p.tool_choice.type === 'tool' && p.tool_choice.name === 'record_screening_referral');
    ok('retry has thinking off', p.thinking && p.thinking.type === 'disabled');
  }

  // 3. text-only twice -> no_tool_use error, still only two calls.
  {
    const c = fakeClient([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'hmm' }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'hmm' }] },
    ]);
    let err = null;
    try { await sr.runScreeningExtraction(c, args); } catch (e) { err = e; }
    ok('two text replies -> no_tool_use', err && err.code === 'no_tool_use', err && err.message);
    ok('never more than one retry', c.calls.length === 2);
  }

  // 4. max_tokens truncation -> truncated error, no retry.
  {
    const c = fakeClient([{ stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '' }, toolUse] }]);
    let err = null;
    try { await sr.runScreeningExtraction(c, args); } catch (e) { err = e; }
    ok('max_tokens -> truncated', err && err.code === 'truncated');
    ok('truncation does not retry', c.calls.length === 1);
  }

  // 5. truncation on the retry is also refused.
  {
    const c = fakeClient([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'x' }] },
      { stop_reason: 'max_tokens', content: [toolUse] },
    ]);
    let err = null;
    try { await sr.runScreeningExtraction(c, args); } catch (e) { err = e; }
    ok('retry max_tokens -> truncated', err && err.code === 'truncated');
  }

  // 6. prompt wording: calibrated flags + the must-call line.
  {
    const sys = sr.buildSystemPrompt('Monday, October 5, 2026');
    ok('prompt has MUST call line', sys.indexOf('you MUST call record_screening_referral exactly once') !== -1);
    ok('prompt drops over-flagging line', sys.indexOf('Over-flagging is the cheaper mistake') === -1);
    ok('prompt says do not flag clear fields', sys.indexOf('Do NOT flag fields that are clearly written') !== -1);
    const desc = sr.SCREENING_REFERRAL_TOOL_SCHEMA.properties.uncertainFields.description;
    ok('uncertainFields no longer says be generous', desc.indexOf('generous') === -1);
  }

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
