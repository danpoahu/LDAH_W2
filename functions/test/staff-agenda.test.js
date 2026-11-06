const test = require("node:test");
const assert = require("node:assert");
const A = require("../staffAgenda");

test("weekly dates skip deleted ones and stop at Until", () => {
  assert.deepStrictEqual(A.entryDates({ date: "2026-11-11", repeat: "weekly", skipDates: ["2026-11-25"], repeatUntil: "2026-12-09" }, "2026-11-01", "2027-01-31"),
    ["2026-11-11", "2026-11-18", "2026-12-02", "2026-12-09"]);
});
test("monthly keeps the same nth weekday", () => {
  assert.deepStrictEqual(A.entryDates({ date: "2026-11-11", repeat: "monthly" }, "2026-11-01", "2027-02-28"),
    ["2026-11-11", "2026-12-09", "2027-01-13", "2027-02-10"]);
});
test("one-time entry", () => {
  assert.deepStrictEqual(A.entryDates({ date: "2026-11-11" }, "2026-11-09", "2026-11-15"), ["2026-11-11"]);
  assert.deepStrictEqual(A.entryDates({ date: "2026-11-11" }, "2026-11-12", "2026-11-15"), []);
});
test("ask task is due the day before and opens the agenda", () => {
  const t = A.askTask("abcdefghij12", { title: "Leadership", agendaToName: "Rosie Rowe" }, "2026-11-11", { uid: "u1", name: "Noe" }, "2026-11-09");
  assert.strictEqual(t.followUpDate, "2026-11-10");
  assert.strictEqual(t.workflowStep, "staffAgenda");
  assert.strictEqual(t.ownerUid, "u1");
  assert.match(t.summary, /Leadership \(Wednesday, November 11\)/);
  assert.match(t.notes, /3pm on Tuesday, November 10/);
});
test("final task gives the count, never the item text, to Rosie by default", () => {
  const t = A.finalTask("abcdefghij12", { title: "Leadership" }, "2026-11-11",
    { items: [{ text: "Budget", byName: "Dan" }, { text: "Hiring", byName: "Noe" }], files: [{ name: "base.pdf" }] });
  assert.strictEqual(t.ownerUid, A.ROSIE_UID);
  assert.match(t.notes, /^2 items are on the agenda\./);
  assert.doesNotMatch(t.notes, /Budget|Hiring/);   // item text never goes in a task
  assert.match(t.summary, /2 items$/);
});
test("participants are de-duplicated", () => {
  assert.strictEqual(A.participantsOf({ participants: [{ uid: "a" }, { uid: "a" }, { uid: "" }, { uid: "b" }] }).length, 2);
});

test("agenda members: participants and the finished-agenda person only", () => {
  const e = { participants: [{ uid: "a" }], participantUids: ["a"], agendaToUid: "r" };
  assert.strictEqual(A.isMember(e, "a"), true);
  assert.strictEqual(A.isMember(e, "r"), true);
  assert.strictEqual(A.isMember(e, "superadmin-not-invited"), false);
  assert.strictEqual(A.isMember({ participants: [{ uid: "b" }] }, "b"), true);
});
