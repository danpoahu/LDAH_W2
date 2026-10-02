// ═══════════════════════════════════════════════════════════════════════════
// Advocacy Readiness score (2026-09-23, Daniel)
//
// Every case-advocacy family gets a 0–10 "self-advocacy readiness" score:
//   0–1  new to it (never heard of IDEA / 504)
//   2–6  knows the basics
//   7–9  getting there
//   10   self-advocate — runs their own school meetings without us
//
// START: set once from the intake notes. The model SUGGESTS (0–6, with a
// verbatim quote), an advocate CONFIRMS from the staff UI (startScore).
//
// CHECKS: Monday, Wednesday and Friday mornings per open family, FORWARD ONLY. A check starts from
// the prior score and reads only items dated after the checkpoint
// (lastCheckedAt). Nothing already scored is ever re-read or re-scored, and the
// model is never shown the history of scored items — only a compact state
// summary plus the NEW items.
//
// THE MODEL PROPOSES, THE CODE DISPOSES. Points for workshops, meetings and
// certificates are fixed by the client-approved rules below and set by code;
// the model only writes the one-line text, picks a same-issue meeting for a
// 'didnt' take-back, and may propose a small note-evidence adjustment, each of
// which is clamped here. The model cannot award more than a rule allows.
//
// ONE SCORE FORMULA: currentScore = clamp(effectiveStart + sumDelta), where
// effectiveStart = startScore ?? startSuggested.score. computeCurrentScore()
// is that formula; the staff UI must compute it the same way, because staff
// can change startScore after checks have run.
//
// ── THE UNRATED-MEETING RULE (thought through, 2026-09-23) ────────────────────
// A school meeting ("Out of office meeting") is only scored once staff record
// its outcome (meetingOutcome) — and it must still be scored when that happens,
// even though its createdAt is in the past. So the checkpoint may not move past
// an unrated meeting:
//
//     untilAt = min(now, earliestUnratedMeeting.createdAt - 1ms)
//
// The naive version of that rule DOUBLE-COUNTS: everything between the unrated
// meeting and now (workshops, notes, a rated meeting) is scored in this check,
// but it is still "after the checkpoint", so the next check would read and
// score it again. The guard is `scoredRefs` on the readiness doc: every item
// scored whose date is later than the new checkpoint is remembered there
// ({ ref, at }) and skipped by later checks. Once the checkpoint moves past an
// item, it is pruned from the list (the date filter alone then excludes it),
// so the list only ever holds the items sitting between a held checkpoint and
// the last run. Result: an unrated meeting holds the checkpoint back without
// holding up anything else, and it is scored exactly once when rated.
//
// Because a held checkpoint would otherwise make every sweep look "due", the
// every-other-day cadence runs off `lastRunAt`, not `lastCheckedAt`.
//
// The same scoredRefs guard makes appended "Add a Note" entries safe: their
// stamp has minute resolution, so they are dated to the END of that minute —
// a note written a few seconds after a check ran is never missed, and one that
// was already read is never read twice.
//
// RAILS
//   • Sweep runs ONLY when advocacyReadinessConfig/settings.armed === true.
//   • CF never writes startScore / startConfirmed* — those belong to the UI.
//   • Per-family try/catch; one family failing never stops the sweep.
//   • A failed model call ABORTS that family's check without advancing the
//     checkpoint — it is simply retried next sweep. Nothing half-scored lands.
//   • Emails and phone numbers are stripped from every text sent to the model.
//   • Never logs error cause.message (it can carry the API key); code/errno only.
// ═══════════════════════════════════════════════════════════════════════════

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");

// Same model as the Connect-Gen Case Review (CG_CASE_REVIEW_MODEL in index.js).
const ADVOCACY_READINESS_MODEL = "claude-opus-5";

const READINESS_COLLECTION = "advocacyReadiness";
const READINESS_CONFIG_PATH = "advocacyReadinessConfig/settings";
const CHECK_INTERVAL_HOURS = 40;           // Mon/Wed/Fri 6am (Daniel 2026-10-01): gaps are 48h or 72h, 40h keeps slack
const START_CONTEXT_DAYS = 14;             // intake window read for the start suggestion
const MEETING_CHANNEL = "out of office meeting";
const SWEEP_TIME_BUDGET_MS = 420 * 1000;   // stop STARTING families after this (fn timeout 540s)
const SWEEP_CONCURRENCY = 2;
const HST_OFFSET_MS = 10 * 3600 * 1000;

// Client-approved rules. The rubric text below is generated from these numbers
// so the prompt can never drift from what the code enforces.
const READINESS_RULES = Object.freeze({
  workshopEach: 0.5,
  workshopCap: 2.5,                 // across the life of the case
  meeting: Object.freeze({ worked: 1.5, partly: 0.5, didnt: 0 }),
  parentLedBonus: 1,
  certTier: 1,                      // per bronze / silver / gold certificate
  certLesson: 0,
  notesMaxPerCheck: 0.5,            // |sum of note points| per check
  capWithoutBothGates: 9.5,
  capWithBothGates: 10,
  startMaxSuggested: 6,
});

const CERT_TIERS = ["bronze", "silver", "gold"];
const CERT_TIER_LESSONS = {
  bronze: ["b1", "b2", "b2pq", "b3", "b4", "bquiz"],
  silver: ["s1", "s2", "s2pq", "s3", "s4", "squiz"],
  gold: ["g1", "g2", "g2pq", "g3", "g4", "gquiz"],
};

// Event types that are not a workshop a parent attends to learn (a table at
// somebody else's event, a screening, a flyer). Mirrors EVENT_TYPE_CAPABILITIES
// in index.js.
const NON_WORKSHOP_EVENT_TYPES = ["outreach_booth", "screening", "flyer"];

const READINESS_RUBRIC = [
  "LDAH self-advocacy readiness scale, 0 to 10:",
  "  0-1  New to it: has not heard of IDEA or Section 504, does not know what an IEP meeting is for.",
  "  2-6  Knows the basics: understands the IEP/504 process, still relies on the advocate to speak for the child.",
  "  7-9  Getting there: prepares for and speaks up in meetings, drafts their own requests, the advocate backs them up.",
  "  10   Self-advocate: runs their own school meetings without us.",
  "",
  "Points (the code enforces these exactly; you cannot change a fixed amount):",
  "  - Workshop attended: +" + READINESS_RULES.workshopEach + " each; workshop points are capped at " +
    READINESS_RULES.workshopCap + " for the life of the case.",
  "  - School meeting ('Out of office meeting'): worked +" + READINESS_RULES.meeting.worked +
    ", partly +" + READINESS_RULES.meeting.partly + ", didn't work " + READINESS_RULES.meeting.didnt + ".",
  "    A meeting that didn't work MAY take back up to the points given for an EARLIER meeting on the SAME",
  "    issue. Only do this when it is clearly the same issue; name that meeting in sameIssueAsRef and the",
  "    amount in takeBack. The score never falls below the family's starting score.",
  "  - The parent led the meeting: +" + READINESS_RULES.parentLedBonus + " extra (on any outcome).",
  "  - Certification: +" + READINESS_RULES.certTier + " per tier certificate (bronze, silver, gold). Individual lessons are 0 points,",
  "    but mention the progress.",
  "  - Notes: from evidence of growing independence (e.g. the parent drafted their own email to the school,",
  "    requested records themselves, prepared questions for the meeting) you may add at most +/-" +
    READINESS_RULES.notesMaxPerCheck + " IN TOTAL per check,",
  "    in steps of 0.5, and only with a VERBATIM quote from that note as evidence. Most notes earn 0 — routine",
  "    scheduling, reminders and staff admin are not evidence. Omit notes that earn nothing.",
  "  - Maximum " + READINESS_RULES.capWithoutBothGates + " unless the family has BOTH a gold certificate AND a parent-led meeting; then " +
    READINESS_RULES.capWithBothGates + ".",
  "  - Scores are in steps of 0.5.",
].join("\n");

