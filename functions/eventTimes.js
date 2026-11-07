"use strict";
/*
 * Event times for family email (2026-11-06).
 *
 * Every LDAH event is scheduled in Hawaiʻi time. A Pacific Island Partner family
 * reading "5:00 PM HST" has to do the arithmetic themselves, and for most of them
 * the session is on the NEXT calendar day. These helpers turn an HST session into
 * the recipient's own local date and time, with the Hawaiʻi time kept alongside
 * for reference, and give a Hawaiʻi family the same words as before plus a
 * "Hawaiʻi time" label.
 *
 * ONE zone table lives here; announcements, reminders, confirmations and
 * lifecycle notices all read it. No zone observes daylight saving time, so a
 * fixed UTC offset is exact all year.
 *
 * Everything is pure except recipientIsland(), which reads one contact doc.
 */

const HAWAII_OFFSET = -10;
const HAWAII_LABEL = "Hawaiʻi time";

// UTC offsets. Strings match the partnerIsland / contacts.island values in -Int.
const PARTNER_ZONES = Object.freeze({
  "American Samoa": [{ label: "American Samoa time", offset: -11 }],
  "Guam": [{ label: "Guam time", offset: 10 }],
  "CNMI": [{ label: "CNMI time", offset: 10 }],
  "Palau": [{ label: "Palau time", offset: 9 }],
  "Micronesia": [{ label: "Yap & Chuuk time", offset: 10 }, { label: "Pohnpei & Kosrae time", offset: 11 }],
  "Micronesia (Yap & Chuuk)": [{ label: "Yap & Chuuk time", offset: 10 }],
  "Micronesia (Pohnpei & Kosrae)": [{ label: "Pohnpei & Kosrae time", offset: 11 }],
  "Marshall Islands": [{ label: "Marshall Islands time", offset: 12 }],
});
const PARTNER_ISLANDS = ["American Samoa", "Guam", "CNMI", "Micronesia", "Marshall Islands", "Palau"];
const MICRONESIA_YAP_CHUUK = "Micronesia (Yap & Chuuk)";
const MICRONESIA_POHNPEI_KOSRAE = "Micronesia (Pohnpei & Kosrae)";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NUM = {};
MONTHS.forEach((m, i) => { MONTH_NUM[m.toLowerCase()] = i + 1; MONTH_NUM[m.slice(0, 3).toLowerCase()] = i + 1; });
MONTH_NUM.sept = 9;

// ── Islands ────────────────────────────────────────────────────────────────

const _ALIASES = [
  [/^(fsm|federated states of micronesia|micronesia)$/i, "Micronesia"],
  [/^(micronesia\s*[(\-–:]\s*)?(yap|chuuk|truk|yap\s*&\s*chuuk)\)?$/i, MICRONESIA_YAP_CHUUK],
  [/^(micronesia\s*[(\-–:]\s*)?(pohnpei|kosrae|pohnpei\s*&\s*kosrae)\)?$/i, MICRONESIA_POHNPEI_KOSRAE],
  [/^(cnmi|northern mariana islands|commonwealth of the northern mariana islands|saipan)$/i, "CNMI"],
  [/^(rmi|marshall islands|republic of the marshall islands|marshalls)$/i, "Marshall Islands"],
  [/^(american samoa|amerika samoa)$/i, "American Samoa"],
  [/^guam$/i, "Guam"],
  [/^palau$/i, "Palau"],
];

/** Canonical island string: a PARTNER_ZONES key for partner places, else the trimmed input. */
function normalizeIsland(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  for (const [re, canon] of _ALIASES) if (re.test(s)) return canon;
  return s;
}

function zonesFor(island) {
  const z = PARTNER_ZONES[normalizeIsland(island)];
  return z ? z.slice() : [];
}

function isPartnerIsland(island) { return zonesFor(island).length > 0; }

/** Which half of Micronesia, from a zip and/or free-text city. '' when it cannot tell. */
function micronesiaState(zip, text) {
  const z = String(zip == null ? "" : zip).trim().slice(0, 5);
  if (z === "96941" || z === "96944") return MICRONESIA_POHNPEI_KOSRAE;
  if (z === "96942" || z === "96943") return MICRONESIA_YAP_CHUUK;
  const t = String(text || "");
  if (/\b(pohnpei|kolonia|kosrae|lelu|tofol|palikir)\b/i.test(t)) return MICRONESIA_POHNPEI_KOSRAE;
  if (/\b(chuuk|weno|truk|yap|colonia)\b/i.test(t)) return MICRONESIA_YAP_CHUUK;
  return "";
}

