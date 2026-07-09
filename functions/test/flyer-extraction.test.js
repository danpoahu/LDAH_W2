const test = require("node:test");
const assert = require("node:assert");
const { sessionsToSignupDates, hasYear, FLYER_TOOL_SCHEMA } = require("../flyerExtraction");

test("sessionsToSignupDates builds canonical year-bearing labels", () => {
  const out = sessionsToSignupDates([
    { date: "July 8, 2026",  topic: "A-B-C's of Advocacy", time: "5:00 PM" },
    { date: "July 22, 2026", topic: "Parents as Collaborative Leaders", time: "5:00 PM" },
  ]);
  assert.deepStrictEqual(out, [
    "July 8, 2026, 5:00 PM - A-B-C's of Advocacy",
    "July 22, 2026, 5:00 PM - Parents as Collaborative Leaders",
  ]);
});

test("hasYear detects a 4-digit year", () => {
  assert.ok(hasYear("July 8, 2026"));
  assert.ok(!hasYear("July 8th, 5pm"));
});

test("sessionsToSignupDates keeps a year-less date usable (topic preserved)", () => {
  const out = sessionsToSignupDates([{ date: "July 8", topic: "Reading" }]);
  assert.ok(out[0].includes("Reading"));
});

test("sessionsToSignupDates uses fallbackTime when a session has no time", () => {
  const out = sessionsToSignupDates(
    [{ date: "July 8, 2026", topic: "A-B-C's of Advocacy" }],
    "5:00 PM"
  );
  assert.strictEqual(out[0], "July 8, 2026, 5:00 PM - A-B-C's of Advocacy");
});

test("sessionsToSignupDates prefers a session's own time over fallback", () => {
  const out = sessionsToSignupDates(
    [{ date: "July 8, 2026", topic: "X", time: "3:00 PM" }],
    "5:00 PM"
  );
  assert.ok(out[0].includes("3:00 PM") && !out[0].includes("5:00 PM"));
});

test("FLYER_TOOL_SCHEMA has required top-level fields", () => {
  assert.strictEqual(FLYER_TOOL_SCHEMA.type, "object");
  for (const k of ["title", "description", "sessions"]) {
    assert.ok(FLYER_TOOL_SCHEMA.properties[k], "missing " + k);
  }
});