// ── Pure helpers ────────────────────────────────────────────────────────────

function roundHalf(x) {
  const n = Number(x);
  if (!isFinite(n)) return 0;
  return Math.round(n * 2) / 2;
}

// Timestamp | Date | number(ms) | ISO string | {seconds} -> ms, or null.
function tsMs(v) {
  if (v == null || v === true || v === false) return null;
  if (typeof v === "number") return isFinite(v) && v > 0 ? v : null;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) { const t = v.getTime(); return isFinite(t) ? t : null; }
  if (typeof v === "string") { const t = Date.parse(v); return isFinite(t) ? t : null; }
  if (typeof v === "object" && typeof v.seconds === "number") {
    return v.seconds * 1000 + Math.round((v.nanoseconds || 0) / 1e6);
  }
  return null;
}

// Hawaii calendar date for a ms instant.
function ymd(ms) {
  if (ms == null) return "";
  return new Date(ms - HST_OFFSET_MS).toISOString().slice(0, 10);
}

// "YYYY-MM-DD..." session key -> noon HST that day (ms), or null.
function dateKeyMs(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ""));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0) + HST_OFFSET_MS;
}

function effectiveStart(doc) {
  const d = doc || {};
  if (typeof d.startScore === "number" && isFinite(d.startScore)) return d.startScore;
  const s = d.startSuggested;
  if (s && typeof s.score === "number" && isFinite(s.score)) return s.score;
  return 0;
}

function scoreCap(gates) {
  const g = gates || {};
  return (g.goldCert === true && g.parentLedMeeting === true)
    ? READINESS_RULES.capWithBothGates : READINESS_RULES.capWithoutBothGates;
}

// THE clamp. Round to 0.5, cap at 9.5 (10 with both gates), never below the
// floor (the effective start), always inside 0..10. If staff confirmed a start
// above the cap, the start wins — it is their call.
function clampScore(raw, floor, gates) {
  const f = Math.max(0, Math.min(10, roundHalf(floor || 0)));
  let x = roundHalf(raw);
  x = Math.min(x, scoreCap(gates));
  x = Math.max(x, f);
  return Math.max(0, Math.min(10, x));
}

// The one formula for the displayed score. The UI computes exactly this.
function computeCurrentScore(doc) {
  const d = doc || {};
  const start = effectiveStart(d);
  const sum = (typeof d.sumDelta === "number" && isFinite(d.sumDelta)) ? d.sumDelta : 0;
  return clampScore(start + sum, start, d.gates);
}

// Fold one check's raw points onto the current doc. Returns the numbers the
// check and the doc record. sumDelta is re-based as (scoreAfter - start) so
// currentScore === computeCurrentScore(updatedDoc) always holds; it equals the
// running total of deltas unless staff changed the start in between.
function finalizeScore(doc, rawPoints, gates) {
  const start = effectiveStart(doc);
  const scoreBefore = computeCurrentScore(doc);
  const scoreAfter = clampScore(scoreBefore + (Number(rawPoints) || 0), start, gates);
  return {
    scoreBefore,
    scoreAfter,
    delta: roundHalf(scoreAfter - scoreBefore),
    sumDelta: roundHalf(scoreAfter - start),
  };
}

// Emails and phone numbers out of anything sent to the model.
function stripPii(text) {
  return String(text || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone]");
}

function oneLine(text, max) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  const m = max || 240;
  return s.length > m ? s.slice(0, m - 1).trimEnd() + "…" : s;
}

