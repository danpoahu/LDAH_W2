// Pacific Island Partner local times in family email (2026-11-06).
// Pure helpers in functions/eventTimes.js plus the index.js wiring that uses them.
const test = require("node:test");
const assert = require("node:assert");
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "ldah-932d5";
const T = require("../eventTimes.js");
const { __test: X } = require("../index.js");

const VEB = {
  title: "Learning Labs — January 2027",
  time: "5:00 PM - 6:00 PM HST",
  eventDate: "2027-01-14",
  location: "Virtual (Zoom)",
  signupDates: [
    "January 14, 2027, 5:00 PM - 6:00 PM - Reading the IEP",
    "January 21, 2027, 6:00 PM - 7:30 PM - Transition Planning",
  ],
  vebSpec: { sessions: [
    { date: "2027-01-14", start: "17:00", end: "18:00", lesson: "Reading the IEP" },
    { date: "2027-01-21", start: "18:00", end: "19:30", lesson: "Transition Planning" },
  ] },
};
const nonVeb = () => { const e = JSON.parse(JSON.stringify(VEB)); delete e.vebSpec; return e; };

// ── zones ──────────────────────────────────────────────────────────────────
test("every partner zone has the right offset and label", () => {
  const z = (i) => T.zonesFor(i).map((x) => [x.label, x.offset]);
  assert.deepStrictEqual(z("American Samoa"), [["American Samoa time", -11]]);
  assert.deepStrictEqual(z("Guam"), [["Guam time", 10]]);
  assert.deepStrictEqual(z("CNMI"), [["CNMI time", 10]]);
  assert.deepStrictEqual(z("Palau"), [["Palau time", 9]]);
  assert.deepStrictEqual(z("Micronesia"), [["Yap & Chuuk time", 10], ["Pohnpei & Kosrae time", 11]]);
  assert.deepStrictEqual(z("Marshall Islands"), [["Marshall Islands time", 12]]);
  for (const h of ["Oahu", "Hawaii", "Maui", "Kauai", "Molokai", "Lanai", "Other", "Unknown", "", null]) {
    assert.deepStrictEqual(T.zonesFor(h), [], String(h));
    assert.strictEqual(T.isPartnerIsland(h), false);
  }
});

test("island aliases normalise", () => {
  assert.strictEqual(T.normalizeIsland(" FSM "), "Micronesia");
  assert.strictEqual(T.normalizeIsland("Northern Mariana Islands"), "CNMI");
  assert.strictEqual(T.normalizeIsland("RMI"), "Marshall Islands");
  assert.strictEqual(T.normalizeIsland("Pohnpei"), T.MICRONESIA_POHNPEI_KOSRAE);
  assert.strictEqual(T.normalizeIsland("Oahu"), "Oahu");
});

test("Micronesia narrows by zip, then by city text", () => {
  assert.strictEqual(T.micronesiaState("96941"), T.MICRONESIA_POHNPEI_KOSRAE);
  assert.strictEqual(T.micronesiaState("96942"), T.MICRONESIA_YAP_CHUUK);
  assert.strictEqual(T.micronesiaState("96943-0001"), T.MICRONESIA_YAP_CHUUK);
  assert.strictEqual(T.micronesiaState("96944"), T.MICRONESIA_POHNPEI_KOSRAE);
  assert.strictEqual(T.micronesiaState("", "Weno, Chuuk"), T.MICRONESIA_YAP_CHUUK);
  assert.strictEqual(T.micronesiaState("", "Kolonia"), T.MICRONESIA_POHNPEI_KOSRAE);
  assert.strictEqual(T.micronesiaState("", "Colonia, Yap"), T.MICRONESIA_YAP_CHUUK);
  assert.strictEqual(T.micronesiaState("", "somewhere"), "");
  assert.strictEqual(T.islandForContact({ island: "Micronesia", zipCode: "96941" }), T.MICRONESIA_POHNPEI_KOSRAE);
  assert.strictEqual(T.islandForContact({ island: "Micronesia" }), "Micronesia");
  assert.strictEqual(T.islandForContact({ island: "Unknown" }), "");
  assert.strictEqual(T.islandForContact({ island: "Guam", zipCode: "96941" }), "Guam");
});