/**
 * The island to time an email for, from a contact doc: contacts.island, with
 * Micronesia narrowed to its state by zip or city when either is on file.
 * '' when the contact has no usable island ("Unknown" or blank).
 */
function islandForContact(c) {
  if (!c || typeof c !== "object") return "";
  const raw = String(c.island || "").trim();
  if (!raw || /^unknown$/i.test(raw)) return "";
  const isl = normalizeIsland(raw);
  if (isl === "Micronesia") {
    const st = micronesiaState(c.zipCode || c.zip,
      [c.city, c.location, c.streetAddress].filter(Boolean).join(" "));
    if (st) return st;
  }
  return isl;
}

/**
 * Async: the recipient's island for a signup. contacts/{linkedContactId}.island
 * first (Micronesia narrowed by zip/city), else the event's partnerIsland, else ''.
 * cache is an optional Map shared across one run so a contact is read once.
 */
async function recipientIsland(db, signup, event, cache) {
  let isl = "";
  const id = signup && (signup.linkedContactId || signup.contactId);
  if (id && db) {
    const key = "contact:" + id;
    if (cache && cache.has(key)) {
      isl = cache.get(key);
    } else {
      try {
        const snap = await db.collection("contacts").doc(String(id)).get();
        isl = snap && snap.exists ? islandForContact(snap.data() || {}) : "";
      } catch (_) { isl = ""; }
      if (cache) cache.set(key, isl);
    }
  }
  if (!isl) isl = normalizeIsland(event && event.partnerIsland);
  return isl || "";
}

// ── Parsing ────────────────────────────────────────────────────────────────

const _AP = "([AaPp])\\.?\\s*[Mm]?\\.?";
const _T = "(\\d{1,2})(?::(\\d{2}))?\\s*(?:" + _AP + ")?";
const _RANGE_RE = new RegExp(_T + "\\s*(?:[-–—]|to)\\s*" + _T, "g");
const _SINGLE_RE = new RegExp("(\\d{1,2})(?::(\\d{2}))?\\s*" + _AP + "|(\\d{1,2}):(\\d{2})", "g");

function _hhmm(h, m, ap) {
  let hh = parseInt(h, 10);
  const mm = m == null || m === "" ? 0 : parseInt(m, 10);
  if (isNaN(hh) || isNaN(mm) || mm > 59) return "";
  const a = String(ap || "").toLowerCase();
  if (a) {
    if (hh < 1 || hh > 12) return "";
    if (a === "p" && hh < 12) hh += 12;
    if (a === "a" && hh === 12) hh = 0;
  } else if (hh > 23) return "";
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

const _MONTH_ALT = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const _MONTH_DATE_RE = new RegExp("\\b" + _MONTH_ALT + "\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s*\\d{4})?", "gi");

// Remove date text so "2026-04-27" or "May 6, 2026" never reads as a time range.
function _stripDates(s) {
  return String(s || "")
    .replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?/g, " ")
    .replace(_MONTH_DATE_RE, " ");
}

/** One time of day ("5:00 PM", "5pm", "17:00", "5:00 pm HST") -> "HH:MM" 24h, or "". */
function toHHMM(raw) {
  if (raw == null) return "";
  const r = parseTimeRange(raw);
  return r.start;
}

/**
 * First time range in a string -> { start, end } as "HH:MM" 24h ("" when absent).
 * Tolerates "5:00 PM - 6:00 PM HST", "5:00 pm-6:00 pm", "5-6 PM", "10:00 AM – 12:00 PM",
 * "17:00-18:00", "5:00 PM to 6:00 PM", and a single time ("5:00 PM", "17:00").
 */
