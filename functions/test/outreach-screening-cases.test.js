const test = require("node:test");
const assert = require("node:assert");
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "ldah-932d5";
const { __test } = require("../index.js");
const { _isSelfScreening, _schoolScreeningFails } = __test;

test("a parent screening themselves is a self screening", () => {
  assert.strictEqual(_isSelfScreening({ relationship: "Other: Self", child: { firstName: "Self" } }), true);
  assert.strictEqual(_isSelfScreening({ relationship: "Mother", child: { firstName: "Self", lastName: "Self" } }), true);
});
test("a child screened by a parent is not a self screening", () => {
  assert.strictEqual(_isSelfScreening({ relationship: "Mother", child: { firstName: "William" } }), false);
  assert.strictEqual(_isSelfScreening({ relationship: "Selfish uncle", child: { firstName: "Ana" } }), false);
});
test("an OAE + tympanometry fail is a hearing fail", () => {
  const res = { hearing: { oae: { right: "Fail", left: "Fail" }, tympanometry: { right: "Fail", left: "Fail" } }, vision: { distance: { right: "", left: "" } } };
  assert.deepStrictEqual(_schoolScreeningFails(res), ["hearing"]);
});
test("all passes are no fail", () => {
  const res = { hearing: { oae: { right: "Pass", left: "Pass" } }, vision: {} };
  assert.deepStrictEqual(_schoolScreeningFails(res), []);
});