function normForMatch(s) {
  return String(s || "").toLowerCase().replace(/[“”"‘’'`]/g, "").replace(/\s+/g, " ").trim();
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// Parse the Int "Add a Note" stamp: "Sep 3, 2026 10:15 AM" (browser-local,
// which for staff is HST). Returns the ms at the END of that minute (see the
// header note), or null.
function parseNoteStamp(stamp) {
  const m = /([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])?\.?[Mm]?\.?)?/.exec(String(stamp || ""));
  if (!m) return null;
  const mon = MONTHS[m[1].toLowerCase()];
  if (mon == null) return null;
  let hh = m[4] != null ? +m[4] : 12;
  const mm = m[5] != null ? +m[5] : 0;
  const ap = m[6] ? m[6].toUpperCase() : "";
  if (ap === "P" && hh < 12) hh += 12;
  if (ap === "A" && hh === 12) hh = 0;
  return Date.UTC(+m[3], mon, +m[2], hh, mm, 59, 999) + HST_OFFSET_MS;
}

// Split an interaction's `notes` into the original block and each appended
// "Add a Note" block. Int appends: "\n---\n[Name — Mon D, YYYY hh:mm AM]\ntext".
// An appended block whose stamp cannot be read inherits the previous block's
// date (so it is never dated into the future and re-read forever).
function parseNoteBlocks(notes, createdAtMs) {
  const src = String(notes || "");
  const re = /\n---\n\[([^\]\n]*)\]\n/g;
  const out = [];
  let last = 0, m, idx = 0, prevAt = createdAtMs;
  let pending = { index: 0, who: "", at: createdAtMs };
  while ((m = re.exec(src)) !== null) {
    const text = src.slice(last, m.index).trim();
    if (text) out.push({ index: pending.index, who: pending.who, at: pending.at, text });
    idx++;
    const header = m[1];
    const parts = header.split(/\s+[—–-]\s+/);
    const who = parts.length > 1 ? parts.slice(0, -1).join(" - ").trim() : "";
    const at = parseNoteStamp(parts[parts.length - 1]);
    prevAt = at != null ? at : prevAt;
    pending = { index: idx, who, at: prevAt };
    last = m.index + m[0].length;
  }
  const tail = src.slice(last).trim();
  if (tail) out.push({ index: pending.index, who: pending.who, at: pending.at, text: tail });
  return out;
}

function isMeetingIx(x) {
  return String((x && x.channel) || "").trim().toLowerCase() === MEETING_CHANNEL;
}

function normOutcome(v) {
  const s = String(v || "").toLowerCase().replace(/[^a-z]/g, "");
  if (s === "worked") return "worked";
  if (s === "partly" || s === "partial" || s === "partially") return "partly";
  if (s === "didnt" || s === "didnotwork" || s === "didntwork") return "didnt";
  return null;
}

// Mirrors LDAH-Int _carIsAdv() (cmsBuildCaseAdvocacyReport) exactly, so the set
// of families here is the set on the Case Advocacy report.
function isAdvocacyRecord(d) {
  if (!d) return false;
  return d.caseAdvocacy === true || !!d.caseAdvocateUid ||
         d.interactionType === "Case Advocacy" || d.workflowStep === "caseAdvocacy";
}

// interactions: [{ id, ...data }]. One entry per contactId, built the way the
// report builds its rows: the anchor is the OLDEST caseAdvocacy case file (else
// the first advocacy record), the family is OPEN when any advocacy record has
// status 'Open', the advocate is named by the case file first.
function groupAdvocacyFamilies(interactions) {
  const fam = {};
  let orphanRecords = 0;
  for (const v of interactions || []) {
    if (!isAdvocacyRecord(v)) continue;
    if (!v.contactId) { orphanRecords++; continue; }
    const g = fam[v.contactId] || (fam[v.contactId] = { contactId: v.contactId, recs: [], file: null });
    g.recs.push(v);
    if (v.workflowStep === "caseAdvocacy") {
      const a = tsMs(v.createdAt), b = g.file ? tsMs(g.file.createdAt) : null;
      if (!g.file || (a && b && a < b)) g.file = v;
    }
  }
  const families = Object.keys(fam).map((cid) => {
    const g = fam[cid];
    const f = g.file || g.recs[0];
    const firstNamed = (key) => (g.recs.map((r) => r[key]).filter(Boolean))[0] || "";
    const open = g.recs.some((r) => r.status === "Open");
    let closedAtMs = null;
    for (const r of g.recs) { const t = tsMs(r.caseAdvocacyClosedAt); if (t && !closedAtMs) closedAtMs = t; }
    return {
      contactId: cid,
      caseInteractionId: f.id || "",
      contactName: f.contactName || firstNamed("contactName") || "",
      advocateName: (g.file && g.file.caseAdvocateName) || firstNamed("caseAdvocateName"),
      advocateUid: (g.file && g.file.caseAdvocateUid) || firstNamed("caseAdvocateUid"),
      startedAtMs: tsMs(f.caseAdvocacyStartedAt) || tsMs(f.createdAt),
      open,
      closedAtMs,
    };
  });
  return { families, orphanRecords };
}

// Event type, compact twin of _lcEventType() in index.js (not required from
// there: requiring index.js would re-run the whole file).
function eventTypeOf(ev, collection) {
  if (!ev) return "";
  if (ev.eventType) return ev.eventType;
  if (collection === "recurringEvents") return ev.flyerOnly === true ? "flyer" : "connect_gen";
  if (ev.specialEvent === true) {
    return (ev.specialFormConfig && ev.specialFormConfig.screening === true) ? "screening" : "outreach_booth";
  }
  if (ev.infoOnly === true) return "flyer";
  if (ev.remoteSignup === true) return "remote_signup";
  return "learning_labs";
}

// Include every LDAH workshop (Connect-Gen too); exclude one-off events (those
// are really meetings) and the non-workshop types. An event that no longer
// exists fails OPEN — the attendance happened.
function isWorkshopEvent(ev, collection) {
  if (!ev) return true;
  if (ev.isOneOff === true) return false;
  return NON_WORKSHOP_EVENT_TYPES.indexOf(eventTypeOf(ev, collection)) === -1;
}

// Attended sessions on one signup, mirroring Int _sessions(): per-session
// sessionAttendance wins; else the flat attendanceStatus; else attended===true.
function attendedSessions(s) {
  const out = [];
  const sa = s && s.sessionAttendance;
  if (sa && typeof sa === "object" && Object.keys(sa).length) {
    for (const k of Object.keys(sa)) {
      const r = sa[k] || {};
      if (r.status === "attended") {
        out.push({ key: k, at: tsMs(r.markedAt) || dateKeyMs(k) || tsMs(s.attendanceMarkedAt) });
      }
    }
    return out;
  }
  if (s && s.attendanceStatus) {
    if (s.attendanceStatus === "attended") {
      const key = (Array.isArray(s.selectedDates) && s.selectedDates[0]) || s.sessionDate || "";
      out.push({ key: "", dateKey: typeof key === "string" ? key : "", at: tsMs(s.attendanceMarkedAt) || dateKeyMs(key) });
    }
    return out;
  }
  if (s && s.attended === true) {
    out.push({ key: "", at: tsMs(s.attendanceMarkedAt) || tsMs(s.timestamp) || tsMs(s.createdAt) });
  }
  return out;
}

function certSummary(progress, certificates) {
  const lessons = (progress && progress.lessons) || {};
  const tiers = (progress && progress.tiers) || {};
  const certs = certificates || {};
  const out = {};
  for (const t of CERT_TIERS) {
    const done = !!certs[t] || !!tsMs(tiers[t] && tiers[t].completedAt);
    if (done) { out[t] = "done"; continue; }
    const n = CERT_TIER_LESSONS[t].filter((k) => tsMs(lessons[k]) != null).length;
    out[t] = n + "/" + CERT_TIER_LESSONS[t].length;
  }
  return out;
}

// Gates are facts about the family as a whole (reading them is not re-scoring).
function computeGates({ certificates, progress, interactions }) {
  const tiers = (progress && progress.tiers) || {};
  const goldCert = !!(certificates && certificates.gold) || !!tsMs(tiers.gold && tiers.gold.completedAt);
  const parentLedMeeting = (interactions || []).some((x) =>
    isMeetingIx(x) && x.meetingParentLed === true && normOutcome(x.meetingOutcome) != null);
  return { goldCert, parentLedMeeting };
}

// Every dated item for one family. Pure: all reads are done by the caller.
//   interactions : [{ id, ...data }] for this contactId
//   signups      : [{ path, data, eventId, eventCollection, event }]
//   events       : { "<collection>/<id>": eventData|null } for walk-in lookups
//   cert         : { progress, certificates: { bronze?: {...}, ... } }
function buildAllItems({ contactId, interactions, signups, events, cert }) {
  const items = [];
  const unrated = [];
  const seenAttendance = new Set();

  for (const x of interactions || []) {
    const createdMs = tsMs(x.createdAt);
    const blocks = parseNoteBlocks(x.notes, createdMs);
    const meeting = isMeetingIx(x);
    const walkIn = x.interactionType === "Event Attendance";

    if (meeting) {
      const outcome = normOutcome(x.meetingOutcome);
      const original = blocks.find((b) => b.index === 0);
      const rec = {
        kind: "meeting", ref: "interactions/" + x.id, at: createdMs,
        meta: {
          outcome, parentLed: x.meetingParentLed === true,
          summary: String(x.summary || ""), body: original ? original.text : "",
          who: x.owner || "",
        },
      };
      if (outcome) items.push(rec); else if (createdMs != null) unrated.push(rec);
    } else if (walkIn) {
      const evKey = x.relatedEventId || "";
      const ev = evKey ? ((events || {})["events/" + evKey] || (events || {})["recurringEvents/" + evKey] || null) : null;
      const col = evKey && (events || {})["events/" + evKey] ? "events" : "recurringEvents";
      if (isWorkshopEvent(ev, col)) {
        const at = createdMs;
        const dk = x.sessionDate || ymd(at);
        const dedupe = evKey + "|" + String(dk).slice(0, 10);
        if (!evKey || !seenAttendance.has(dedupe)) {
          if (evKey) seenAttendance.add(dedupe);
          items.push({
            kind: "workshop", ref: "interactions/" + x.id, at,
            meta: { title: String(x.summary || "").replace(/^Attended\s+/i, "") || (ev && ev.title) || "a workshop" },
          });
        }
      }
    }

    // Notes. A meeting's original block belongs to the meeting item; a walk-in
    // row's is boilerplate. Appended notes on any record are notes.
    for (const b of blocks) {
      if (b.index === 0 && (meeting || walkIn)) continue;
      items.push({
        kind: "note",
        ref: "interactions/" + x.id + (b.index ? "#note" + b.index : ""),
        at: b.at,
        meta: {
          body: b.text,
          summary: b.index === 0 ? String(x.summary || "") : "",
          who: b.who || x.owner || "",
          interactionType: x.interactionType || "",
          channel: x.channel || "",
        },
      });
    }
  }

  for (const su of signups || []) {
    if (!isWorkshopEvent(su.event, su.eventCollection)) continue;
    const s = su.data || {};
    for (const sess of attendedSessions(s)) {
      const dk = String(sess.key || sess.dateKey || "").slice(0, 10) || ymd(sess.at);
      const dedupe = su.eventId + "|" + dk;
      if (seenAttendance.has(dedupe)) continue;
      seenAttendance.add(dedupe);
      items.push({
        kind: "workshop",
        ref: su.path + (sess.key ? "#" + sess.key : ""),
        at: sess.at,
        meta: { title: s.eventTitle || (su.event && su.event.title) || "a workshop", sessionDate: dk },
      });
    }
  }

  const progress = (cert && cert.progress) || {};
  const certificates = (cert && cert.certificates) || {};
  for (const t of CERT_TIERS) {
    const at = tsMs(certificates[t] && certificates[t].issuedAt) ||
               tsMs(progress.tiers && progress.tiers[t] && progress.tiers[t].completedAt);
    if (at != null) {
      items.push({ kind: "cert", ref: "contacts/" + contactId + "/certificates/" + t, at, meta: { tier: t, type: "tier" } });
    }
    for (const k of CERT_TIER_LESSONS[t]) {
      const lat = tsMs(progress.lessons && progress.lessons[k]);
      if (lat != null) {
        items.push({
          kind: "cert", ref: "contacts/" + contactId + "/certification/progress#lesson:" + k, at: lat,
          meta: { tier: t, type: "lesson", lesson: k },
        });
      }
    }
  }

  return { items: items.filter((i) => i.at != null), unratedMeetings: unrated };
}

// Forward-only selection. Returns the items to score now, the unrated meetings
// that hold the checkpoint, and the new checkpoint (untilMs).
function selectNewItems({ allItems, unratedMeetings, sinceMs, nowMs, scoredRefs }) {
  const skip = new Set((scoredRefs || []).map((r) => r && r.ref).filter(Boolean));
  const items = (allItems || [])
    .filter((i) => i.at > sinceMs && i.at <= nowMs && !skip.has(i.ref))
    .sort((a, b) => a.at - b.at);
  const held = (unratedMeetings || []).filter((m) => m.at > sinceMs).sort((a, b) => a.at - b.at);
  const untilMs = nextCheckpoint(sinceMs, nowMs, held.map((m) => m.at));
  return { items, held, untilMs };
}

// The unrated-meeting rule. Never before the old checkpoint, never after now,
// never at-or-after the earliest unrated meeting (strictly-after reads mean
// the meeting must sit AFTER the checkpoint to be read once rated).
function nextCheckpoint(sinceMs, nowMs, unratedMeetingMs) {
  let until = nowMs;
  for (const t of unratedMeetingMs || []) {
    if (t > sinceMs && t - 1 < until) until = t - 1;
  }
  return Math.max(sinceMs, until);
}

// Remember scored refs that still sit after the new checkpoint; forget the rest.
function nextScoredRefs(prev, scoredItems, untilMs) {
  const map = new Map();
  for (const r of prev || []) if (r && r.ref && r.at > untilMs) map.set(r.ref, { ref: r.ref, at: r.at });
  for (const i of scoredItems || []) if (i.at > untilMs) map.set(i.ref, { ref: i.ref, at: i.at });
  return Array.from(map.values());
}

function tierLabel(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

// Apply the rules to the new items and the model's proposal. Returns entries
// (in date order), the raw point total, and the state that must be persisted.
//   state: { workshopPoints, meetingLedger: [{ ref, date, outcome, points, takenBack, issue }] }
//   proposal: { entries: [{ ref, text, points, sameIssueAsRef, takeBack, quote }] }
function applyRules({ items, proposal, state, progress }) {
  const byRef = {};
  for (const e of ((proposal && proposal.entries) || [])) {
    if (e && typeof e.ref === "string" && !byRef[e.ref]) byRef[e.ref] = e;
  }
  const aiText = (ref, fallback) => {
    const t = byRef[ref] && byRef[ref].text;
    return oneLine(stripPii(t || fallback), 240);
  };

  let workshopPoints = roundHalf((state && state.workshopPoints) || 0);
  const ledger = ((state && state.meetingLedger) || []).map((m) => Object.assign({}, m));
  const entries = [];
  const lessonsByTier = {};
  let notePoints = 0;

  for (const it of items || []) {
    const date = it.kind === "workshop" && it.meta.sessionDate ? it.meta.sessionDate : ymd(it.at);

    if (it.kind === "workshop") {
      const room = Math.max(0, READINESS_RULES.workshopCap - workshopPoints);
      const pts = Math.min(READINESS_RULES.workshopEach, room);
      workshopPoints = roundHalf(workshopPoints + pts);
      let text = aiText(it.ref, "Attended " + it.meta.title + ".");
      if (pts === 0) text = oneLine(text + " (workshop points already at the " + READINESS_RULES.workshopCap + " cap)", 240);
      entries.push({ kind: "workshop", ref: it.ref, date, text, points: pts });

    } else if (it.kind === "meeting") {
      const outcome = it.meta.outcome;
      const base = READINESS_RULES.meeting[outcome] || 0;
      const bonus = it.meta.parentLed ? READINESS_RULES.parentLedBonus : 0;
      let takeBack = 0;
      const p = byRef[it.ref] || {};
      if (outcome === "didnt" && p.sameIssueAsRef && p.sameIssueAsRef !== it.ref) {
        const earlier = ledger.find((m) => m.ref === p.sameIssueAsRef);
        if (earlier) {
          const remaining = Math.max(0, roundHalf((earlier.points || 0) - (earlier.takenBack || 0)));
          const asked = Math.abs(Number(p.takeBack) || 0);
          takeBack = Math.min(remaining, roundHalf(asked));
          if (takeBack > 0) earlier.takenBack = roundHalf((earlier.takenBack || 0) + takeBack);
        }
      }
      const pts = roundHalf(base + bonus - takeBack);
      const label = outcome === "worked" ? "worked" : outcome === "partly" ? "partly worked" : "didn't work";
      let fallback = "School meeting " + label + (it.meta.parentLed ? "; the parent led it" : "") + ".";
      let text = aiText(it.ref, fallback);
      if (takeBack > 0) {
        const earlier = ledger.find((m) => m.ref === p.sameIssueAsRef);
        text = oneLine(text + " (takes back " + takeBack + " from the " + (earlier && earlier.date) + " meeting on the same issue)", 240);
      }
      entries.push({ kind: "meeting", ref: it.ref, date, text, points: pts });
      ledger.push({
        ref: it.ref, date, outcome, parentLed: !!it.meta.parentLed,
        points: base, takenBack: 0,
        issue: oneLine(stripPii(it.meta.summary || it.meta.body), 140),
      });

    } else if (it.kind === "cert" && it.meta.type === "tier") {
      entries.push({
        kind: "cert", ref: it.ref, date,
        text: aiText(it.ref, "Earned the " + tierLabel(it.meta.tier) + " certificate."),
        points: READINESS_RULES.certTier,
      });

    } else if (it.kind === "cert" && it.meta.type === "lesson") {
      (lessonsByTier[it.meta.tier] = lessonsByTier[it.meta.tier] || []).push(it);

    } else if (it.kind === "note") {
      const p = byRef[it.ref];
      if (!p) continue;                               // model found nothing in it
      let pts = roundHalf(Math.max(-READINESS_RULES.notesMaxPerCheck,
        Math.min(READINESS_RULES.notesMaxPerCheck, Number(p.points) || 0)));
      const quote = oneLine(stripPii(p.quote || ""), 200);
      const verified = quote.length >= 8 && normForMatch(stripPii(it.meta.body)).indexOf(normForMatch(quote)) !== -1;
      if (!verified) continue;                        // no verbatim evidence, no points, no entry
      // Keep the running note total inside +/- notesMaxPerCheck.
      const next = notePoints + pts;
      if (next > READINESS_RULES.notesMaxPerCheck) pts = READINESS_RULES.notesMaxPerCheck - notePoints;
      if (next < -READINESS_RULES.notesMaxPerCheck) pts = -READINESS_RULES.notesMaxPerCheck - notePoints;
      pts = roundHalf(pts);
      if (pts === 0) continue;
      notePoints = roundHalf(notePoints + pts);
      entries.push({
        kind: "note", ref: it.ref, date,
        text: oneLine(aiText(it.ref, "Note shows growing independence.") + ' — "' + quote + '"', 300),
        points: pts,
      });
    }
  }

  // Lessons: 0 points, one progress line per tier.
  const lessons = (progress && progress.lessons) || {};
  for (const t of CERT_TIERS) {
    const got = lessonsByTier[t];
    if (!got || !got.length) continue;
    const doneCount = CERT_TIER_LESSONS[t].filter((k) => tsMs(lessons[k]) != null).length;
    const last = got[got.length - 1];
    entries.push({
      kind: "cert",
      ref: "contacts/" + last.ref.split("/")[1] + "/certification/progress",
      date: ymd(last.at),
      text: "Completed " + got.length + " " + tierLabel(t) + " lesson" + (got.length === 1 ? "" : "s") +
            " (" + doneCount + "/" + CERT_TIER_LESSONS[t].length + " done).",
      points: READINESS_RULES.certLesson,
    });
  }

  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const rawPoints = roundHalf(entries.reduce((s, e) => s + (e.points || 0), 0));
  return { entries, rawPoints, workshopPoints, meetingLedger: ledger, notePoints };
}

function unratedNextStep(held) {
  if (!held || !held.length) return "";
  const d = ymd(held[0].at);
  return "Record how the " + d + " school meeting went (did it work, did the parent lead it) so the readiness check can count it.";
}

// ── Prompts ────────────────────────────────────────────────────────────────

const START_SYSTEM = [
  "You help LDAH (Leadership in Disabilities and Achievement of Hawaiʻi) parent advocates set a family's",
  "STARTING self-advocacy readiness score from the intake notes of a new case-advocacy file.",
  "",
  READINESS_RUBRIC,
  "",
  "For a STARTING score you may only use 0 to 6 (a family who needed an advocate is not yet at 7).",
  "Base it only on what the notes say about the PARENT's own knowledge and confidence, not the child's needs.",
  "You MUST quote, verbatim and exactly as written, the sentence from the notes that best supports the score,",
  "and give that note's date. If the notes say little, choose a cautious low score and say so in the reasoning.",
  "Write for the advocate: plain words, no jargon, one or two sentences of reasoning.",
].join("\n");

const START_TOOL = {
  name: "record_start_score",
  description: "Record the suggested starting readiness score.",
  input_schema: {
    type: "object",
    properties: {
      score: { type: "number", description: "0 to 6, in steps of 0.5" },
      quote: { type: "string", description: "Verbatim quote from the notes supporting the score" },
      sourceDate: { type: "string", description: "YYYY-MM-DD date of the note the quote comes from" },
      reasoning: { type: "string", description: "One or two plain sentences for the advocate" },
    },
    required: ["score", "quote", "sourceDate", "reasoning"],
  },
};

const CHECK_SYSTEM = [
  "You help LDAH (Leadership in Disabilities and Achievement of Hawaiʻi) parent advocates track how a family",
  "is growing toward advocating for their own child at school. You are running a FORWARD-ONLY check: you see",
  "the family's current state and ONLY the items that are new since the last check. Everything before was",
  "already scored; never re-score it.",
  "",
  READINESS_RUBRIC,
  "",
  "For each new workshop, meeting and certificate item, write one short plain line for staff (what happened,",
  "in the family's terms). The point amounts for those are fixed by code — echo them, do not invent others.",
  "For a meeting that didn't work, decide whether it is the SAME issue as one of the earlier meetings listed",
  "(set sameIssueAsRef and takeBack) — otherwise leave those empty.",
  "For notes, only include a note if it shows the parent's growing independence (or clearly losing it), with",
  "a verbatim quote. Leave out notes that earn nothing.",
  "Then give a one to three sentence reason for the change, and ONE short next step for the advocate —",
  "a concrete thing to do with this family to move them toward running their own meetings.",
  "Never include emails, phone numbers or the child's diagnosis details in what you write.",
].join("\n");

const CHECK_TOOL = {
  name: "record_readiness_check",
  description: "Record the forward-only readiness check.",
  input_schema: {
    type: "object",
    properties: {
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ref: { type: "string", description: "The item ref exactly as given" },
            text: { type: "string", description: "One plain line for staff" },
            points: { type: "number" },
            sameIssueAsRef: { type: "string", description: "Only for a meeting that didn't work: ref of the earlier meeting on the same issue" },
            takeBack: { type: "number", description: "Only with sameIssueAsRef: points to take back" },
            quote: { type: "string", description: "Only for notes: verbatim evidence from the note" },
          },
          required: ["ref", "text", "points"],
        },
      },
      reason: { type: "string" },
      nextStep: { type: "string" },
    },
    required: ["entries", "reason", "nextStep"],
  },
};