function parseTimeRange(raw) {
  const s = _stripDates(raw);
  _RANGE_RE.lastIndex = 0;
  let m;
  while ((m = _RANGE_RE.exec(s)) !== null) {
    const [, h1, m1, a1, h2, m2, a2] = m;
    const leftOk = m1 != null || a1 || a2;
    const rightOk = m2 != null || a2;
    if (!leftOk || !rightOk) continue;
    let ap1 = a1 || "", ap2 = a2 || "";
    if (!ap1 && ap2) {                                     // "5-6 PM", "5:00-6:00 PM", "11:00-12:30 PM"
      const sh = parseInt(h1, 10), eh = parseInt(h2, 10);
      ap1 = ap2;
      if (ap2.toLowerCase() === "p" && eh === 12 && sh !== 12) ap1 = "a";
      if (sh > 12) ap1 = "";
    }
    if (!ap2 && ap1 && m2 != null && parseInt(h2, 10) <= 12) ap2 = ap1;
    const start = _hhmm(h1, m1, ap1);
    const end = _hhmm(h2, m2, ap2);
    if (start && end) return { start, end };
  }
  _SINGLE_RE.lastIndex = 0;
  const one = _SINGLE_RE.exec(s);
  if (one) {
    const start = one[1] != null ? _hhmm(one[1], one[2], one[3]) : _hhmm(one[4], one[5], "");
    if (start) return { start, end: "" };
  }
  return { start: "", end: "" };
}

/**
 * YYYY-MM-DD from a session string: an ISO date anywhere, "May 6, 2026",
 * "Tue, May 6, 2026", or a year-less "May 6th" (opts.refYear, else this year).
 */
function parseDateKey(raw, opts) {
  const s = String(raw == null ? "" : raw);
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + "-" + iso[2] + "-" + iso[3];
  const re = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4}))?/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const mon = MONTH_NUM[m[1].toLowerCase()];
    if (!mon) continue;
    const day = parseInt(m[2], 10);
    if (day < 1 || day > 31) continue;
    const year = m[3] ? parseInt(m[3], 10)
      : ((opts && opts.refYear) || new Date(Date.now() + HAWAII_OFFSET * 3600e3).getUTCFullYear());
    return year + "-" + String(mon).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }
  return "";
}

/**
 * Start/end ("HH:MM" 24h HST) of the session on ymd. Sources, in order:
 * the Virtual Event Builder spec, the raw session string given, the signup's
 * own session strings for that date, the event's signupDates entry for that
 * date, the event's sessions[] (then extraSessions, e.g. a recurring program's
 * projected schedule), and finally the event-level time fields.
 */
function resolveSessionTimes(event, signup, ymd, raw, extraSessions) {
  const ev = event || {};
  const out = (start, end) => ({ start: start || "", end: (start && end) || "" });
  const spec = ev.vebSpec;
  if (ymd && spec && Array.isArray(spec.sessions)) {
    const hit = spec.sessions.find((x) => x && x.date === ymd && x.start);
    if (hit) return out(toHHMM(hit.start), toHHMM(hit.end));
  }
  const fromString = (str) => {
    const t = String(str || "");
    const piece = t.indexOf("|") !== -1 ? (t.split("|")[2] || "") : t;
    return parseTimeRange(piece);
  };
  if (raw) {
    const r = fromString(raw);
    if (r.start) return out(r.start, r.end);
  }
  const lists = [];
  if (signup) {
    if (Array.isArray(signup.selectedSessions)) lists.push(signup.selectedSessions);
    if (Array.isArray(signup.selectedDates)) lists.push(signup.selectedDates);
  }
  if (Array.isArray(ev.signupDates)) lists.push(ev.signupDates);
  for (const list of lists) {
    for (const entry of list) {
      if (typeof entry !== "string" || !ymd) continue;
      const key = entry.indexOf("|") !== -1 ? parseDateKey(entry.split("|")[0]) : parseDateKey(entry);
      if (key !== ymd) continue;
      const r = fromString(entry);
      if (r.start) return out(r.start, r.end);
    }
  }
  for (const list of [ev.sessions, extraSessions]) {
    if (!ymd || !Array.isArray(list)) continue;
    const hit = list.find((x) => x && x.dateKey === ymd && x.startTime);
    if (hit) return out(toHHMM(hit.startTime), toHHMM(hit.endTime));
  }
  const r = parseTimeRange(ev.time || "");
  const st = toHHMM(ev.startTime) || r.start;
  const en = toHHMM(ev.endTime) || r.end;
  return out(st, en);
}

// ── Formatting ─────────────────────────────────────────────────────────────

function _ymdParts(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : null;
}

