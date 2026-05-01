// One-off: send Virginia O'Toole an IN-PERSON 1-day reminder for
// Connect-Gen on 2026-04-27. Same root cause as the 5-day correction
// on 4/24 — her signup has no per-date modeOverride, so the scheduled
// 1-day reminder went out as Zoom/virtual.
//
// Sends the corrected email. Does NOT modify the signup doc.

const admin = require("firebase-admin");
const { applicationDefault } = require("firebase-admin/app");
admin.initializeApp({ credential: applicationDefault(), projectId: "ldah-932d5" });
const db = admin.firestore();

const COLLECTION = "recurringEvents";
const EVENT_ID = "CmkPXEpPwfAQ5sR377K2";
const SIGNUP_ID = "HrrGvoOdcBhWV0VprO17";
const SESSION_DATE = "2026-04-27";
const OFFICE_LOCATION = "LDAH Office — 245 N. Kukui St., Suite 205, Honolulu, HI 96817";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "re_GweFg3U8_L4VoPVKE7dcqdKoGDBK97LLs";
const SMTP_FROM = process.env.SMTP_FROM || "registration@ldahawaii.org";

function formatHstDateParts(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayName = dt.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const formatted = dt.toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
  return { dayName, formatted };
}

function resolveName(signup) {
  const n = (signup && signup.name ? String(signup.name).trim() : "");
  if (n) return n;
  const e = (signup && signup.email ? String(signup.email).trim() : "");
  if (e && e.indexOf("@") > 0) {
    const first = e.split("@")[0].split(/[._-]/)[0];
    if (first) return first;
  }
  return "there";
}

