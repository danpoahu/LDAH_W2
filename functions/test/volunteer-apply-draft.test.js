// Exercises functions/volunteerApplyLink.js pure helpers for "Email me a link
// to finish on another device" (2026-10-03): the Step 2 draft allow-list and
// caps, email masking, the rate-limit decision, and the finish email shell.
// No Firestore.
//   node functions/test/volunteer-apply-draft.test.js
// All fixture data below is invented.

const P = require("../volunteerApplyLink.js")._pure;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++; console.error("FAIL " + name + "\n  got:  " + g + "\n  want: " + w);
}
function ok(name, cond) { if (cond) pass++; else { fail++; console.error("FAIL " + name); } }

// ── sanitizeDraft ──
eq("null input", P.sanitizeDraft(null, 0), null);
eq("array input", P.sanitizeDraft(["x"], 0), null);
eq("empty object", P.sanitizeDraft({}, 0), null);
eq("only unknown keys", P.sanitizeDraft({ evil: "x", __proto__x: "y" }, 0), null);

let r = P.sanitizeDraft({
  firstName: "Kaʻai", lastName: "Testperson", dob: "1990-04-01", city: "Hilo", state: "HI",
  criminal: "no", hours: 4, preferredDays: ["Mon", "Wed", "Mon", "Funday"],
  driveAgree: true, certify: true, parentConsent: true, signatureName: "Kaʻai Testperson",
  parentSignature: "x", email: "someone@example.com", _noEmail: "no", _minor: "no",
  zip: { nested: 1 }, apt: "   ", middleName: null,
}, 2);
eq("kept keys", Object.keys(r.draft).sort(), ["city", "criminal", "dob", "driveAgree", "firstName", "hours", "lastName", "preferredDays", "state"].sort());
eq("number becomes string", r.draft.hours, "4");
eq("days filtered + unique", r.draft.preferredDays, ["Mon", "Wed"]);
eq("part kept", r.part, 2);
ok("signature not carried", !("signatureName" in r.draft) && !("certify" in r.draft) && !("parentConsent" in r.draft));
ok("email not carried", !("email" in r.draft));
ok("internal flags dropped", !("_noEmail" in r.draft) && !("_minor" in r.draft));
eq("driveAgree only true", P.sanitizeDraft({ driveAgree: "yes", city: "Hilo" }, 0).draft, { city: "Hilo" });

eq("bad part -> 0", P.sanitizeDraft({ city: "Hilo" }, 9).part, 0);
eq("negative part -> 0", P.sanitizeDraft({ city: "Hilo" }, -1).part, 0);
eq("string part", P.sanitizeDraft({ city: "Hilo" }, "3").part, 3);

const long = "a".repeat(5000);
r = P.sanitizeDraft({ city: long, interests: long }, 0);
eq("short field capped at 200", r.draft.city.length, 200);
eq("long field capped at 2000", r.draft.interests.length, 2000);
eq("control chars stripped", P.sanitizeDraft({ city: "Hi\u0000lo\u0007" }, 0).draft.city, "Hilo");
eq("newlines kept in textarea", P.sanitizeDraft({ interests: "a\nb" }, 0).draft.interests, "a\nb");

// Size cap: every key at its max is still under 40 KB? Six long keys x 2000 +
// ~60 short x 200 = ~24 KB, so the cap only bites on multi-byte text.
const all = {}; P.DRAFT_STRING_KEYS.forEach((k) => { all[k] = "😀".repeat(2000); });
eq("over 40 KB refused", P.sanitizeDraft(all, 0), null);
const allAscii = {}; P.DRAFT_STRING_KEYS.forEach((k) => { allAscii[k] = "b".repeat(2000); });
ok("ascii at caps accepted", P.sanitizeDraft(allAscii, 0) !== null);

// ── maskEmail ──
eq("mask gmail", P.maskEmail("danielp@gmail.com"), "d***@gmail.com");
eq("mask trims", P.maskEmail("  x@y.org "), "x***@y.org");
eq("mask invalid", P.maskEmail("nope"), "");
eq("mask leading @", P.maskEmail("@y.org"), "");

// ── rateDecision ──
const DAY = 24 * 3600 * 1000, COOL = P.SELF_COOLDOWN_MS;
const opts = { windowMs: DAY, max: P.SELF_DAY_MAX, cooldownMs: COOL };
let t = 1_000_000_000_000;
let d = P.rateDecision(null, t, opts);
ok("first allowed", d.allowed && d.next.dayCount === 1);
let d2 = P.rateDecision(d.next, t + 60 * 1000, opts);
ok("inside cooldown refused", !d2.allowed && d2.tooSoon && d2.retryAfterSec === 60);
let prev = d.next;
for (let i = 1; i < P.SELF_DAY_MAX; i++) { const x = P.rateDecision(prev, t + i * (COOL + 1000), opts); ok("send " + (i + 1) + " allowed", x.allowed); prev = x.next; }
let d6 = P.rateDecision(prev, t + 10 * (COOL + 1000), opts);
ok("6th in a day refused", !d6.allowed && d6.overMax && !d6.tooSoon);
let dNext = P.rateDecision(prev, t + DAY + 1, opts);
ok("next day allowed", dNext.allowed && dNext.next.dayCount === 1);
ok("no cooldown when lastAt 0 (refund after failed send)", P.rateDecision({ lastAt: 0, dayStart: t, dayCount: 1 }, t + 1000, opts).allowed);

// ── email ──
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const link = P.applyLink("a".repeat(64));
const html = P.buildFinishEmailHtml({
  firstName: "<Lani>", link,
  deps: {
    _emailEsc: esc,
    _emailBtn: (h, l) => '<a class="btn" href="' + esc(h) + '">' + esc(l) + "</a>",
    _emailLinkFooter: () => "<p>footer</p>",
    orgFooterHtml: "<tr><td>org</td></tr>",
  },
});
ok("link to live page", link === "https://www.ldahawaii.org/volunteer.html?apply=" + "a".repeat(64));
ok("one big button", (html.match(/class="btn"/g) || []).length === 1 && html.indexOf("Finish my application") !== -1);
ok("name escaped", html.indexOf("&lt;Lani&gt;") !== -1 && html.indexOf("<Lani>") === -1);
ok("title", html.indexOf("<title>Finish your LDAH volunteer application</title>") !== -1);
ok("org name", html.indexOf("Leadership in Disabilities") !== -1 && !/Learning Disabilities Association/.test(html));
ok("no answers in email", html.indexOf("1990") === -1);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
