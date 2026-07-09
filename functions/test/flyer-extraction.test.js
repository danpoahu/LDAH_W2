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

test("FLYER_TOOL_SCHEMA has required top-level fields", () => {
  assert.strictEqual(FLYER_TOOL_SCHEMA.type, "object");
  for (const k of ["title", "description", "sessions"]) {
    assert.ok(FLYER_TOOL_SCHEMA.properties[k], "missing " + k);
  }
});
