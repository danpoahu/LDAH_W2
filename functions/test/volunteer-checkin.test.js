// Exercises functions/volunteerCheckin.js pure helpers: HST time parts, the
// 12-hour / next-day stale rule, the check-out plan (automatic and typed time
// out), rate limiting, roster matching by email, and the link email shell.
// No Firestore.
//   node functions/test/volunteer-checkin.test.js
// Set VOLDOCS_OUT_DIR to also write the rendered email for eyeballing.
// All fixture data below is invented.

const fs = require("fs");
const path = require("path");
const P = require("../volunteerCheckin.js")._pure;
const V = require("../volunteerDocuments.js")._pure;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++; console.error("FAIL " + name + "\n  got:  " + g + "\n  want: " + w);
}
function ok(name, cond) { if (cond) pass++; else { fail++; console.error("FAIL " + name); } }

// HST = UTC-10. 2026-10-02 09:02:45 HST = 19:02:45Z
const hst = (s) => Date.parse(s + "-10:00");
const IN = hst("2026-10-02T09:02:45");
eq("hstParts", P.hstParts(IN), { date: "2026-10-02", hhmm: "09:02" });
eq("hstParts late evening", P.hstParts(hst("2026-10-02T23:59:00")), { date: "2026-10-02", hhmm: "23:59" });

// Stale
ok("fresh not stale", !P.isStale(IN, hst("2026-10-02T15:00:00")));
ok("over 12h stale", P.isStale(hst("2026-10-02T06:00:00"), hst("2026-10-02T18:30:00")));
ok("next day stale", P.isStale(hst("2026-10-02T20:00:00"), hst("2026-10-03T07:00:00")));
ok("none not stale", !P.isStale(0, IN));

// Automatic check-out
let r = P.checkoutPlan(IN, hst("2026-10-02T12:30:10"));
eq("auto plan", r, { ok: true, serviceDate: "2026-10-02", timeIn: "09:02", timeOut: "12:30" });
eq("auto hours", V.hoursBetween(r.timeIn, r.timeOut), 3.47);
r = P.checkoutPlan(IN, hst("2026-10-02T09:02:59"));
ok("same minute refused", !r.ok && !r.needsTimeOut);
r = P.checkoutPlan(0, IN);
ok("not checked in", !r.ok);

// Forgot to check out
r = P.checkoutPlan(IN, hst("2026-10-03T08:00:00"));
ok("stale needs time out", !r.ok && r.needsTimeOut === true);
r = P.checkoutPlan(IN, hst("2026-10-03T08:00:00"), "16:30");
eq("typed time out next day", r, { ok: true, serviceDate: "2026-10-02", timeIn: "09:02", timeOut: "16:30" });
eq("typed hours", V.hoursBetween(r.timeIn, r.timeOut), 7.47);
r = P.checkoutPlan(IN, hst("2026-10-03T08:00:00"), "8:15");
ok("typed before check-in refused", !r.ok && r.needsTimeOut);
r = P.checkoutPlan(IN, hst("2026-10-02T11:00:00"), "13:00");
ok("typed future refused", !r.ok && r.needsTimeOut);
r = P.checkoutPlan(IN, hst("2026-10-02T15:00:00"), "9:45");
eq("typed single-digit hour padded", r.timeOut, "09:45");
r = P.checkoutPlan(IN, hst("2026-10-03T08:00:00"), "25:00");
ok("typed nonsense refused", !r.ok);

// The entry written by check-out passes the existing Service Log validation.
r = P.checkoutPlan(IN, hst("2026-10-02T12:30:10"));
const entry = V.validateLogEntry({ serviceDate: r.serviceDate, serviceType: "Office help", serviceDetail: "Filing", timeIn: r.timeIn, timeOut: r.timeOut, pti: 0, srp: 0 }, "2026-10-02");
eq("entry all LDAH", [entry.ok, entry.entry.hours, entry.entry.ldah, entry.entry.pti, entry.entry.srp], [true, 3.47, 3.47, 0, 0]);
const long = P.checkoutPlan(hst("2026-10-02T05:00:00"), hst("2026-10-03T07:00:00"), "22:30");
ok("17.5h day refused by log validation", !V.validateLogEntry({ serviceDate: long.serviceDate, serviceType: "Other", timeIn: long.timeIn, timeOut: long.timeOut }, "2026-10-03").ok);

