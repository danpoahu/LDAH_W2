// ═══════════════════════════════════════════════════════════════════════════
// Volunteer thank-you email (2026-11-10)
//
// Daniel: "next time we do this and attendance is saved and hours reviewed
// then we can send this out". One email per volunteer on a help request,
// signed by the request's Lead: their hours for the event, their total for the
// calendar year, and an "Invite a friend to volunteer" button.
//
//   sendVolunteerThankYou({ requestId, serviceDate:'YYYY-MM-DD', volunteerIds:[],
//     subject, opening, nextUp, preview? })   subject may use {first}
//     preview:true -> { html, subject } for the first volunteer, nothing sent.
//     otherwise    -> { sent:[names], failed:[{name, reason}] }
// Lead of the request or a Super Admin. Sends go through sendEmailViaResend so
// each one lands in emailLog on the volunteer's contact card.
// ═══════════════════════════════════════════════════════════════════════════

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

const INVITE_URL = "https://www.ldahawaii.org/volunteer.html#volunteer";
const MAIN_LINE = "(808) 536-9684";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function clean(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max || 200);
}
function t12(h) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(h || ""));
  if (!m) return "";
  let a = Number(m[1]);
  const ap = a >= 12 ? "pm" : "am";
  a = a % 12 || 12;
  return a + ":" + m[2] + " " + ap;
}
function fmtHours(n) {
  n = Math.round((Number(n) || 0) * 100) / 100;
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0$/, "");
}
function dayParts(key) {
  const d = new Date(key + "T12:00:00Z");
  return { weekday: WEEKDAYS[d.getUTCDay()], short: WEEKDAYS[d.getUTCDay()].slice(0, 3) + ", " + MONTHS[d.getUTCMonth()] + " " + d.getUTCDate() };
}
function defaultOpening(title, weekday) {
  return "Mahalo for giving your " + weekday + " to LDAH at " + clean(title, 160) + ". Every hour you give helps us keep our support free for Hawai\u02BBi families, and it went so well because of you.";
}
function defaultNextUp(title) {
  return /sodexo/i.test(title || "")
    ? "We have more Sodexo games coming up this season and into next year. I will send each one as it opens so you can pick the nights that work for you."
    : "We have more volunteer events coming up. I will send each one as it opens so you can pick the ones that work for you.";
}

