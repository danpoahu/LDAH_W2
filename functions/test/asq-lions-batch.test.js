const test = require("node:test");
const assert = require("node:assert");
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "ldah-932d5";
const { _asqLionsTodoKeys } = require("../index.js").__test;
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