test("recipientIsland: contact first, then event.partnerIsland, cached per run", async () => {
  let reads = 0;
  const docs = { c1: { island: "Guam" }, c2: { island: "Micronesia", city: "Lelu, Kosrae" }, c3: { island: "Unknown" } };
  const db = { collection: () => ({ doc: (id) => ({ get: async () => { reads++; return { exists: !!docs[id], data: () => docs[id] }; } }) }) };
  const cache = new Map();
  assert.strictEqual(await T.recipientIsland(db, { linkedContactId: "c1" }, { partnerIsland: "Palau" }, cache), "Guam");
  assert.strictEqual(await T.recipientIsland(db, { linkedContactId: "c1" }, {}, cache), "Guam");
  assert.strictEqual(reads, 1);
  assert.strictEqual(await T.recipientIsland(db, { linkedContactId: "c2" }, {}, cache), T.MICRONESIA_POHNPEI_KOSRAE);
  assert.strictEqual(await T.recipientIsland(db, { linkedContactId: "c3" }, { partnerIsland: "Palau" }, cache), "Palau");
  assert.strictEqual(await T.recipientIsland(db, {}, { partnerIsland: "CNMI" }, cache), "CNMI");
  assert.strictEqual(await T.recipientIsland(db, {}, {}, cache), "");
  const bad = { collection: () => { throw new Error("offline"); } };
  assert.strictEqual(await T.recipientIsland(bad, { linkedContactId: "zz" }, { partnerIsland: "Guam" }), "Guam");
});

// ── parsing ────────────────────────────────────────────────────────────────
test("time ranges parse from every shape LDAH stores", () => {
  const P = (s) => T.parseTimeRange(s);
  assert.deepStrictEqual(P("5:00 PM - 6:00 PM HST"), { start: "17:00", end: "18:00" });
  assert.deepStrictEqual(P("January 14, 2027, 5:00 PM - 6:00 PM - Reading the IEP"), { start: "17:00", end: "18:00" });
  assert.deepStrictEqual(P("2026-04-27|Oahu – Kukui|10:00 AM – 12:00 PM"), { start: "10:00", end: "12:00" });
  assert.deepStrictEqual(P("5:00 pm-6:00 pm"), { start: "17:00", end: "18:00" });
  assert.deepStrictEqual(P("5-6 PM"), { start: "17:00", end: "18:00" });
  assert.deepStrictEqual(P("11:00-12:30 PM"), { start: "11:00", end: "12:30" });
  assert.deepStrictEqual(P("17:00-18:00"), { start: "17:00", end: "18:00" });
  assert.deepStrictEqual(P("from 5:00 PM to 6:30 PM"), { start: "17:00", end: "18:30" });
  assert.deepStrictEqual(P("12:00 AM"), { start: "00:00", end: "" });
  assert.deepStrictEqual(P("Thursday, January 14"), { start: "", end: "" });
  assert.strictEqual(T.toHHMM("17:00"), "17:00");
  assert.strictEqual(T.toHHMM("5pm"), "17:00");
});

test("date keys parse from ISO, long and year-less forms", () => {
  assert.strictEqual(T.parseDateKey("2026-05-04|Hilo|9:00 AM"), "2026-05-04");
  assert.strictEqual(T.parseDateKey("January 14, 2027, 5:00 PM"), "2027-01-14");
  assert.strictEqual(T.parseDateKey("Thursday, January 14, 2027"), "2027-01-14");
  assert.strictEqual(T.parseDateKey("Jan 4th", { refYear: 2027 }), "2027-01-04");
  assert.strictEqual(T.parseDateKey("nothing"), "");
});

test("resolveSessionTimes: vebSpec, then strings for that date, then event fields", () => {
  assert.deepStrictEqual(T.resolveSessionTimes(VEB, null, "2027-01-21"), { start: "18:00", end: "19:30" });
  assert.deepStrictEqual(T.resolveSessionTimes(nonVeb(), null, "2027-01-21"), { start: "18:00", end: "19:30" });
  assert.deepStrictEqual(T.resolveSessionTimes(nonVeb(), { selectedSessions: ["2027-01-28|Virtual|9:00 am-10:00 am"] }, "2027-01-28"),
    { start: "09:00", end: "10:00" });
  assert.deepStrictEqual(T.resolveSessionTimes({ time: "5:00 PM - 6:00 PM HST" }, null, "2027-02-01"), { start: "17:00", end: "18:00" });
  assert.deepStrictEqual(T.resolveSessionTimes({}, null, "2027-01-28", null, [{ dateKey: "2027-01-28", startTime: "15:00", endTime: "17:00" }]),
    { start: "15:00", end: "17:00" });
  assert.deepStrictEqual(T.resolveSessionTimes({}, null, "2027-01-28"), { start: "", end: "" });
});

