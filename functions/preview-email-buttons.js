// Render samples of every email template to a single HTML preview.
// Copies index.js to a tmp file, appends a __previewBuilders export, stubs
// firebase modules, then requires it.

const fs = require("fs");
const path = require("path");
const os = require("os");
const Module = require("module");

const SRC = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const tmp = path.join(os.tmpdir(), "ldah-index-preview-" + Date.now() + ".js");
fs.writeFileSync(tmp, SRC + `

module.exports.__previewBuilders = {
  buildRegistrationEmailHtml,
  buildNoShowEmailHtml,
  buildFeedbackEmailHtml,
  buildEventReminderEmailHtml,
  buildAnnouncementEmailHtml,
  buildRecordingEmailHtml,
};
`);

// Stub firebase-admin and firebase-functions before require.
const origResolve = Module._resolveFilename;
const origLoad = Module._load;
const stubs = new Map([
  ["firebase-admin", { initializeApp: () => {}, firestore: () => ({ FieldValue: {} }), credential: { applicationDefault: () => ({}) } }],
  ["firebase-admin/app", { applicationDefault: () => ({}), initializeApp: () => {} }],
  ["firebase-functions", makeFunctionsStub()],
  ["firebase-functions/v1", makeFunctionsStub()],
  ["nodemailer", { createTransport: () => ({ sendMail: () => Promise.resolve({}) }) }],
  ["resend", { Resend: function() { this.emails = { send: () => Promise.resolve({ id: "stub" }) }; } }],
  ["@anthropic-ai/sdk", { Anthropic: function () { this.messages = { create: () => Promise.resolve({}) }; } }],
  ["googleapis", { google: { auth: { GoogleAuth: function () {} }, calendar: () => ({}) } }],
  ["axios", { default: () => Promise.resolve({}), get: () => Promise.resolve({}), post: () => Promise.resolve({}) }],
]);

function makeFunctionsStub() {
  const trigger = new Proxy(function () {}, {
    get(t, prop) { return trigger; },
    apply() { return trigger; },
  });
  return new Proxy({}, {
    get() { return trigger; },
  });
}

Module._load = function (request, parent, ...rest) {
  if (stubs.has(request)) return stubs.get(request);
  return origLoad.apply(this, [request, parent, ...rest]);
};

const mod = require(tmp);
const B = mod.__previewBuilders || mod;

if (!B.buildRegistrationEmailHtml) {
  console.error("Failed to load builders. Available exports:", Object.keys(mod).slice(0, 20));
  process.exit(1);
}

const samples = [];

samples.push({ title: "1. Registration Confirmation", html: B.buildRegistrationEmailHtml({
  name: "Virginia",
  eventTitle: "Connect-Gen",
  eventDate: "Monday, April 27, 2026",
  signupId: "HrrGvoOdcBhWV0VprO17",
  eventId: "CmkPXEpPwfAQ5sR377K2",
  type: "recurring",
}) });

samples.push({ title: "2. No-Show Re-Invite (with next event)", html: B.buildNoShowEmailHtml({
  name: "Virginia",
  eventTitle: "Learning Labs Chapter 60",
  nextEventTitle: "Connect-Gen",
  nextEventDate: "Monday, May 4, 2026",
  nextEventUrl: "https://ldahawaii.org/events.html?eventId=CmkPXEpPwfAQ5sR377K2",
}) });

samples.push({ title: "2b. No-Show Re-Invite (no next event)", html: B.buildNoShowEmailHtml({
  name: "Virginia",
  eventTitle: "Learning Labs Chapter 60",
}) });

samples.push({ title: "3. Feedback Follow-Up", html: B.buildFeedbackEmailHtml({
  name: "Virginia",
  eventTitle: "Connect-Gen",
  feedbackUrl: "https://ldahawaii.org/feedback.html?signupId=HrrGvoOdcBhWV0VprO17&eventId=CmkPXEpPwfAQ5sR377K2&type=recurring&sessionDate=2026-04-27",
  mode: "initial",
}) });

