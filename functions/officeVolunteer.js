// ═══════════════════════════════════════════════════════════════════════════
// In-office volunteering (2026-11-10)
//
// Staff set up office help in DAN (Volunteers → In-Office Help): the weekdays
// the office takes volunteers, the hours, how many can be in at once, the task
// list volunteers see, and one-off "special volunteer days" (event prep, big
// mailings) with their own hours and head count. Volunteers sign up on the
// website (STAGE/volunteer-office.html for now) for a weekday, every week or
// just once, or for a special day.
//
// STORAGE (Admin SDK only; neither the website nor DAN touches these
// collections directly, so no security rule changes are needed):
//   officeVolunteerSettings/main        { active, openDays[0-6], from, to,
//                                         maxAtOnce, tasks[{name,note}], updatedAt, updatedBy }
//   officeVolunteerSpecialDays/{id}     { date, from, to, note, max, createdAt, createdBy }
//   officeVolunteerSignups/{id}         { kind weekly|once|special, weekday, date,
//                                         specialDayId, start, minutes, email,
//                                         firstName, lastName, phone, notes,
//                                         isNew, volunteerId, status active|cancelled,
//                                         createdAt, cancelledAt, cancelledBy }
//
// Capacity is counted per half hour: a booking holds every 30-minute block
// from its start to its end, and no block may go over the limit (maxAtOnce for
// weekdays, the special day's own number for a special day). A weekly booking
// counts on every date of its weekday.
//
// The public schedule call returns bookings WITHOUT names or emails; only the
// staff call returns who is coming.
// ═══════════════════════════════════════════════════════════════════════════

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const crypto = require("crypto");

const SETTINGS = "officeVolunteerSettings";
const DAYS = "officeVolunteerSpecialDays";
const SIGNUPS = "officeVolunteerSignups";
const RATE = "volunteerLinkRequests";          // shared server-only rate-limit counters
const STAFF_ROLES = ["superAdmin", "admin", "webAdmin", "appAdmin"];
const DEFAULT_TASKS = [
  { name: "Filing", note: "Sorting and filing paperwork" },
  { name: "Brochure folders", note: "Folding and stuffing family folders" },
  { name: "Event prep", note: "Getting supplies ready for events" },
  { name: "Mailings", note: "Envelopes, labels and stamps" },
  { name: "Other office help", note: "Whatever needs doing that day" },
];
const ONCE_WEEKS = 8;                          // "just once" offers the next 8 dates

