const test = require("node:test");
const assert = require("node:assert");
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "ldah-932d5";
const { __test } = require("../index.js");
const R = __test._islandFromPlaces;

test("contact zip wins", () => {
  assert.deepStrictEqual(R({ zipCode: "96720" }, []), { island: "Hawaii", islandSource: "zip" });
});
test("screening address zip fills an empty contact", () => {
  const a = R({ screenings: [{ address: { zipCode: "96717", city: "Hauula" } }] }, []);
  assert.strictEqual(a.island, "Oahu"); assert.strictEqual(a.islandSource, "screening address"); assert.strictEqual(a.address.zipCode, "96717");
});
test("signup registration zip fills an empty contact", () => {
  const b = R({}, [{ registration: { zipCode: "96793" } }]);
  assert.strictEqual(b.island, "Maui"); assert.strictEqual(b.islandSource, "signup address");
});
test("signup city alone, unambiguous name only", () => {
  assert.strictEqual(R({}, [{ registration: { city: "Kaunakakai" } }]).island, "Molokai");
  assert.strictEqual(R({}, [{ registration: { city: "Waimea" } }]).island, "Unknown");   // on two islands
});
test("a partner stamp alone is never used", () => {
  assert.strictEqual(R({ partnerIsland: "Guam" }, []).island, "Unknown");
});

test("a booth signup's specialCapture address counts", () => {
  const c = R({}, [{ specialCapture: { zipCode: "96748", city: "Kaunakakai" } }]);
  assert.strictEqual(c.island, "Molokai"); assert.strictEqual(c.address.city, "Kaunakakai");
});
