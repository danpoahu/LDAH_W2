"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { isStaffCard, countNeeds, initials } = require("../volunteerStaff");

test("staff card: flag or @ldahawaii.org email", () => {
  assert.strictEqual(isStaffCard({ isStaff: true, email: "someone@gmail.com" }), true);
  assert.strictEqual(isStaffCard({ email: "RRowe@LDAHawaii.org " }), true);
  assert.strictEqual(isStaffCard({ email: "parent@gmail.com" }), false);
  assert.strictEqual(isStaffCard({ isStaff: false, email: "x@ldahawaii.org" }), false);
  assert.strictEqual(isStaffCard(null), false);
});

test("extra staff count as volunteers and lower the volunteer count", () => {
  const c = countNeeds({ staffNeeded: 2, volunteersNeeded: 3 }, [
    { isStaff: true, confirmed: true }, { isStaff: true, confirmed: true }, { isStaff: true, confirmed: true },
    { confirmed: true }, { confirmed: false },
  ]);
  assert.deepStrictEqual([c.staffConf, c.volConf, c.extraStaff, c.staffStill, c.volStill], [3, 1, 1, 0, 1]);
});

test("staff short, volunteers full", () => {
  const c = countNeeds({ staffNeeded: 2, volunteersNeeded: 1 }, [{ confirmed: true }, { isStaff: true, confirmed: true }]);
  assert.deepStrictEqual([c.staffStill, c.volStill, c.extraStaff], [1, 0, 0]);
});

test("volunteer count never goes below zero", () => {
  const c = countNeeds({ staffNeeded: 0, volunteersNeeded: 1 }, [{ isStaff: true, confirmed: true }, { isStaff: true, confirmed: true }]);
  assert.deepStrictEqual([c.extraStaff, c.volStill], [2, 0]);
});

test("old request without the split counts everyone against maxVolunteers", () => {
  const c = countNeeds({ maxVolunteers: "3" }, [{ isStaff: true, confirmed: true }, { confirmed: true }]);
  assert.strictEqual(c.split, false);
  assert.strictEqual(c.volStill, 1);
  assert.strictEqual(c.staffStill, 0);
});

test("0 staff and 0 volunteers means no limit", () => {
  const c = countNeeds({ staffNeeded: 0, volunteersNeeded: 0, maxVolunteers: 0 }, [{ confirmed: true }]);
  assert.strictEqual(c.split, false);
  assert.strictEqual(c.volStill, 0);
});

test("initials", () => {
  assert.strictEqual(initials("Rosie Rowe"), "RR");
  assert.strictEqual(initials("Noelani Dela Vega"), "NDV");
  assert.strictEqual(initials(""), "");
});