// ── Pure helpers ──────────────────────────────────────────────────────────
function cleanText(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max || 200);
}
function normEmail(v) { return String(v || "").trim().toLowerCase(); }
function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "")) && String(v).length <= 200; }
function sha(v) { return crypto.createHash("sha256").update(String(v)).digest("hex"); }
function pad2(n) { return (n < 10 ? "0" : "") + n; }
function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return NaN;
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? h * 60 + mi : NaN;
}
function fromMin(n) { return pad2(Math.floor(n / 60)) + ":" + pad2(n % 60); }
function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(Date.parse(s + "T00:00:00Z")); }
// Hawaii has no DST: UTC-10 always.
function hstToday(ms) {
  const d = new Date((ms == null ? Date.now() : ms) - 10 * 3600 * 1000);
  return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
}
function weekdayOf(dateKey) { return new Date(dateKey + "T00:00:00Z").getUTCDay(); }
function addDays(dateKey, n) {
  const d = new Date(dateKey + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function normSettings(x) {
  const s = x || {};
  const days = Array.isArray(s.openDays) ? s.openDays.map(Number).filter((n) => n >= 0 && n <= 6) : [];
  const tasks = Array.isArray(s.tasks)
    ? s.tasks.map((t) => (typeof t === "string" ? { name: cleanText(t, 60), note: "" } : { name: cleanText(t && t.name, 60), note: cleanText(t && t.note, 120) }))
      .filter((t) => t.name).slice(0, 20)
    : DEFAULT_TASKS.map((t) => Object.assign({}, t));
  return {
    active: s.active === true,
    openDays: [...new Set(days)].sort(),
    from: isNaN(toMin(s.from)) ? "08:00" : s.from,
    to: isNaN(toMin(s.to)) ? "16:30" : s.to,
    maxAtOnce: Math.max(1, Math.min(20, parseInt(s.maxAtOnce, 10) || 3)),
    tasks,
  };
}

// The 30-minute blocks a booking occupies: [startMin, startMin+30, ...).
function blocks(start, minutes) {
  const a = toMin(start), out = [];
  for (let t = a; t < a + minutes; t += 30) out.push(t);
  return out;
}

// Highest head count in any block a new booking would occupy, among the
// bookings that apply to the given occurrence.
function peakLoad(applying, start, minutes) {
  const want = new Set(blocks(start, minutes));
  const load = {};
  applying.forEach((b) => blocks(b.start, b.minutes).forEach((t) => { if (want.has(t)) load[t] = (load[t] || 0) + 1; }));
  return Object.values(load).reduce((m, n) => Math.max(m, n), 0);
}

// Bookings that are in the office on a given weekday date.
function applyingOnDate(bookings, dateKey) {
  const wd = weekdayOf(dateKey);
  return bookings.filter((b) => b.kind === "weekly" ? b.weekday === wd : (b.kind === "once" && b.date === dateKey));
}

function publicBooking(b) {
  return { kind: b.kind, weekday: b.weekday == null ? null : b.weekday, date: b.date || "", specialDayId: b.specialDayId || "", start: b.start, minutes: b.minutes };
}

function build() {
  const HttpsError = functions.https.HttpsError;

  async function loadAll(db, includePast) {
    const today = hstToday();
    const [setSnap, daySnap, sigSnap] = await Promise.all([
      db.collection(SETTINGS).doc("main").get(),
      db.collection(DAYS).get(),
      db.collection(SIGNUPS).where("status", "==", "active").get(),
    ]);
    const settings = normSettings(setSnap.exists ? setSnap.data() : null);
    const cutoff = includePast ? addDays(today, -30) : today;
    const special = daySnap.docs.map((d) => Object.assign({ id: d.id }, d.data()))
      .filter((d) => validDate(d.date) && d.date >= cutoff)
      .map((d) => ({ id: d.id, date: d.date, from: d.from, to: d.to, note: d.note || "", max: d.max || 1 }))
      .sort((a, b) => (a.date + a.from < b.date + b.from ? -1 : 1));
    // A one-off booking whose date has passed no longer takes a spot.
    const bookings = sigSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()))
      .filter((b) => b.kind === "weekly" || (b.date && b.date >= today));
    return { today, settings, special, bookings, setSnap };
  }

  async function requireStaff(db, context) {
    if (!context.auth) throw new HttpsError("unauthenticated", "Please sign in.");
    const snap = await db.collection("userRoles").doc(context.auth.uid).get();
    const me = snap.exists ? (snap.data() || {}) : {};
    if (STAFF_ROLES.indexOf(me.role) === -1 || me.revoked === true) {
      throw new HttpsError("permission-denied", "Only Volunteers staff can change office help.");
    }
    return me.displayName || context.auth.token.email || context.auth.uid;
  }

  // ── Public: what's open (no names) ───────────────────────────────────────
  const officeVolunteerSchedule = functions
    .runWith({ timeoutSeconds: 30, maxInstances: 10 })
    .https.onCall(async (data) => {
      if ((data || {}).warm === true) return { warm: true };
      const db = admin.firestore();
      const { today, settings, special, bookings } = await loadAll(db, false);
      const weekdaysOpen = settings.active && settings.openDays.length > 0;
      return {
        today,
        open: weekdaysOpen || special.length > 0,
        weekdaysOpen,
        openDays: weekdaysOpen ? settings.openDays : [],
        from: settings.from, to: settings.to, maxAtOnce: settings.maxAtOnce,
        tasks: settings.tasks,
        special,
        bookings: bookings.map(publicBooking),
        onceWeeks: ONCE_WEEKS,
      };
    });

  // ── Public: sign up ──────────────────────────────────────────────────────
  const officeVolunteerSignUp = functions
    .runWith({ timeoutSeconds: 30, maxInstances: 5 })
    .https.onCall(async (data, context) => {
      if ((data || {}).warm === true) return { warm: true };   // page load: wake the function so Sign me up is quick
      const p = data || {};
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;

      const email = normEmail(cleanText(p.email, 200));
      if (!validEmail(email)) throw new HttpsError("invalid-argument", "Please enter a full email address, like name@example.com.");
      const isNew = p.isNew === true;
      const firstName = cleanText(p.firstName, 60), lastName = cleanText(p.lastName, 60), phone = cleanText(p.phone, 30);
      if (isNew && (!firstName || !lastName)) throw new HttpsError("invalid-argument", "Please enter your first and last name.");
      if (isNew && phone.replace(/\D/g, "").length < 7) throw new HttpsError("invalid-argument", "Please enter a phone number we can reach you at.");
      const notes = cleanText(p.notes, 600);
      const kind = ["weekly", "once", "special"].indexOf(p.kind) === -1 ? "" : p.kind;
      if (!kind) throw new HttpsError("invalid-argument", "Pick a day.");
      const minutes = parseInt(p.minutes, 10);
      if (!(minutes >= 30 && minutes <= 240 && minutes % 30 === 0)) throw new HttpsError("invalid-argument", "Pick how long you can stay (30 minutes to 4 hours).");
      const start = cleanText(p.start, 5);
      const startMin = toMin(start);
      if (isNaN(startMin) || startMin % 30 !== 0) throw new HttpsError("invalid-argument", "Pick a start time.");

      // Light rate limit per IP: 10 sign-ups an hour.
      const req = context && context.rawRequest;
      const ip = req ? String((req.headers && req.headers["x-forwarded-for"]) || req.ip || "").split(",")[0].trim() : "";
      if (ip) {
        const ref = db.collection(RATE).doc("o_" + sha(ip));
        const ok = await db.runTransaction(async (tx) => {
          const s = await tx.get(ref); const x = s.exists ? s.data() : {};
          const now = Date.now(); const fresh = !x.windowStart || now - x.windowStart > 3600e3;
          const count = fresh ? 1 : (x.count || 0) + 1;
          tx.set(ref, { windowStart: fresh ? now : x.windowStart, count });
          return count <= 10;
        });
        if (!ok) throw new HttpsError("resource-exhausted", "Too many sign-ups from this connection. Please call the office at (808) 536-9684.");
      }

      // Match an accepted volunteer by email (never revealed to the caller).
      // A returning volunteer gives only their email; their name comes from the roster.
      let volunteerId = "", rosterFirst = "", rosterLast = "";
      const vSnap = await db.collection("volunteers").where("status", "==", "accepted").limit(2000).get();
      vSnap.forEach((s) => {
        const v = s.data() || {};
        if (!volunteerId && !v.archived && normEmail(v.email) === email) { volunteerId = s.id; rosterFirst = cleanText(v.firstName, 60); rosterLast = cleanText(v.lastName, 60); }
      });

      const result = await db.runTransaction(async (tx) => {
        const { today, settings, special, bookings } = await loadAll(db, false);
        let rec = { kind, start, minutes };
        let limit, label;
        if (kind === "special") {
          const day = special.find((d) => d.id === cleanText(p.specialDayId, 64));
          if (!day) throw new HttpsError("failed-precondition", "That special volunteer day is no longer open. Please pick another.");
          if (startMin < toMin(day.from) || startMin + minutes > toMin(day.to)) throw new HttpsError("invalid-argument", "That time is outside the hours for that day.");
          limit = day.max;
          const peak = peakLoad(bookings.filter((b) => b.kind === "special" && b.specialDayId === day.id), start, minutes);
          if (peak >= limit) throw new HttpsError("failed-precondition", "That time just filled up. Please pick another time.");
          rec = Object.assign(rec, { specialDayId: day.id, date: day.date, weekday: weekdayOf(day.date), specialNote: day.note });
          label = day.date;
        } else {
          if (!(settings.active && settings.openDays.length)) throw new HttpsError("failed-precondition", "Office volunteer days aren't open right now.");
          const weekday = kind === "weekly" ? parseInt(p.weekday, 10) : (validDate(p.date) ? weekdayOf(p.date) : NaN);
          if (settings.openDays.indexOf(weekday) === -1) throw new HttpsError("invalid-argument", "That day isn't an office volunteer day.");
          if (startMin < toMin(settings.from) || startMin + minutes > toMin(settings.to)) throw new HttpsError("invalid-argument", "That time is outside office volunteer hours.");
          limit = settings.maxAtOnce;
          if (kind === "once") {
            const date = p.date;
            if (!(date > today && date <= addDays(today, ONCE_WEEKS * 7))) throw new HttpsError("invalid-argument", "Pick one of the dates shown.");
            if (peakLoad(applyingOnDate(bookings, date), start, minutes) >= limit) throw new HttpsError("failed-precondition", "That time just filled up on that date. Please pick another time.");
            rec = Object.assign(rec, { weekday, date });
            label = date;
          } else {
            // Every week: must fit on every one of the coming dates.
            for (let i = 1; i <= ONCE_WEEKS * 7; i++) {
              const d = addDays(today, i);
              if (weekdayOf(d) !== weekday) continue;
              if (peakLoad(applyingOnDate(bookings, d), start, minutes) >= limit) {
                throw new HttpsError("failed-precondition", "That time is full on " + d + ". Please pick another time, or sign up just once.");
              }
            }
            rec = Object.assign(rec, { weekday, date: "" });
            label = "weekly";
          }
        }
        const ref = db.collection(SIGNUPS).doc();
        tx.set(ref, Object.assign(rec, {
          email, firstName: firstName || rosterFirst, lastName: lastName || rosterLast, phone, notes, isNew, volunteerId,
          status: "active", createdAt: FieldValue.serverTimestamp(), source: cleanText(p.src, 40),
        }));
        return { id: ref.id, label };
      });
      return { ok: true, id: result.id, end: fromMin(startMin + minutes) };
    });

  // ── Staff (DAN): read and change ─────────────────────────────────────────
  const officeVolunteerAdmin = functions
    .runWith({ timeoutSeconds: 30, maxInstances: 5 })
    .https.onCall(async (data, context) => {
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const who = await requireStaff(db, context);
      const p = data || {};
      const action = cleanText(p.action, 30);

      if (action === "saveSettings") {
        const s = p.settings || {};
        const from = cleanText(s.from, 5), to = cleanText(s.to, 5);
        if (isNaN(toMin(from)) || isNaN(toMin(to)) || toMin(to) - toMin(from) < 60) throw new HttpsError("invalid-argument", "Office hours must be at least an hour long.");
        const clean = normSettings({ active: s.active === true, openDays: s.openDays, from, to, maxAtOnce: s.maxAtOnce, tasks: Array.isArray(s.tasks) ? s.tasks : [] });
        await db.collection(SETTINGS).doc("main").set(Object.assign(clean, { updatedAt: FieldValue.serverTimestamp(), updatedBy: who }), { merge: false });
      } else if (action === "addDay") {
        const d = p.day || {};
        const date = cleanText(d.date, 10), from = cleanText(d.from, 5), to = cleanText(d.to, 5), note = cleanText(d.note, 120);
        const max = Math.max(1, Math.min(50, parseInt(d.max, 10) || 0));
        if (!validDate(date)) throw new HttpsError("invalid-argument", "Pick a date.");
        if (date < hstToday()) throw new HttpsError("invalid-argument", "That date has passed.");
        if (isNaN(toMin(from)) || isNaN(toMin(to)) || toMin(to) - toMin(from) < 60) throw new HttpsError("invalid-argument", "The day must be at least an hour long.");
        if (!note) throw new HttpsError("invalid-argument", "Say what the day is for.");
        if (!(parseInt(d.max, 10) >= 1)) throw new HttpsError("invalid-argument", "Say how many volunteers you need.");
        await db.collection(DAYS).add({ date, from, to, note, max, createdAt: FieldValue.serverTimestamp(), createdBy: who });
      } else if (action === "removeDay") {
        const id = cleanText(p.id, 64);
        if (!id || id.indexOf("/") !== -1) throw new HttpsError("invalid-argument", "Missing day.");
        const booked = await db.collection(SIGNUPS).where("specialDayId", "==", id).where("status", "==", "active").get();
        if (!booked.empty && p.confirm !== true) {
          return { ok: false, needsConfirm: true, booked: booked.size };
        }
        const batch = db.batch();
        booked.forEach((b) => batch.update(b.ref, { status: "cancelled", cancelledAt: FieldValue.serverTimestamp(), cancelledBy: who, cancelReason: "Special day removed" }));
        batch.delete(db.collection(DAYS).doc(id));
        await batch.commit();
      } else if (action === "cancelSignup") {
        const id = cleanText(p.id, 64);
        if (!id || id.indexOf("/") !== -1) throw new HttpsError("invalid-argument", "Missing sign-up.");
        await db.collection(SIGNUPS).doc(id).update({ status: "cancelled", cancelledAt: FieldValue.serverTimestamp(), cancelledBy: who });
      } else if (action !== "get") {
        throw new HttpsError("invalid-argument", "Unknown action.");
      }

      const { today, settings, special, bookings, setSnap } = await loadAll(db, true);
      const meta = setSnap.exists ? (setSnap.data() || {}) : {};
      return {
        ok: true, today, settings, special,
        updatedBy: meta.updatedBy || "",
        updatedAt: meta.updatedAt && meta.updatedAt.toMillis ? meta.updatedAt.toMillis() : 0,
        signups: bookings.map((b) => ({
          id: b.id, kind: b.kind, weekday: b.weekday, date: b.date || "", specialDayId: b.specialDayId || "",
          specialNote: b.specialNote || "", start: b.start, minutes: b.minutes,
          end: fromMin(toMin(b.start) + b.minutes),
          email: b.email, firstName: b.firstName || "", lastName: b.lastName || "", phone: b.phone || "",
          notes: b.notes || "", isNew: b.isNew === true, volunteerId: b.volunteerId || "",
          createdAt: b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0,
        })).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
      };
    });

  return { officeVolunteerSchedule, officeVolunteerSignUp, officeVolunteerAdmin };
}

module.exports = build;
module.exports._pure = { toMin, fromMin, blocks, peakLoad, applyingOnDate, normSettings, hstToday, addDays, weekdayOf };
