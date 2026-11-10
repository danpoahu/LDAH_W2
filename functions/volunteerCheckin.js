// ═══════════════════════════════════════════════════════════════════════════
// Volunteer QR check-in / check-out (2026-10-02)
//
// Staff print a "Check-in QR poster" from the Int Roster tab. The QR opens
// the public page volunteer-checkin.html. A volunteer's phone remembers them
// by their PERSONAL documents token (the same token as volunteer-documents.html
// ?t=..., kept in the phone's localStorage), so the flow is:
//
//   scan -> "Hi Kai"  -> [ Check in ]                      volunteerCheckIn
//   scan -> "Checked in at 9:02 am, 2 h 14 m" -> [ Check out ]
//        -> tap what you did                                volunteerCheckOut
//        -> "Thank you, 3.47 hours logged"
//
// A phone that does not know the volunteer asks for the email they applied
// with; requestVolunteerLink emails their personal link (and always answers
// the same way, so it never reveals whether an email is on the roster).
//
// STORAGE (Admin SDK only; the page never touches Firestore):
//   volunteerOnboarding/{volunteerId}.openCheckIn   { at: Timestamp, site }
//     present only while checked in. Staff can already read this doc, which
//     drives the "On site now" strip on the Int Roster.
//   volunteerOnboarding/{volunteerId}/logs/{id}     the SAME service-log entry
//     shape submitVolunteerDocument writes, plus source:'qr', site,
//     checkInAt, checkOutAt. logTotals is recomputed in the same transaction,
//     exactly as submitVolunteerDocument does.
//   volunteerLinkRequests/{e_<sha256(email)> | i_<sha256(ip)>}   SERVER ONLY
//     rate-limit counters. Hashes only, no email address is stored.
//
// Hours default to all-LDAH (PTI / SRP 0). A volunteer who needs a split can
// still edit from the full Service Log on their documents page.
// ═══════════════════════════════════════════════════════════════════════════

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const crypto = require("crypto");
const V = require("./volunteerDocuments")._pure;

// The check-in page is on STAGE only for now. Change to the root path when promoted.
const CHECKIN_PAGE_URL = "https://www.ldahawaii.org/volunteer-checkin.html";
const COLLECTION = "volunteerOnboarding";
const TOKENS = "volunteerOnboardingTokens";
const LINK_REQUESTS = "volunteerLinkRequests";
const STALE_HOURS = 12;
const EMAIL_COOLDOWN_MS = 5 * 60 * 1000;     // one link per email per 5 minutes
const EMAIL_DAY_MAX = 5;                     // and at most 5 a day
const IP_HOUR_MAX = 20;                      // any emails, per IP, per hour
const OFFICE_PHONE = "(808) 536-9684";
const GENERIC_LINK_REPLY = "If you're on our volunteer roster, we've emailed you a link. Open it on this phone.";

// ── Pure helpers (exported for tests) ─────────────────────────────────────
function cleanText(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max || 200);
}

// ?site= from the poster: a short label such as "Office" or "Event".
function cleanSite(v) {
  return cleanText(v, 40).replace(/[^A-Za-z0-9 ʻ'&-]/g, "").replace(/\s+/g, " ").trim();
}

function normEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "")) && String(v).length <= 200;
}

function sha(v) { return crypto.createHash("sha256").update(String(v)).digest("hex"); }

function pad2(n) { return (n < 10 ? "0" : "") + n; }

// Hawaii has no DST: UTC-10 always. Returns the HST calendar date and HH:MM
// (minutes truncated, the same resolution the paper log uses).
function hstParts(ms) {
  const d = new Date(Number(ms) - 10 * 3600 * 1000);
  return { date: d.toISOString().slice(0, 10), hhmm: pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()) };
}

// An open check-in needs a typed time out when it is older than 12 hours or
// began on an earlier HST day (an automatic time out would land on the wrong date).
function isStale(openAtMs, nowMs) {
  if (!openAtMs) return false;
  if (nowMs - openAtMs > STALE_HOURS * 3600 * 1000) return true;
  return hstParts(openAtMs).date !== hstParts(nowMs).date;
}