// ── formatting ─────────────────────────────────────────────────────────────
test("partnerTimeLine: Guam is the next day, with the Hawaiʻi time alongside", () => {
  const r = T.partnerTimeLine("Guam", "2027-01-14", "17:00", "18:00");
  assert.strictEqual(r.text, "Friday, January 15, 1:00–2:00 PM Guam time (Thursday, January 14, 5:00–6:00 PM Hawaiʻi time)");
  assert.strictEqual(String(r), r.text);
  assert.strictEqual(r.isPartner, true);
  assert.strictEqual(r.localYmd, "2027-01-15");
  assert.strictEqual(r.localDayName, "Friday");
  assert.strictEqual(r.localDateLabel, "Friday, January 15");
  assert.strictEqual(r.localHour, 13);
  assert.strictEqual(r.zoneLabel, "Guam time");
});

test("partnerTimeLine: American Samoa is an hour behind, same day", () => {
  assert.strictEqual(T.partnerTimeLine("American Samoa", "2027-01-14", "17:00", "18:00").text,
    "Thursday, January 14, 4:00–5:00 PM American Samoa time (Thursday, January 14, 5:00–6:00 PM Hawaiʻi time)");
});

test("partnerTimeLine: Palau, CNMI, Marshall Islands", () => {
  assert.match(T.partnerTimeLine("Palau", "2027-01-14", "17:00", "18:00").text, /^Friday, January 15, 12:00–1:00 PM Palau time/);
  assert.match(T.partnerTimeLine("CNMI", "2027-01-14", "17:00", "18:00").text, /^Friday, January 15, 1:00–2:00 PM CNMI time/);
  assert.match(T.partnerTimeLine("Marshall Islands", "2027-01-14", "17:00", "18:00").text, /^Friday, January 15, 3:00–4:00 PM Marshall Islands time/);
});

test("partnerTimeLine: Micronesia with no state gives both local lines, then Hawaiʻi", () => {
  const r = T.partnerTimeLine("Micronesia", "2027-01-14", "17:00", "18:00");
  assert.deepStrictEqual(r.lines, [
    "Friday, January 15, 1:00–2:00 PM Yap & Chuuk time",
    "Friday, January 15, 2:00–3:00 PM Pohnpei & Kosrae time",
    "Thursday, January 14, 5:00–6:00 PM Hawaiʻi time",
  ]);
  assert.strictEqual(T.partnerTimeLine(T.MICRONESIA_POHNPEI_KOSRAE, "2027-01-14", "17:00", "18:00").localLines.length, 1);
});

test("partnerTimeLine: Hawaiʻi, Other and unknown just get the label", () => {
  for (const isl of ["Oahu", "Maui", "Other", "", undefined]) {
    const r = T.partnerTimeLine(isl, "2027-01-14", "17:00", "18:00");
    assert.strictEqual(r.text, "Thursday, January 14, 5:00–6:00 PM Hawaiʻi time");
    assert.strictEqual(r.isPartner, false);
    assert.strictEqual(r.localYmd, "2027-01-14");
    assert.strictEqual(r.localHour, 17);
  }
});

test("partnerTimeLine options: year, ordinal, crossing noon, no end, no time", () => {
  assert.strictEqual(T.partnerTimeLine("Oahu", "2027-01-14", "11:00", "12:30", { year: true }).text,
    "Thursday, January 14, 2027, 11:00 AM–12:30 PM Hawaiʻi time");
  assert.strictEqual(T.partnerTimeLine("Oahu", "2027-01-01", "09:00", "", { ordinal: true }).text,
    "Friday, January 1st, 9:00 AM Hawaiʻi time");
  assert.strictEqual(T.partnerTimeLine("Guam", "2027-01-14", "", "").text, "Thursday, January 14 (Hawaiʻi date)");
  assert.strictEqual(T.partnerTimeLine("Oahu", "2027-01-14", "", "").text, "Thursday, January 14");
});