function buildHtml(o, deps) {
  const esc = deps._emailEsc;
  const P = (s) => '<p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.55;">' + s + "</p>";
  const box = (label, big, small) => '<div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#0E7490;">' + label + "</div>"
    + '<div style="font-size:30px;font-weight:800;color:#0E7490;line-height:1.2;">' + big + "</div>"
    + '<div style="font-size:13px;color:#555555;">' + small + "</div>";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${esc(o.subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
  <tr><td style="background-color:#ffffff;padding:28px 32px 20px;text-align:center;">
    <img src="https://www.ldahawaii.org/logo_blue.png" alt="Leadership in Disabilities &amp; Achievement of Hawai&#699;i" width="150" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;">
  </td></tr>
  <tr><td style="background-color:#0891B2;padding:16px 32px;text-align:center;">
    <div style="font-size:20px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">Mahalo for volunteering</div>
  </td></tr>
  <tr><td style="padding:32px;">
    ${P("Aloha " + esc(o.firstName || "there") + ",")}
    ${P(esc(o.opening))}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px;border:1px solid #BAE6FD;border-radius:8px;background:#F0F9FF;">
      <tr>
        <td style="padding:16px 18px;width:50%;border-right:1px solid #BAE6FD;vertical-align:top;">${box("This event", fmtHours(o.eventHours) + " hours", esc(o.dayShort) + (o.times ? " &middot; " + esc(o.times) : ""))}</td>
        <td style="padding:16px 18px;width:50%;vertical-align:top;">${box("Your " + esc(o.year) + " total", fmtHours(o.ytdHours) + " hours", "volunteering with LDAH this year")}</td>
      </tr>
    </table>
    ${o.nextUp ? P(esc(o.nextUp)) : ""}
    ${P("<strong>Know someone who would enjoy this?</strong> We would love to welcome them into our LDAH &#699;ohana. Send them this button and they can apply in a few minutes.")}
    ${deps._emailBtn(INVITE_URL, "Invite a friend to volunteer", { bg: "#0891B2" })}
    <p style="margin:22px 0 4px;font-size:15px;color:#333333;line-height:1.5;">Mahalo nui loa,</p>
    <p style="margin:16px 0 2px;font-size:14px;color:#555555;line-height:1.5;"><strong>${esc(o.signName)}</strong>${o.signTitle ? "<br>" + esc(o.signTitle) : ""}<br>Leadership in Disabilities &amp; Achievement of Hawai&#699;i<br>245 N. Kukui St. Ste. 205, Honolulu, HI 96817<br>Phone: ${esc(o.signPhone)}</p>
    ${deps._emailLinkFooter([{ label: "Invite a friend to volunteer", href: INVITE_URL }])}
  </td></tr>
  ${o.orgFooterHtml || ""}
</table>
</td></tr>
</table>
</body>
</html>`;
}

function build(deps) {
  const sendVolunteerThankYou = functions
    .runWith({ timeoutSeconds: 120, maxInstances: 3, secrets: deps.EMAIL_SECRETS })
    .https.onCall(async (data, context) => {
      if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Please sign in.");
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const p = data || {};
      const uid = context.auth.uid;
      const requestId = clean(p.requestId, 64);
      const day = clean(p.serviceDate, 10);
      if (!requestId || requestId.indexOf("/") !== -1 || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        throw new functions.https.HttpsError("invalid-argument", "Missing request or date.");
      }
      const [meSnap, rq] = await Promise.all([db.collection("userRoles").doc(uid).get(), db.collection("volunteerRequests").doc(requestId).get()]);
      if (!rq.exists) throw new functions.https.HttpsError("not-found", "Request not found.");
      const me = meSnap.exists ? (meSnap.data() || {}) : {};
      const req = rq.data() || {};
      if (!(me.role === "superAdmin" || req.leadUid === uid)) {
        throw new functions.https.HttpsError("permission-denied", "Only the event lead or a Super Admin can send the thank-you.");
      }
      // Signed by the request's Lead (falls back to whoever is sending).
      const signUid = req.leadUid || uid;
      const signer = signUid === uid ? me : ((await db.collection("userRoles").doc(signUid).get()).data() || {});
      const signName = clean(signer.displayName || req.leadName || "The LDAH Volunteer Team", 80);
      const signEmail = clean(signer.email, 120);
      const ids = Array.isArray(p.volunteerIds) ? [...new Set(p.volunteerIds.map((x) => clean(x, 64)).filter((x) => x && x.indexOf("/") === -1))] : [];
      if (!ids.length) throw new functions.https.HttpsError("invalid-argument", "Pick at least one volunteer.");
      if (ids.length > 60) throw new functions.https.HttpsError("invalid-argument", "Too many at once.");
      const subject = clean(p.subject, 140) || "Mahalo for volunteering with LDAH";
      const year = day.slice(0, 4);
      const dp = dayParts(day);
      const opening = clean(p.opening, 600) || defaultOpening(req.title, dp.weekday);
      const nextUp = p.nextUp == null ? defaultNextUp(req.title) : clean(p.nextUp, 400);
      const orgFooterHtml = await deps.getOrgFooterHtml();

      const one = async (vid) => {
        const [partSnap, vSnap, logs] = await Promise.all([
          rq.ref.collection("participants").doc(vid).get(),
          db.collection("volunteers").doc(vid).get(),
          db.collection("volunteerOnboarding").doc(vid).collection("logs").where("serviceDate", ">=", year + "-01-01").get(),
        ]);
        const part = partSnap.exists ? (partSnap.data() || {}) : null;
        if (!part) throw new Error("not on this request");
        const v = vSnap.exists ? (vSnap.data() || {}) : {};
        const email = clean(part.email || v.email, 200);
        if (!/@/.test(email)) throw new Error("no email address");
        const L = logs.docs.map((d) => d.data() || {}).filter((e) => String(e.serviceDate || "") <= year + "-12-31");
        const ev = L.filter((e) => e.serviceDate === day).sort((a, b) => String(a.timeIn).localeCompare(String(b.timeIn)));
        const eventHours = ev.reduce((a, e) => a + (Number(e.hours) || 0), 0);
        if (!(eventHours > 0)) throw new Error("no hours logged for " + day);
        const ytdHours = L.reduce((a, e) => a + (Number(e.hours) || 0), 0);
        const firstName = clean(v.firstName || String(part.name || "").split(" ")[0], 60);
        const subj = subject.replace(/\{first\}/gi, firstName);
        const html = buildHtml({
          subject: subj, firstName, dayShort: dp.short, opening, nextUp, year,
          eventHours, ytdHours, times: ev.map((e) => t12(e.timeIn) + " to " + t12(e.timeOut)).join(", "),
          signName, signTitle: clean(signer.title, 80), signPhone: clean(signer.signaturePhone, 40) || MAIN_LINE, orgFooterHtml,
        }, deps);
        return { vid, part, email, name: clean(part.name || [v.firstName, v.lastName].filter(Boolean).join(" "), 120), subject: subj, html, eventHours, ytdHours };
      };

      if (p.preview === true) {
        const m = await one(ids[0]).catch((e) => { throw new functions.https.HttpsError("failed-precondition", e.message); });
        return { subject: m.subject, html: m.html, to: m.email, name: m.name };
      }

      const fromAddr = (deps.lifecycleFromAddress().match(/<([^>]+)>/) || [])[1] || deps.lifecycleFromAddress();
      const from = signName.replace(/[<>"]/g, "") + " (LDAH) <" + fromAddr + ">";
      const sent = [], failed = [];
      for (const vid of ids) {
        try {
          const m = await one(vid);
          await deps.sendEmailViaResend({
            from, to: [m.email], subject: m.subject, html: m.html, replyTo: signEmail || undefined,
            type: "volunteerThankYou", recipientName: m.name, relatedContactId: m.part.contactId || null,
          });
          await rq.ref.collection("participants").doc(vid).set({ thankYouSentAt: FieldValue.serverTimestamp(), thankYouHours: Math.round(m.eventHours * 100) / 100 }, { merge: true });
          sent.push(m.name);
        } catch (e) {
          failed.push({ id: vid, reason: e.message || "could not send" });
        }
      }
      if (sent.length) {
        await rq.ref.set({ thankYouSentAt: FieldValue.serverTimestamp(), thankYouSentBy: clean(me.displayName || context.auth.token.email, 80) }, { merge: true });
        try {
          await db.collection("auditLog").add({ action: "Volunteer thank-you sent", details: clean(req.title, 160) + ": " + sent.join(", "),
            performedBy: clean(me.displayName || context.auth.token.email || uid, 80), performedByUid: uid, timestamp: FieldValue.serverTimestamp() });
        } catch (_) { /* audit is best-effort */ }
      }
      return { sent, failed };
    });
  return { sendVolunteerThankYou };
}

module.exports = build;
module.exports._pure = { buildHtml, t12, fmtHours, dayParts, defaultOpening, defaultNextUp, INVITE_URL };
