// Exercises functions/volunteerDocuments.js pure helpers: hours math, the
// LDAH / PTI / SRP split, signature and emergency validation, the defensive
// pre-fill from the full application, and the email shell. No Firestore.
//   node functions/test/volunteer-documents.test.js
// Set VOLDOCS_OUT_DIR to also write the rendered email for eyeballing.
// All fixture data below is invented.

const fs = require("fs");
const path = require("path");
const P = require("../volunteerDocuments.js")._pure;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++; console.error("FAIL " + name + "\n  got:  " + g + "\n  want: " + w);
}
function ok(name, cond) { if (cond) pass++; else { fail++; console.error("FAIL " + name); } }

// Hours
eq("9:00-12:30", P.hoursBetween("09:00", "12:30"), 3.5);
eq("8:15-9:05", P.hoursBetween("08:15", "09:05"), 0.83);
eq("out before in", P.hoursBetween("13:00", "12:00"), null);
eq("same time", P.hoursBetween("13:00", "13:00"), null);
eq("bad time", P.hoursBetween("25:00", "26:00"), null);

// Log entry + split
const base = { serviceDate: "2026-09-30", serviceType: "IEP meeting", timeIn: "09:00", timeOut: "12:30" };
let r = P.validateLogEntry(base, "2026-10-02");
eq("default all LDAH", [r.ok, r.entry.hours, r.entry.ldah, r.entry.pti, r.entry.srp], [true, 3.5, 3.5, 0, 0]);
r = P.validateLogEntry(Object.assign({}, base, { pti: "1", srp: "0.5" }), "2026-10-02");
eq("split", [r.entry.ldah, r.entry.pti, r.entry.srp], [2, 1, 0.5]);
r = P.validateLogEntry(Object.assign({}, base, { pti: "3", srp: "1" }), "2026-10-02");
ok("split over total refused", !r.ok);
r = P.validateLogEntry(Object.assign({}, base, { serviceDate: "2026-10-03" }), "2026-10-02");
ok("future refused", !r.ok);
r = P.validateLogEntry(Object.assign({}, base, { timeIn: "06:00", timeOut: "23:00" }), "2026-10-02");
ok("over 16h refused", !r.ok);
r = P.validateLogEntry(Object.assign({}, base, { serviceType: "" }), "2026-10-02");
ok("type required", !r.ok);
eq("totals", P.sumTotals([{ hours: 3.5, ldah: 2, pti: 1, srp: 0.5 }, { hours: 1.25, ldah: 1.25, pti: 0, srp: 0 }]),
  { ldah: 3.25, pti: 1, srp: 0.5, total: 4.75, count: 2 });

// Signature
ok("sig ok", P.validateSignature({ printedName: "Kai Makani", signature: "kai  makani", certified: true }).ok);
ok("sig mismatch", !P.validateSignature({ printedName: "Kai Makani", signature: "K M", certified: true }).ok);
ok("sig needs tick", !P.validateSignature({ printedName: "Kai Makani", signature: "Kai Makani" }).ok);
ok("sig okina", P.validateSignature({ printedName: "Lei Kaʻaihue", signature: "Lei Kaʻaihue", certified: true }).ok);

// Emergency
ok("em empty refused", !P.validateEmergency({ contacts: [{}, {}, {}] }).ok);
ok("em no phone refused", !P.validateEmergency({ contacts: [{ name: "A B" }] }).ok);
ok("em short phone refused", !P.validateEmergency({ contacts: [{ name: "A B", cellPhone: "12" }] }).ok);
const em = P.validateEmergency({ contacts: [{ name: "Ana Makani", relationship: "Sister", cellPhone: "(808) 555-0142" }, {}, {}], additionalInfo: "Queens" });
eq("em ok", [em.ok, em.value.contacts.length, em.value.additionalInfo], [true, 1, "Queens"]);

// Pre-fill shapes
eq("prefill array", P.contactsFromApplication({ emergencyContacts: [{ name: "A", relationship: "Mom", phone: "8085550100" }] }),
  [{ name: "A", relationship: "Mom", homePhone: "", workPhone: "", cellPhone: "8085550100" }]);
eq("prefill numbered", P.contactsFromApplication({ emergencyContact1: { name: "A", phone: "1" }, emergencyContact2: { name: "B", phone: "2" } }).map((c) => c.name), ["A", "B"]);
eq("prefill flat", P.contactsFromApplication({ ec1Name: "A", ec1Relationship: "Dad", ec1Phone: "3" }).map((c) => c.relationship), ["Dad"]);
eq("prefill full application shape", P.contactsFromApplication({ emergencyContacts: [{ name: "Ana Makani", relationship: "Sister", dayPhone: "(808) 555-0142" }, { name: "Lono Makani", relationship: "Father", dayPhone: "8085550177" }] }).map((c) => c.cellPhone), ["(808) 555-0142", "8085550177"]);
eq("prefill none", P.contactsFromApplication({}), []);

// Agreement text: supervisor default, never the retired org name
const c = P.fillAgreement("confidentiality", {});
ok("supervisor default", JSON.stringify(c).indexOf("Rosie Rowe (staff person supervising volunteer)") !== -1);
const c2 = P.fillAgreement("confidentiality", { supervisorName: "Pat Example" });
ok("supervisor custom", JSON.stringify(c2).indexOf("Pat Example (staff person") !== -1);
const allText = JSON.stringify(P.AGREEMENTS);
ok("no retired org name", !/Disabilities Association/i.test(allText));
ok("current org name", P.agreementPlainText(P.fillAgreement("drugFree", { name: "Kai" })).indexOf("Leadership in Disabilities and Achievement of Hawaiʻi") !== -1);

// Token
const t = P.newToken();
ok("token 64 hex", /^[a-f0-9]{64}$/.test(t));
ok("hash differs", P.hashToken(t) !== t && P.hashToken(t).length === 64);

// Email shell
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const html = P.buildDocumentsEmailHtml({
  firstName: "Kai", link: P.DOCS_PAGE_URL + "?t=" + t, supervisorName: "Rosie Rowe", isResend: false,
  deps: {
    _emailEsc: esc,
    _emailBtn: (h, l) => '<a class="btn" href="' + esc(h) + '">' + esc(l) + "</a>",
    _emailLinkFooter: (links) => links.map((l) => '<p class="foot">' + esc(l.href) + "</p>").join(""),
    orgFooterHtml: '<tr><td class="orgfoot">org</td></tr>',
  },
});
ok("email has button", html.indexOf("Open my volunteer documents") !== -1);
ok("email has link", html.indexOf("?t=" + t) !== -1);
ok("email has logo", html.indexOf("logo_blue.png") !== -1);
ok("email has org footer", html.indexOf("orgfoot") !== -1);
ok("email no retired name", !/Disabilities Association/i.test(html));
if (process.env.VOLDOCS_OUT_DIR) fs.writeFileSync(path.join(process.env.VOLDOCS_OUT_DIR, "volunteer-documents-email.html"), html);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
