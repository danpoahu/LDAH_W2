// ═══════════════════════════════════════════════════════════════════════════
// IT_Help auto-answer (2026-09-01, Daniel)
//
// Answers staff messages sent to the IT_Help account, in the same thread, using
// Claude with a knowledge base about the -Int dashboard.
//
// WHY A CLOUD FUNCTION AND NOT A LIVE CLAUDE SESSION
// Daniel's first instinct was to leave a Claude session running and have it
// answer. That only works while he has the session open; staff message IT_Help
// at 7am on a Saturday. This runs on Firestore's trigger, always, with no
// laptop involved.
//
// WHERE THE KNOWLEDGE LIVES
// system/itHelpAssistant.knowledge in Firestore — NOT in this file. It can be
// rewritten any time without a redeploy, which is what makes it maintainable:
// everything learned about -Int gets appended there.
//
// It is sent as a cached system block (cache_control: ephemeral), so a large
// knowledge base costs roughly a tenth on repeat calls instead of full price
// every time. That is what makes "give it everything we know" affordable.
//
// RAILS
//   • IT_Help conversations only. Never a thread with a person.
//   • Never replies to itself (senderId === IT_HELP_UID short-circuits).
//   • Never writes to any record. It explains; it does not act.
//   • Reads the conversation text only — no contacts, events or family data.
//   • Every reply is labelled isAutoReply so the UI can mark it.
//   • Capped per thread per day, so a misunderstanding cannot become a loop.
//   • Killable instantly: system/itHelpAssistant.enabled = false.
//   • Waits before answering unless the person said they are blocked, so a
//     human gets first refusal; skips entirely if a human answered meanwhile.
//   • Every reply ends by saying Daniel has been notified too.
//   • Never leaves the person with silence: if no answer can be produced, it
//     says so in the thread rather than failing quietly.
// ═══════════════════════════════════════════════════════════════════════════

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");

const IT_HELP_UID = "Lwz0SNVIRAcC68tVQdzE2BBCapt1";   // ". IT_Help"
const CONFIG_DOC = "itHelpAssistant";                  // system/itHelpAssistant
const LOG_COLLECTION = "itHelpLog";                    // one doc per reply, for the usage report

// Fallbacks only — the Firestore config wins. Kept here so a missing config doc
// cannot leave the function without a usable shape.
const DEFAULTS = {
  enabled: false,              // OFF until the config doc is seeded, deliberately
  model: "claude-opus-5",
  effort: "low",               // support chat, not hard reasoning — see note in the deploy report
  maxTokens: 1024,
  delaySeconds: 60,            // 1 minute (Daniel, 2026-09-01) — long enough for a
                               // person to get there first, short enough not to feel broken
  urgentDelaySeconds: 0,       // "Cannot work — blocked" is answered at once
  maxRepliesPerThreadPerDay: 6,
  historyMessages: 8,
  knowledge: "",
};