// Works out the log entry's date / time in / time out for a check-out.
//   timeOutOverride: "HH:MM" typed by the volunteer (forgot-to-check-out path)
// Returns { ok, serviceDate, timeIn, timeOut } or { ok:false, error, needsTimeOut }.
function checkoutPlan(openAtMs, nowMs, timeOutOverride) {
  if (!openAtMs) return { ok: false, error: "You are not checked in." };
  const start = hstParts(openAtMs);
  const now = hstParts(nowMs);
  const typed = cleanText(timeOutOverride, 5);
  if (!typed) {
    if (isStale(openAtMs, nowMs)) {
      return { ok: false, needsTimeOut: true, error: "You checked in on " + start.date + " at " + start.hhmm + ". Please enter the time you left." };
    }
    if (now.hhmm <= start.hhmm) return { ok: false, error: "You only just checked in. Check out when you finish." };
    return { ok: true, serviceDate: start.date, timeIn: start.hhmm, timeOut: now.hhmm };
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(typed);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { ok: false, needsTimeOut: true, error: "Enter the time you left, for example 4:30 pm." };
  const timeOut = pad2(Number(m[1])) + ":" + m[2];
  if (timeOut <= start.hhmm) return { ok: false, needsTimeOut: true, error: "The time you left must be later than " + start.hhmm + ", when you checked in." };
  if (start.date === now.date && timeOut > now.hhmm) return { ok: false, needsTimeOut: true, error: "That time has not happened yet." };
  return { ok: true, serviceDate: start.date, timeIn: start.hhmm, timeOut };
}

// Rate limit: { allowed, next } where next is the record to store.
// prev = { lastAt, dayStart, dayCount } in ms; windowMs / max describe the bucket.
function rateDecision(prev, nowMs, opts) {
  const p = prev || {};
  const windowMs = opts.windowMs, max = opts.max, cooldownMs = opts.cooldownMs || 0;
  const inWindow = p.dayStart && nowMs - p.dayStart < windowMs;
  const count = inWindow ? (p.dayCount || 0) : 0;
  const tooSoon = cooldownMs && p.lastAt && nowMs - p.lastAt < cooldownMs;
  const allowed = !tooSoon && count < max;
  return {
    allowed,
    next: allowed
      ? { lastAt: nowMs, dayStart: inWindow ? p.dayStart : nowMs, dayCount: count + 1 }
      : { lastAt: p.lastAt || nowMs, dayStart: inWindow ? p.dayStart : nowMs, dayCount: count, blockedAt: nowMs },
  };
}

// Picks the roster record for an email: accepted, not archived. Prefers the
// one that already has a link, then the most recent.
function pickVolunteer(rows, email) {
  const want = normEmail(email);
  const hits = (rows || []).filter((r) => r && normEmail(r.email) === want && r.status === "accepted" && r.archived !== true);
  hits.sort((a, b) => (b.hasToken ? 1 : 0) - (a.hasToken ? 1 : 0) || (b.sortMs || 0) - (a.sortMs || 0));
  return hits[0] || null;
}

function openSummary(open, nowMs) {
  if (!open || !open.at) return null;
  const ms = open.at.toMillis ? open.at.toMillis() : Date.parse(open.at);
  if (!ms) return null;
  const p = hstParts(ms);
  return { at: new Date(ms).toISOString(), site: open.site || "", date: p.date, timeIn: p.hhmm, stale: isStale(ms, nowMs) };
}

// ── Email ─────────────────────────────────────────────────────────────────
function buildLinkEmailHtml({ firstName, checkinLink, docsLink, deps }) {
  const esc = deps._emailEsc;
  const P = (s) => '<p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.55;">' + s + "</p>";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Your volunteer check-in link</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
  <tr>
    <td style="background-color:#ffffff;padding:28px 32px 20px;text-align:center;">
      <img src="https://www.ldahawaii.org/logo_blue.png" alt="Leadership in Disabilities &amp; Achievement of Hawai&#699;i" width="150" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;">
    </td>
  </tr>
  <tr>
    <td style="background-color:#0891B2;padding:16px 32px;text-align:center;">
      <div style="font-size:20px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">Your volunteer check-in link</div>
    </td>
  </tr>
  <tr>
    <td style="padding:32px;">
      ${P("Aloha " + esc(firstName || "there") + ",")}
      ${P("You asked for your LDAH volunteer link. Open it <strong>on the phone you will check in with</strong>. That phone will remember you, so next time you just scan the check-in code.")}
      ${deps._emailBtn(checkinLink, "Check in on this phone", { bg: "#0891B2" })}
      <p style="margin:18px 0 16px;font-size:15px;color:#555555;line-height:1.55;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:6px;padding:12px 14px;">
        <strong>This link is just for you.</strong> Please do not forward it. It also opens your volunteer documents and your hours log.
      </p>
      ${P("If you did not ask for this, you can ignore this email. Questions? Call us at <a href=\"tel:+18085369684\" style=\"color:#1a73e8;text-decoration:none;\">" + OFFICE_PHONE + "</a>.")}
      <p style="margin:0 0 4px;font-size:15px;color:#333333;line-height:1.5;">Mahalo,</p>
      <p style="margin:0 0 0;font-size:15px;color:#333333;line-height:1.5;"><strong>The LDAH Volunteer Team</strong></p>
      ${deps._emailLinkFooter([{ label: "Check in", href: checkinLink }, { label: "Your volunteer documents", href: docsLink }])}
    </td>
  </tr>
  ${deps.orgFooterHtml || ""}
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Roster check-in (Daniel 2026-11-09) ───────────────────────────────────
// "can't you just have the roster pop open and you select yourself and then
// check in ... none of this email back and forth". The poster page lists
// today's help-request roster; a tap on a name checks that volunteer in or
// out (by volunteerId, no personal link needed). Backup: every accepted
// volunteer, for a day with no request or a name that is not on it.
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// The HST date a help request's free-text date names, "YYYY-MM-DD", or "".
// Reads "11-9-2026", "11/9/2026", "2026-11-09", "November 9" / "Nov 9, 2026".
function requestDateKey(text, nowMs) {
  const t = String(text || "").toLowerCase();
  const yNow = Number(hstParts(nowMs).date.slice(0, 4));
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return m[1] + "-" + pad2(+m[2]) + "-" + pad2(+m[3]);
  m = /\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/.exec(t);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return y + "-" + pad2(+m[1]) + "-" + pad2(+m[2]); }
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/.exec(t);
  if (m) { const mo = MONTHS.findIndex((x) => x.startsWith(m[1])) + 1; return (m[3] ? +m[3] : yNow) + "-" + pad2(mo) + "-" + pad2(+m[2]); }
  return "";
}

// Is this help request for today? Its written date says so, or it has no
// readable date and was created within the last day.
function isTodaysRequest(req, nowMs) {
  const today = hstParts(nowMs).date;
  const key = requestDateKey(req && req.date, nowMs);
  if (key) return key === today;
  const c = req && req.createdAt && req.createdAt.toMillis ? req.createdAt.toMillis() : 0;
  return !!c && nowMs - c < 24 * 3600 * 1000;
}

// "Rosie R." for the public roster: enough to find yourself, no full surname.
function rosterName(first, last, email) {
  const f = String(first || "").trim(), l = String(last || "").trim();
  if (f) return f + (l ? " " + l.charAt(0).toUpperCase() + "." : "");
  return String(email || "").split("@")[0] || "Volunteer";
}

// ── Firestore helpers ─────────────────────────────────────────────────────
function notFound() {
  return new functions.https.HttpsError("not-found",
    "This phone's volunteer link is not valid any more. Enter your email and we will send a new one.");
}

// Token -> { volunteerId, ref, onb } after checking the onboarding doc still
// points at this token (a "new link" from staff retires the old one).
async function loadByToken(db, token) {
  const t = String(token || "").trim();
  if (!/^[a-f0-9]{64}$/.test(t)) throw notFound();
  const tSnap = await db.collection(TOKENS).doc(V.hashToken(t)).get();
  if (!tSnap.exists) throw notFound();
  const volunteerId = (tSnap.data() || {}).volunteerId;
  if (!volunteerId) throw notFound();
  const ref = db.collection(COLLECTION).doc(volunteerId);
  const [onbSnap, vSnap] = await Promise.all([ref.get(), db.collection("volunteers").doc(volunteerId).get()]);
  if (!onbSnap.exists || (onbSnap.data() || {}).tokenHash !== tSnap.id) throw notFound();
  if (!vSnap.exists) throw notFound();
  const v = vSnap.data() || {};
  if (v.archived === true || (v.status && v.status !== "accepted")) {
    throw new functions.https.HttpsError("failed-precondition",
      "Your volunteer record is not active right now. Please call LDAH at " + OFFICE_PHONE + ".");
  }
  return { volunteerId, ref, onb: onbSnap.data() || {}, volunteer: v };
}

// Roster path: volunteerId -> same shape as loadByToken. The onboarding doc is
// created on first check-in if the volunteer never had documents sent.
async function loadById(db, volunteerId) {
  const id = String(volunteerId || "").trim();
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) throw new functions.https.HttpsError("invalid-argument", "Pick your name from the list.");
  const ref = db.collection(COLLECTION).doc(id);
  const [onbSnap, vSnap] = await Promise.all([ref.get(), db.collection("volunteers").doc(id).get()]);
  if (!vSnap.exists) throw new functions.https.HttpsError("not-found", "Pick your name from the list.");
  const v = vSnap.data() || {};
  if (v.archived === true || v.status !== "accepted") {
    throw new functions.https.HttpsError("failed-precondition",
      "Your volunteer record is not active right now. Please check with the LDAH staff lead.");
  }
  return { volunteerId: id, ref, onb: onbSnap.exists ? (onbSnap.data() || {}) : {}, volunteer: v };
}