function buildInPersonReminderHtml({ recipientName, eventTitle, dayName, dateFormatted, startTime, endTime, locationLabel, surveyUrl }) {
  const timeLine = (startTime || endTime)
    ? ` from ${startTime || ""}${endTime ? " to " + endTime : ""}`
    : "";

  const tomorrowLine = `<p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">
      This is a friendly reminder that <strong>${eventTitle}</strong> is <strong>tomorrow</strong>, ${dayName}, ${dateFormatted}${timeLine}.
    </p>`;

  const accomNote = `<p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">
      As arranged, you will be joining us <strong>at the LDAH office</strong> for this session rather than on Zoom. Please disregard the Zoom link in yesterday's reminder.
    </p>`;

  const locationBlock = `<div style="margin:16px 0;padding:16px;background-color:#f4f8fc;border-left:4px solid #1a3c6e;border-radius:4px;">
      <p style="margin:0 0 6px;font-size:15px;color:#1a3c6e;font-weight:bold;">In-Person Location</p>
      <p style="margin:0;font-size:15px;color:#333333;">${locationLabel}</p>
    </div>`;

  const surveyBlock = `<div style="margin:16px 0;padding:16px;background-color:#fff8e8;border-left:4px solid #c79400;border-radius:4px;">
      <p style="margin:0 0 6px;font-size:15px;color:#8a6600;font-weight:bold;">Evaluation Survey Link</p>
      <p style="margin:0;font-size:15px;color:#333333;word-break:break-all;">
        <a href="${surveyUrl}" target="_blank" style="color:#1a73e8;text-decoration:none;">${surveyUrl}</a>
      </p>
      <p style="margin:6px 0 0;font-size:13px;color:#555555;">Please complete after the session.</p>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
  <tr><td style="background-color:#ffffff;padding:28px 32px 20px;text-align:center;border-bottom:3px solid #1a3c6e;">
    <img src="https://www.ldahawaii.org/logo_blue.png" alt="Leadership in Disabilities &amp; Achievement of Hawai'i" width="150" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;">
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 16px;font-size:16px;color:#333333;">Aloha, ${recipientName},</p>
    ${tomorrowLine}
    ${accomNote}
    <p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">
      Below is the meeting location and evaluation survey (please complete after the session):
    </p>
    ${locationBlock}
    ${surveyBlock}
    <p style="margin:16px 0;font-size:15px;color:#555555;line-height:1.5;">
      If you have further questions, please call us at <strong>808-536-9684</strong>. We are here to support you.
    </p>
    <p style="margin:24px 0 4px;font-size:15px;color:#333333;line-height:1.5;">With gratitude,</p>
    <p style="margin:0 0 16px;font-size:15px;color:#333333;line-height:1.5;"><strong>LDAH Team</strong></p>
    <p style="margin:16px 0 2px;font-size:14px;color:#555555;line-height:1.5;">
      <strong>Leilani Kailiawa</strong><br>
      Parent Consultant<br>
      Leadership in Disabilities &amp; Achievement of Hawai'i<br>
      245 N. Kukui St. Ste. 205, Honolulu, HI 96817<br>
      Phone: (808) 536-9684 ext 112<br>
      <a href="https://www.ldahawaii.org" style="color:#1a73e8;text-decoration:none;">LDAHawaii.org</a>
    </p>
  </td></tr>
  <tr><td style="background-color:#f0f0f0;padding:24px 32px;text-align:center;border-top:1px solid #dddddd;">
    <p style="margin:0 0 4px;font-size:13px;color:#777777;font-weight:bold;">Leadership in Disabilities &amp; Achievement of Hawai'i</p>
    <p style="margin:0 0 4px;font-size:12px;color:#999999;">245 N. Kukui St., Suite 205, Honolulu, HI 96817</p>
    <p style="margin:0 0 4px;font-size:12px;color:#999999;">Phone: (808) 536-2280</p>
    <p style="margin:0;font-size:12px;color:#999999;">Email: <a href="mailto:rrowe@ldahawaii.org" style="color:#999999;">rrowe@ldahawaii.org</a></p>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

async function main() {
  const eventRef = db.doc(`${COLLECTION}/${EVENT_ID}`);
  const signupRef = eventRef.collection("signups").doc(SIGNUP_ID);
  const [eventSnap, signupSnap] = await Promise.all([eventRef.get(), signupRef.get()]);
  if (!eventSnap.exists) throw new Error("Event not found: " + EVENT_ID);
  if (!signupSnap.exists) throw new Error("Signup not found: " + SIGNUP_ID);

  const event = eventSnap.data();
  const signup = signupSnap.data();

  if (signup.status !== "confirmed") {
    console.warn(`WARN: signup.status is "${signup.status}", not "confirmed". Aborting.`);
    process.exit(2);
  }

  const { dayName, formatted } = formatHstDateParts(SESSION_DATE);
  const recipientName = resolveName(signup);
  const eventTitle = (event && event.title) || "Connect-Gen";
  const startTime = (event && (event.startTime || event.time)) || "3:00 PM";
  const endTime = (event && event.endTime) || "5:00 PM";

  const surveyUrl = "https://ldahawaii.org/feedback.html?signupId=" +
    encodeURIComponent(SIGNUP_ID) + "&eventId=" + encodeURIComponent(EVENT_ID) +
    "&type=recurring";

  const html = buildInPersonReminderHtml({
    recipientName, eventTitle, dayName, dateFormatted: formatted,
    startTime, endTime, locationLabel: OFFICE_LOCATION, surveyUrl,
  });

  const subject = `Reminder: ${eventTitle} is Tomorrow -- ${dayName}, ${formatted} (In Person at LDAH)`;
  const to = signup.email;
  const from = `LDAH <${SMTP_FROM}>`;

  console.log("About to send:");
  console.log("  to:", to);
  console.log("  recipient:", recipientName);
  console.log("  subject:", subject);
  console.log("  location:", OFFICE_LOCATION);

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error("Resend FAILED:", resp.status, err);
    await db.collection("emailLog").add({
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      from, to, bcc: "", subject, html,
      type: "event-reminder-1day",
      relatedEventId: EVENT_ID,
      relatedSignupId: SIGNUP_ID,
      recipientName,
      success: false,
      error: `Resend API error (${resp.status}): ${err}`,
      resendId: null,
    });
    process.exit(1);
  }

  const result = await resp.json();
  console.log("Resend OK — id:", result.id);

  await db.collection("emailLog").add({
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    from, to, bcc: "", subject, html,
    type: "event-reminder-1day",
    relatedEventId: EVENT_ID,
    relatedSignupId: SIGNUP_ID,
    recipientName,
    success: true,
    error: null,
    resendId: result.id || null,
    note: "Manual send — corrected from Zoom to in-person at office (Virginia special accommodation, 1-day reminder)",
  });

  console.log("emailLog entry written. Done.");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
