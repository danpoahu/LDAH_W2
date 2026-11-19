"use strict";
/* Scheduled one-off family letters (Daniel 2026-11-19: the Nutcracker tickets letter
   "should go out on Friday @ five pm"). Pure helpers, tested in
   test/scheduled-family-email.test.js. The scheduler in index.js sends them. */

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* "Leilani & Daniel Kailiawa" -> "Leilani"; blank -> "there". */
function firstName(name) {
  const w = String(name || "").trim().split(/\s+/)[0] || "";
  return w.replace(/[^A-Za-zÀ-ɏʻ'-]/g, "") || "there";
}

/* The same branded shell as the event confirmation email (LDAH logo header,
   grey address footer), with plain-text paragraphs and a signature. */
function letterHtml({ greetingName, paragraphs, signatureLines }) {
  const p = (paragraphs || []).map((t) => '<p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">' + esc(t) + "</p>").join("\n      ");
  const sig = (signatureLines || []).map((t, i) => i === 1 ? "<strong>" + esc(t) + "</strong>" : esc(t)).join("<br>");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
  <tr>
    <td style="background-color:#ffffff;padding:28px 32px 20px;text-align:center;border-bottom:3px solid #1a3c6e;">
      <img src="https://www.ldahawaii.org/logo_blue.png" alt="Leadership in Disabilities &amp; Achievement of Hawai'i" width="150" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;">
    </td>
  </tr>
  <tr>
    <td style="padding:32px;">
      <p style="margin:0 0 16px;font-size:16px;color:#333333;">Aloha ${esc(greetingName || "there")},</p>
      ${p}
      ${sig ? '<p style="margin:8px 0 0;font-size:15px;color:#555555;line-height:1.5;">' + sig + "</p>" : ""}
    </td>
  </tr>
  <tr>
    <td style="background-color:#f0f0f0;padding:24px 32px;text-align:center;border-top:1px solid #dddddd;">
      <p style="margin:0 0 4px;font-size:13px;color:#777777;font-weight:bold;">Leadership in Disabilities &amp; Achievement of Hawai'i</p>
      <p style="margin:0 0 4px;font-size:12px;color:#999999;">245 N. Kukui St., Suite 205, Honolulu, HI 96817</p>
      <p style="margin:0;font-size:12px;color:#999999;">Phone: (808) 536-9684</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/* One recipient per email address, confirmed signups only. */
function recipientsFromSignups(signups) {
  const seen = {}, out = [];
  (signups || []).forEach((s) => {
    if (!s || s.status !== "confirmed" || s.archived === true) return;
    const email = String(s.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    const k = email.toLowerCase();
    if (seen[k]) return;
    seen[k] = 1;
    out.push({ email, name: s.name || "", signupId: s.id || "" });
  });
  return out;
}

module.exports = { esc, firstName, letterHtml, recipientsFromSignups };
