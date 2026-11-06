const test = require("node:test");
const assert = require("node:assert");
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "ldah-932d5";
const OS = require("../officeScreenings");
const { __test } = require("../index.js");

const DAY = { date: "2026-11-11", start: "14:00", end: "16:00", slotMinutes: 15, closedTimes: ["14:45"], published: true,
  leadUid: "u1", leadName: "Lead Person" };
const ms = (iso, hhmm) => OS.hstMs(iso, hhmm);
const nowAt = (iso, hhmm) => Object.assign(OS.hstNow(ms(iso, hhmm)), { ms: ms(iso, hhmm) });

test("slots run from start in 15 minutes, before end, minus closed times", () => {
  assert.deepStrictEqual(OS.daySlots(DAY), ["14:00", "14:15", "14:30", "15:00", "15:15", "15:30", "15:45"]);
  assert.deepStrictEqual(OS.daySlots({ start: "09:00", end: "09:40" }), ["09:00", "09:15", "09:30"]);
  assert.deepStrictEqual(OS.daySlots({ start: "bad", end: "16:00" }), []);
});
test("labels", () => {
  assert.strictEqual(OS.timeLabel("14:30"), "2:30");
  assert.strictEqual(OS.timeLabelFull("14:30"), "2:30 PM");
  assert.strictEqual(OS.timeLabelFull("09:00"), "9:00 AM");
  assert.strictEqual(OS.timeLabelFull("12:15"), "12:15 PM");
  assert.strictEqual(OS.dayLabel("2026-11-11"), "Wed, Nov 11");
  assert.strictEqual(OS.dayLabelLong("2026-11-11"), "Wednesday, November 11");
  assert.strictEqual(OS.dayRangeLabel(DAY), "Wed, Nov 11, 2:00 to 4:00 PM");
  assert.strictEqual(OS.dayRangeLabel({ date: "2026-11-21", start: "11:00", end: "13:00" }), "Sat, Nov 21, 11:00 AM to 1:00 PM");
});
test("Honolulu clock", () => {
  const n = OS.hstNow(Date.UTC(2026, 10, 11, 6, 0)); // 06:00 UTC = 20:00 HST the day before
  assert.deepStrictEqual(n, { date: "2026-11-10", minutes: 20 * 60 });
  assert.strictEqual(OS.hstMs("2026-11-11", "14:30"), Date.UTC(2026, 10, 12, 0, 30));
});
test("cutoff: any time up to 23:59 the day before", () => {
  assert.strictEqual(OS.canBook({ date: "2026-11-11", time: "14:00", today: "2026-11-10", nowMin: 23 * 60 + 59, bookedCount: 0 }), true);
  assert.strictEqual(OS.canBook({ date: "2026-11-11", time: "14:00", today: "2026-11-12", nowMin: 0, bookedCount: 3 }), false);
});
test("same day: only when the day already has a booked child, never a started time", () => {
  const base = { date: "2026-11-11", today: "2026-11-11", nowMin: 9 * 60 };
  assert.strictEqual(OS.canBook(Object.assign({ time: "14:00", bookedCount: 0 }, base)), false);
  assert.strictEqual(OS.canBook(Object.assign({ time: "14:00", bookedCount: 1 }, base)), true);
  assert.strictEqual(OS.canBook({ date: "2026-11-11", time: "14:00", today: "2026-11-11", nowMin: 14 * 60, bookedCount: 2 }), false);
  assert.strictEqual(OS.canBook({ date: "2026-11-11", time: "14:15", today: "2026-11-11", nowMin: 14 * 60 + 5, bookedCount: 2 }), true);
  // staff skip the same-day rule but not a started time
  assert.strictEqual(OS.canBook(Object.assign({ time: "14:00", bookedCount: 0, staff: true }, base)), true);
  assert.strictEqual(OS.canBook({ date: "2026-11-11", time: "14:00", today: "2026-11-11", nowMin: 14 * 60, staff: true }), false);
});
test("held times count until they expire; your own hold never blocks you", () => {
  const now = ms("2026-11-10", "10:00");
  assert.strictEqual(OS.slotTaken({ bookingId: "a", status: "held", holdExpiresAt: now + 60000 }, now), true);
  assert.strictEqual(OS.slotTaken({ bookingId: "a", status: "held", holdExpiresAt: now - 1 }, now), false);
  assert.strictEqual(OS.slotTaken({ bookingId: "a", status: "booked" }, now), true);
  assert.strictEqual(OS.slotTaken({ bookingId: "a", status: "booked" }, now, "a"), false);
  assert.strictEqual(OS.slotTaken(null, now), false);
});
test("times list: taken shows closed, full day still listed, same-day without bookings is empty", () => {
  const n = nowAt("2026-11-10", "12:00");
  const locks = [{ time: "14:00", status: "booked", bookingId: "x" }, { time: "14:15", status: "held", bookingId: "y", holdExpiresAt: n.ms + 60000 },
    { time: "14:30", status: "held", bookingId: "z", holdExpiresAt: n.ms - 1 }];
  const t = OS.dayTimes(DAY, locks, n);
  assert.strictEqual(t.label, "Wed, Nov 11");
  assert.deepStrictEqual(t.times.slice(0, 3), [{ time: "14:00", label: "2:00", open: false }, { time: "14:15", label: "2:15", open: false },
    { time: "14:30", label: "2:30", open: true }]);
  assert.strictEqual(t.openCount, 5);
  const full = OS.dayTimes(DAY, OS.daySlots(DAY).map((x, i) => ({ time: x, status: "booked", bookingId: "b" + i })), n);
  assert.strictEqual(full.times.length, 7);
  assert.strictEqual(full.openCount, 0);
  assert.strictEqual(OS.dayTimes(DAY, [], nowAt("2026-11-11", "08:00")).times.length, 0);
  const sameDay = OS.dayTimes(DAY, [{ time: "14:00", status: "booked", bookingId: "x" }], nowAt("2026-11-11", "14:20"));
  assert.deepStrictEqual(sameDay.times.map((x) => x.time), ["14:30", "15:00", "15:15", "15:30", "15:45"]);
});
test("phone masking", () => {
  assert.strictEqual(OS.maskPhone("808-555-1223"), "(808) •••-••23");
  assert.strictEqual(OS.maskPhone("+1 (808) 555 1223"), "(808) •••-••23");
  assert.strictEqual(OS.maskPhone("555-1223"), "•••-••23");
  assert.strictEqual(OS.maskPhone(""), "");
  assert.strictEqual(OS.maskPhone("123456789"), "\u2022\u2022\u2022 \u2022\u202289");
});
test("address hint is city and zip only", () => {
  assert.strictEqual(OS.addressHint({ streetAddress: "1 Main St", city: "Kaneohe", zipCode: "96744" }), "Kaneohe 96744");
  assert.strictEqual(OS.hasAddress({ streetAddress: "1 Main St" }), true);
  assert.strictEqual(OS.hasAddress({}), false);
});
test("children come from screenings then children[], deduped by name", () => {
  const kids = OS.familyChildren({
    children: [{ name: "Kai Akamu Test" }, { name: "Mele Test", gender: "Female" }],
    screenings: [{ child: { firstName: "Kai", middleName: "Akamu", lastName: "Test", nativeHawaiian: "Yes", ethnicity: "Hawaiian / Part Hawaiian" } },
      { child: { firstName: "Self", lastName: "Self" } }],
  });
  assert.deepStrictEqual(kids.map((k) => k.firstName), ["Kai", "Mele"]);
  assert.strictEqual(kids[0].key, "c0");
  assert.strictEqual(kids[0].nativeHawaiian, "Yes");
  assert.strictEqual(kids[1].lastName, "Test");
});
test("reminder at/after 9am the day before, once, not when booked that day", () => {
  const b = { status: "booked", date: "2026-11-11", email: "a@b.co" };
  assert.strictEqual(OS.reminderDue(b, nowAt("2026-11-10", "08:59")), false);
  assert.strictEqual(OS.reminderDue(b, nowAt("2026-11-10", "09:00")), true);
  assert.strictEqual(OS.reminderDue(Object.assign({ reminderSentAt: 1 }, b), nowAt("2026-11-10", "10:00")), false);
  assert.strictEqual(OS.reminderDue(Object.assign({ confirmationSentAt: ms("2026-11-10", "08:00") }, b), nowAt("2026-11-10", "10:00")), false);
  assert.strictEqual(OS.reminderDue(Object.assign({ confirmationSentAt: ms("2026-11-08", "08:00") }, b), nowAt("2026-11-10", "10:00")), true);
});
test("no-show check from 8am the next day", () => {
  const b = { status: "booked", date: "2026-11-11" };
  assert.strictEqual(OS.noShowDue(b, nowAt("2026-11-11", "17:00")), false);
  assert.strictEqual(OS.noShowDue(b, nowAt("2026-11-12", "07:59")), false);
  assert.strictEqual(OS.noShowDue(b, nowAt("2026-11-12", "08:00")), true);
  assert.strictEqual(OS.noShowDue(b, nowAt("2026-11-14", "01:00")), true);
});
test("screened vs no-show", () => {
  const parts = __test._screeningParts;
  assert.strictEqual(OS.screeningOutcome({}, parts), "noshow");
  assert.strictEqual(OS.screeningOutcome({ results: { vision: { distance: { right: "20/20", left: "20/20" } } } }, parts), "screened");
  assert.strictEqual(OS.screeningOutcome({ results: { screenedAt: "2026-11-11" } }, parts), "screened");
  assert.strictEqual(OS.screeningOutcome({ results: { screenedAt: "2026-11-11" }, absent: { vision: "2026-11-11", hearing: "2026-11-11" } }, parts), "noshow");
});
test("lead task: from 7 days before, due the day before, count in notes", () => {
  assert.strictEqual(OS.leadTaskWanted(DAY, "2026-11-03"), false);
  assert.strictEqual(OS.leadTaskWanted(DAY, "2026-11-04"), true);
  assert.strictEqual(OS.leadTaskWanted(DAY, "2026-11-11"), true);
  assert.strictEqual(OS.leadTaskWanted(DAY, "2026-11-12"), false);
  assert.strictEqual(OS.leadTaskWanted(Object.assign({}, DAY, { published: false }), "2026-11-05"), false);
  const t = OS.leadTask(DAY, 5, "2026-11-04");
  assert.strictEqual(OS.leadTaskId("2026-11-11"), "officeLead__2026-11-11");
  assert.strictEqual(t.summary, "Office screenings Wed, Nov 11, 2:00 to 4:00 PM: you are the lead");
  assert.strictEqual(t.workflowStep, "officeScreeningLead");
  assert.strictEqual(t.interactionType, "Office screening");
  assert.strictEqual(t.channel, "Other");
  assert.strictEqual(t.followUpDate, "2026-11-10");
  assert.strictEqual(t.ownerUid, "u1");
  assert.match(t.notes, /^5 children booked so far\./);
  assert.strictEqual(OS.leadTask(DAY, 1, "2026-11-11").followUpDate, "2026-11-11");
});
test("screening extras and links", () => {
  assert.deepStrictEqual(OS.screeningExtras({ date: "2026-11-11", time: "14:30", bookingId: "b1" }), {
    source: "office-screening", location: "LDAH Office", classroom: "14:30",
    scheduled: { location: "LDAH Office", dates: ["2026-11-11"], time: "2:30 PM" }, officeBookingId: "b1", officeBookingStatus: "booked" });
  assert.strictEqual(OS.manageUrl("live", "ab"), "https://www.ldahawaii.org/readiness/booking.html?t=ab");
  assert.strictEqual(OS.manageUrl("stage", "ab", "cancel"), "https://www.ldahawaii.org/STAGE/readiness/booking.html?t=ab&action=cancel");
  assert.strictEqual(OS.bookUrl("anything"), "https://www.ldahawaii.org/readiness.html#book");
});
test("no-show note appends to Contact Notes", () => {
  const line = OS.noShowLine({ date: "2026-11-11", time: "14:30", childFirstName: "Kai" });
  assert.strictEqual(line, "No-show: office screening Wed, Nov 11 at 2:30 PM (Kai)");
  assert.strictEqual(OS.appendNote("", "2026-11-12", line), "[System — Nov 12, 2026]\n" + line);
  assert.strictEqual(OS.appendNote("Old note", "2026-11-12", line), "Old note\n---\n[System — Nov 12, 2026]\n" + line);
});