samples.push({ title: "4a. Reminder — VIRTUAL (Zoom)", html: B.buildEventReminderEmailHtml({
  recipientName: "Virginia",
  eventTitle: "Connect-Gen",
  dayName: "Monday",
  dateFormatted: "April 27, 2026",
  startTime: "3:00 PM",
  endTime: "5:00 PM",
  isVirtual: true,
  zoomUrl: "https://us02web.zoom.us/j/82345678901?pwd=abcDEF123ghiJKL456mnoPQR789stuVWX",
  meetingId: "823 4567 8901",
  passcode: "2gi=UL+@",
  surveyUrl: "https://ldahawaii.org/feedback.html?signupId=HrrGvoOdcBhWV0VprO17&eventId=CmkPXEpPwfAQ5sR377K2&type=recurring&sessionDate=2026-04-27",
  mode: "5day",
}) });

samples.push({ title: "4b. Reminder — IN-PERSON", html: B.buildEventReminderEmailHtml({
  recipientName: "Virginia",
  eventTitle: "Connect-Gen",
  dayName: "Monday",
  dateFormatted: "April 27, 2026",
  startTime: "3:00 PM",
  endTime: "5:00 PM",
  isVirtual: false,
  locationLabel: "LDAH Office — 245 N. Kukui St., Suite 205, Honolulu, HI 96817",
  surveyUrl: "https://ldahawaii.org/feedback.html?signupId=HrrGvoOdcBhWV0VprO17&eventId=CmkPXEpPwfAQ5sR377K2&type=recurring&sessionDate=2026-04-27",
  mode: "1day",
}) });

samples.push({ title: "5. Announcement Blast", html: B.buildAnnouncementEmailHtml({
  event: {
    title: "IDEA Workshop: Understanding IEPs",
    signupDates: ["Saturday, May 17, 2026"],
    location: "LDAH Office, Honolulu",
    description: "Join us for a workshop on Understanding IEPs. We'll cover the IEP process from start to finish, including how to prepare for meetings, how to advocate for your child, and how to ensure your child receives the services they need.",
  },
  contact: {
    displayName: "Virginia O'Toole",
    unsubscribeToken: "abc123token",
  },
  unsubscribeUrl: "https://us-central1-ldah-932d5.cloudfunctions.net/handleUnsubscribe?token=abc123token",
  eventId: "EVT_IDEA_2026_05_17",
}) });

samples.push({ title: "6. Recording & Slides Follow-Up", html: B.buildRecordingEmailHtml({
  bodyText: "Aloha,\n\nMahalo for joining us for Learning Labs IDEA Chapter 60 on Tuesday. As promised, here is the Zoom recording and the slide deck from the session.\n\nIf you have any questions or would like to discuss further, please don't hesitate to reach out.\n\nWith gratitude,\nLeilani",
  eventTitle: "Learning Labs: IDEA Chapter 60",
  recordingUrl: "https://us02web.zoom.us/rec/share/abc123def456ghi789jkl0mnopqrstuvwxyz1234567890",
  passcode: "2gi=UL+@",
  slidesDownloadUrl: "https://firebasestorage.googleapis.com/v0/b/ldah-932d5.appspot.com/o/recordings%2FEVT_TEST%2F2026-04-22%2FIDEA_CH60.pdf?alt=media&token=89abcdef-1234-5678-9012-3456789abcde",
  slidesFileName: "IDEA_CH60PDFw notes.pdf",
}) });

const wrapped = samples.map(s => `
  <section style="max-width:800px;margin:32px auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;background:#fff;">
    <h2 style="margin:0;padding:16px 24px;background:#1a3c6e;color:#fff;font-size:18px;font-family:system-ui;">${s.title}</h2>
    <div style="padding:0;">${s.html}</div>
  </section>
`).join("\n");

const out = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>LDAH Email Button Preview — 2026-04-26</title>
<style>body{margin:0;background:#f9fafb;font-family:system-ui;}h1{max-width:800px;margin:32px auto 0;padding:0 24px;color:#1a3c6e;}p.note{max-width:800px;margin:8px auto 24px;padding:0 24px;color:#6b7280;}</style>
</head><body>
<h1>LDAH Email Templates — Buttons + Copy/Paste URLs</h1>
<p class="note">Generated 2026-04-26. Each card shows the rendered email body with the new pattern: a button at the call-to-action, then a small light-grey URL underneath for plain-text fallback. Reminder, no-show, registration, feedback, announcement, and recording emails all share the same convention now.</p>
${wrapped}
</body></html>`;

const outPath = "/Volumes/Xcode_Projects/Reports/email-button-preview-2026-04-26.html";
fs.writeFileSync(outPath, out);
console.log("Wrote: " + outPath);
console.log("Open with: open '" + outPath + "'");

try { fs.unlinkSync(tmp); } catch (_) {}