// Wall clock at `offset` for a Hawaiʻi wall-clock time. Returned as a Date whose
// UTC fields ARE that wall clock (read with getUTC*).
function _wall(ymd, hhmm, offset) {
  const p = _ymdParts(ymd);
  if (!p) return null;
  const t = String(hhmm || "00:00").split(":").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(p[0], p[1] - 1, p[2], t[0] || 0, t[1] || 0) + (offset - HAWAII_OFFSET) * 3600e3);
}

function _ymdOf(d) {
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}

function _ordinal(n) {
  if (n >= 11 && n <= 13) return n + "th";
  return n + ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
}

/** "Thursday, January 14" (opts.year adds ", 2027"; opts.ordinal gives "14th"; opts.weekday:false drops the day). */
function formatDateLabel(ymd, opts) {
  const o = opts || {};
  const p = _ymdParts(ymd);
  if (!p) return String(ymd || "");
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  const day = o.ordinal ? _ordinal(p[2]) : String(p[2]);
  return (o.weekday === false ? "" : DAYS[d.getUTCDay()] + ", ") + MONTHS[p[1] - 1] + " " + day + (o.year ? ", " + p[0] : "");
}

function _t12(h, m) { return ((h % 12) || 12) + ":" + String(m).padStart(2, "0") + " " + (h >= 12 ? "PM" : "AM"); }

/** "5:00 PM" from "17:00". */
function formatTime12(hhmm) {
  const s = toHHMM(hhmm);
  if (!s) return "";
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return _t12(h, m);
}

// "1:00–2:00 PM" (same half of the day) or "11:00 AM–12:00 PM"; opts.rangeStyle "to" gives "1:00 PM to 2:00 PM".
function _timeRange(a, b, opts) {
  const o = opts || {};
  const sa = _t12(a.getUTCHours(), a.getUTCMinutes());
  if (!b) return sa;
  const sb = _t12(b.getUTCHours(), b.getUTCMinutes());
  if (o.rangeStyle === "to") return sa + " to " + sb;
  if (o.rangeStyle === "spaced") return sa + " - " + sb;
  if ((a.getUTCHours() >= 12) === (b.getUTCHours() >= 12)) return sa.replace(/ [AP]M$/, "") + "–" + sb;
  return sa + "–" + sb;
}

function _zoneView(ymd, start, end, offset, label, opts) {
  const a = _wall(ymd, start || "00:00", offset);
  const b = end ? _wall(ymd, end, offset) : null;
  // An end before the start means the session runs past midnight.
  if (b && b < a) b.setTime(b.getTime() + 86400e3);
  const ymdL = _ymdOf(a);
  const dateLabel = formatDateLabel(ymdL, opts);
  const timeText = start ? _timeRange(a, b, opts) : "";
  const sep = (opts && opts.dateTimeSep != null) ? opts.dateTimeSep : ", ";
  return {
    label, offset, ymd: ymdL,
    dayName: DAYS[a.getUTCDay()],
    dateLabel, timeText,
    hour: start ? a.getUTCHours() : null,
    minute: start ? a.getUTCMinutes() : null,
    line: dateLabel + (timeText ? sep + timeText + " " + label : ""),
  };
}

/**
 * The session as the recipient should read it.
 *   partner:  "Friday, January 15, 1:00–2:00 PM Guam time (Thursday, January 14, 5:00–6:00 PM Hawaiʻi time)"
 *   Micronesia with no state: both local lines, then the Hawaiʻi line.
 *   Hawaiʻi / Other / unknown: "Thursday, January 14, 5:00–6:00 PM Hawaiʻi time"
 * Without a start time it degrades to the date (marked "Hawaiʻi date" for a partner,
 * because their own date cannot be known).
 * Returns { text, lines, localLines, hawaiiLine, isPartner, zoneLabel, localYmd,
 * localDayName, localDateLabel, localHour, localMinute, hawaiiYmd, zones }; it also
 * stringifies to text.
 * opts: { year, ordinal, weekday, rangeStyle: "dash"|"to"|"spaced", dateTimeSep }
 */