function fixedPointsHint(it) {
  if (it.kind === "workshop") return "+" + READINESS_RULES.workshopEach + " (subject to the workshop cap)";
  if (it.kind === "meeting") {
    const b = READINESS_RULES.meeting[it.meta.outcome] || 0;
    return "+" + (b + (it.meta.parentLed ? READINESS_RULES.parentLedBonus : 0));
  }
  if (it.kind === "cert") return it.meta.type === "tier" ? "+" + READINESS_RULES.certTier : "0";
  return "0, or up to +/-" + READINESS_RULES.notesMaxPerCheck + " with a quote";
}

// The check brief: compact state + ONLY the new items.
function buildCheckBrief({ doc, items, gates, certSum, sinceMs, lastReasons }) {
  const lines = [];
  lines.push("CURRENT STATE");
  lines.push("Score now: " + computeCurrentScore(Object.assign({}, doc, { gates })) +
    " (starting score " + effectiveStart(doc) + ", " + (typeof doc.startScore === "number" ? "confirmed by the advocate" : "suggested, not yet confirmed") + ")");
  lines.push("Gold certificate: " + (gates.goldCert ? "yes" : "no") + "; has led a school meeting: " + (gates.parentLedMeeting ? "yes" : "no"));
  lines.push("Certification: " + CERT_TIERS.map((t) => tierLabel(t) + " " + (certSum[t] || "0/6")).join(", "));
  lines.push("Workshop points so far: " + (doc.workshopPoints || 0) + " of " + READINESS_RULES.workshopCap);
  const ledger = (doc.meetingLedger || []).slice(-6);
  if (ledger.length) {
    lines.push("Earlier school meetings (for a same-issue take-back ONLY):");
    for (const m of ledger) {
      lines.push("  [" + m.ref + "] " + m.date + " " + m.outcome + ", " + m.points + " pts" +
        (m.takenBack ? " (" + m.takenBack + " already taken back)" : "") + " — " + (m.issue || ""));
    }
  }
  if (lastReasons && lastReasons.length) {
    lines.push("Last check reasons (newest first):");
    for (const r of lastReasons) lines.push("  - " + oneLine(stripPii(r), 300));
  }
  lines.push("");
  lines.push("NEW ITEMS SINCE " + (ymd(sinceMs) || "the case opened") + " (score these only):");
  for (const it of items) {
    const head = "[" + it.ref + "] " + it.kind.toUpperCase() + " " + ymd(it.at) + " — fixed points " + fixedPointsHint(it);
    lines.push(head);
    if (it.kind === "workshop") lines.push("  Attended: " + oneLine(it.meta.title, 160));
    if (it.kind === "meeting") {
      lines.push("  Outcome: " + it.meta.outcome + "; parent led it: " + (it.meta.parentLed ? "yes" : "no"));
      if (it.meta.summary) lines.push("  Summary: " + oneLine(stripPii(it.meta.summary), 300));
      if (it.meta.body) lines.push("  Notes: " + stripPii(it.meta.body).slice(0, 1500));
    }
    if (it.kind === "cert") {
      lines.push(it.meta.type === "tier" ? "  Earned the " + tierLabel(it.meta.tier) + " certificate" : "  Completed lesson " + it.meta.lesson + " (" + it.meta.tier + ")");
    }
    if (it.kind === "note") {
      const meta = [it.meta.interactionType, it.meta.channel, it.meta.who ? "by " + it.meta.who : ""].filter(Boolean).join(", ");
      if (meta) lines.push("  (" + meta + ")");
      if (it.meta.summary) lines.push("  Summary: " + oneLine(stripPii(it.meta.summary), 300));
      lines.push("  " + stripPii(it.meta.body).slice(0, 1500));
    }
  }
  return lines.join("\n").slice(0, 60000);
}