// Prices per million tokens, for the usage report. Cache reads are ~0.1x input,
// cache writes ~1.25x. Kept beside the model so the report cannot silently price
// a different model at these rates.
const PRICING = {
  "claude-opus-5":   { in: 5.00, out: 25.00 },
  "claude-sonnet-5": { in: 2.00, out: 10.00 },
  "claude-haiku-4-5":{ in: 1.00, out: 5.00 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every automatic answer ends with this line (Daniel, 2026-09-04): "have the form
// live in the chat, but if you attempt to answer yourself just let the user know
// that i have also been notified." No time promise — only that a person knows.
const NOTIFIED_LINE = "Daniel has also been notified about this and will follow up with you.";

// Posted into the thread when no automatic answer could be produced. Before this,
// a failure was silent: a Pacific partner asked for help and got nothing back at
// all, with nothing to tell her anything had gone wrong.
const FALLBACK_MESSAGE =
  "I was not able to put an answer together for this one. " + NOTIFIED_LINE;

// Adds the "a person knows too" line to an answer, once.
function withNotifiedLine(text) {
  const body = String(text || "").trim();
  if (!body) return body;
  if (body.indexOf(NOTIFIED_LINE) !== -1) return body;
  return body + "\n\n" + NOTIFIED_LINE;
}

/* Turn the stored thread into a messages array the API will accept.

   The conversation must END on a user turn. An assistant message last reads as a
   prefill, and current models reject it outright with a 400. That is not
   theoretical: it happened three times in the first eighteen live attempts. The
   function waits a minute before answering so a person gets first refusal, and if
   a second automatic reply landed during that wait — which is what happens when
   somebody asks two questions in quick succession — the reversed history ended on
   an assistant turn and the entire answer was lost.

   So: drop trailing assistant turns (they are our own replies; there is nothing
   in them to answer), then drop leading assistant turns (the first message has to
   be a user one). What is left is the question, or nothing at all. */
function buildApiMessages(history) {
  const messages = (history || [])
    .filter((m) => m && String(m.text || "").trim())
    .map((m) => ({
      role: m.fromHelpdesk ? "assistant" : "user",
      content: String(m.text || "").slice(0, 2000),
    }));
  while (messages.length && messages[messages.length - 1].role === "assistant") messages.pop();
  while (messages.length && messages[0].role === "assistant") messages.shift();
  return messages;
}

async function loadConfig(db) {
  try {
    const snap = await db.collection("system").doc(CONFIG_DOC).get();
    return Object.assign({}, DEFAULTS, snap.exists ? (snap.data() || {}) : {});
  } catch (e) {
    console.warn("itHelp: config read failed, using defaults:", e.message);
    return Object.assign({}, DEFAULTS);
  }
}

function estimateCostUsd(model, usage) {
  const p = PRICING[model];
  if (!p || !usage) return null;
  const inTok    = usage.input_tokens || 0;
  const cacheRd  = usage.cache_read_input_tokens || 0;
  const cacheWr  = usage.cache_creation_input_tokens || 0;
  const outTok   = usage.output_tokens || 0;
  const cost = (inTok * p.in + cacheRd * p.in * 0.1 + cacheWr * p.in * 1.25 + outTok * p.out) / 1e6;
  return Math.round(cost * 1e6) / 1e6;    // to the millionth of a dollar
}

// How many auto-replies this thread has already had today (HST).
async function repliesTodayForThread(db, convId) {
  const nowHst = new Date(new Date().toLocaleString("en-US", { timeZone: "Pacific/Honolulu" }));
  const dayKey = nowHst.getFullYear() + "-" +
    String(nowHst.getMonth() + 1).padStart(2, "0") + "-" +
    String(nowHst.getDate()).padStart(2, "0");
  const snap = await db.collection(LOG_COLLECTION)
    .where("convId", "==", convId).where("dayKey", "==", dayKey).get();
  let n = 0;
  snap.forEach((d) => { if (!(d.data() || {}).suppressed) n++; });
  return { count: n, dayKey };
}

/* Ask Claude. The knowledge base goes in its own cached system block; the
   volatile per-request framing goes after it, because caching is a prefix match
   and anything that changes per request must sit behind the last breakpoint.

   The SDK pinned here is old (0.39.0), so `output_config` may not be understood
   by the installed client. If the API rejects it we retry once without it rather
   than failing the reply — the answer matters more than the effort setting.

   Returns { skipped, reason } when the thread holds no question to answer, so the
   caller can log it and stop WITHOUT spending a call. `client` is injectable so
   the tests can prove no call is made in that case. */
async function answerFromHistory(cfg, history, askerName, client) {
  const messages = buildApiMessages(history);
  if (!messages.length) {
    return { skipped: true, reason: "nothing left to answer — the thread ends on an automatic reply" };
  }
  client = client || new Anthropic();

  const system = [
    {
      type: "text",
      text: cfg.knowledge || "You help LDAH staff use their internal dashboard.",
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text:
        "You are answering inside LDAH's internal Team Messages chat, as the IT_Help account.\n" +
        "You are talking to " + (askerName || "a staff member") + ".\n\n" +
        "HOW TO ANSWER\n" +
        "- If they can do it themselves, TELL THEM HOW. Steps, not a name. Handing\n" +
        "  someone a colleague to go and ask, when three steps would have fixed it, is\n" +
        "  a bad answer — it costs them a wait and interrupts somebody else. Only name\n" +
        "  a person when the thing genuinely cannot be done by the person asking.\n" +
        "- Short. Two or three sentences, or a short numbered list. This is a chat window.\n" +
        "- Plain language. Never mention Firestore, Cloud Functions, JavaScript or any code.\n" +
        "- Name the actual screen and button they should click.\n" +
        "- If a training video covers it, PASTE THE LINK from the list you were\n" +
        "  given. A link they can click beats a title they have to go and hunt for.\n" +
        "  Only ever use a link from that list — never invent or guess a URL.\n\n" +
        "WHAT YOU MUST NOT DO\n" +
        "- Do not guess. If you are not sure, say so plainly and say Daniel will pick it up.\n" +
        "- You cannot change anything — no records, no events, no contacts. You explain only.\n" +
        "- You have no access to any family's information. If the question needs a specific\n" +
        "  family's record, say that a person needs to look, and stop.\n" +
        "- Never invent a screen, button or report that you were not told about above.\n",
    },
  ];

  const base = {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    system,
    messages,
  };

  let response;
  try {
    response = await client.messages.create(
      Object.assign({}, base, { output_config: { effort: cfg.effort } })
    );
  } catch (err) {
    const status = err && err.status;
    if (status !== 400) throw err;
    console.warn("itHelp: output_config rejected by this SDK/API, retrying without it:", err.message);
    response = await client.messages.create(base);
  }

  const text = (response.content || [])
    .filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return {
    text: withNotifiedLine(text),
    usage: response.usage || {},
    stopReason: response.stop_reason,
  };
}

exports.itHelpAutoAnswer = functions
  .runWith({ timeoutSeconds: 540, memory: "256MB", maxInstances: 5, secrets: ["ANTHROPIC_API_KEY"] })
  .firestore.document("chatConversations/{convId}/messages/{msgId}")
  .onCreate(async (snap, context) => {
    const db = admin.firestore();
    const convId = context.params.convId;
    const msg = snap.data() || {};

    // ── gates, cheapest first ────────────────────────────────────────────
    if (msg.senderId === IT_HELP_UID) return null;          // never answer itself
    if (msg.isAutoReply === true) return null;              // belt and braces
    if (!String(msg.text || "").trim()) return null;        // a bare screenshot is not a question

    const convRef = db.collection("chatConversations").doc(convId);
    const convSnap = await convRef.get();
    if (!convSnap.exists) return null;
    const conv = convSnap.data() || {};
    const parts = Array.isArray(conv.participants) ? conv.participants : [];
    if (parts.indexOf(IT_HELP_UID) === -1) return null;     // not an IT_Help thread — stop

    const cfg = await loadConfig(db);
    if (cfg.enabled !== true) return null;                  // kill switch

    const { count, dayKey } = await repliesTodayForThread(db, convId);
    if (count >= cfg.maxRepliesPerThreadPerDay) {
      console.log("itHelp: thread", convId, "at its daily cap; staying quiet");
      return null;
    }

    const askerUid = msg.senderId || "";
    const askerName = msg.senderName || (conv.participantNames || {})[askerUid] || "a staff member";

    // ── wait, so a human gets first refusal ──────────────────────────────
    const urgent = /cannot work|blocked/i.test(String(msg.text || ""));
    const waitMs = 1000 * (urgent ? (cfg.urgentDelaySeconds || 0) : (cfg.delaySeconds || 0));
    if (waitMs > 0) await sleep(Math.min(waitMs, 420000));   // hard cap inside the 540s timeout

    // Did a person answer while we waited? If so this is no longer needed.
    const since = await convRef.collection("messages")
      .where("createdAt", ">", msg.createdAt || admin.firestore.Timestamp.now()).get();
    let humanReplied = false;
    since.forEach((d) => {
      const x = d.data() || {};
      if (x.senderId && x.senderId !== askerUid && x.isAutoReply !== true) humanReplied = true;
    });
    if (humanReplied) {
      await db.collection(LOG_COLLECTION).add({
        convId, askerUid, askerName, dayKey,
        question: String(msg.text || "").slice(0, 400),
        suppressed: true, suppressedReason: "a person replied first",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log("itHelp: a person answered first in", convId, "— staying quiet");
      return null;
    }

    // ── the last few turns, for context ──────────────────────────────────
    const histSnap = await convRef.collection("messages")
      .orderBy("createdAt", "desc").limit(cfg.historyMessages).get();
    const history = [];
    histSnap.forEach((d) => {
      const x = d.data() || {};
      if (!String(x.text || "").trim()) return;
      history.push({ text: x.text, fromHelpdesk: x.senderId === IT_HELP_UID || x.isAutoReply === true });
    });
    history.reverse();

    // ── ask, then post ───────────────────────────────────────────────────
    const FieldValue = admin.firestore.FieldValue;

    // Posting into the thread, used for both the answer and the "could not
    // answer" notice, so a failure can never leave the person with silence.
    const postToThread = async (text, extra) => {
      await convRef.collection("messages").add(Object.assign({
        senderId: IT_HELP_UID,
        senderName: "IT_Help",
        text,
        isAutoReply: true,               // the UI badges on this
        createdAt: FieldValue.serverTimestamp(),
        readBy: [IT_HELP_UID],
      }, extra || {}));
      await convRef.update({
        lastMessage: text.length > 80 ? text.slice(0, 80) + "…" : text,
        lastMessageAt: FieldValue.serverTimestamp(),
        lastSenderId: IT_HELP_UID,
        lastReadBy: [IT_HELP_UID],
      });
    };

    let answer, usage = {}, failed = null, skippedReason = null;
    try {
      const r = await answerFromHistory(cfg, history, askerName);
      if (r.skipped) {
        skippedReason = r.reason;
      } else {
        answer = r.text; usage = r.usage;
        if (r.stopReason === "refusal") failed = "declined";
      }
    } catch (e) {
      failed = e.message;
      console.error("itHelp: Claude call failed:", e.message);
    }

    // Nothing was actually asked — our own reply is the last word in the thread.
    // Log it and stop; posting a notice here would be noise, not help.
    if (skippedReason) {
      await db.collection(LOG_COLLECTION).add({
        convId, askerUid, askerName, dayKey,
        question: String(msg.text || "").slice(0, 400),
        suppressed: true, suppressedReason: skippedReason,
        createdAt: FieldValue.serverTimestamp(),
      });
      console.log("itHelp:", skippedReason, "in", convId, "— staying quiet");
      return null;
    }

    if (failed || !answer) {
      // The person asked and is waiting. Say so plainly rather than say nothing.
      let noticePosted = false;
      try {
        await postToThread(FALLBACK_MESSAGE, { isFallbackNotice: true });
        noticePosted = true;
      } catch (e) {
        console.error("itHelp: could not post the fallback notice:", e.message);
      }
      await db.collection(LOG_COLLECTION).add({
        convId, askerUid, askerName, dayKey,
        question: String(msg.text || "").slice(0, 400),
        suppressed: true, suppressedReason: "no answer produced: " + (failed || "empty"),
        noticePosted,
        createdAt: FieldValue.serverTimestamp(),
      });
      return null;
    }

    await postToThread(answer, { autoReplyModel: cfg.model });

    await db.collection(LOG_COLLECTION).add({
      convId, askerUid, askerName, dayKey,
      question: String(msg.text || "").slice(0, 400),
      answer: answer.slice(0, 1000),
      model: cfg.model,
      urgent,
      suppressed: false,
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cacheReadTokens: usage.cache_read_input_tokens || 0,
      cacheCreateTokens: usage.cache_creation_input_tokens || 0,
      estCostUsd: estimateCostUsd(cfg.model, usage),
      createdAt: FieldValue.serverTimestamp(),
    });

    console.log("itHelp: answered", askerName, "in", convId,
      "(in " + (usage.input_tokens || 0) + ", cached " + (usage.cache_read_input_tokens || 0) +
      ", out " + (usage.output_tokens || 0) + ")");
    return null;
  });

exports.__itHelpTest = {
  estimateCostUsd, PRICING, DEFAULTS, IT_HELP_UID,
  buildApiMessages, withNotifiedLine, answerFromHistory,
  NOTIFIED_LINE, FALLBACK_MESSAGE,
};