function partnerTimeLine(island, ymdHst, startHHMM24, endHHMM24, opts) {
  const o = opts || {};
  const start = toHHMM(startHHMM24);
  const end = start ? toHHMM(endHHMM24) : "";
  const zones = zonesFor(island);
  const hw = _zoneView(ymdHst, start, end, HAWAII_OFFSET, HAWAII_LABEL, o);
  const views = zones.map((z) => _zoneView(ymdHst, start, end, z.offset, z.label, o));
  const isPartner = views.length > 0;
  let localLines, text;
  if (!isPartner) {
    localLines = [hw.line];
    text = hw.line;
  } else if (!start) {
    localLines = [hw.dateLabel + " (Hawaiʻi date)"];
    text = localLines[0];
  } else {
    localLines = views.map((v) => v.line);
    text = localLines.join("; ") + " (" + hw.line + ")";
  }
  const first = (isPartner && start) ? views[0] : hw;
  const res = {
    text,
    lines: (isPartner && start) ? localLines.concat([hw.line]) : localLines.slice(),
    localLines,
    hawaiiLine: hw.line,
    isPartner,
    zoneLabel: first.label,
    localYmd: first.ymd,
    localDayName: first.dayName,
    localDateLabel: first.dateLabel,
    localHour: first.hour,
    localMinute: first.minute,
    hawaiiYmd: hw.ymd,
    zones: isPartner ? views : [hw],
  };
  Object.defineProperty(res, "toString", { value: function () { return this.text; }, enumerable: false });
  return res;
}

/**
 * Date-only variant, for emails that state a date and no time. The session's
 * start (HST) decides the recipient's local date; it is never printed.
 *   Hawaiʻi: "Thursday, January 14"
 *   partner, same date: "Thursday, January 14"
 *   partner, next day: "Friday, January 15 (Thursday, January 14 in Hawaiʻi)"
 *   partner, no start known: "Thursday, January 14 (Hawaiʻi date)"
 */
function partnerDateLine(island, ymdHst, startHHMM24, opts) {
  const o = opts || {};
  const start = toHHMM(startHHMM24);
  const hwLabel = formatDateLabel(ymdHst, o);
  const zones = zonesFor(island);
  let text = hwLabel, localYmd = ymdHst, localDateLabel = hwLabel;
  if (zones.length && !start) {
    text = hwLabel + " (Hawaiʻi date)";
  } else if (zones.length) {
    const views = zones.map((z) => _zoneView(ymdHst, start, "", z.offset, z.label, o));
    localYmd = views[0].ymd;
    localDateLabel = views[0].dateLabel;
    const distinct = Array.from(new Set(views.map((v) => v.ymd)));
    if (distinct.length === 1 && distinct[0] === ymdHst) text = hwLabel;
    else if (distinct.length === 1) text = views[0].dateLabel + " (" + hwLabel + " in Hawaiʻi)";
    else text = views.map((v) => v.label.replace(/ time$/, "") + ": " + v.dateLabel).join("; ") +
      " (" + hwLabel + " in Hawaiʻi)";
  }
  const res = { text, isPartner: zones.length > 0, localYmd, localDateLabel, hawaiiYmd: ymdHst };
  Object.defineProperty(res, "toString", { value: function () { return this.text; }, enumerable: false });
  return res;
}

/**
 * An instant (ms) as "Wednesday, September 16 at 11:00 AM Hawaiʻi time", or for a
 * partner "Thursday, September 17 at 7:00 AM Guam time (Wednesday, September 16 at
 * 11:00 AM Hawaiʻi time)". Used for deadlines.
 */
function instantLabel(ms, island, opts) {
  if (!Number.isFinite(ms)) return "";
  const at = (offset, label) => {
    const d = new Date(ms + offset * 3600e3);
    return formatDateLabel(_ymdOf(d), opts) + " at " + _t12(d.getUTCHours(), d.getUTCMinutes()) + " " + label;
  };
  const hw = at(HAWAII_OFFSET, HAWAII_LABEL);
  const zones = zonesFor(island);
  if (!zones.length) return hw;
  return zones.map((z) => at(z.offset, z.label)).join("; ") + " (" + hw + ")";
}

/** Today's date and hour on the recipient's clock (first zone for Micronesia with no state). */
function localNow(island, nowMs) {
  const zones = zonesFor(island);
  const off = zones.length ? zones[0].offset : HAWAII_OFFSET;
  const d = new Date((nowMs == null ? Date.now() : nowMs) + off * 3600e3);
  return { ymd: _ymdOf(d), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** "today" / "tomorrow" / "" for a session date against the recipient's today. */
function dayWord(sessionYmd, todayYmd) {
  if (!sessionYmd || !todayYmd) return "";
  if (sessionYmd === todayYmd) return "today";
  const p = _ymdParts(todayYmd);
  if (!p) return "";
  const t = _ymdOf(new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1)));
  return sessionYmd === t ? "tomorrow" : "";
}

