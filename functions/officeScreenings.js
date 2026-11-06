"use strict";
/* Office Screenings (Daniel 2026-11-06).

   Staff open a day at the LDAH office (officeScreeningDays/{YYYY-MM-DD}) with
   15-minute times. Families book one time per child from School Readiness on
   the website and in the app; signing the Outreach Screening Consent books it.
   A time is locked by officeScreeningSlots/{date}_{time} inside a transaction
   so two families can never get the same time.

   Pure helpers only. The HTTP and scheduled functions are in index.js. */

const OFFICE_LOCATION = "LDAH Office";
const OFFICE_ADDRESS = "245 N Kukui St, Suite 205, Honolulu";
const OFFICE_PHONE = "(808) 536-9684";
const SLOT_MINUTES = 15;
const HOLD_MINUTES = 10;
const LEAD_TASK_DAYS = 7;
const REMINDER_FROM_MIN = 9 * 60;   // 9:00 AM HST the day before
const NOSHOW_FROM_MIN = 8 * 60;     // 8:00 AM HST the day after
const HST_OFFSET_MS = 10 * 60 * 60 * 1000; // Hawaii has no daylight saving

/* Family links. The website pages pass site:'stage' while they are being tested
   on www.ldahawaii.org/STAGE/; the booking remembers it so every later email
   (reminder, no-show) points at the same copy. Anything else is live. */
const LINKS = {
  live: {
    manage: "https://www.ldahawaii.org/readiness/booking.html",
    book: "https://www.ldahawaii.org/readiness.html#book",
  },
  stage: {
    manage: "https://www.ldahawaii.org/STAGE/readiness/booking.html",
    book: "https://www.ldahawaii.org/STAGE/readiness.html#book",
  },
};
function siteOf(v) { return v === "stage" ? "stage" : "live"; }
function manageUrl(site, token, action) {
  return LINKS[siteOf(site)].manage + "?t=" + encodeURIComponent(token) + (action ? "&action=" + encodeURIComponent(action) : "");
}
function bookUrl(site) { return LINKS[siteOf(site)].book; }

const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));
function parseIso(iso) { const p = iso.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
function isoOf(d) {
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}
function addDaysIso(iso, n) { const d = parseIso(iso); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); }

function toMin(t) { const p = String(t).split(":").map(Number); return p[0] * 60 + p[1]; }
function fromMin(m) { return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }

/* Today's date and minutes past midnight in Honolulu. */
function hstNow(nowMs) {
  const d = new Date((nowMs == null ? Date.now() : nowMs) - HST_OFFSET_MS);
  return { date: isoOf(d), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
/* Epoch ms of a Honolulu wall-clock time. */
function hstMs(date, time) { return parseIso(date).getTime() + toMin(time || "00:00") * 60000 + HST_OFFSET_MS; }

/* '14:30' -> '2:30' (short, time grid) and '2:30 PM' (full). */
function timeLabel(t) { const m = toMin(t), h = Math.floor(m / 60) % 12 || 12; return h + ":" + String(m % 60).padStart(2, "0"); }
function timeLabelFull(t) { return timeLabel(t) + (toMin(t) >= 720 ? " PM" : " AM"); }
/* 'Wed, Nov 11' and 'Wednesday, November 11'. */
function dayLabel(iso) { return parseIso(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); }
function dayLabelLong(iso) { return parseIso(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }); }
/* 'Wed, Nov 11, 2:00 to 4:00 PM' (the 2:00 keeps its AM/PM when it differs). */
function dayRangeLabel(day) {
  const s = timeLabelFull(day.start), e = timeLabelFull(day.end);
  const same = s.slice(-2) === e.slice(-2);
  return dayLabel(day.date) + ", " + (same ? timeLabel(day.start) : s) + " to " + e;
}

/* Every time a family can book on a day: start, start+15 ... < end, minus closedTimes. */
function daySlots(day) {
  if (!day || !isTime(day.start) || !isTime(day.end)) return [];
  const step = Number(day.slotMinutes) > 0 ? Number(day.slotMinutes) : SLOT_MINUTES;
  const closed = new Set(Array.isArray(day.closedTimes) ? day.closedTimes : []);
  const out = [];
  for (let m = toMin(day.start); m < toMin(day.end); m += step) {
    const t = fromMin(m);
    if (!closed.has(t)) out.push(t);
  }
  return out;
}

/* Cutoff + same-day rule. Families book up to 23:59 HST the day before. On
   the day itself only when that day already has a booked child, and never a
   time that has already started. Staff (staff:true) skip the cutoff but still
   can't book a time that has started. */
function canBook({ date, time, today, nowMin, bookedCount, staff }) {
  if (!isIso(date) || !isTime(time) || date < today) return false;
  if (date > today) return true;
  if (toMin(time) <= nowMin) return false;
  return staff ? true : Number(bookedCount) >= 1;
}

const slotId = (date, time) => date + "_" + time;
function tsMs(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v === "number") return v;
  if (typeof v._seconds === "number") return v._seconds * 1000;
  if (typeof v.seconds === "number") return v.seconds * 1000;
  return 0;
}
/* Is a lock in the way of `bookingId`? A held lock stops counting once it expires. */
function slotTaken(lock, nowMs, bookingId) {
  if (!lock || !lock.bookingId) return false;
  if (bookingId && lock.bookingId === bookingId) return false;
  if (lock.status === "booked") return true;
  return lock.status === "held" && tsMs(lock.holdExpiresAt) > nowMs;
}