// ── Shared consent core ─────────────────────────────────────────────────────
const FORM = () => ({
  parent: { firstName: "Pat", lastName: "Parent", email: "Pat@Example.com", relationship: "Mother" },
  child: { firstName: "Kid", lastName: "Parent" },
  health: { chronicEar: "No", sickRecently: "No" },
  signedName: "Pat Parent",
});
test("kiosk request without the new fields parses as before", () => {
  const p = __test._parseReadinessConsent({ form: FORM() });
  assert.strictEqual(p.error, undefined);
  assert.strictEqual(p.keepPhone, false);
  assert.strictEqual(p.keepAddress, false);
  assert.strictEqual(p.birthday, "");
  const s = __test._buildReadinessScreening(p, __test._readinessKeptFields(p, null), { id: "s1", ip: "1.2.3.4" });
  assert.deepStrictEqual(Object.keys(s).sort(), ["child", "consentVersion", "health", "id", "parent", "relationship", "signedAt", "signedIp", "signedName", "source"].sort());
  assert.strictEqual(s.source, "outreach-kiosk");
  assert.strictEqual(s.parent.email, "pat@example.com");
  assert.strictEqual("birthday" in s.child, false);
});
test("kiosk validation messages are unchanged", () => {
  const P = __test._parseReadinessConsent;
  const f = FORM(); f.parent.email = ""; assert.strictEqual(P({ form: f }).error, "Please give either an email address or a phone number");
  const g = FORM(); g.signedName = "Pat"; assert.strictEqual(P({ form: g }).error, "Please type your first and last name to sign");
  const h = FORM(); h.child.lastName = ""; assert.strictEqual(P({ form: h }).error, "Child name is required");
  const i = FORM(); i.parent.email = "nope"; assert.strictEqual(P({ form: i }).error, "That email doesn't look right — fix it or leave it blank");
});
test("birthday is saved on the child; a bad one is refused; no age limit", () => {
  const f = FORM(); f.child.birthday = "2009-01-02";
  const p = __test._parseReadinessConsent({ form: f });
  const s = __test._buildReadinessScreening(p, __test._readinessKeptFields(p, null), {});
  assert.strictEqual(s.child.birthday, "2009-01-02");
  const g = FORM(); g.child.birthday = "Jan 2";
  assert.match(__test._parseReadinessConsent({ form: g }).error, /birthday/);
});
test("keepPhone / keepAddress use what is on the contact when nothing new is typed", () => {
  const onFile = { phone: "808-555-1223", streetAddress: "1 Main St", city: "Kaneohe", zipCode: "96744" };
  const p = __test._parseReadinessConsent({ form: FORM(), keepPhone: true, keepAddress: true });
  const k = __test._readinessKeptFields(p, onFile);
  assert.strictEqual(k.phone, "808-555-1223");
  assert.deepStrictEqual(k.address, { streetAddress: "1 Main St", city: "Kaneohe", zipCode: "96744" });
  const s = __test._buildReadinessScreening(p, k, {});
  assert.deepStrictEqual(s.address, k.address);
  // typed values win
  const f = FORM(); f.parent.phone = "808-555-9999"; f.address = { streetAddress: "2 New St", city: "Hilo", zipCode: "96720" };
  const q = __test._parseReadinessConsent({ form: f, keepPhone: true, keepAddress: true });
  const kq = __test._readinessKeptFields(q, onFile);
  assert.strictEqual(kq.phone, "808-555-9999");
  assert.strictEqual(kq.address.city, "Hilo");
  // without the flags nothing is copied from the contact
  const r = __test._parseReadinessConsent({ form: FORM() });
  assert.deepStrictEqual(__test._readinessKeptFields(r, onFile), { phone: "", address: null });
});
test("office booking needs an email; staff on-the-day consent may be unsigned", () => {
  const f = FORM(); f.parent.email = ""; f.parent.phone = "808-555-1223";
  assert.match(__test._parseReadinessConsent({ form: f }, { requireEmail: true }).error, /email/);
  const g = FORM(); g.signedName = "";
  assert.match(__test._parseReadinessConsent({ form: g }).error, /sign/);
  assert.strictEqual(__test._parseReadinessConsent({ form: g }, { paperConsent: true }).error, undefined);
});

