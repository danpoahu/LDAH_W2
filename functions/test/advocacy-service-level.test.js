const test = require("node:test");
const assert = require("node:assert");
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "ldah-932d5";
const { serviceLevelOf } = require("../advocacyReadiness.js");

test("screening case management is not scored", () => {
  assert.strictEqual(serviceLevelOf({ serviceLevel: "management" }, null), "management");
  assert.strictEqual(serviceLevelOf({ caseAdvocacySource: "lions-screening" }, {}), "management");
});
test("advocacy cases are scored", () => {
  assert.strictEqual(serviceLevelOf({ serviceLevel: "advocacy" }, null), "advocacy");
  assert.strictEqual(serviceLevelOf({}, null), "advocacy");
  assert.strictEqual(serviceLevelOf({ caseAdvocacySource: "lions-screening" }, { caseAdvocacyAuthorization: { signedAt: 1 } }), "advocacy");
});
test("an explicit management level wins over a signed authorization, as on the report", () => {
  assert.strictEqual(serviceLevelOf({ serviceLevel: "management" }, { caseAdvocacyAuthorization: {} }), "management");
});