// A personal link (token) when the phone has one, otherwise the roster pick.
async function loadIdent(db, data) {
  const d = data || {};
  if (d.token) return loadByToken(db, d.token);
  return loadById(db, d.volunteerId);
}

function statusPayload(x, nowMs) {
  const o = x.onb || {};
  const totals = o.logTotals || { ldah: 0, pti: 0, srp: 0, total: 0, count: 0 };
  return {
    ok: true,
    firstName: x.volunteer.firstName || "",
    open: openSummary(o.openCheckIn, nowMs),
    totals: { ldah: totals.ldah || 0, pti: totals.pti || 0, srp: totals.srp || 0, total: totals.total || 0, count: totals.count || 0 },
    serviceTypes: V.SERVICE_TYPES,
    today: V.hstTodayKey(nowMs),
    now: new Date(nowMs).toISOString(),
  };
}

// ── Factory: index.js injects the shared email helpers ────────────────────
function build(deps) {
  const d = deps || {};
  const secrets = d.EMAIL_SECRETS || ["RESEND_API_KEY", "SMTP_FROM"];

  // Public (token): who is this phone, and are they checked in?
  const volunteerCheckinStatus = functions
    .runWith({ timeoutSeconds: 30, maxInstances: 10 })
    .https.onCall(async (data) => {
      if ((data || {}).warm === true) return { warm: true };
      const db = admin.firestore();
      const x = await loadIdent(db, data);
      return statusPayload(x, Date.now());
    });

  // Public (token): open a check-in. Idempotent: already open = returns it.
  const volunteerCheckIn = functions
    .runWith({ timeoutSeconds: 30, maxInstances: 10 })
    .https.onCall(async (data) => {
      if ((data || {}).warm === true) return { warm: true };
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const x = await loadIdent(db, data);
      const nowMs = Date.now();
      const existing = openSummary(x.onb.openCheckIn, nowMs);
      if (existing) return Object.assign(statusPayload(x, nowMs), { already: true });
      const site = cleanSite((data || {}).site);
      const at = admin.firestore.Timestamp.fromMillis(nowMs);
      await x.ref.set({
        openCheckIn: site ? { at, site } : { at },
        lastCheckInAt: at,
        ...((data || {}).token ? {} : { lastCheckInVia: "roster" }),
        ...(x.onb.volunteerEmail ? {} : { volunteerEmail: String(x.volunteer.email || "").trim() }),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      x.onb.openCheckIn = site ? { at, site } : { at };
      return Object.assign(statusPayload(x, nowMs), { already: false });
    });

  // Public (token): close the check-in and write the Service Log entry.
  //   { token, serviceType, note, timeOut? }   timeOut "HH:MM" for a forgotten check-out
  //   { token, discard:true }                  "I wasn't here": remove the open check-in
  const volunteerCheckOut = functions
    .runWith({ timeoutSeconds: 30, maxInstances: 10 })
    .https.onCall(async (data) => {
      if ((data || {}).warm === true) return { warm: true };
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const x0 = await loadIdent(db, data);
      const ref = x0.ref;
      const logs = ref.collection("logs");
      const p = data || {};
      const nowMs = Date.now();

      if (p.discard === true) {
        await ref.set({ openCheckIn: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return { ok: true, discarded: true };
      }

      const newRef = logs.doc();
      const result = await db.runTransaction(async (tx) => {
        const onbSnap = await tx.get(ref);
        const o = onbSnap.data() || {};
        const open = o.openCheckIn;
        const openMs = open && open.at && open.at.toMillis ? open.at.toMillis() : 0;
        if (!openMs) throw new functions.https.HttpsError("failed-precondition", "You are not checked in. Scan again to check in.");
        const plan = checkoutPlan(openMs, nowMs, p.timeOut);
        if (!plan.ok) {
          throw new functions.https.HttpsError("failed-precondition", plan.error, { needsTimeOut: !!plan.needsTimeOut });
        }
        const r = V.validateLogEntry({
          serviceDate: plan.serviceDate, serviceType: p.serviceType, serviceDetail: p.note,
          timeIn: plan.timeIn, timeOut: plan.timeOut, pti: 0, srp: 0,
        }, V.hstTodayKey(nowMs));
        if (!r.ok) throw new functions.https.HttpsError("invalid-argument", r.error, { needsTimeOut: /hours|later/i.test(r.error) });
        const entry = Object.assign({}, r.entry, {
          source: "qr",
          site: open.site || "",
          checkInAt: open.at,
          checkOutAt: admin.firestore.Timestamp.fromMillis(nowMs),
          timeOutTyped: !!cleanText(p.timeOut, 5),
        });
        // Same totals recompute as submitVolunteerDocument's 'log' branch.
        const all = await tx.get(logs);
        const list = [];
        all.forEach((s) => list.push(s.data() || {}));
        list.push(entry);
        const t = V.sumTotals(list);
        tx.set(newRef, Object.assign({}, entry, { createdAt: FieldValue.serverTimestamp() }));
        tx.set(ref, {
          openCheckIn: FieldValue.delete(),
          lastCheckOutAt: admin.firestore.Timestamp.fromMillis(nowMs),
          logTotals: Object.assign({}, t, { lastEntryAt: FieldValue.serverTimestamp() }),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return { entry: r.entry, totals: t };
      });
      return { ok: true, entryId: newRef.id, entry: result.entry, totals: result.totals, firstName: x0.volunteer.firstName || "" };
    });

  // Public: "Enter the email you applied with". Always the same reply.
  const requestVolunteerLink = functions
    .runWith({ timeoutSeconds: 60, maxInstances: 3, secrets })
    .https.onCall(async (data, context) => {
      if ((data || {}).warm === true) return { warm: true };
      const reply = { ok: true, message: GENERIC_LINK_REPLY };
      const raw = cleanText((data || {}).email, 200);
      if (!validEmail(raw)) {
        throw new functions.https.HttpsError("invalid-argument", "Please enter a full email address, like name@example.com.");
      }
      const email = normEmail(raw);
      const site = cleanSite((data || {}).site);
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const nowMs = Date.now();

      // Rate limits: per email and per IP. Exceeding either is silent.
      const req = context && context.rawRequest;
      const ip = req ? String((req.headers && req.headers["x-forwarded-for"]) || req.ip || "").split(",")[0].trim() : "";
      const eRef = db.collection(LINK_REQUESTS).doc("e_" + sha(email));
      const iRef = ip ? db.collection(LINK_REQUESTS).doc("i_" + sha(ip)) : null;
      const allowed = await db.runTransaction(async (tx) => {
        const eSnap = await tx.get(eRef);
        const iSnap = iRef ? await tx.get(iRef) : null;
        const eDec = rateDecision(eSnap.exists ? eSnap.data() : null, nowMs, { windowMs: 24 * 3600 * 1000, max: EMAIL_DAY_MAX, cooldownMs: EMAIL_COOLDOWN_MS });
        const iDec = iRef ? rateDecision(iSnap && iSnap.exists ? iSnap.data() : null, nowMs, { windowMs: 3600 * 1000, max: IP_HOUR_MAX }) : { allowed: true, next: null };
        tx.set(eRef, eDec.next);
        if (iRef) tx.set(iRef, iDec.next);
        return eDec.allowed && iDec.allowed;
      });
      if (!allowed) return reply;

      // The roster is small: read accepted volunteers and match the email
      // case-insensitively (the application stores it exactly as typed).
      const vSnap = await db.collection("volunteers").where("status", "==", "accepted").limit(2000).get();
      const rows = [];
      vSnap.forEach((s) => {
        const v = s.data() || {};
        const ms = (v.acceptedAt && v.acceptedAt.toMillis && v.acceptedAt.toMillis()) || (v.submittedAt && v.submittedAt.toMillis && v.submittedAt.toMillis()) || 0;
        rows.push({ id: s.id, email: v.email, status: v.status, archived: v.archived, firstName: v.firstName, lastName: v.lastName, sortMs: ms });
      });
      const matches = rows.filter((r) => normEmail(r.email) === email);
      if (!matches.length) return reply;
      const tokSnaps = await Promise.all(matches.map((r) => db.collection(TOKENS).where("volunteerId", "==", r.id).limit(1).get()));
      matches.forEach((r, i) => { r.hasToken = !tokSnaps[i].empty; r.tokenDoc = tokSnaps[i].empty ? null : tokSnaps[i].docs[0]; });
      const pick = pickVolunteer(matches, email);
      if (!pick) return reply;

      const ref = db.collection(COLLECTION).doc(pick.id);
      const onbSnap = await ref.get();
      const onb = onbSnap.exists ? (onbSnap.data() || {}) : {};
      let token = pick.tokenDoc ? (pick.tokenDoc.data() || {}).token : null;
      const volunteerName = [pick.firstName, pick.lastName].filter(Boolean).join(" ").trim() || raw;
      const batch = db.batch();
      if (!token) {
        // Accepted but staff have not sent documents yet: give them a link now,
        // so check-in works. No sentAt stamp: that still means "staff sent docs".
        token = V.newToken();
        batch.set(db.collection(TOKENS).doc(V.hashToken(token)), { volunteerId: pick.id, token, createdAt: FieldValue.serverTimestamp() });
      }
      const stamp = {
        volunteerId: pick.id, tokenHash: V.hashToken(token),
        lastLinkRequestAt: FieldValue.serverTimestamp(),
        linkRequestCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (!onb.volunteerName) stamp.volunteerName = volunteerName;
      if (!onb.volunteerEmail) stamp.volunteerEmail = String(pick.email || "").trim();
      batch.set(ref, stamp, { merge: true });
      await batch.commit();

      const checkinLink = CHECKIN_PAGE_URL + "?t=" + token + (site ? "&site=" + encodeURIComponent(site) : "");
      const docsLink = V.DOCS_PAGE_URL + "?t=" + token;
      const orgFooterHtml = d.getOrgFooterHtml ? await d.getOrgFooterHtml() : "";
      const html = buildLinkEmailHtml({
        firstName: pick.firstName || "", checkinLink, docsLink,
        deps: { _emailEsc: d._emailEsc, _emailBtn: d._emailBtn, _emailLinkFooter: d._emailLinkFooter, orgFooterHtml },
      });
      try {
        await d.sendEmailViaResend({
          from: d.lifecycleFromAddress ? d.lifecycleFromAddress() : ("LDAH <" + (process.env.SMTP_FROM || "") + ">"),
          to: [String(pick.email || "").trim()],
          subject: "Your LDAH volunteer check-in link",
          html,
          type: "volunteerCheckinLink",
          recipientName: volunteerName,
        });
      } catch (e) {
        // Logged for staff; the volunteer still sees the same generic reply.
        console.error("requestVolunteerLink send failed", pick.id, String(e.message || e).slice(0, 300));
        await ref.set({ lastLinkRequestError: String(e.message || e).slice(0, 300) }, { merge: true });
      }
      return reply;
    });

  // Public: the poster page's roster. Today's help request(s) first; every
  // accepted volunteer as the backup list. Names are "First L.".
  const volunteerCheckinRoster = functions
    .runWith({ timeoutSeconds: 30, maxInstances: 10 })
    .https.onCall(async (data) => {
      if ((data || {}).warm === true) return { warm: true };
      const db = admin.firestore();
      const nowMs = Date.now();
      const [volSnap, onbSnap, reqSnap] = await Promise.all([
        db.collection("volunteers").where("status", "==", "accepted").get(),
        db.collection(COLLECTION).get(),
        db.collection("volunteerRequests").orderBy("createdAt", "desc").limit(30).get(),
      ]);
      const openBy = {};
      onbSnap.forEach((s) => { const o = openSummary((s.data() || {}).openCheckIn, nowMs); if (o) openBy[s.id] = o; });
      const vols = {};
      volSnap.forEach((s) => {
        const v = s.data() || {};
        if (v.archived === true) return;
        vols[s.id] = { id: s.id, name: rosterName(v.firstName, v.lastName, v.email), open: openBy[s.id] || null };
      });
      const all = Object.values(vols).sort((a, b) => a.name.localeCompare(b.name));
      const requests = [];
      for (const rs of reqSnap.docs) {
        const rq = rs.data() || {};
        if (rq.status === "closed" || !isTodaysRequest(rq, nowMs)) continue;
        const ps = await rs.ref.collection("participants").get();
        const people = [];
        ps.forEach((p) => {
          const x = p.data() || {};
          const vid = x.volunteerId || p.id;
          if (!x.confirmed || !vols[vid]) return;
          people.push(vols[vid]);
        });
        people.sort((a, b) => a.name.localeCompare(b.name));
        requests.push({ id: rs.id, title: cleanText(rq.title, 120), time: cleanText(rq.time, 60), location: cleanText(rq.location, 80), people });
      }
      return { ok: true, requests, all, today: hstParts(nowMs).date };
    });

  // Staff: "Check everyone out" for a help request (2026-11-10, Daniel: "make
  // sure if one person leaves earlier than the others, the log out everyone
  // button does not overwrite the one who's left already"). Only people who
  // still have an open check-in are touched; anyone already checked out keeps
  // their own time. Lead of the request or a Super Admin.
  //   { requestId, timeOut:"HH:MM", serviceType? } -> { closed:[], skipped:[], alreadyOut }
  const staffCheckOutAll = functions
    .runWith({ timeoutSeconds: 60, maxInstances: 3 })
    .https.onCall(async (data, context) => {
      if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Please sign in.");
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const p = data || {};
      const uid = context.auth.uid;
      const requestId = cleanText(p.requestId, 64);
      if (!requestId || requestId.indexOf("/") !== -1) throw new functions.https.HttpsError("invalid-argument", "Missing request.");
      const [roleSnap, rq] = await Promise.all([db.collection("userRoles").doc(uid).get(), db.collection("volunteerRequests").doc(requestId).get()]);
      if (!rq.exists) throw new functions.https.HttpsError("not-found", "Request not found.");
      const me = roleSnap.exists ? (roleSnap.data() || {}) : {};
      const req = rq.data() || {};
      if (!(me.role === "superAdmin" || req.leadUid === uid)) {
        throw new functions.https.HttpsError("permission-denied", "Only the event lead or a Super Admin can check everyone out.");
      }
      const typed = cleanText(p.timeOut, 5);
      if (!/^\d{1,2}:\d{2}$/.test(typed)) throw new functions.https.HttpsError("invalid-argument", "Pick the time everyone left.");
      const serviceType = cleanText(p.serviceType, 60) || (/sodexo/i.test(req.title || "") ? "Sodexo" : "Community event");
      const who = me.displayName || context.auth.token.email || uid;
      const ps = await rq.ref.collection("participants").get();
      const ids = [...new Set(ps.docs.map((d) => (d.data() || {}).volunteerId || d.id)
        .concat((req.participants || []).map((x) => x && (x.volunteerId || x.id)))
        .filter((x) => x && String(x).indexOf("/") === -1))];
      const nowMs = Date.now();
      const closed = [], skipped = [];
      let alreadyOut = 0;
      for (const vid of ids) {
        const ref = db.collection(COLLECTION).doc(vid);
        const vSnap = await db.collection("volunteers").doc(vid).get();
        const v = vSnap.exists ? (vSnap.data() || {}) : {};
        const name = [v.firstName, v.lastName].filter(Boolean).join(" ") || vid;
        const newRef = ref.collection("logs").doc();
        try {
          const res = await db.runTransaction(async (tx) => {
            const onbSnap = await tx.get(ref);
            const open = (onbSnap.data() || {}).openCheckIn;
            const openMs = open && open.at && open.at.toMillis ? open.at.toMillis() : 0;
            if (!openMs) return { out: true };   // already checked out: leave their time alone
            const plan = checkoutPlan(openMs, nowMs, typed);
            if (!plan.ok) return { skip: plan.error.replace(/^The time you left/, "The time out").replace(/when you checked in/, "when they checked in") };
            const r = V.validateLogEntry({ serviceDate: plan.serviceDate, serviceType, serviceDetail: cleanText(req.title, 120),
              timeIn: plan.timeIn, timeOut: plan.timeOut, pti: 0, srp: 0 }, V.hstTodayKey(nowMs));
            if (!r.ok) return { skip: r.error };
            const entry = Object.assign({}, r.entry, {
              source: "qr", site: open.site || "", checkInAt: open.at,
              checkOutAt: admin.firestore.Timestamp.fromMillis(nowMs), timeOutTyped: true,
              requestId, checkedOutBy: who, checkedOutByUid: uid,
            });
            const all = await tx.get(ref.collection("logs"));
            const list = [];
            all.forEach((s2) => list.push(s2.data() || {}));
            list.push(entry);
            const t = V.sumTotals(list);
            tx.set(newRef, Object.assign({}, entry, { createdAt: FieldValue.serverTimestamp() }));
            tx.set(ref, { openCheckIn: FieldValue.delete(), lastCheckOutAt: admin.firestore.Timestamp.fromMillis(nowMs),
              logTotals: Object.assign({}, t, { lastEntryAt: FieldValue.serverTimestamp() }), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
            return { entry: r.entry };
          });
          if (res.out) alreadyOut++;
          else if (res.skip) skipped.push({ name, reason: res.skip });
          else closed.push({ name, timeIn: res.entry.timeIn, timeOut: res.entry.timeOut, hours: res.entry.hours });
        } catch (e) { skipped.push({ name, reason: e.message || "Could not check out." }); }
      }
      if (closed.length) {
        try {
          await db.collection("auditLog").add({ action: "Volunteers checked out by staff",
            details: cleanText(req.title, 120) + ": " + closed.map((c) => c.name + " " + c.timeIn + "-" + c.timeOut + " (" + c.hours + " h)").join(", "),
            performedBy: who, performedByUid: uid, timestamp: FieldValue.serverTimestamp() });
        } catch (_) { /* audit is best-effort */ }
      }
      return { closed, skipped, alreadyOut };
    });

  return { volunteerCheckinStatus, volunteerCheckIn, volunteerCheckOut, requestVolunteerLink, volunteerCheckinRoster, staffCheckOutAll };
}

module.exports = build;
module.exports._pure = {
  CHECKIN_PAGE_URL, STALE_HOURS, GENERIC_LINK_REPLY, EMAIL_DAY_MAX, IP_HOUR_MAX, EMAIL_COOLDOWN_MS,
  cleanSite, normEmail, validEmail, hstParts, isStale, checkoutPlan, rateDecision, pickVolunteer,
  openSummary, buildLinkEmailHtml, requestDateKey, isTodaysRequest, rosterName,
};