test("partnerDateLine: date-only, local date with the Hawaiʻi one when it differs", () => {
  assert.strictEqual(T.partnerDateLine("Guam", "2027-01-14", "17:00").text, "Friday, January 15 (Thursday, January 14 in Hawaiʻi)");
  assert.strictEqual(T.partnerDateLine("American Samoa", "2027-01-14", "17:00").text, "Thursday, January 14");
  assert.strictEqual(T.partnerDateLine("Guam", "2027-01-14", "03:00").text, "Thursday, January 14");   // 11 PM in Guam
  assert.strictEqual(T.partnerDateLine("Oahu", "2027-01-14", "17:00").text, "Thursday, January 14");
  assert.strictEqual(T.partnerDateLine("Guam", "2027-01-14", "").text, "Thursday, January 14 (Hawaiʻi date)");
  assert.strictEqual(T.partnerDateLine("Guam", "2027-01-14", "17:00", { ordinal: true }).text,
    "Friday, January 15th (Thursday, January 14th in Hawaiʻi)");
});

test("instantLabel for deadlines", () => {
  const ms = Date.parse("2026-09-16T11:00:00-10:00");
  assert.strictEqual(T.instantLabel(ms, "Oahu"), "Wednesday, September 16 at 11:00 AM Hawaiʻi time");
  assert.strictEqual(T.instantLabel(ms, "Guam"),
    "Thursday, September 17 at 7:00 AM Guam time (Wednesday, September 16 at 11:00 AM Hawaiʻi time)");
  assert.strictEqual(T.instantLabel(NaN, "Guam"), "");
});

test("today / tomorrow and part of day on the recipient's clock", () => {
  // 2027-01-14 20:00 UTC = 10:00 HST Jan 14 = 06:00 Guam Jan 15.
  const now = Date.parse("2027-01-14T20:00:00Z");
  assert.deepStrictEqual(T.localNow("Guam", now), { ymd: "2027-01-15", hour: 6, minute: 0 });
  assert.deepStrictEqual(T.localNow("Oahu", now), { ymd: "2027-01-14", hour: 10, minute: 0 });
  assert.strictEqual(T.dayWord("2027-01-15", "2027-01-15"), "today");
  assert.strictEqual(T.dayWord("2027-01-16", "2027-01-15"), "tomorrow");
  assert.strictEqual(T.dayWord("2027-01-01", "2026-12-31"), "tomorrow");
  assert.strictEqual(T.dayWord("2027-01-20", "2027-01-15"), "");
  assert.strictEqual(T.partOfDayPhrase(9), "See you this morning");
  assert.strictEqual(T.partOfDayPhrase(13), "See you this afternoon");
  assert.strictEqual(T.partOfDayPhrase(18), "See you tonight");
  assert.strictEqual(T.partOfDayPhrase(13, "tomorrow"), "See you tomorrow afternoon");
  assert.strictEqual(T.partOfDayPhrase(null), "See you soon");
});

test("labelHawaiiTimes: label after the last time, never doubled, dates untouched", () => {
  assert.strictEqual(T.labelHawaiiTimes("January 14, 2027, 5:00 PM - 6:00 PM - Reading the IEP"),
    "January 14, 2027, 5:00 PM - 6:00 PM Hawaiʻi time - Reading the IEP");
  assert.strictEqual(T.labelHawaiiTimes("5:00 PM - 6:00 PM HST"), "5:00 PM - 6:00 PM Hawaiʻi time");
  assert.strictEqual(T.labelHawaiiTimes("5:00 PM (HST)"), "5:00 PM Hawaiʻi time");
  assert.strictEqual(T.labelHawaiiTimes("10:00 AM – 12:00 PM"), "10:00 AM – 12:00 PM Hawaiʻi time");
  assert.strictEqual(T.labelHawaiiTimes("5-6 PM"), "5-6 PM Hawaiʻi time");
  assert.strictEqual(T.labelHawaiiTimes("Thursday, January 14, 2027"), "Thursday, January 14, 2027");
  assert.strictEqual(T.labelHawaiiTimes("2026-04-27"), "2026-04-27");
  assert.strictEqual(T.labelHawaiiTimes("5:00 PM Hawaiʻi time"), "5:00 PM Hawaiʻi time");
});

test("rawWhenFor: partner gets a local line and keeps the lesson", () => {
  assert.strictEqual(T.rawWhenFor("Guam", "January 14, 2027, 5:00 PM - 6:00 PM - Reading the IEP"),
    "Friday, January 15, 1:00–2:00 PM Guam time (Thursday, January 14, 5:00–6:00 PM Hawaiʻi time) - Reading the IEP");
  assert.strictEqual(T.rawWhenFor("Oahu", "January 14, 2027, 5:00 PM - 6:00 PM"), "January 14, 2027, 5:00 PM - 6:00 PM Hawaiʻi time");
  assert.strictEqual(T.rawWhenFor("Guam", "Thursday, January 14, 2027", { start: "17:00", end: "18:00" }),
    "Friday, January 15, 1:00–2:00 PM Guam time (Thursday, January 14, 5:00–6:00 PM Hawaiʻi time)");
  assert.strictEqual(T.rawWhenFor("Guam", "no date here"), "no date here");
});