// openSummary
const fakeTs = { toMillis: () => IN };
eq("openSummary", P.openSummary({ at: fakeTs, site: "Office" }, hst("2026-10-02T10:00:00")),
  { at: new Date(IN).toISOString(), site: "Office", date: "2026-10-02", timeIn: "09:02", stale: false });
eq("openSummary none", P.openSummary(null, IN), null);

// Site + email cleaning
eq("site", P.cleanSite("  Office <b>"), "Office b");
eq("site long", P.cleanSite("x".repeat(80)).length, 40);
eq("norm email", P.normEmail("  Kai.Makani@Example.COM "), "kai.makani@example.com");
ok("valid email", P.validEmail("kai@example.com"));
ok("invalid email", !P.validEmail("kai@example"));

// Rate limit: 5 min cooldown, 5 a day per email
const day = 24 * 3600 * 1000, opts = { windowMs: day, max: 5, cooldownMs: 5 * 60 * 1000 };
let rec = null, t0 = IN, allowedCount = 0;
for (let i = 0; i < 8; i++) {
  const dec = P.rateDecision(rec, t0 + i * 10 * 60 * 1000, opts);
  if (dec.allowed) allowedCount++;
  rec = dec.next;
}
eq("5 per day", allowedCount, 5);
ok("cooldown blocks", !P.rateDecision({ lastAt: t0, dayStart: t0, dayCount: 1 }, t0 + 60 * 1000, opts).allowed);
ok("window resets", P.rateDecision({ lastAt: t0, dayStart: t0, dayCount: 5 }, t0 + day + 1, opts).allowed);
ok("ip bucket no cooldown", P.rateDecision({ lastAt: t0, dayStart: t0, dayCount: 1 }, t0 + 1000, { windowMs: 3600000, max: 20 }).allowed);

// Roster matching
const rows = [
  { id: "a", email: "Kai@Example.com", status: "accepted", sortMs: 1 },
  { id: "b", email: "kai@example.com", status: "accepted", sortMs: 5, hasToken: true },
  { id: "c", email: "kai@example.com", status: "new", sortMs: 9 },
  { id: "d", email: "kai@example.com", status: "accepted", archived: true, sortMs: 9 },
];
eq("prefers linked record", (P.pickVolunteer(rows, " KAI@example.com") || {}).id, "b");
eq("falls back to newest accepted", (P.pickVolunteer(rows.slice(0, 1), "kai@example.com") || {}).id, "a");
eq("pending applicant ignored", P.pickVolunteer([rows[2]], "kai@example.com"), null);
eq("archived ignored", P.pickVolunteer([rows[3]], "kai@example.com"), null);
eq("unknown email", P.pickVolunteer(rows, "nobody@example.com"), null);

// Link email shell
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tok = "a".repeat(64);
const html = P.buildLinkEmailHtml({
  firstName: "Kai", checkinLink: P.CHECKIN_PAGE_URL + "?t=" + tok, docsLink: V.DOCS_PAGE_URL + "?t=" + tok,
  deps: {
    _emailEsc: esc,
    _emailBtn: (h, l) => '<a class="btn" href="' + esc(h) + '">' + esc(l) + "</a>",
    _emailLinkFooter: (links) => links.map((l) => '<p class="foot">' + esc(l.href) + "</p>").join(""),
    orgFooterHtml: '<tr><td class="orgfoot">org</td></tr>',
  },
});
ok("email button", html.indexOf("Check in on this phone") !== -1);
ok("email checkin link", html.indexOf("volunteer-checkin.html?t=" + tok) !== -1);
ok("email docs link", html.indexOf("volunteer-documents.html?t=" + tok) !== -1);
ok("email logo", html.indexOf("logo_blue.png") !== -1);
ok("email org footer", html.indexOf("orgfoot") !== -1);
ok("email no retired name", !/Disabilities Association/i.test(html));
ok("generic reply never confirms", /If you're on our volunteer roster/.test(P.GENERIC_LINK_REPLY));
if (process.env.VOLDOCS_OUT_DIR) fs.writeFileSync(path.join(process.env.VOLDOCS_OUT_DIR, "volunteer-checkin-email.html"), html);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