// ── Emails ─────────────────────────────────────────────────────────────────
const BOOKING = { date: "2026-11-11", time: "14:30", parentFirstName: "Pat", childFirstName: "Kid", manageToken: "a".repeat(32), site: "live" };
test("confirmation email has the mockup copy and both buttons", () => {
  const h = __test.buildOfficeScreeningEmailHtml("confirmation", BOOKING);
  assert.match(h, /Your screening is booked/);
  assert.match(h, /Hi Pat,/);
  assert.match(h, /Wednesday, November 11 at 2:30 PM/);
  assert.match(h, /245 N Kukui St, Suite 205, Honolulu/);
  assert.match(h, /Kid&rsquo;s glasses, if Kid wears them/);
  assert.match(h, /Hearing aids, if Kid uses them/);
  assert.match(h, /Any past eye or hearing reports, if you have them/);
  assert.match(h, /Nothing hurts and there are no eye drops\. You stay with Kid the whole time\./);
  assert.match(h, /There is ample parking in the lot at the building\./);
  assert.match(h, /Change my time/);
  assert.match(h, /readiness\/booking\.html\?t=a{32}&amp;action=cancel/);
  assert.match(h, /Questions\? Call us at \(808\) 536-9684\./);
  assert.strictEqual(__test._osEmailSubject("confirmation", BOOKING), "Your screening is booked: Wednesday, November 11 at 2:30 PM");
});
test("reminder and no-show emails", () => {
  assert.match(__test.buildOfficeScreeningEmailHtml("reminder", BOOKING), /screening is <strong>tomorrow<\/strong>/);
  const n = __test.buildOfficeScreeningEmailHtml("noshow", Object.assign({}, BOOKING, { site: "stage" }));
  assert.match(n, /Book another time/);
  assert.match(n, /ldahawaii\.org\/STAGE\/readiness\.html#book/);
  assert.doesNotMatch(n, /booking\.html/);
});

test("screened child entry for children[] (11-06)", () => {
  const T = require("../index.js").__test;
  assert.strictEqual(T._childEntryFromScreening({ child: {} }), null);
  const e = T._childEntryFromScreening({ child: { firstName: "Kai", middleName: "M", lastName: "Akana", gender: "Male", ethnicity: "Filipino", birthday: "2021-05-04" } });
  assert.strictEqual(e.name, "Kai M Akana");
  assert.strictEqual(e.gender, "Male");
  assert.strictEqual(e.ethnicity, "Filipino");
  assert.strictEqual(T._ageBandFromBirthday("2021-05-04", "2026-11-06"), "3-5");
  assert.strictEqual(T._ageBandFromBirthday("1992-07-22", "2026-11-06"), "Adult");
  assert.strictEqual(T._ageBandFromBirthday("2014-11-07", "2026-11-06"), "6-12");
});