// ── index.js wiring ────────────────────────────────────────────────────────
test("getSessionTimeForDate: a one-time/VEB session gets ITS time, not the first session's", () => {
  const signup = { selectedDates: [VEB.signupDates[1]] };
  assert.deepStrictEqual(X.getSessionTimeForDate(signup, "2027-01-21", VEB), { startTime: "6:00 PM", endTime: "7:30 PM" });
  assert.deepStrictEqual(X.getSessionTimeForDate(signup, "2027-01-21", nonVeb()), { startTime: "6:00 PM", endTime: "7:30 PM" });
  assert.deepStrictEqual(X.getSessionTimeForDate({}, "2027-01-21", nonVeb()), { startTime: "6:00 PM", endTime: "7:30 PM" });
  // Nothing for that date: the event's own range, split, never "HST" on the end.
  assert.deepStrictEqual(X.getSessionTimeForDate({}, "2027-03-01", { time: "5:00 PM - 6:00 PM HST" }), { startTime: "5:00 PM", endTime: "6:00 PM" });
  // Connect-Gen pipe keys behave as before.
  assert.deepStrictEqual(X.getSessionTimeForDate({ selectedSessions: ["2026-05-04|Hilo|5:00 pm-6:00 pm"] }, "2026-05-04", {}),
    { startTime: "5:00 pm", endTime: "6:00 pm" });
});

test("3-day reminder: Hawaiʻi label, or the partner's whenText", () => {
  const base = { recipientName: "Kai", eventTitle: "LL", dayName: "Thursday", dateFormatted: "January 14, 2027",
    startTime: "5:00 PM", endTime: "6:00 PM", isVirtual: true, zoomUrl: "https://zoom.us/j/1", surveyUrl: "https://x" };
  assert.match(X.buildEventReminderEmailHtml(base), /on Thursday, January 14, 2027 from 5:00 PM to 6:00 PM Hawaiʻi time\./);
  const p = X.buildEventReminderEmailHtml(Object.assign({}, base, { whenText: "Friday, January 15, 2027, 1:00–2:00 PM Guam time (x)" }));
  assert.match(p, /on Friday, January 15, 2027, 1:00–2:00 PM Guam time \(x\)\./);
});

test("day-of email: never 'HST HST'", () => {
  const html = X.buildDayOfEmail({ name: "Kai", eventTitle: "LL", startTime: "5:00 PM HST", endTime: "6:00 PM HST",
    isVirtual: true, zoomUrl: "https://zoom.us/j/1", feedbackUrl: "https://x" });
  assert.ok(!/HST/.test(html));
  assert.match(html, /today at <strong>5:00 PM – 6:00 PM Hawaiʻi time<\/strong>/);
  const p = X.buildDayOfEmail({ name: "Kai", eventTitle: "LL", startTime: "5:00 PM", endTime: "6:00 PM",
    isVirtual: true, zoomUrl: "https://zoom.us/j/1", feedbackUrl: "https://x", whenHtml: ", tomorrow at <strong>1:00–2:00 PM Guam time</strong>" });
  assert.match(p, /LL<\/strong>, tomorrow at <strong>1:00–2:00 PM Guam time<\/strong>!/);
});

test("confirmation dates phrase: unchanged in Hawaiʻi, local for a partner", () => {
  const sessions = [{ dateKey: "2027-01-14" }, { dateKey: "2027-01-21" }];
  assert.strictEqual(X._tzDatesPhrase("Oahu", sessions, VEB, null), X.formatDatesPhrase(["2027-01-14", "2027-01-21"]));
  assert.strictEqual(X._tzDatesPhrase("Guam", sessions, VEB, null),
    ", on Friday, January 15th (Thursday, January 14th in Hawaiʻi) and Friday, January 22nd (Thursday, January 21st in Hawaiʻi)");
  assert.strictEqual(X._tzDatesPhrase("American Samoa", sessions, VEB, null), ", on Thursday, January 14th and Thursday, January 21st");
});