// Intake blocks for the start suggestion: every note on this family's records
// dated inside the first START_CONTEXT_DAYS of the case, oldest first.
function startSourceBlocks({ interactions, startedAtMs }) {
  const end = (startedAtMs || 0) + START_CONTEXT_DAYS * 86400000;
  const blocks = [];
  for (const x of interactions || []) {
    if (x.interactionType === "Event Attendance") continue;
    for (const b of parseNoteBlocks(x.notes, tsMs(x.createdAt))) {
      if (b.at == null || b.at > end) continue;
      blocks.push({ at: b.at, date: ymd(b.at), text: stripPii(b.text), summary: b.index === 0 ? stripPii(x.summary || "") : "" });
    }
  }
  blocks.sort((a, b) => a.at - b.at);
  const out = [];
  let chars = 0;
  for (const b of blocks) {
    if (out.length >= 12 || chars > 12000) break;
    out.push(b);
    chars += b.text.length;
  }
  return out;
}

function validateStartSuggestion(input, blocks) {
  const i = input || {};
  const score = Math.max(0, Math.min(READINESS_RULES.startMaxSuggested, roundHalf(i.score)));
  const quote = oneLine(stripPii(i.quote || ""), 400);
  const hit = quote.length >= 8 ? (blocks || []).find((b) => normForMatch(b.text + " " + b.summary).indexOf(normForMatch(quote)) !== -1) : null;
  let sourceDate = /^\d{4}-\d{2}-\d{2}$/.test(String(i.sourceDate || "")) ? i.sourceDate : "";
  if (hit) sourceDate = hit.date;
  return {
    score,
    quote: hit ? quote : "",
    quoteVerified: !!hit,
    sourceDate,
    reasoning: oneLine(stripPii(i.reasoning || ""), 600),
  };
}