/** Morning / afternoon / tonight phrase for a local start hour, mirroring the day-of subject. */
function partOfDayPhrase(hour, word) {
  if (hour == null || isNaN(hour)) return "See you soon";
  if (word === "tomorrow") {
    if (hour < 12) return "See you tomorrow morning";
    if (hour < 17) return "See you tomorrow afternoon";
    return "See you tomorrow evening";
  }
  if (hour < 12) return "See you this morning";
  if (hour < 17) return "See you this afternoon";
  return "See you tonight";
}

// Time-with-meridiem or 24h-with-colon occurrences, optionally as a range, then an optional HST tag.
const _LABEL_RE = new RegExp(
  "(\\d{1,2}(?::\\d{2})?\\s*[AaPp]\\.?\\s*[Mm]\\.?|\\d{1,2}:\\d{2})" +
  "(\\s*(?:[-–—]|to)\\s*(\\d{1,2}(?::\\d{2})?\\s*[AaPp]\\.?\\s*[Mm]\\.?|\\d{1,2}:\\d{2}))?" +
  "(\\s*\\(?\\s*(?:HST|Hawai(?:ʻ|'|&#699;)?i(?:an)?\\s+(?:Standard\\s+)?time)\\s*\\)?)?", "gi");

/**
 * Put "Hawaiʻi time" after the last clock time in a string (replacing a trailing
 * "HST" so it never doubles). Strings with no clock time come back unchanged.
 */
function labelHawaiiTimes(str) {
  const s = String(str == null ? "" : str);
  if (/Hawai(ʻ|')?i time/i.test(s)) return s;
  let last = null, m;
  _LABEL_RE.lastIndex = 0;
  while ((m = _LABEL_RE.exec(s)) !== null) {
    // Skip a match that is really part of a date ("2026-04-27") or a year.
    const before = s.slice(0, m.index);
    if (/\d$/.test(before) || /\d{4}-(\d{2}-)?$/.test(before)) continue;
    last = m;
  }
  if (!last) return s;
  const core = last[1] + (last[2] || "");
  return s.slice(0, last.index) + core + " " + HAWAII_LABEL + s.slice(last.index + last[0].length);
}

/**
 * A raw session string (signupDates / selectedDates / pipe key) for the recipient.
 * Hawaiʻi: the string itself with its time labelled. Partner: the local line built
 * from the parsed date and time, keeping any trailing " - Lesson" topic.
 */
function rawWhenFor(island, raw, opts) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  if (!isPartnerIsland(island)) return labelHawaiiTimes(s);
  const ymd = s.indexOf("|") !== -1 ? parseDateKey(s.split("|")[0]) : parseDateKey(s, opts);
  if (!ymd) return labelHawaiiTimes(s);
  const piece = s.indexOf("|") !== -1 ? (s.split("|")[2] || "") : s;
  const t = (opts && opts.start) ? { start: toHHMM(opts.start), end: toHHMM(opts.end) } : parseTimeRange(piece);
  const line = t.start ? partnerTimeLine(island, ymd, t.start, t.end, opts).text
    : partnerDateLine(island, ymd, "", opts).text;
  // VEB entries end "… 6:00 PM - Lesson title"; keep the topic.
  const topic = s.indexOf("|") === -1 ? (s.match(/^.*\d\s*[AaPp]\.?[Mm]\.?\s*(?:HST)?\s+[-–—]\s+(.+)$/) || [])[1] : "";
  return line + (topic ? " - " + topic.trim() : "");
}

module.exports = {
  HAWAII_LABEL, HAWAII_OFFSET, PARTNER_ZONES, PARTNER_ISLANDS,
  MICRONESIA_YAP_CHUUK, MICRONESIA_POHNPEI_KOSRAE,
  normalizeIsland, zonesFor, isPartnerIsland, micronesiaState, islandForContact, recipientIsland,
  toHHMM, parseTimeRange, parseDateKey, resolveSessionTimes,
  formatDateLabel, formatTime12, partnerTimeLine, partnerDateLine, instantLabel,
  localNow, dayWord, partOfDayPhrase, labelHawaiiTimes, rawWhenFor,
};
