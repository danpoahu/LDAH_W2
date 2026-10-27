// Exercises functions/calendarRequestTitle.js. No Firestore, no deploy.
//   node functions/test/calendar-request-title.test.js
// All names are invented.

const assert = require("assert");
const { calendarRequestTask, formatTime } = require("../calendarRequestTitle");

const base = { requesterName: "Pat Example", preferredTime: "12:00", todayKey: "2026-10-27", defaultFollowUp: "2026-10-30" };
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok - " + name); };

t("formatTime", () => {
  assert.strictEqual(formatTime("12:00"), "12pm");
  assert.strictEqual(formatTime("16:30"), "4:30pm");
  assert.strictEqual(formatTime("00:15"), "12:15am");
  assert.strictEqual(formatTime("noonish"), "noonish");
});
t("4 days out is urgent, due today, names the day", () => {
  const r = calendarRequestTask({ ...base, preferredDate: "2026-10-31" });
  assert.strictEqual(r.summary, "EVENT IS Sat, Oct 31 at 12pm (in 4 days) - calendar request from Pat Example, reply ASAP");
  assert.strictEqual(r.urgent, true);
  assert.strictEqual(r.followUpDate, "2026-10-27");
});
t("today and tomorrow", () => {
  assert.match(calendarRequestTask({ ...base, preferredDate: "2026-10-27" }).summary, /\(TODAY\)/);
  assert.match(calendarRequestTask({ ...base, preferredDate: "2026-10-28" }).summary, /\(TOMORROW\)/);
});
t("6 days urgent, 7 days not", () => {
  assert.strictEqual(calendarRequestTask({ ...base, preferredDate: "2026-11-02" }).urgent, true);
  const r = calendarRequestTask({ ...base, preferredDate: "2026-11-03" });
  assert.strictEqual(r.urgent, false);
  assert.strictEqual(r.followUpDate, "2026-10-30");
  assert.strictEqual(r.summary, "Calendar request from Pat Example - event is Tue, Nov 3 at 12pm (in 7 days)");
});
t("past date says so, not urgent", () => {
  const r = calendarRequestTask({ ...base, preferredDate: "2026-10-20" });
  assert.strictEqual(r.urgent, false);
  assert.match(r.summary, /has already passed$/);
});
t("no or bad date keeps the plain title", () => {
  for (const pd of ["", undefined, "10/31/2026"]) {
    const r = calendarRequestTask({ ...base, preferredDate: pd });
    assert.strictEqual(r.summary, "New calendar request from Pat Example");
    assert.strictEqual(r.urgent, false);
  }
});
t("no time omits 'at'", () => {
  assert.strictEqual(calendarRequestTask({ ...base, preferredTime: "", preferredDate: "2026-11-20" }).summary,
    "Calendar request from Pat Example - event is Fri, Nov 20 (in 24 days)");
});
t("missing name", () => {
  assert.match(calendarRequestTask({ ...base, requesterName: "", preferredDate: "2026-11-20" }).summary, /from Unknown requester/);
});
console.log(n + " passed");