// ── Model calls (streamed + forced tool, the _cgGenerateCaseReview pattern) ──

function _anthropicKey(name) {
  return String(process.env[name] || "").trim();
}

function _logAiError(where, e) {
  const cause = (e && e.cause) || {};
  // Deliberately NOT logging cause.message: when a bad header value is the
  // cause, the runtime puts the offending value — the API key — in it.
  console.error(where + " failed:", e && e.message,
    "| name=" + (e && e.name) + " status=" + (e && e.status) +
    " causeCode=" + (cause.code || "none") + " causeErrno=" + (cause.errno || "none"));
}

async function _callTool(client, { system, tool, text, maxTokens }) {
  const stream = client.messages.stream({
    model: ADVOCACY_READINESS_MODEL,
    max_tokens: maxTokens || 4000,
    system,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content: [{ type: "text", text }] }],
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === "max_tokens") throw new Error("model response truncated at max_tokens");
  const use = (response.content || []).find((b) => b.type === "tool_use");
  if (!use || !use.input) throw new Error("model returned no tool call");
  return use.input;
}

function makeClient() {
  return new Anthropic({ apiKey: _anthropicKey("ANTHROPIC_API_KEY") });
}

async function suggestStart({ client, interactions, startedAtMs }) {
  const blocks = startSourceBlocks({ interactions, startedAtMs });
  if (!blocks.length) return null;
  const text = "Intake notes for this case-advocacy family, oldest first:\n\n" +
    blocks.map((b) => "[" + b.date + "]" + (b.summary ? " " + oneLine(b.summary, 200) : "") + "\n" + b.text.slice(0, 3000)).join("\n\n");
  const input = await _callTool(client, { system: START_SYSTEM, tool: START_TOOL, text, maxTokens: 1500 });
  const v = validateStartSuggestion(input, blocks);
  return Object.assign(v, {
    generatedAt: admin.firestore.Timestamp.now(),
    model: ADVOCACY_READINESS_MODEL,
  });
}

// ── Firestore orchestration ────────────────────────────────────────────────

function _db() { return admin.firestore(); }

async function _getEvent(db, cache, collection, id) {
  const key = collection + "/" + id;
  if (key in cache) return cache[key];
  let data = null;
  try {
    const s = await db.collection(collection).doc(id).get();
    data = s.exists ? (s.data() || {}) : null;
  } catch (e) { data = null; }
  cache[key] = data;
  return data;
}

async function loadFamilyData(db, contactId, interactions, eventCache) {
  const suSnap = await db.collectionGroup("signups").where("linkedContactId", "==", contactId).get();
  const signups = [];
  for (const d of suSnap.docs) {
    const parent = d.ref.parent.parent;
    if (!parent) continue;                           // root `signups` is legacy/empty
    const eventCollection = parent.parent.id;
    const event = await _getEvent(db, eventCache, eventCollection, parent.id);
    signups.push({ path: d.ref.path, data: d.data() || {}, eventId: parent.id, eventCollection, event });
  }

  const events = {};
  for (const x of interactions) {
    if (x.interactionType !== "Event Attendance" || !x.relatedEventId) continue;
    const ev = await _getEvent(db, eventCache, "events", x.relatedEventId);
    events["events/" + x.relatedEventId] = ev;
    if (!ev) events["recurringEvents/" + x.relatedEventId] = await _getEvent(db, eventCache, "recurringEvents", x.relatedEventId);
  }

  const cRef = db.collection("contacts").doc(contactId);
  const [progSnap, certSnap] = await Promise.all([
    cRef.collection("certification").doc("progress").get(),
    cRef.collection("certificates").get(),
  ]);
  const certificates = {};
  certSnap.forEach((d) => { certificates[d.id] = d.data() || {}; });
  const cert = { progress: progSnap.exists ? (progSnap.data() || {}) : {}, certificates };
  return { signups, events, cert };
}

function _identity(family) {
  return {
    contactId: family.contactId,
    contactName: family.contactName || "",
    caseInteractionId: family.caseInteractionId || "",
    advocateName: family.advocateName || "",
    advocateUid: family.advocateUid || "",
  };
}

