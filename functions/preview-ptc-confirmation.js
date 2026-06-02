// Render the Parent Talk Cafe confirmation email to /Volumes/Xcode_Projects/Reports/
// for visual review before deploy. No Firestore, no network — pure render.
const fs = require("fs");
const path = require("path");

// We can't require index.js (it pulls in firebase-admin and triggers boot).
// Instead, inline-copy the helpers and the new template here so the preview
// stays a fast, dependency-free render. Keep these in sync if the real ones
// in index.js change.

function _emailEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function _emailBtn(href, label, opts) {
  const o = opts || {};
  const bg = o.bg || "#1a3c6e";
  const fg = o.fg || "#ffffff";
  const align = o.align === "left" ? "left" : "center";
  const safeHref = _emailEsc(href);
  const safeLabel = _emailEsc(label);
  const wrapAttr = align === "center" ? ' align="center"' : "";
  const wrapMargin = align === "center" ? "16px auto 4px" : "10px 0 4px";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${wrapAttr} style="margin:${wrapMargin};">
      <tr><td align="center" bgcolor="${bg}" style="border-radius:6px;background:${bg};">
        <a href="${safeHref}" target="_blank"
           style="display:inline-block;padding:12px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:${fg};text-decoration:none;border-radius:6px;">
          ${safeLabel}
        </a>
      </td></tr></table>`;
}

function _emailLinkFooter(links) {
  const list = (links || []).filter(l => l && l.href);
  if (!list.length) return "";
  const intro = list.length > 1
    ? "If the buttons above don't work in your email app, you can copy and paste these links into your browser:"
    : "If the button above doesn't work in your email app, you can copy and paste this link into your browser:";
  const items = list.map(l => `
    <p style="margin:10px 0 0;font-size:12px;color:#6b7280;line-height:1.5;">
      <strong style="color:#374151;">${_emailEsc(l.label)}:</strong><br>
      <a href="${_emailEsc(l.href)}" target="_blank" style="color:#9ca3af;text-decoration:underline;word-break:break-all;">${_emailEsc(l.href)}</a>
    </p>`).join("");
  return `<div style="margin:28px 0 8px;padding:14px 18px;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;">
      <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.5;">${intro}</p>
      ${items}
    </div>`;
}

function buildParentTalkCafeConfirmationEmailHtml({ name, eventTitle, datesPhrase, eventTime, donateHtml }) {
  const greetingName = _emailEsc(name || "there");
  const safeTitle = _emailEsc(eventTitle || "Parent Talk Cafe");
  const datesSuffix = datesPhrase ? _emailEsc(datesPhrase) : "";
  const timeLine = eventTime
    ? `<p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">We'll see you at <strong>${_emailEsc(eventTime)}</strong>${datesSuffix ? ` ${_emailEsc(datesPhrase)}` : ""}.</p>`
    : (datesSuffix
        ? `<p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">We'll see you${datesSuffix}.</p>`
        : "");
  const ptcUrl = "https://www.facebook.com/groups/2659334410969387";

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
      <p style="margin:0 0 16px;font-size:16px;color:#333333;">Aloha ${greetingName},</p>

      <p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">
        Mahalo for signing up for <strong>${safeTitle}</strong>${datesSuffix}! We are so glad you'll be joining us for an evening of conversation, encouragement, and aloha with other Hawai'i families.
      </p>

      ${timeLine}

      ${_emailBtn(ptcUrl, "Open Parent Talk Cafe", { bg: "#1877F2", align: "center" })}

      <p style="margin:24px 0 16px;font-size:16px;color:#333333;line-height:1.5;">
        <strong>One thing to do ahead of time:</strong> if you haven't already, please sign up for Facebook and request to join the Parent Talk Cafe group <em>before</em> the session, so you're all set when it's time to talk story.
      </p>

      <p style="margin:0 0 24px;font-size:16px;color:#333333;line-height:1.5;">
        <strong>This is your only reminder for this session</strong> — please save the date and add it to your calendar so it doesn't slip by.
      </p>

      ${donateHtml || ""}

      ${_emailLinkFooter([
        { label: "Parent Talk Cafe (Facebook group)", href: ptcUrl },
      ])}
    </td>
  </tr>

  <tr>
    <td style="background-color:#f0f0f0;padding:24px 32px;text-align:center;border-top:1px solid #dddddd;">
      <p style="margin:0 0 4px;font-size:13px;color:#777777;font-weight:bold;">
        Leadership in Disabilities &amp; Achievement of Hawai'i
      </p>
      <p style="margin:0 0 4px;font-size:12px;color:#999999;">
        245 N. Kukui St., Suite 205, Honolulu, HI 96817
      </p>
      <p style="margin:0;font-size:12px;color:#999999;">
        Phone: (808) 536-9684
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// Sample donate block matching the universal flavor (paypal hosted button).
const sampleDonate =
  '<p style="margin:24px 0 12px;font-size:15px;color:#444;line-height:1.5;">' +
  'LDAH is a small nonprofit. If our work has helped your family, please consider a gift — every dollar funds another seat at Parent Talk Cafe.' +
  '</p>' +
  _emailBtn("https://www.paypal.com/donate?hosted_button_id=F6F2DPC4D6RSA", "Donate", { bg: "#0E7C4D", align: "center" });

const html = buildParentTalkCafeConfirmationEmailHtml({
  name: "Maria",
  eventTitle: "Parent Talk Cafe",
  datesPhrase: ", on May 15th",
  eventTime: "5:00 PM",
  donateHtml: sampleDonate,
});

const out = "/Volumes/Xcode_Projects/Reports/ptc-confirmation-preview.html";
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Wrote ${out}`);
