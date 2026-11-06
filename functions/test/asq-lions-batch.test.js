const test = require("node:test");
const assert = require("node:assert");
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "ldah-932d5";
const { _asqLionsTodoKeys: _raw, _asqGroupBySchool, _asqLionsLabel } = require("../index.js").__test;
const _asqLionsTodoKeys = (c, r, t) => _raw(c, r, t).map((x) => x.key);
const T = "2026-11-05";
const kid = (id, child, extra) => Object.assign({ id, source: "lions-screening", child }, extra || {});

test("a new Lions child waits for entry; entered and not-needed do not", () => {
  const c = [{ id: "c1", screenings: [kid("a", { birthdate: "2022-03-01" }), kid("b", { birthdate: "2022-03-01" }), kid("d", { birthdate: "2022-03-01" })] }];
  const recs = { c1__b: { status: "entered" }, c1__d: { status: "notNeeded" } };
  assert.deepStrictEqual(_asqLionsTodoKeys(c, recs, T), ["c1__a"]);
});
test("over ASQ age is held back unless Send anyway", () => {
  const c = [{ id: "c1", screenings: [kid("a", { birthdate: "2019-01-01" }), kid("b", {}, { grade: "2" }), kid("e", { birthdate: "2019-01-01" })] }];
  assert.deepStrictEqual(_asqLionsTodoKeys(c, { c1__e: { sendAnyway: true } }, T), ["c1__e"]);
});
test("school-paper, archived, partner and sandbox families are skipped", () => {
  const c = [
    { id: "c1", screenings: [{ id: "a", source: "school-paper", child: {} }] },
    { id: "c2", archived: true, screenings: [kid("a", {})] },
    { id: "c3", partnerIsland: "Guam", screenings: [kid("a", {})] },
    { id: "c4", sandbox: true, screenings: [kid("a", {})] },
  ];
  assert.deepStrictEqual(_asqLionsTodoKeys(c, {}, T), []);
});
test("no birthdate and no grade still counts (age unknown)", () => {
  assert.deepStrictEqual(_asqLionsTodoKeys([{ id: "c1", screenings: [kid("a", {})] }], {}, T), ["c1__a"]);
});

test("a bunch is split by school, largest first", () => {
  const g = _asqGroupBySchool([{ key: "a", school: "Kahala Elementary" }, { key: "b", school: "Makakilo Elementary" }, { key: "c", school: "Makakilo Elementary" }]);
  assert.deepStrictEqual(g, [{ school: "Makakilo Elementary", keys: ["b", "c"] }, { school: "Kahala Elementary", keys: ["a"] }]);
});
test("labels read plainly", () => {
  assert.strictEqual(_asqLionsLabel("HONOWAI ELEMENTARY SCHOOL"), "Honowai (Lions)");
  assert.strictEqual(_asqLionsLabel("WAI'ALAE ELEMENTARY PCS"), "Wai'alae (Lions)");
  assert.strictEqual(_asqLionsLabel(""), "Lions vision");
});

test("a child needs a mailing address before going to Dustin", () => {
  const { _asqHasAddress } = require("../index.js").__test;
  assert.strictEqual(_asqHasAddress({}, kid("a", {})), false);
  assert.strictEqual(_asqHasAddress({ streetAddress: "  " }, kid("a", {})), false);
  assert.strictEqual(_asqHasAddress({ streetAddress: "1 Main St" }, kid("a", {})), true);
  assert.strictEqual(_asqHasAddress({}, kid("a", {}, { parent: { address: "2 Kukui St" } })), true);
  const r = _raw([{ id: "c1", screenings: [kid("a", {})] }, { id: "c2", streetAddress: "1 Main St", screenings: [kid("b", {})] }], {}, T);
  assert.deepStrictEqual(r.map((x) => [x.key, x.ready]), [["c1__a", false], ["c2__b", true]]);
});
