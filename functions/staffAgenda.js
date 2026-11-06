"use strict";
/* Meeting agendas on Staff Calendar only entries (Daniel 2026-11-06).

   An entry in staffCalendar with agendaOn: true collects agenda items for each
   date it falls on. Each date's agenda lives on the entry under
   agendas["YYYY-MM-DD"] = { items: [{id, text, byUid, byName, at}], notes,
   files: [{name, path, type, size, byName, at}], sentAt }.

   Monday 8am HST every participant gets a task to add their items for any
   meeting in the next 7 days. 3pm HST the day before the meeting the person in
   agendaToUid (Rosie by default) gets the finished agenda as a task, and the
   participants' open tasks are closed. Pure helpers here; the scheduled and
   HTTP functions are in index.js. */

const ROSIE_UID = "rorJEIUS4sX7jYgzqORK8G7iPdM2";
const AGENDA_MIME_EXT = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/jpeg": "jpg",
  "image/png": "png",
};
const AGENDA_MAX_BYTES = 25 * 1024 * 1024;

const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
function isoOf(d) {
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}
function parseIso(iso) {
  const p = iso.split("-").map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
}
function addDaysIso(iso, n) {
  const d = parseIso(iso); d.setUTCDate(d.getUTCDate() + n); return isoOf(d);
}

/* Same rule as the DAN calendar (window._staffCalDates): repeat '' | weekly |
   biweekly | monthly (same nth weekday), optional repeatUntil, skipDates. */
function entryDates(x, fromIso, toIso) {
  if (!x || !isIso(x.date)) return [];
  const until = isIso(x.repeatUntil) ? x.repeatUntil : "";
  const end = until && until < toIso ? until : toIso;
  const skip = new Set(Array.isArray(x.skipDates) ? x.skipDates : []);
  const out = [];
  if (!x.repeat) { if (x.date >= fromIso && x.date <= toIso) out.push(x.date); return out; }
  const first = parseIso(x.date);
  if (x.repeat === "monthly") {
    const nth = Math.ceil(first.getUTCDate() / 7), wd = first.getUTCDay();
    for (let m = 0; m < 240; m++) {
      const d1 = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + m, 1));
      const day = 1 + ((wd - d1.getUTCDay() + 7) % 7) + (nth - 1) * 7;
      const dt = new Date(Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth(), day));
      if (dt.getUTCMonth() !== d1.getUTCMonth()) continue;
      const iso = isoOf(dt);
      if (iso > end) break;
      if (iso >= fromIso && !skip.has(iso)) out.push(iso);
    }
    return out;
  }
  const step = x.repeat === "biweekly" ? 14 : 7;
  for (let i = 0; i < 1500; i++) {
    const iso = addDaysIso(x.date, i * step);
    if (iso > end) break;
    if (iso >= fromIso && !skip.has(iso)) out.push(iso);
  }
  return out;
}

function niceDate(iso) {
  return parseIso(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}
function participantsOf(entry) {
  const seen = new Set();
  return (Array.isArray(entry.participants) ? entry.participants : []).filter((p) => {
    if (!p || !p.uid || seen.has(p.uid)) return false;
    seen.add(p.uid); return true;
  });
}
function agendaToOf(entry) {
  return { uid: entry.agendaToUid || ROSIE_UID, name: entry.agendaToName || "Rosie Rowe" };
}

// Who may open a meeting's agenda: the ticked participants and the
// finished-agenda person. Nobody else, whatever their role (2026-11-06).
function isMember(entry, uid) {
  if (!uid || !entry) return false;
  if (entry.agendaToUid === uid) return true;
  if (Array.isArray(entry.participantUids) && entry.participantUids.indexOf(uid) !== -1) return true;
  return (Array.isArray(entry.participants) ? entry.participants : []).some((p) => p && p.uid === uid);
}

const askTaskId = (entryId, date, uid) => "agendaAsk__" + entryId + "__" + date + "__" + uid;
const finalTaskId = (entryId, date) => "agendaFinal__" + entryId + "__" + date;

function baseTask(entryId, date) {
  return {
    channel: "Other", interactionType: "Meeting agenda", workflowStep: "staffAgenda",
    agendaEntryId: entryId, agendaDate: date,
    contactId: "", contactName: "", contactType: "",
    status: "Open", isDraft: false, urgent: false, createdBy: "System",
  };
}

/* The Monday ask. Due the day before the meeting (today when that has passed). */
function askTask(entryId, entry, date, person, todayIso) {
  const due = addDaysIso(date, -1) < todayIso ? todayIso : addDaysIso(date, -1);
  return Object.assign(baseTask(entryId, date), {
    summary: "Add your agenda items for " + (entry.title || "the meeting") + " (" + niceDate(date) + ")",
    notes: "1. Press Open agenda.\n" +
           "2. Type each thing you want to talk about and press Add.\n" +
           "3. Tick this task done.\n\n" +
           "The agenda goes to " + agendaToOf(entry).name + " at 3pm on " + niceDate(addDaysIso(date, -1)) + ".",
    followUpDate: due, owner: person.name || "", ownerUid: person.uid,
  });
}

function agendaText(agenda) {
  const a = agenda || {};
  const items = Array.isArray(a.items) ? a.items : [];
  const files = Array.isArray(a.files) ? a.files : [];
  let t = items.length
    ? items.map((it, i) => (i + 1) + ". " + String(it.text || "").trim() + (it.byName ? " (" + it.byName + ")" : "")).join("\n")
    : "Nobody has added an item yet.";
  if (files.length) t += "\n\nBase agenda: " + files.map((f) => f.name).join(", ");
  return t;
}

/* The finished agenda for the agendaTo person, the day before the meeting. */
function finalTask(entryId, entry, date, agenda) {
  const to = agendaToOf(entry);
  const n = ((agenda && agenda.items) || []).length;
  return Object.assign(baseTask(entryId, date), {
    summary: "Agenda for " + (entry.title || "the meeting") + " (" + niceDate(date) + "): " + n + (n === 1 ? " item" : " items"),
    // No item text in the task: tasks can be seen by other staff, the agenda
    // is private to the meeting (2026-11-06).
    notes: (n ? n + (n === 1 ? " item is" : " items are") + " on the agenda." : "Nobody has added an item yet.") +
           "\n\nPress Open agenda to read them, build the master agenda, upload it there for everyone in the meeting, and take meeting notes.",
    followUpDate: date, owner: to.name, ownerUid: to.uid,
  });
}

module.exports = {
  ROSIE_UID, AGENDA_MIME_EXT, AGENDA_MAX_BYTES,
  isIso, addDaysIso, entryDates, niceDate, participantsOf, agendaToOf,
  askTaskId, finalTaskId, askTask, finalTask, agendaText, isMember,
};