/* The public times list for one day. locks = officeScreeningSlots docs for it. */
function dayTimes(day, locks, now) {
  const all = daySlots(day);
  const byTime = {};
  (locks || []).forEach((l) => { if (l && l.time) byTime[l.time] = l; });
  const booked = (locks || []).filter((l) => l && l.status === "booked").length;
  const times = [];
  all.forEach((t) => {
    if (!canBook({ date: day.date, time: t, today: now.date, nowMin: now.minutes, bookedCount: booked })) return;
    times.push({ time: t, label: timeLabel(t), open: !slotTaken(byTime[t], now.ms) });
  });
  return { date: day.date, label: dayLabel(day.date), times, openCount: times.filter((x) => x.open).length, bookedCount: booked };
}

/* '(808) •••-••23'. Empty when there is nothing usable. */
function maskPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  if (d.length < 4) return "";
  const last2 = d.slice(-2);
  if (d.length === 10) return "(" + d.slice(0, 3) + ") •••-••" + last2;
  if (d.length === 7) return "•••-••" + last2;
  return "••• ••" + last2;
}
/* 'Kaneohe 96744' — never the street. */
function addressHint(c) {
  const city = String((c && c.city) || "").trim();
  const zip = String((c && (c.zipCode || c.zip)) || "").trim();
  return (city + " " + zip).trim();
}
function hasAddress(c) { return !!(c && (String(c.streetAddress || "").trim() || addressHint(c))); }

/* Children on file: past screenings (newest first, richest) then contacts.children[].
   Deduped by first + last name. */
function familyChildren(contact) {
  const c = contact || {};
  const out = [];
  const seen = new Set();
  const key = (f, l) => (String(f || "") + "|" + String(l || "")).toLowerCase().replace(/[^a-z|]+/g, "");
  const add = (ch) => {
    if (!ch.firstName) return;
    const k = key(ch.firstName, ch.lastName);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(ch);
  };
  const scr = Array.isArray(c.screenings) ? c.screenings.slice().reverse() : [];
  scr.forEach((s) => {
    const ch = (s && s.child) || {};
    if (String(ch.firstName || "").trim().toLowerCase() === "self") return;
    add({
      firstName: String(ch.firstName || "").trim(), middleName: String(ch.middleName || "").trim(),
      lastName: String(ch.lastName || "").trim(), gender: String(ch.gender || ""),
      nativeHawaiian: String(ch.nativeHawaiian || ""), ethnicity: String(ch.ethnicity || ""),
    });
  });
  (Array.isArray(c.children) ? c.children : []).forEach((ch) => {
    if (!ch) return;
    let first = String(ch.firstName || "").trim(), last = String(ch.lastName || "").trim(), middle = "";
    if (!first) {
      const parts = String(ch.name || "").trim().split(/\s+/).filter(Boolean);
      first = parts[0] || "";
      if (parts.length > 2) { middle = parts.slice(1, -1).join(" "); last = parts[parts.length - 1]; } else last = parts[1] || "";
    }
    add({ firstName: first, middleName: middle, lastName: last, gender: String(ch.gender || ch.childGender || ""),
      nativeHawaiian: "", ethnicity: String(ch.ethnicity || "") });
  });
  return out.map((ch, i) => Object.assign({ key: "c" + i }, ch));
}