async function createReadinessDoc({ db, client, family, interactions, cert }) {
  const ref = db.collection(READINESS_COLLECTION).doc(family.contactId);
  let startSuggested = null;
  try {
    startSuggested = await suggestStart({ client, interactions, startedAtMs: family.startedAtMs });
  } catch (e) {
    _logAiError("advocacyReadiness start suggestion for " + family.contactId, e);
  }
  const gates = computeGates({ certificates: cert.certificates, progress: cert.progress, interactions });
  const base = { startScore: null, startSuggested, sumDelta: 0, gates };
  const startMs = family.startedAtMs || Date.now();
  const now = admin.firestore.FieldValue.serverTimestamp();
  // create() fails if the doc exists — never overwrite a start the UI confirmed.
  await ref.create(Object.assign(_identity(family), {
    startScore: null,
    startSuggested,
    sumDelta: 0,
    currentScore: computeCurrentScore(base),
    gates,
    certSummary: certSummary(cert.progress, cert.certificates),
    lastCheckedAt: admin.firestore.Timestamp.fromMillis(startMs),
    lastMovedAt: null,
    lastRunAt: null,
    nextStep: "Confirm the starting score from the intake notes.",
    status: "active",
    workshopPoints: 0,
    meetingLedger: [],
    scoredRefs: [],
    unratedMeetings: [],
    createdAt: now,
    updatedAt: now,
  }));
  return { action: "created", startSuggested: startSuggested ? startSuggested.score : null };
}

function isDue(doc, nowMs, force) {
  if (force) return true;
  const last = tsMs(doc.lastRunAt) || tsMs(doc.lastCheckedAt) || 0;
  return nowMs - last >= CHECK_INTERVAL_HOURS * 3600 * 1000;
}

async function runCheck({ db, client, family, interactions, data, doc, trigger }) {
  const ref = db.collection(READINESS_COLLECTION).doc(family.contactId);
  const nowMs = Date.now();
  const sinceMs = tsMs(doc.lastCheckedAt) || family.startedAtMs || 0;
  const { cert } = data;

  // A family created while the model was down has no suggestion; retry it
  // before checking (only while no advocate has confirmed a start).
  let startSuggestedPatch = null;
  if (typeof doc.startScore !== "number" && !(doc.startSuggested && typeof doc.startSuggested.score === "number")) {
    try {
      startSuggestedPatch = await suggestStart({ client, interactions, startedAtMs: family.startedAtMs });
    } catch (e) { _logAiError("advocacyReadiness start retry for " + family.contactId, e); }
    if (startSuggestedPatch) doc = Object.assign({}, doc, { startSuggested: startSuggestedPatch });
  }

  const all = buildAllItems({ contactId: family.contactId, interactions, signups: data.signups, events: data.events, cert });
  const sel = selectNewItems({
    allItems: all.items, unratedMeetings: all.unratedMeetings,
    sinceMs, nowMs, scoredRefs: doc.scoredRefs,
  });
  const gates = computeGates({ certificates: cert.certificates, progress: cert.progress, interactions });
  const certSum = certSummary(cert.progress, cert.certificates);

  let proposal = { entries: [], reason: "", nextStep: "" };
  if (sel.items.length) {
    let lastReasons = [];
    try {
      const prev = await ref.collection("checks").orderBy("checkedAt", "desc").limit(3).get();
      lastReasons = prev.docs.map((d) => (d.data() || {}).reason).filter(Boolean);
    } catch (e) { /* context only */ }
    const brief = buildCheckBrief({ doc, items: sel.items, gates, certSum, sinceMs, lastReasons });
    // Throws on failure: the check is abandoned, the checkpoint does not move.
    proposal = await _callTool(client, { system: CHECK_SYSTEM, tool: CHECK_TOOL, text: brief, maxTokens: 6000 });
  }

  const applied = applyRules({
    items: sel.items, proposal,
    state: { workshopPoints: doc.workshopPoints || 0, meetingLedger: doc.meetingLedger || [] },
    progress: cert.progress,
  });
  const scoredRefs = nextScoredRefs(doc.scoredRefs, sel.items, sel.untilMs);
  const reason = sel.items.length
    ? oneLine(stripPii(proposal.reason || ""), 600) || "Scored " + sel.items.length + " new item(s)."
    : "Nothing new since " + ymd(sinceMs) + ".";
  let nextStep = unratedNextStep(sel.held) ||
    (sel.items.length ? oneLine(stripPii(proposal.nextStep || ""), 240) : "") ||
    doc.nextStep || "";

  const checkRef = ref.collection("checks").doc();
  let result = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? (snap.data() || {}) : null;
    if (!cur) throw new Error("readiness doc vanished");
    // Another run (sweep vs manual) got here first — do not score twice.
    if ((tsMs(cur.lastCheckedAt) || 0) !== (tsMs(doc.lastCheckedAt) || 0)) throw new Error("CONCURRENT_CHECK");
    // Score math on the doc as it is NOW (staff may have just changed startScore).
    const basis = Object.assign({}, cur, startSuggestedPatch ? { startSuggested: startSuggestedPatch } : {});
    const fin = finalizeScore(Object.assign({}, basis, { gates: cur.gates || gates }), applied.rawPoints, gates);
    const nowTs = admin.firestore.Timestamp.fromMillis(nowMs);
    const checkDoc = {
      checkedAt: nowTs,
      sinceAt: admin.firestore.Timestamp.fromMillis(sinceMs),
      untilAt: admin.firestore.Timestamp.fromMillis(sel.untilMs),
      itemCount: sel.items.length,
      scoreBefore: fin.scoreBefore,
      scoreAfter: fin.scoreAfter,
      delta: fin.delta,
      entries: applied.entries,
      reason,
      model: sel.items.length ? ADVOCACY_READINESS_MODEL : "",
      // additive:
      rawPoints: applied.rawPoints,
      heldForMeetings: sel.held.map((m) => m.ref),
      trigger: trigger || "sweep",
    };
    const update = Object.assign(_identity(family), {
      sumDelta: fin.sumDelta,
      currentScore: fin.scoreAfter,
      gates,
      certSummary: certSum,
      lastCheckedAt: admin.firestore.Timestamp.fromMillis(sel.untilMs),
      lastRunAt: nowTs,
      nextStep,
      status: "active",
      workshopPoints: applied.workshopPoints,
      meetingLedger: applied.meetingLedger,
      scoredRefs,
      unratedMeetings: sel.held.map((m) => ({ ref: m.ref, date: ymd(m.at) })),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (fin.delta !== 0) update.lastMovedAt = nowTs;
    if (startSuggestedPatch) update.startSuggested = startSuggestedPatch;
    tx.set(checkRef, checkDoc);
    tx.set(ref, update, { merge: true });
    result = { action: "checked", itemCount: sel.items.length, scoreBefore: fin.scoreBefore, scoreAfter: fin.scoreAfter, delta: fin.delta, held: sel.held.length };
  });
  return result;
}

