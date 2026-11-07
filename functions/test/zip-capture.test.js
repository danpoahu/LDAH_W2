const test = require("node:test");
const assert = require("node:assert");
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "ldah-932d5";
const { __test } = require("../index.js");
const Z = __test._zip5;
const A = __test._signupTopLevelAddress;

test("_zip5 keeps a plain 5-digit zip", () => {
  assert.strictEqual(Z("96817"), "96817");
  assert.strictEqual(Z(" 96720 "), "96720");
});
test("_zip5 trims ZIP+4 and finds a zip inside text", () => {
  assert.strictEqual(Z("96817-1234"), "96817");
  assert.strictEqual(Z("Honolulu, HI 96813"), "96813");
});
test("_zip5 returns empty for nothing usable", () => {
  assert.strictEqual(Z(""), "");
  assert.strictEqual(Z(null), "");
  assert.strictEqual(Z(undefined), "");
  assert.strictEqual(Z("9681"), "");
  assert.strictEqual(Z("968171"), "");
  assert.strictEqual(Z(96817), "96817");
});
test("_signupTopLevelAddress reads the parent zip on the first form", () => {
  assert.deepStrictEqual(A({ zipCode: "96793", name: "x" }), { zipCode: "96793", city: "" });
});
test("_signupTopLevelAddress carries a top-level city (app form state)", () => {
  assert.deepStrictEqual(A({ zipCode: "", city: " Hilo " }), { zipCode: "", city: "Hilo" });
});
test("_signupTopLevelAddress ignores a bad zip and returns null when empty", () => {
  assert.strictEqual(A({ zipCode: "abc" }), null);
  assert.strictEqual(A({}), null);
  assert.strictEqual(A(null), null);
  assert.strictEqual(A({ registration: { zipCode: "96817" } }), null);   // registration is handled elsewhere
});