/* Did the child on this screening get screened? Any finished part, or a
   screenedAt stamp, counts. Otherwise (nothing, or only absent marks) it is a no-show. */
function screeningOutcome(s, isComplete) {
  const r = (s && s.results) || null;
  if (!r) return "noshow";
  const parts = isComplete ? isComplete(s) : null;
  if (parts && (parts.vision === "done" || parts.hearing === "done")) return "screened";
  if (r.screenedAt && !(s.absent && (s.absent.vision || s.absent.hearing))) return "screened";
  return "noshow";
}

/* Reminder: at/after 9:00 HST the day before, once, booked only. A family who
   booked (or moved) today has just had the confirmation, so they are skipped. */
function reminderDue(b, now) {
  if (!b || b.status !== "booked" || b.reminderSentAt || !b.email) return false;
  if (b.date !== addDaysIso(now.date, 1) || now.minutes < REMINDER_FROM_MIN) return false;
  const conf = tsMs(b.confirmationSentAt);
  return !(conf && hstNow(conf).date === now.date);
}
/* No-show check runs from 08:00 HST the day after. */
function noShowDue(b, now) {
  if (!b || b.status !== "booked" || !isIso(b.date)) return false;
  const next = addDaysIso(b.date, 1);
  return now.date > next || (now.date === next && now.minutes >= NOSHOW_FROM_MIN);
}

/* The lead screener's My Day task. Exists from 7 days before (or straight away
   when the day was opened later) until the day; closed after it. */
const leadTaskId = (date) => "officeLead__" + date;
function leadTaskWanted(day, today) {
  return !!(day && day.published === true && day.leadUid && isIso(day.date) &&
    day.date >= today && addDaysIso(day.date, -LEAD_TASK_DAYS) <= today);
}
function leadTask(day, bookedCount, today) {
  const n = Number(bookedCount) || 0;
  const due = addDaysIso(day.date, -1) < today ? today : addDaysIso(day.date, -1);
  return {
    channel: "Other", interactionType: "Office screening", workflowStep: "officeScreeningLead",
    officeScreeningDate: day.date,
    contactId: "", contactName: "", contactType: "",
    summary: "Office screenings " + dayRangeLabel(day) + ": you are the lead",
    notes: (n === 0 ? "No children booked yet." : n + (n === 1 ? " child" : " children") + " booked so far.") +
      " Check the list the day before and bring the screening kit and the tablet.\n\n" +
      "On the day, open the screening results page and pick " + OFFICE_LOCATION + ". Press See bookings for the list.",
    officeScreeningBookedCount: n,
    followUpDate: due, owner: day.leadName || "", ownerUid: day.leadUid,
    status: "Open", isDraft: false, urgent: false, createdBy: "System",
  };
}

/* The extra fields an office booking puts on the contact's screening. */
function screeningExtras({ date, time, bookingId }) {
  return {
    source: "office-screening",
    location: OFFICE_LOCATION,
    classroom: time,
    scheduled: { location: OFFICE_LOCATION, dates: [date], time: timeLabelFull(time) },
    officeBookingId: bookingId,
    officeBookingStatus: "booked",
  };
}

/* Line for the contact's Contact Notes (contacts.notes, a plain string that no
   report reads), in DAN's appended-note style. */
function noShowLine(b) {
  return "No-show: office screening " + dayLabel(b.date) + " at " + timeLabelFull(b.time) +
    (b.childFirstName ? " (" + b.childFirstName + ")" : "");
}
function appendNote(existing, stampIso, text) {
  const stamp = parseIso(stampIso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const block = "[System — " + stamp + "]\n" + text;
  const cur = String(existing || "").trim();
  return cur ? cur + "\n---\n" + block : block;
}

module.exports = {
  OFFICE_LOCATION, OFFICE_ADDRESS, OFFICE_PHONE, SLOT_MINUTES, HOLD_MINUTES, LEAD_TASK_DAYS, LINKS,
  siteOf, manageUrl, bookUrl, isIso, isTime, addDaysIso, toMin, fromMin, hstNow, hstMs,
  timeLabel, timeLabelFull, dayLabel, dayLabelLong, dayRangeLabel, daySlots, canBook, slotId, tsMs, slotTaken,
  dayTimes, maskPhone, addressHint, hasAddress, familyChildren, screeningOutcome, reminderDue, noShowDue,
  leadTaskId, leadTaskWanted, leadTask, screeningExtras, noShowLine, appendNote,
};