// One family. mode: 'sweep' (create OR check, never both) | 'manual'.
async function processFamily({ db, client, family, interactions, eventCache, nowMs, force, mode }) {
  const ref = db.collection(READINESS_COLLECTION).doc(family.contactId);
  const snap = await ref.get();
  const doc = snap.exists ? (snap.data() || {}) : null;

  if (!family.open) {
    if (doc && doc.status !== "closed") {
      await ref.set({ status: "closed", updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return { contactId: family.contactId, action: "closed" };
    }
    return { contactId: family.contactId, action: "skipped", why: "case closed" };
  }

  const data = await loadFamilyData(db, family.contactId, interactions, eventCache);
  if (!doc) {
    const r = await createReadinessDoc({ db, client, family, interactions, cert: data.cert });
    if (mode === "manual" && force) {
      const fresh = (await ref.get()).data() || {};
      const c = await runCheck({ db, client, family, interactions, data, doc: fresh, trigger: "manual" });
      return Object.assign({ contactId: family.contactId }, c, { created: true, startSuggested: r.startSuggested });
    }
    return Object.assign({ contactId: family.contactId }, r);
  }
  if (doc.status === "closed") {
    // Re-opened case: show it as active straight away; the check follows on cadence.
    await ref.set({ status: "active", updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }
  if (!isDue(doc, nowMs, force)) {
    return { contactId: family.contactId, action: "skipped", why: "checked within " + CHECK_INTERVAL_HOURS + "h" };
  }
  const c = await runCheck({ db, client, family, interactions, data, doc, trigger: mode === "manual" ? "manual" : "sweep" });
  return Object.assign({ contactId: family.contactId }, c);
}

// Families to process, oldest-checked first so a sweep that runs out of time
// picks up where it left off next day.
async function listFamilies(db, contactId) {
  let docs;
  if (contactId) {
    docs = (await db.collection("interactions").where("contactId", "==", contactId).get()).docs;
  } else {
    // Read all and filter in memory, as the report does: advocacy is identified
    // by a flag OR a type OR a workflow step, which one where() cannot express.
    docs = (await db.collection("interactions").get()).docs;
  }
  const all = docs.map((d) => Object.assign({ id: d.id }, d.data() || {}));
  const byContact = {};
  for (const x of all) if (x.contactId) (byContact[x.contactId] = byContact[x.contactId] || []).push(x);
  const { families, orphanRecords } = groupAdvocacyFamilies(all);
  return { families, byContact, orphanRecords };
}

async function runReadiness({ contactId, force, mode }) {
  const db = _db();
  const started = Date.now();
  const client = makeClient();
  const listed = await listFamilies(db, contactId);
  const byContact = listed.byContact, orphanRecords = listed.orphanRecords;
  /* PIP cases are never scored (Daniel 2026-09-25): each partner manages their
     own, they are off the LDAH report, and scoring them only spends AI calls.
     A family is PIP if any of its advocacy records, or its contact, carries a
     partnerIsland stamp. */
  const families = [];
  for (const f of listed.families) {
    let pip = (byContact[f.contactId] || []).some((r) => !!r.partnerIsland);
    if (!pip) {
      try {
        const cs = await db.collection("contacts").doc(f.contactId).get();
        pip = !!(cs.exists && (cs.data() || {}).partnerIsland);
      } catch (e) { /* unknown: score it, as before */ }
    }
    if (!pip) families.push(f);
  }

  // Order: stale first (by existing doc lastRunAt), new families before that.
  const lastRun = {};
  try {
    const rs = await db.collection(READINESS_COLLECTION).get();
    rs.forEach((d) => { const x = d.data() || {}; lastRun[d.id] = tsMs(x.lastRunAt) || tsMs(x.lastCheckedAt) || 0; });
  } catch (e) { /* ordering only */ }
  families.sort((a, b) => (lastRun[a.contactId] || 0) - (lastRun[b.contactId] || 0));

  const eventCache = {};
  const results = [];
  let i = 0, deferred = 0;
  async function worker() {
    while (i < families.length) {
      if (Date.now() - started > SWEEP_TIME_BUDGET_MS) { deferred = families.length - i; i = families.length; return; }
      const family = families[i++];
      try {
        results.push(await processFamily({
          db, client, family, interactions: byContact[family.contactId] || [],
          eventCache, nowMs: Date.now(), force: !!force, mode,
        }));
      } catch (e) {
        if (e && e.message === "CONCURRENT_CHECK") {
          results.push({ contactId: family.contactId, action: "skipped", why: "another run checked it first" });
        } else {
          _logAiError("advocacyReadiness family " + family.contactId, e);
          results.push({ contactId: family.contactId, action: "error", error: String((e && e.message) || e).slice(0, 200) });
        }
      }
    }
  }
  await Promise.all(Array.from({ length: SWEEP_CONCURRENCY }, worker));

  const count = (a) => results.filter((r) => r.action === a).length;
  const summary = {
    families: families.length,
    created: count("created") + results.filter((r) => r.created).length,
    checked: count("checked"),
    closed: count("closed"),
    skipped: count("skipped"),
    errors: count("error"),
    deferred,
    orphanRecords,
    ms: Date.now() - started,
    results,
  };
  console.log("advocacyReadiness " + mode + ": families=" + summary.families + " created=" + summary.created +
    " checked=" + summary.checked + " closed=" + summary.closed + " skipped=" + summary.skipped +
    " errors=" + summary.errors + " deferred=" + deferred + " orphanRecords=" + orphanRecords);
  return summary;
}

// ── Exports: scheduled sweep + manual callable ─────────────────────────────

const sweepAdvocacyReadiness = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB", maxInstances: 1, secrets: ["ANTHROPIC_API_KEY"] })
  // Monday, Wednesday and Friday mornings (2026-10-01): still three checks a week,
  // but on the days the staff actually work their cases. Was daily + a 44h gate.
  .pubsub.schedule("0 6 * * 1,3,5")
  .timeZone("Pacific/Honolulu")
  .onRun(async () => {
    const db = _db();
    const cfg = await db.doc(READINESS_CONFIG_PATH).get();
    if (!cfg.exists || (cfg.data() || {}).armed !== true) {
      console.log("sweepAdvocacyReadiness: DISARMED (" + READINESS_CONFIG_PATH + ".armed !== true) — nothing done");
      return null;
    }
    await runReadiness({ mode: "sweep" });
    return null;
  });

const runAdvocacyReadinessNow = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB", maxInstances: 2, secrets: ["ANTHROPIC_API_KEY"] })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
    const roleSnap = await _db().collection("userRoles").doc(context.auth.uid).get();
    const role = roleSnap.exists ? ((roleSnap.data() || {}).role || "") : "";
    if (role !== "superAdmin") throw new functions.https.HttpsError("permission-denied", "Super Admin only.");
    const d = data || {};
    const contactId = typeof d.contactId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(d.contactId) ? d.contactId : "";
    if (d.contactId && !contactId) throw new functions.https.HttpsError("invalid-argument", "Bad contactId.");
    const summary = await runReadiness({ contactId, force: d.force === true, mode: "manual" });
    return summary;
  });

module.exports = {
  sweepAdvocacyReadiness,
  runAdvocacyReadinessNow,
  // routines
  runReadiness,
  processFamily,
  // pure helpers (tested in test/advocacy-readiness.test.js)
  ADVOCACY_READINESS_MODEL,
  READINESS_RULES,
  READINESS_RUBRIC,
  CERT_TIER_LESSONS,
  CHECK_INTERVAL_HOURS,
  roundHalf,
  tsMs,
  ymd,
  effectiveStart,
  scoreCap,
  clampScore,
  computeCurrentScore,
  finalizeScore,
  stripPii,
  parseNoteStamp,
  parseNoteBlocks,
  normOutcome,
  isAdvocacyRecord,
  groupAdvocacyFamilies,
  isWorkshopEvent,
  attendedSessions,
  certSummary,
  computeGates,
  buildAllItems,
  selectNewItems,
  nextCheckpoint,
  nextScoredRefs,
  applyRules,
  isDue,
  buildCheckBrief,
  startSourceBlocks,
  validateStartSuggestion,
};