test("PTC: each session its own time", () => {
  const sessions = [{ dateKey: "2027-01-14" }, { dateKey: "2027-01-21" }];
  assert.deepStrictEqual(X._tzPtcWhen("Oahu", [{ dateKey: "2027-01-14" }], VEB, null), { time: "5:00 PM - 6:00 PM Hawaiʻi time" });
  assert.deepStrictEqual(X._tzPtcWhen("Oahu", sessions, VEB, null),
    { when: "on Thursday, January 14th, 5:00–6:00 PM Hawaiʻi time and Thursday, January 21st, 6:00–7:30 PM Hawaiʻi time" });
  assert.match(X._tzPtcWhen("Guam", sessions, VEB, null).when, /^on Friday, January 15th, 1:00–2:00 PM Guam time \(/);
  const html = X.buildParentTalkCafeConfirmationEmailHtml({ name: "Kai", eventTitle: "PTC", datesPhrase: ", on x", sessionWhen: "on Friday" });
  assert.match(html, /We'll see you <strong>on Friday<\/strong>\./);
});

test("lifecycle session entries: Hawaiʻi label or the partner line", () => {
  assert.strictEqual(X.lifecycleFormatSessionEntry("2026-05-04|Hilo – Venue|10:00 AM – 12:00 PM", "Oahu"),
    "Mon, May 4 — 10:00 AM – 12:00 PM Hawaiʻi time @ Hilo – Venue");
  assert.strictEqual(X.lifecycleFormatSessionEntry("2026-05-04|Virtual|5:00 pm-6:00 pm", "Guam"),
    "Tuesday, May 5, 1:00–2:00 PM Guam time (Monday, May 4, 5:00–6:00 PM Hawaiʻi time) @ Virtual");
  assert.strictEqual(X.lifecycleFormatSessionEntry(VEB.signupDates[0], ""),
    "January 14, 2027, 5:00 PM - 6:00 PM Hawaiʻi time - Reading the IEP");
});

test("announcement: VEB output kept, Hawaiʻi reference added; non-VEB events get local times too", () => {
  assert.strictEqual(X._annLocalWhen(VEB, "Guam", VEB.signupDates[0]),
    "Friday, January 15, 1:00 PM to 2:00 PM (Guam time): Reading the IEP | Thursday, January 14, 5:00 PM to 6:00 PM (Hawaiʻi time)");
  assert.strictEqual(X._annLocalWhen(nonVeb(), "Guam", VEB.signupDates[1]),
    "Friday, January 22, 2:00 PM to 3:30 PM (Guam time) | Thursday, January 21, 6:00 PM to 7:30 PM (Hawaiʻi time)");
  assert.strictEqual(X._annLocalWhen(VEB, "Oahu", ""), "");
  const contact = { displayName: "Kai Test", island: "Micronesia", zipCode: "96941", unsubscribeToken: "t" };
  const html = X.buildAnnouncementEmailHtml({ event: VEB, contact, unsubscribeUrl: "u", eventId: "e", sessionDate: VEB.signupDates[0] });
  assert.match(html, /Pohnpei &amp; Kosrae time/);
  assert.ok(!/Yap &amp; Chuuk time/.test(html));
  assert.match(html, /Hi Kai,/);
  const hw = X.buildAnnouncementEmailHtml({ event: nonVeb(), contact: { displayName: "Kai", island: "Oahu" }, unsubscribeUrl: "u", eventId: "e" });
  assert.match(hw, /5:00 PM - 6:00 PM Hawaiʻi time - Reading the IEP/);
  assert.match(hw, /Aloha Kai,/);
});

test("combined announcement: partner block shows local time, staff whenText untouched", () => {
  const blocks = [{ eventId: "e1", event: nonVeb() }, { eventId: "e2", event: VEB, whenText: "All month" }];
  const html = X.buildCombinedAnnouncementEmailHtml({ blocks, contact: { displayName: "Kai", island: "Guam", unsubscribeToken: "t" }, unsubscribeUrl: "u" });
  assert.match(html, /When \(your local time\):<\/strong><br>Friday, January 15, 1:00 PM to 2:00 PM \(Guam time\)/);
  assert.match(html, /<strong>When:<\/strong> All month/);
});

test("greetingWord: Hi for partner islands, Aloha otherwise", () => {
  assert.equal(T.greetingWord("Guam"), "Hi");
  assert.equal(T.greetingWord("American Samoa"), "Hi");
  assert.equal(T.greetingWord("Micronesia (Yap & Chuuk)"), "Hi");
  assert.equal(T.greetingWord("Oahu"), "Aloha");
  assert.equal(T.greetingWord(""), "Aloha");
});
