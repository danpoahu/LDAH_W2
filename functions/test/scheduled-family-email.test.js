"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { firstName, letterHtml, recipientsFromSignups } = require("../scheduledFamilyEmail");

test("first name from a signup name", () => {
  assert.strictEqual(firstName("Leilani & Daniel Kailiawa"), "Leilani");
  assert.strictEqual(firstName("  Noelani Dela Vega "), "Noelani");
  assert.strictEqual(firstName(""), "there");
});

test("letter uses the branded shell and escapes text", () => {
  const h = letterHtml({ greetingName: "Kai", paragraphs: ["Tickets <b>gone</b> & sorry."], signatureLines: ["Warmly,", "Daniel Pellegrini"] });
  assert.ok(h.includes("logo_blue.png"));
  assert.ok(h.includes("245 N. Kukui St."));
  assert.ok(h.includes("Aloha Kai,"));
  assert.ok(h.includes("Tickets &lt;b&gt;gone&lt;/b&gt; &amp; sorry."));
  assert.ok(h.includes("<strong>Daniel Pellegrini</strong>"));
});

test("recipients: confirmed only, one per email", () => {
  const r = recipientsFromSignups([
    { id: "1", status: "confirmed", email: "a@x.org", name: "A" },
    { id: "2", status: "confirmed", email: "A@x.org", name: "A2" },
    { id: "3", status: "cancelled", email: "b@x.org" },
    { id: "4", status: "confirmed", email: "bad" },
    { id: "5", status: "confirmed", email: "c@x.org", archived: true },
  ]);
  assert.deepStrictEqual(r.map((x) => x.email), ["a@x.org"]);
});
