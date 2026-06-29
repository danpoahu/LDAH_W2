const functions = require("firebase-functions");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");
const crypto = require("crypto");
const heicConvert = require("heic-convert");
// nodemailer removed — Firebase 1st Gen blocks outbound SMTP (port 465/587).
// Using Resend HTTP API instead (HTTPS on port 443, always allowed).

admin.initializeApp();

const ALLOWED_ORIGIN = "https://danpoahu.github.io";

const SYSTEM_PROMPT = `You are "LDAH Page Editor Helper" — a friendly, patient tech support assistant built into the LDAH website content management system (Page Editor). You help LDAH staff edit their website content. Speak in simple, clear language. Never use technical jargon. Be encouraging — remind them they can't break anything permanently.

IMPORTANT RULES:
- Only answer questions about using the Page Editor (page-admin.html)
- If asked about anything unrelated to the CMS, politely redirect
- Never mention Firebase, Firestore, JavaScript, HTML, CSS, or any backend technology
- Keep answers short and step-by-step (numbered lists)
- If you don't know, say "I'm not sure about that — please ask Daniel at DP Consulting"

THE PAGE EDITOR LAYOUT:
- Left sidebar: lists all pages you can edit (Home, Who We Are, Events, Volunteer, Resources, Contact, Readiness, Special Ed, Military, Pacific, and Pacific sub-pages for each island, plus Community)
- Center area: shows a preview of the page you selected
- Right panel: slides open when you click something to edit — this is where you type changes or upload photos

HOW TO EDIT TEXT:
1. Click on any text in the center preview area — look for the teal "Edit" badge that appears when you hover
2. The right panel slides open with a text editor
3. Make your changes in the editor. You can use the toolbar buttons: Bold (B), Italic (I), Underline (U), Heading (H), Paragraph (¶), Line Break (BR)
4. You can change text color using the color dots, and font size using the Size dropdown
5. Click the green "Save" button when done
6. Click "Cancel" to discard changes

HOW TO CHANGE A PHOTO:
1. Click on any photo in the center preview — look for the teal "Photo" badge
2. The right panel shows the current photo and two options:
   a. "Choose File" — pick a photo from your device (max 5MB, it will be automatically compressed)
   b. Paste a URL — if you have a web link to an image, paste it in the URL field
3. Click "Save" to update the photo
4. Photos are automatically resized to max 600px and compressed — you don't need to worry about file size

PAGES AND WHAT YOU CAN EDIT:

HOME page: Hero title & subtitle, 3 hero photos, 4 stat cards (each has photo, number, label), services section title, 6 service cards (photo, title, description), events title & subtitle, CTA title & subtitle

WHO WE ARE page: Hero title & subtitle, foundation section, mission/vision/values cards (each has photo, title, text), PTI section (photo, title, text), team section with team & board cards, gallery section, CTA

EVENTS page: Hero title & subtitle, section titles for current/past/calendar, CTA. Note: actual events are managed in the main CMS (cms.html), not here.

VOLUNTEER page: Hero title & subtitle, gallery title & subtitle, CTA. Note: volunteer opportunities are managed in the main CMS.

RESOURCES page: Hero title & subtitle, CTA. Note: resources are managed in the main CMS.

CONTACT page: Hero title & subtitle, Honolulu office details (title, subtitle, phone, email, address), Ma'ili office details (title, subtitle, phone, hours, address), CTA

READINESS (School Readiness) page: Hero title & subtitle, about & partners sections, 3 screening cards (vision, hearing, developmental — each has photo, title, text), 3 services cards (case management, workshops, provider — each has photo, title, text), CTA

SPECIAL ED page: Hero title & subtitle, resources section title, 6 resource document cards (photo, title, description), CTA

MILITARY page: Hero title & subtitle, video section (title, description), resources section, 4 branch contact cards (Army, Navy, Marines, Coast Guard — each has title and text), 2 PDF cards, CTA

PACIFIC (main page): Hero title & subtitle, partners section title & subtitle, 6 island overview cards (each has card photo, title, partner name, description), CTA

PACIFIC ISLAND SUB-PAGES (click an island name in the sidebar):
Each island has: Hero photo, flag photo, About section, Primary Contact (name, phone, email, address — some have a contact photo), Support Personnel (individual people with name, title, email, phone), Photo Gallery (up to 9 photos)
- American Samoa: 2 support personnel
- CNMI: 2 support personnel
- FSM: Has 4 state contacts instead (Yap, Chuuk, Pohnpei, Kosrae) — each state has its own contact info
- Guam: Has partner logo (ACT), 2 contacts, 2 support personnel
- Marshall Islands: Has 2 partners — MISPA (primary contact + 3 support) and PSS (logo, contact, 3 support)
- Palau: Has partner logo (PPE), contact with photo, 1 support person

COMMUNITY (Anti-Bullying) page: Hero title & subtitle, response kit section, 10 resource cards (each has photo and title), CTA

DONATE BUTTON / PAYPAL URL:
The PayPal donate URL is NOT edited in this Page Editor — it's managed in LDAH-Int (the staff dashboard, the same place you go for Contacts, Events, and Email settings). One field there controls the donate button on every page of the website, in the app, and in every outgoing email.

If someone asks "How do I change the donate button?", "Where do I update the PayPal link?", or anything similar:
1. Open LDAH-Int
2. Click Admin (top menu)
3. Click List Management
4. Find the "Donate Block — Universal" card and click to expand it
5. Update the "Donate URL" field with the new PayPal link
6. Click Save
The change appears everywhere within seconds — no developer needed.

TIPS:
- The "Edit" and "Photo" badges only appear when you hover over editable content
- After saving, the preview updates immediately — you can see your changes right away
- Photos from your device are automatically compressed — no need to resize first
- If you upload a photo and it looks stretched, try a landscape-oriented photo
- The Page Editor saves to the live website — changes are visible to visitors immediately after saving
- To edit Pacific island details, click the island name in the sidebar (Am. Samoa, CNMI, FSM, etc.)`;

exports.ldahCmsHelp = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 5, secrets: ["ANTHROPIC_API_KEY"] })
  .https.onRequest(async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "3600");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const { message, pageContext, history } = req.body;

      if (!message || typeof message !== "string") {
        res.status(400).json({ error: "Missing or invalid message" });
        return;
      }

      const messages = [];

      if (Array.isArray(history)) {
        const recentHistory = history.slice(-10);
        for (const entry of recentHistory) {
          if (entry.role && entry.content) {
            messages.push({
              role: entry.role === "assistant" ? "assistant" : "user",
              content: String(entry.content).slice(0, 1000),
            });
          }
        }
      }

      let userContent = message.slice(0, 1000);
      if (pageContext) {
        userContent = `[Currently viewing: ${String(pageContext).slice(0, 200)}]\n\n${userContent}`;
      }
      messages.push({ role: "user", content: userContent });

      const client = new Anthropic();
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: messages,
      });

      const reply =
        response.content && response.content[0]
          ? response.content[0].text
          : "I'm sorry, I couldn't generate a response. Please try again.";

      res.status(200).json({ reply });
    } catch (err) {
      console.error("ldahCmsHelp error:", err);
      res.status(500).json({
        error: "Something went wrong. Please try again in a moment.",
      });
    }
  });

// ── Check Resource URL for iframe compatibility ──
exports.checkResourceUrl = functions
  .runWith({ timeoutSeconds: 15, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    // CORS headers — LDAH-Int is on GitHub Pages
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "3600");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const { url } = req.body;

    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "Missing or invalid url" });
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (_) {
      res.status(400).json({ error: "Invalid URL format" });
      return;
    }

    // Only allow http/https
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      res.status(400).json({ error: "Only http and https URLs are supported" });
      return;
    }

    const https = require("https");
    const http = require("http");

    /**
     * Makes a HEAD request to the given URL, following up to maxRedirects
     * redirects, and resolves with the final response headers and status.
     */
    function headRequest(targetUrl, redirectsLeft = 5) {
      return new Promise((resolve, reject) => {
        const parsed = new URL(targetUrl);
        const lib = parsed.protocol === "https:" ? https : http;

        const options = {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: "HEAD",
          headers: { "User-Agent": "LDAH-ResourceChecker/1.0" },
          timeout: 5000,
        };

        const request = lib.request(options, (response) => {
          const { statusCode, headers: resHeaders } = response;
          // Consume response body (HEAD should have none, but be safe)
          response.resume();

          // Follow redirects (301, 302, 303, 307, 308)
          if (
            [301, 302, 303, 307, 308].includes(statusCode) &&
            resHeaders.location &&
            redirectsLeft > 0
          ) {
            // Resolve relative redirects against the current URL
            const nextUrl = new URL(resHeaders.location, targetUrl).href;
            resolve(headRequest(nextUrl, redirectsLeft - 1));
          } else {
            resolve({ statusCode, headers: resHeaders, finalUrl: targetUrl });
          }
        });

        request.on("timeout", () => {
          request.destroy();
          reject(new Error("Request timed out"));
        });

        request.on("error", (err) => {
          reject(err);
        });

        request.end();
      });
    }

    try {
      const { statusCode, headers: resHeaders } = await headRequest(url);

      // 4xx / 5xx → treat as blocked
      if (statusCode >= 400) {
        res.status(200).json({
          iframeBlocked: true,
          reason: `HTTP ${statusCode} error`,
        });
        return;
      }

      // Check X-Frame-Options
      const xfo = (resHeaders["x-frame-options"] || "").toUpperCase().trim();
      if (xfo === "DENY" || xfo === "SAMEORIGIN") {
        res.status(200).json({
          iframeBlocked: true,
          reason: `X-Frame-Options: ${xfo}`,
        });
        return;
      }

      // Check Content-Security-Policy frame-ancestors
      const csp = (resHeaders["content-security-policy"] || "").toLowerCase();
      if (csp.includes("frame-ancestors")) {
        if (
          csp.includes("frame-ancestors 'none'") ||
          csp.includes("frame-ancestors 'self'")
        ) {
          // Extract the directive for a readable reason
          const match = csp.match(/frame-ancestors[^;]*/);
          const directive = match ? match[0].trim() : "frame-ancestors restricted";
          res.status(200).json({
            iframeBlocked: true,
            reason: `Content-Security-Policy: ${directive}`,
          });
          return;
        }
      }

      res.status(200).json({ iframeBlocked: false });
    } catch (err) {
      console.error("checkResourceUrl error:", err.message);
      res.status(200).json({
        iframeBlocked: true,
        reason: err.message.includes("timed out")
          ? "Request timed out (5s)"
          : "Connection error: " + err.message,
      });
    }
  });

// ── Android Beta: email a heads-up when a tester requests access ──
// Testers are added to the Play Console internal-tester list manually —
// the Cloud Identity API cannot manage a consumer @googlegroups.com group
// (every auto-add attempt 403'd). Requests also surface in the LDAH-Int
// CMS; this CF just emails Daniel so a request isn't missed.
const BETA_NOTIFY_TO = "danpellegrini63@gmail.com";

exports.notifyAndroidBetaRequest = functions
  .runWith({
    timeoutSeconds: 30,
    maxInstances: 5,
    secrets: ["RESEND_API_KEY", "SMTP_FROM"],
  })
  .firestore.document("androidBetaRequests/{docId}")
  .onCreate(async (snap) => {
    const data = snap.data() || {};
    const email = data.email || "(no email provided)";
    console.log("Android beta request received:", email);

    const requestedAt = (data.requestedAt && data.requestedAt.toDate)
      ? data.requestedAt.toDate() : new Date();
    const whenHst = requestedAt.toLocaleString("en-US", { timeZone: "Pacific/Honolulu" });
    const fromAddress = process.env.SMTP_FROM || "onboarding@resend.dev";
    const html = `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
      <h2 style="color:#004E7C;margin:0 0 12px;">New Android beta request</h2>
      <p style="margin:0 0 8px;font-size:15px;"><strong>Tester email:</strong> ${_emailEsc(email)}</p>
      <p style="margin:0 0 16px;font-size:15px;"><strong>Requested:</strong> ${_emailEsc(whenHst)} HST</p>
      <p style="margin:0;font-size:14px;color:#374151;line-height:1.5;">
        Add this address to the Play Console internal-tester list to grant access.
        This request also appears in the LDAH-Int CMS.
      </p>
    </body></html>`;

    try {
      await sendEmailViaResend({
        from: `LDAH <${fromAddress}>`,
        to: BETA_NOTIFY_TO,
        subject: `New Android beta request -- ${email}`,
        html,
        type: "android-beta-request-notify",
      });
      await snap.ref.update({
        notifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error("notifyAndroidBetaRequest: notification email failed:", err.message);
      await snap.ref.update({
        notifyError: err.message,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

// ── Registration Completion Email ──────────────────────────────────
// Sends a "Complete Your Registration" email when a signup is created
// with status: "pending". Does NOT send for status: "confirmed".
//
// Uses Resend HTTP API (not SMTP) because Firebase 1st Gen Cloud Functions
// block outbound connections on SMTP ports (465/587).
//
// Required Firebase secret:
//   RESEND_API_KEY  — your Resend API key (re_xxxx)
//
// To configure:
//   firebase functions:secrets:set RESEND_API_KEY

/**
 * Temporary BCC during email-system review. Set to empty string to disable.
 */
const REVIEW_BCC = "";

/**
 * Log a single email send (or failure) to Firestore for admin review.
 */
async function logEmailSend(entry) {
  try {
    await admin.firestore().collection("emailLog").add({
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      from: entry.from || "",
      to: entry.to || "",
      bcc: entry.bcc || "",
      subject: entry.subject || "",
      html: entry.html || "",
      type: entry.type || "unknown",
      relatedEventId: entry.relatedEventId || "",
      relatedSignupId: entry.relatedSignupId || "",
      recipientName: entry.recipientName || "",
      success: entry.success === true,
      error: entry.error || null,
      resendId: entry.resendId || null,
    });
  } catch (e) {
    console.warn("emailLog write failed:", e.message);
  }
}

/**
 * Send an email via Resend HTTP API.
 * Extra optional fields (type, relatedEventId, relatedSignupId, recipientName)
 * are used only for the emailLog entry and are safe to omit.
 */
async function sendEmailViaResend({
  from, to, subject, html, bcc, cc,
  type, relatedEventId, relatedSignupId, recipientName,
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY secret is not set");

  // Assemble BCC list: per-call bcc + REVIEW_BCC (if set). De-dupe + skip empties.
  const bccList = [];
  if (bcc) {
    if (Array.isArray(bcc)) bccList.push(...bcc.filter(Boolean));
    else bccList.push(bcc);
  }
  if (REVIEW_BCC && !bccList.includes(REVIEW_BCC)) bccList.push(REVIEW_BCC);
  const bccLogValue = bccList.join(", ");

  const ccList = [];
  if (cc) {
    if (Array.isArray(cc)) ccList.push(...cc.filter(Boolean));
    else ccList.push(cc);
  }

  const body = { from, to: [to], subject, html };
  if (bccList.length) body.bcc = bccList;
  if (ccList.length) body.cc = ccList;

  // Retry transient failures — HTTP 429 (Resend's 5 req/sec rate-limit),
  // 5xx, and network errors. Bulk attendance marking fires many feedback
  // triggers near-simultaneously and trips 429s; without retry the loser
  // signups are silently dropped (no stamp, no retry path). Exponential
  // backoff with jitter lets the herd self-space. Only the FINAL outcome
  // is written to emailLog, so retries never pollute it.
  const MAX_ATTEMPTS = 4;
  const backoffMs = (attempt) =>
    Math.round(400 * Math.pow(2, attempt - 1) * (1 + Math.random()));

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const result = await response.json();
        await logEmailSend({
          from, to, bcc: bccLogValue, subject, html,
          type, relatedEventId, relatedSignupId, recipientName,
          success: true, resendId: (result && result.id) || null,
        });
        return result;
      }

      const errorBody = await response.text();
      const msg = "Resend API error (" + response.status + "): " + errorBody;
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < MAX_ATTEMPTS) {
        const wait = backoffMs(attempt);
        console.warn(`sendEmailViaResend: ${response.status} for ${to}, retry ${attempt}/${MAX_ATTEMPTS - 1} in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      // Non-retryable, or retries exhausted — log the failure and throw.
      await logEmailSend({
        from, to, bcc: bccLogValue, subject, html,
        type, relatedEventId, relatedSignupId, recipientName,
        success: false, error: msg,
      });
      throw new Error(msg);
    } catch (err) {
      // A logged Resend-API-error is final — rethrow untouched.
      if (err.message && err.message.indexOf("Resend API error") === 0) throw err;
      // Network/fetch-level error — retry if attempts remain.
      if (attempt < MAX_ATTEMPTS) {
        const wait = backoffMs(attempt);
        console.warn(`sendEmailViaResend: network error for ${to} (${err.message}), retry ${attempt}/${MAX_ATTEMPTS - 1} in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      await logEmailSend({
        from, to, bcc: bccLogValue, subject, html,
        type, relatedEventId, relatedSignupId, recipientName,
        success: false, error: err.message || String(err),
      });
      throw err;
    }
  }
  // Loop always returns or throws above; this is defensive only.
  throw new Error("sendEmailViaResend: exhausted retries for " + to);
}

/**
 * Format a Firestore Timestamp or date-like value to a readable string.
 */
function formatEventDate(dateValue) {
  if (!dateValue) return "";
  let d;
  if (dateValue.toDate && typeof dateValue.toDate === "function") {
    d = dateValue.toDate();
  } else if (dateValue.seconds) {
    d = new Date(dateValue.seconds * 1000);
  } else {
    d = new Date(dateValue);
  }
  if (isNaN(d.getTime())) return String(dateValue);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Shared email helpers — escaping, Outlook-safe button, copy/paste URL fallback.
 */
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

// ─── Personas + Donate helpers ──────────────────────────────────────
// Reads `system/emailPersonas` and `system/donateBlocks` from Firestore
// with a 5-minute in-memory cache. NEVER throws — every helper returns
// a hardcoded fallback that matches what was hardcoded in this file
// before the refactor, so emails keep going out even if Firestore is
// unreachable, the doc is missing, or someone edits the doc into a
// broken state. To force-clear the cache, call `_clearPersonaCache()`
// (the new Admin → List Mgmt "Refresh Now" button hits this via the
// `clearPersonaCache` HTTPS endpoint at the bottom of this file).

const _PERSONA_CACHE_TTL_MS = 5 * 60 * 1000;
let _personaCache = { data: null, loadedAt: 0 };
let _donateCache = { data: null, loadedAt: 0 };

function _clearPersonaCache() {
  _personaCache = { data: null, loadedAt: 0 };
  _donateCache  = { data: null, loadedAt: 0 };
}

// Hardcoded fallback — matches production HTML as of 2026-05-02
// (same values as the Phase 1B seed). If Firestore is broken at deploy
// time, helpers fall back to these and emails are byte-identical to
// pre-refactor.
const _PERSONA_FALLBACK = {
  personas: {
    eventCoordinator: {
      firstName: 'Leilani', fullName: 'Leilani Kailiawa',
      title: 'Parent Consultant', email: 'lkailiawa@ldahawaii.org',
      phone: '(808) 536-9684 ext 112',
      signatureHtml:
        '<p style="margin:16px 0 2px;font-size:14px;color:#555555;line-height:1.5;">' +
          '<strong>Leilani Kailiawa</strong><br>' +
          'Parent Consultant<br>' +
          'Leadership in Disabilities &amp; Achievement of Hawai\'i<br>' +
          '245 N. Kukui St. Ste. 205, Honolulu, HI 96817<br>' +
          'Phone: (808) 536-9684 ext 112<br>' +
          'Email: <a href="mailto:lkailiawa@ldahawaii.org" style="color:#1a73e8;text-decoration:none;">lkailiawa@ldahawaii.org</a><br>' +
          '<a href="https://www.ldahawaii.org" style="color:#1a73e8;text-decoration:none;">LDAHawaii.org</a>' +
        '</p>',
    },
    resourceCoordinator: {
      firstName: 'La\'a', fullName: 'La\'a Salvani',
      title: 'Administrative Assistant', email: 'LSalvani@ldahawaii.org',
      phone: '(808) 536-9684',
      signatureHtml:
        '<p style="margin:16px 0 2px;font-size:14px;color:#555555;line-height:1.5;">' +
          '<strong>La\'a Salvani</strong><br>' +
          'Administrative Assistant<br>' +
          'Leadership in Disabilities &amp; Achievement of Hawai\'i<br>' +
          '245 N. Kukui St. Ste. 205, Honolulu, HI 96817<br>' +
          'Phone: (808) 536-9684<br>' +
          'Email: <a href="mailto:LSalvani@ldahawaii.org" style="color:#1a73e8;text-decoration:none;">LSalvani@ldahawaii.org</a><br>' +
          '<a href="https://www.ldahawaii.org" style="color:#1a73e8;text-decoration:none;">LDAHawaii.org</a>' +
        '</p>',
    },
    executiveDirector: {
      firstName: 'Rosie', fullName: 'Rosie Rowe',
      title: 'Executive Director', email: 'rrowe@ldahawaii.org',
      phone: '(808) 536-9684',
      signatureHtml: '',
    },
    general: {
      firstName: 'LDAH', fullName: 'LDAH Team',
      title: '', email: 'registration@ldahawaii.org',
      phone: '(808) 536-9684', signatureHtml: '',
    },
  },
  orgFooterHtml:
    '<tr>' +
      '<td style="background-color:#f0f0f0;padding:24px 32px;text-align:center;border-top:1px solid #dddddd;">' +
        '<p style="margin:0 0 4px;font-size:13px;color:#777777;font-weight:bold;">Leadership in Disabilities &amp; Achievement of Hawai\'i</p>' +
        '<p style="margin:0 0 4px;font-size:12px;color:#999999;">245 N. Kukui St., Suite 205, Honolulu, HI 96817</p>' +
        '<p style="margin:0 0 4px;font-size:12px;color:#999999;">Phone: (808) 536-9684</p>' +
        '<p style="margin:0;font-size:12px;color:#999999;">Email: <a href="mailto:rrowe@ldahawaii.org" style="color:#999999;">rrowe@ldahawaii.org</a></p>' +
      '</td>' +
    '</tr>',
};

const _DONATE_FALLBACK = {
  donateUrl: 'https://www.paypal.com/donate?hosted_button_id=F6F2DPC4D6RSA',
  buttonLabel: 'Donate to LDAH',
  universal: { bodyHtml:
    '<p style="margin:24px 0 8px;font-size:14px;color:#475569;line-height:1.55;">' +
      'LDAH is a nonprofit that provides every service free of charge. ' +
      'If our work supports your family, please consider a gift so the next family can be helped too.' +
    '</p>' },
  feedback: { bodyHtml:
    '<p style="margin:24px 0 8px;font-size:14px;color:#0F172A;line-height:1.55;">' +
      'This session was offered to your family at no cost — made possible by individual donors. ' +
      'If LDAH has helped you, please consider giving so the next family can experience what you just did.' +
    '</p>' },
};

async function _loadPersonaDoc() {
  const now = Date.now();
  if (_personaCache.data && (now - _personaCache.loadedAt) < _PERSONA_CACHE_TTL_MS) {
    return _personaCache.data;
  }
  try {
    const snap = await admin.firestore().collection('system').doc('emailPersonas').get();
    if (!snap.exists) throw new Error('system/emailPersonas missing');
    const d = snap.data() || {};
    if (!d.personas || !d.personas.eventCoordinator) throw new Error('emailPersonas missing required keys');
    _personaCache = { data: d, loadedAt: now };
    return d;
  } catch (err) {
    console.warn('Persona doc load failed, using fallback:', err.message);
    return _PERSONA_FALLBACK;
  }
}

async function _loadDonateDoc() {
  const now = Date.now();
  if (_donateCache.data && (now - _donateCache.loadedAt) < _PERSONA_CACHE_TTL_MS) {
    return _donateCache.data;
  }
  try {
    const snap = await admin.firestore().collection('system').doc('donateBlocks').get();
    if (!snap.exists) throw new Error('system/donateBlocks missing');
    const d = snap.data() || {};
    if (!d.donateUrl || !d.universal || !d.feedback) throw new Error('donateBlocks missing required keys');
    _donateCache = { data: d, loadedAt: now };
    return d;
  } catch (err) {
    console.warn('Donate doc load failed, using fallback:', err.message);
    return _DONATE_FALLBACK;
  }
}

// getPersona('eventCoordinator' | 'resourceCoordinator' | 'executiveDirector' | 'general')
// Returns { firstName, fullName, title, email, phone, signatureHtml }.
// Unknown role → 'general' fallback.
async function getPersona(role) {
  const doc = await _loadPersonaDoc();
  const personas = (doc && doc.personas) || _PERSONA_FALLBACK.personas;
  return personas[role] || personas.general || _PERSONA_FALLBACK.personas.general;
}

// buildSignatureBlock(role) — returns the rendered HTML signature block
// for the given persona, or "" if the persona has no signatureHtml
// (executiveDirector and general default to empty).
async function buildSignatureBlock(role) {
  const p = await getPersona(role);
  return (p && p.signatureHtml) || '';
}

// getOrgFooterHtml() — returns the grey contact-card footer HTML used at
// the bottom of registration / lifecycle emails.
async function getOrgFooterHtml() {
  const doc = await _loadPersonaDoc();
  return (doc && doc.orgFooterHtml) || _PERSONA_FALLBACK.orgFooterHtml;
}

// buildDonateBlock('universal' | 'feedback') — returns body copy + a
// donate button. Embed above the signature in any email.
async function buildDonateBlock(flavor) {
  const doc = await _loadDonateDoc();
  const f = (flavor === 'feedback') ? doc.feedback : doc.universal;
  const url = doc.donateUrl || _DONATE_FALLBACK.donateUrl;
  const label = doc.buttonLabel || _DONATE_FALLBACK.buttonLabel;
  return (f && f.bodyHtml ? f.bodyHtml : '')
    + _emailBtn(url, label, { bg: '#0E7C4D', align: 'center' });
}

// HTTPS endpoint to flush the in-memory cache from the Admin → List
// Management "Refresh Now" button. Caller must be authenticated as
// admin/superAdmin (rule enforced client-side by hiding the button +
// re-checked by callers via Firebase Auth ID token below).
exports.clearPersonaCache = functions
  .runWith({ timeoutSeconds: 10, maxInstances: 5 })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');
    const uid = context.auth.uid;
    const userRoleSnap = await admin.firestore().collection('userRoles').doc(uid).get();
    const role = userRoleSnap.exists ? (userRoleSnap.data().role || '') : '';
    if (role !== 'superAdmin' && role !== 'admin') {
      throw new functions.https.HttpsError('permission-denied', 'Admin only.');
    }
    _clearPersonaCache();
    return { ok: true, clearedAt: Date.now() };
  });

// Renders a "having trouble with the buttons?" footer block listing each
// link with a short label so recipients can copy and paste the URL.
// `links` is an array of { label, href }. Returns "" if the array is empty.
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

/**
 * Build the registration email HTML.
 */
function buildRegistrationEmailHtml({ name, eventTitle, eventDate, signupId, eventId, type, orgFooterHtml }) {
  const registrationUrl =
    "https://ldahawaii.org/register.html?token=" + encodeURIComponent(signupId) +
    "&eventId=" + encodeURIComponent(eventId) +
    "&type=" + encodeURIComponent(type);
  const dateLine = eventDate ? " on " + eventDate : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">

  <!-- Header -->
  <tr>
    <td style="background-color:#ffffff;padding:28px 32px 20px;text-align:center;border-bottom:3px solid #1a3c6e;">
      <img src="https://www.ldahawaii.org/logo_blue.png" alt="Leadership in Disabilities &amp; Achievement of Hawai'i" width="150" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;">
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="padding:32px;">
      <p style="margin:0 0 16px;font-size:16px;color:#333333;">Aloha ${name},</p>

      <p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">
        Mahalo for signing up for <strong>${eventTitle}</strong>${dateLine}.
        To complete your registration, please click the button below.
      </p>

      ${_emailBtn(registrationUrl, "Complete Registration", { bg: "#1a73e8" })}

      <p style="margin:16px 0;font-size:15px;color:#555555;line-height:1.5;">
        This information helps us serve you better and is required for our
        reporting to ensure continued funding for LDAH programs.
      </p>

      <p style="margin:0 0 16px;font-size:15px;color:#555555;line-height:1.5;">
        Please note that your spot is reserved once registration is complete.
        We want to make sure we have a place saved for you, so completing this
        form as soon as possible helps us plan accordingly.
      </p>

      <p style="margin:0 0 0;font-size:15px;color:#555555;line-height:1.5;">
        Reminder: Please register each person who will be attending, including children.
      </p>

      ${_emailLinkFooter([
        { label: "Complete Registration", href: registrationUrl },
      ])}
    </td>
  </tr>

  <!-- Footer -->
  ${orgFooterHtml || ''}

</table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Build the registration-confirmed email HTML — sent once after the family
 * has fully completed the registration form (status flips to "confirmed")
 * AND no reminder email has already gone out for any of their session dates.
 *
 * Intentionally minimal: just confirms they're handled and tells them
 * reminder emails are coming. Session details, Zoom/location, and any
 * prep info live in the 5-day and 1-day reminder emails.
 *
 * When inlineFlow is true (registrationFlow === 'inline-at-signup'), the
 * "Complete Your Registration" CTA is omitted and replaced with a plain
 * "You're all set" line. (v62.0.0)
 */
function buildConfirmationEmailHtml({ name, eventTitle, datesPhrase, modality, inlineFlow }) {
  const greetingName = _emailEsc(name || "there");
  const safeTitle = _emailEsc(eventTitle || "your LDAH session");
  const datesSuffix = datesPhrase ? _emailEsc(datesPhrase) : "";
  // Modality-aware "what's in the reminder" copy
  let reminderTail;
  if (modality === "in-person") {
    reminderTail = "with the location details and everything else you need to succeed";
  } else if (modality === "mixed") {
    reminderTail = "with the Zoom access or location details for each session and everything else you need to succeed";
  } else {
    reminderTail = "with your access into Zoom and everything else you need to succeed";
  }

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
        You're all set for <strong>${safeTitle}</strong>${datesSuffix}. Mahalo for completing your registration!
      </p>

      ${inlineFlow
        ? '<p style="margin:0;font-size:16px;color:#333333;line-height:1.5;">You\'re all set — we have everything we need. We\'ll see you' + (datesSuffix || " at the event") + '.</p>'
        : '<p style="margin:0;font-size:16px;color:#333333;line-height:1.5;">We\'ll email you a reminder <strong>3 days before</strong> your session and again <strong>on the day of the session</strong>, ' + reminderTail + '.</p>'
      }
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

/**
 * Build the Parent Talk Cafe confirmation email HTML — sent once when a
 * signup is confirmed for an event whose zoomMode === 'parent_talk_cafe'.
 *
 * This is the ONLY email Parent Talk Cafe attendees receive (no 5-day /
 * 1-day Zoom reminders fire — sendEventReminders skips zoomMode='parent_talk_cafe').
 * Includes the Facebook group button, the "join Facebook + PTC ahead of
 * time" nudge, and a Donate button.
 */
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

/**
 * Determine whether a signup is virtual, in-person, or mixed so the
 * confirmation email can promise the right "what's in the reminder" detail.
 *
 * For recurring events, the signup's selectedSessions strings carry the
 * per-session location ("YYYY-MM-DD|location|time-range"), so we read each
 * one. For one-time events, we fall back to the parent event's location field.
 *
 * Returns "virtual", "in-person", or "mixed". Defaults to "virtual" when we
 * can't tell, since most LDAH sessions run on Zoom.
 */
function detectSignupModality(signup, event) {
  const isVirtualString = (s) => /\b(zoom|virtual|online|webinar)\b/i.test(s || "");

  const sel = (signup && Array.isArray(signup.selectedSessions))
    ? signup.selectedSessions : [];
  if (sel.length > 0) {
    let hasVirtual = false;
    let hasInPerson = false;
    sel.forEach((s) => {
      const loc = (String(s).split("|")[1] || "").trim();
      if (!loc) return;
      if (isVirtualString(loc)) hasVirtual = true;
      else hasInPerson = true;
    });
    if (hasVirtual && hasInPerson) return "mixed";
    if (hasVirtual) return "virtual";
    if (hasInPerson) return "in-person";
  }
  // One-time events: lean on event.location
  return isVirtualString(event && event.location) ? "virtual" : "in-person";
}

/**
 * Build the trailing ", on Month Dayth [and Y / , Y, and Z]" phrase for the
 * confirmation email. Takes an array of YYYY-MM-DD keys (already deduped
 * and HST-correct from extractSignupSessionKeys / toHstDateKey). Returns
 * "" if none, so the calling template renders cleanly without the phrase.
 */
function formatDatesPhrase(sessionKeys) {
  if (!Array.isArray(sessionKeys) || sessionKeys.length === 0) return "";
  // Sort chronologically and parse as local date components (avoid UTC-midnight bug)
  const sorted = [...sessionKeys].sort();
  const labels = sorted.map((iso) => {
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const dt = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    if (isNaN(dt.getTime())) return null;
    const weekday = dt.toLocaleDateString("en-US", { weekday: "long" });
    const month = dt.toLocaleDateString("en-US", { month: "long" });
    const day = dt.getDate();
    const ord = (day >= 11 && day <= 13)
      ? "th"
      : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th");
    return `${weekday}, ${month} ${day}${ord}`;
  }).filter(Boolean);
  if (labels.length === 0) return "";
  if (labels.length === 1) return `, on ${labels[0]}`;
  if (labels.length === 2) return `, on ${labels[0]} and ${labels[1]}`;
  return `, on ${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

/**
 * After a signup transitions to "confirmed", send a registration-confirmed
 * email recapping what they signed up for and announcing the upcoming
 * 3-day + day-of reminders. Skips if a reminder has already gone out
 * (catch-up reminder fired) or if any session is within the 3-day window
 * (catch-up reminder will fire shortly).
 */
async function maybeSendRegistrationConfirmation(change, context, collection) {
  try {
    const before = change.before.data() || {};
    const after = change.after.data() || {};

    // Fire on the same transitions as the catch-up reminder
    const statusJustConfirmed = before.status !== "confirmed" && after.status === "confirmed";
    const registrationJustAdded = !before.registration && !!after.registration;
    if (!statusJustConfirmed && !registrationJustAdded) return;
    if (after.archived === true) return;
    if (!after.email) return;
    // Status gate is applied after the event load below — Connect-Gen
    // signups stay 'pending' until consent is signed, so we allow that
    // status through for the consent-required branch only.

    // Idempotence — never send twice for the same signup
    if (after.confirmationEmailSentAt) return;

    // Skip if a reminder has already been sent for any session
    const reminders = (after.sessionReminders && typeof after.sessionReminders === "object")
      ? after.sessionReminders : {};
    const anyReminderSent = Object.values(reminders).some(r => r && (r.fiveDay || r.oneDay));
    if (anyReminderSent) return;

    const eventId = context.params.eventId;
    const signupId = context.params.signupId;
    const db = admin.firestore();

    // Load event for title + fallback date + Connect-Gen flag
    const eventSnap = await db.collection(collection).doc(eventId).get();
    if (!eventSnap.exists) return;
    const event = eventSnap.data() || {};

    // Stage 3b-2 step 4 (2026-05-11): primary session-derivation now flows
    // through getSignupSessions(signup, event) — the canonical accessor added
    // in Stage 3b-1. Falls back to legacySessionsForSignup() on empty result.
    let viaAccessor = 0;
    let viaLegacy = 0;
    let _sessions = getSignupSessions(after, event);
    let _usedLegacy = false;
    if (!_sessions || _sessions.length === 0) {
      _sessions = legacySessionsForSignup(after, event);
      _usedLegacy = _sessions.length > 0;
    }
    if (_usedLegacy) viaLegacy++; else if (_sessions && _sessions.length) viaAccessor++;
    let sessionKeys = (_sessions || []).map((s) => s && s.dateKey).filter(Boolean);
    if (sessionKeys.length === 0) {
      const k = toHstDateKey(event.eventDate || event.date);
      if (k) sessionKeys = [k];
    }

    const recipientName = after.name || "there";
    const eventTitle = event.title || "your LDAH session";
    const datesPhrase = formatDatesPhrase(sessionKeys);
    const modality = detectSignupModality(after, event);

    // Connect-Gen branch — MUST run BEFORE the 3-day window skip below.
    // For programs flagged Program Zoom, the consent gate is required
    // regardless of how close the session is. Without this ordering, a
    // late signup (e.g. 2 days out) would skip the consent email AND the
    // catch-up reminder would also skip it (gated on consentSignedAt) —
    // and the parent gets nothing.
    const isConnectGen = event && event.zoomMode === "program";
    const isParentTalkCafe = event && event.zoomMode === "parent_talk_cafe";

    // Status gate (deferred from earlier so we know if this is Connect-Gen).
    // Non-Connect-Gen requires status='confirmed'. Connect-Gen allows
    // status='pending' so the consent-required email can fire while the
    // signup waits on the parent's signature.
    if (after.status !== "confirmed" && !(isConnectGen && after.status === "pending")) return;

    // Parent Talk Cafe branch — single-shot confirmation that doubles as
    // the only reminder. Send regardless of session proximity (no 5-day
    // catch-up email applies — sendEventReminders skips PTC entirely).
    if (isParentTalkCafe) {
      const donateHtml = await buildDonateBlock("universal");
      const html = buildParentTalkCafeConfirmationEmailHtml({
        name: recipientName,
        eventTitle,
        datesPhrase,
        eventTime: (event && (event.time || event.startTime)) || "",
        donateHtml,
      });
      const fromAddress = process.env.SMTP_FROM || "onboarding@resend.dev";
      await sendEmailViaResend({
        from: `LDAH <${fromAddress}>`,
        to: after.email,
        subject: `You're signed up -- ${eventTitle}`,
        html,
        type: "confirmation-parent-talk-cafe",
        relatedEventId: eventId,
        relatedSignupId: signupId,
        recipientName,
      });
      await change.after.ref.set({
        confirmationEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      console.log(`Parent Talk Cafe confirmation sent to ${after.email} for ${collection}/${eventId}/${signupId}`);
      console.log(`maybeSendRegistrationConfirmation: scanned=1, sent=1, skipped=0, errors=0, viaAccessor=${viaAccessor}, viaLegacy=${viaLegacy}`);
      return;
    }

    // Narrow Connect-Gen consent flow to Monday-virtual signups only.
    // Single-date enforcement (in place since 2026-05-12) means each CG signup
    // has exactly one session, so we inspect the first session deterministically.
    // Non-Monday OR in-person CG signups skip the consent gate entirely and
    // confirm like a standard signup — no IEP/Eval needed for those sessions.
    let _cgMondayVirtual = false;
    if (isConnectGen) {
      try {
        const _sSessions = (getSignupSessions(after, event) || []);
        const _firstKey = (_sSessions[0] && _sSessions[0].dateKey)
          || (sessionKeys && sessionKeys[0]) || "";
        let _firstIsMonday = false;
        if (_firstKey && /^\d{4}-\d{2}-\d{2}$/.test(_firstKey)) {
          const _d = new Date(_firstKey + "T00:00:00-10:00");
          if (!isNaN(_d.getTime())) {
            const _dayName = _d.toLocaleDateString("en-US", { weekday: "long", timeZone: "Pacific/Honolulu" });
            _firstIsMonday = (_dayName === "Monday");
          }
        }
        const _firstIsVirtual = _firstKey ? isSessionVirtual(event, _firstKey, after) : false;
        _cgMondayVirtual = _firstIsMonday && _firstIsVirtual;
        if (!_cgMondayVirtual) {
          console.log(`Connect-Gen consent narrowing: ${collection}/${eventId}/${signupId} skipped consent gate (key=${_firstKey || "?"}, monday=${_firstIsMonday}, virtual=${_firstIsVirtual})`);
        }
      } catch (_narrowErr) {
        console.warn(`Connect-Gen narrowing failed (${collection}/${eventId}/${signupId}):`, _narrowErr.message);
        // Conservative fallback: original behavior — keep consent flow on
        // so a parsing glitch never silently drops a real Connect-Gen parent.
        _cgMondayVirtual = true;
      }
    }

    if (isConnectGen && _cgMondayVirtual && !after.consentSignedAt) {
      // Only send once.
      if (after.consentRequiredEmailSentAt) return;
      const consentToken = crypto.randomBytes(16).toString("hex");
      // URL carries eventId/signupId/collection so the CFs can do a direct
      // path lookup instead of a collectionGroup index query. Token still
      // gates authentication.
      const consentUrl = "https://www.ldahawaii.org/connect-gen-consent.html" +
        "?token=" + encodeURIComponent(consentToken) +
        "&e=" + encodeURIComponent(eventId) +
        "&s=" + encodeURIComponent(signupId) +
        "&c=" + encodeURIComponent(collection);
      const signatureHtml = await buildSignatureBlock('eventCoordinator');
      const donateHtml = await buildDonateBlock('universal');
      const html = buildConsentRequiredEmailHtml({
        name: recipientName,
        eventTitle,
        datesPhrase,
        consentUrl,
        signatureHtml,
        donateHtml,
      });
      const fromAddress = lifecycleFromAddress();
      await sendEmailViaResend({
        from: fromAddress,
        to: after.email,
        subject: `Action needed -- consent form for ${eventTitle}`,
        html,
        type: "connect-gen-consent-required",
        relatedEventId: eventId,
        relatedSignupId: signupId,
        recipientName,
      });
      await change.after.ref.set({
        consentToken,
        consentRequiredEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      console.log(`Consent-required email sent to ${after.email} for ${collection}/${eventId}/${signupId}`);
      console.log(`maybeSendRegistrationConfirmation: scanned=1, sent=1, skipped=0, errors=0, viaAccessor=${viaAccessor}, viaLegacy=${viaLegacy}`);
      return; // do NOT mark confirmationEmailSentAt — the prep email later does that
    }

    // Connect-Gen + consent already signed → send the prep-docs email
    // (in case status flipped from pending to confirmed AFTER consent was
    // already on file from a prior run). Only relevant for Monday-virtual
    // CG signups — non-Monday-virtual CG skips the consent flow entirely.
    if (isConnectGen && _cgMondayVirtual && after.consentSignedAt) {
      // submitConnectGenConsent already sent the prep email when the form
      // was submitted. Don't double-send. Just stamp confirmationEmailSentAt
      // so this branch doesn't keep re-firing.
      await change.after.ref.set({
        confirmationEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    // For non-Connect-Gen events: skip the standard confirmation if any
    // session is within the 3-day catch-up window — the catch-up reminder
    // (which fires from maybeSendCatchupReminder above this in the trigger
    // chain) carries the same info and is the more useful email at that
    // point. Connect-Gen signups bypass this skip: their non-Monday-virtual
    // signups fall through the narrowing above and need the standard
    // confirmation here regardless of session proximity (2026-05-12 fix —
    // previously caused Thursday-in-person CG signups within 3 days to get
    // no email at all).
    if (!isConnectGen) {
      const _todayKey = toHstDateKey(new Date());
      const _windowKeys = {};
      for (let _d = 0; _d <= 3; _d++) {
        const _k = addDaysHst(_todayKey, _d);
        if (_k) _windowKeys[_k] = true;
      }
      const _withinWindow = sessionKeys.some(k => !!_windowKeys[k]);
      if (_withinWindow) {
        console.log(`Confirmation skipped (within 3d window) for ${collection}/${eventId}/${signupId}`);
        console.log(`maybeSendRegistrationConfirmation: scanned=1, sent=0, skipped=1, errors=0, viaAccessor=${viaAccessor}, viaLegacy=${viaLegacy}`);
        return;
      }
    }

    // Standard non-Connect-Gen path.
    // Inline-flow signups (registrationFlow === 'inline-at-signup') skip the
    // "Complete Your Registration" CTA and show a plain "You're all set" message.
    const _inlineFlow = after.registrationFlow === "inline-at-signup";
    const html = buildConfirmationEmailHtml({
      name: recipientName,
      eventTitle,
      datesPhrase,
      modality,
      inlineFlow: _inlineFlow,
    });

    const fromAddress = process.env.SMTP_FROM || "onboarding@resend.dev";
    await sendEmailViaResend({
      from: `LDAH <${fromAddress}>`,
      to: after.email,
      subject: `Confirmed -- ${eventTitle}`,
      html,
      type: "confirmation",
      relatedEventId: eventId,
      relatedSignupId: signupId,
      recipientName,
    });
    // Stamp the idempotency marker AND, for non-Monday-virtual Connect-Gen
    // (Thursday in-person sessions that bypass the consent flow), promote
    // status from "pending" to "confirmed" in the same write. Without the
    // status flip, the sendDeferredRegistrationEmails cron would treat
    // these signups as still-incomplete 10 minutes later and email
    // "Complete Your Registration" — a redundant nudge after we just
    // emailed "Confirmed" (2026-05-15 Villalobos case).
    const _stamp = {
      confirmationEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (isConnectGen && after.status !== "confirmed") {
      _stamp.status = "confirmed";
    }
    await change.after.ref.set(_stamp, { merge: true });
    console.log(`Confirmation email sent to ${after.email} for ${collection}/${eventId}/${signupId}${_stamp.status ? ' (status -> confirmed)' : ''}`);
    console.log(`maybeSendRegistrationConfirmation: scanned=1, sent=1, skipped=0, errors=0, viaAccessor=${viaAccessor}, viaLegacy=${viaLegacy}`);
  } catch (err) {
    console.error(`maybeSendRegistrationConfirmation error (${collection}/${context.params.eventId}/${context.params.signupId}):`, err.message);
  }
}

/**
 * Core handler shared by both event-signup and recurringEvent-signup triggers.
 */
async function handleSignupCreated(snap, context, collectionName) {
  const signupData = snap.data();
  const { eventId, signupId } = context.params;

  // Update denormalized counts on parent doc (admin SDK bypasses security rules)
  try {
    await admin.firestore().collection(collectionName).doc(eventId).update({
      signupCount: admin.firestore.FieldValue.increment(1),
      pendingCount: admin.firestore.FieldValue.increment(1),
    });
  } catch (countErr) {
    console.error(`Count update failed for ${collectionName}/${eventId}:`, countErr.message);
  }

  // ── Contact auto-creation / linking ──────────────────────────────────
  try {
    const db = admin.firestore();
    const signupEmail = signupData.email ? signupData.email.trim().toLowerCase() : null;
    const signupPhone = signupData.phone ? signupData.phone.replace(/\D/g, '') : null;
    const signupName = signupData.name || signupData.firstName || '';

    let linkedContactId = null;

    if (signupEmail) {
      // Query contacts by normalized email
      const emailSnap = await db.collection('contacts').where('email', '==', signupEmail).get();

      if (emailSnap.size === 1) {
        linkedContactId = emailSnap.docs[0].id;
      } else if (emailSnap.size === 0) {
        // Create a new contact
        const nameParts = signupName.trim().split(/\s+/);
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        const newContactRef = await db.collection('contacts').add({
          displayName: signupName,
          firstName,
          lastName,
          email: signupEmail,
          phone: signupData.phone || '',
          type: '',
          source: 'event-signup',
          createdBy: 'auto-signup',
          createdByName: 'Auto-Signup',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        linkedContactId = newContactRef.id;
        console.log(`Auto-created contact ${linkedContactId} for signup ${signupId}`);
      } else {
        // Multiple matches — link to first, warn
        linkedContactId = emailSnap.docs[0].id;
        console.warn(`Multiple contacts (${emailSnap.size}) found for email ${signupEmail}; linked to ${linkedContactId}`);
      }
    } else if (signupPhone) {
      // No email — try phone lookup
      const phoneSnap = await db.collection('contacts').where('phone', '==', signupPhone).get();

      if (phoneSnap.size === 1) {
        linkedContactId = phoneSnap.docs[0].id;
      } else if (phoneSnap.size === 0) {
        const nameParts = signupName.trim().split(/\s+/);
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        const newContactRef = await db.collection('contacts').add({
          displayName: signupName,
          firstName,
          lastName,
          email: '',
          phone: signupPhone,
          type: '',
          source: 'event-signup',
          createdBy: 'auto-signup',
          createdByName: 'Auto-Signup',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        linkedContactId = newContactRef.id;
        console.log(`Auto-created contact ${linkedContactId} (phone-only) for signup ${signupId}`);
      } else {
        linkedContactId = phoneSnap.docs[0].id;
        console.warn(`Multiple contacts (${phoneSnap.size}) found for phone ${signupPhone}; linked to ${linkedContactId}`);
      }
    }

    // Write linkedContactId on the signup doc (null if no email/phone)
    await snap.ref.update({ linkedContactId });

    // Instant prior-registration apply: a pending Parent/Guardian signup for a
    // one-time event whose contact completed a registration in the last 12
    // months is confirmed RIGHT NOW — before the deferred "complete your
    // registration" email (10-min grace) ever fires. Mirrors the 5 AM
    // processPendingParentRegistrations auto-apply, just earlier. Own try/catch
    // so it never blocks the rest of signup handling.
    try {
      const role = signupData.registrantType || signupData.role || (signupData.registration && signupData.registration.role) || "";
      const alreadyDone = signupData.registration && typeof signupData.registration === "object";
      if (collectionName === "events" && linkedContactId && role === "Parent/Guardian"
          && signupData.status !== "confirmed" && !alreadyDone) {
        const prior = await _findPriorCompletedRegistration(db, linkedContactId, snap.ref.path, Date.now() - 365 * 24 * 60 * 60 * 1000);
        if (prior) {
          await snap.ref.update({
            registration: prior.registration,
            status: "confirmed",
            registrationCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
            registrationCompletedVia: "prior-auto",
            registrationAppliedFromSignupId: prior.id,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`handleSignupCreated: applied prior reg to ${snap.ref.path} from ${prior.path}`);
        }
      }
    } catch (priorErr) {
      console.error(`handleSignupCreated prior-reg apply failed for ${signupId}:`, priorErr.message);
    }
  } catch (contactErr) {
    console.error(`Contact auto-creation failed for signup ${signupId}:`, contactErr.message);
    // Non-blocking — continue to email logic
  }

  // ── Connect-Gen returning-family detection ──────────────────────
  // For the Connect-Gen recurring program, flag signups where the family
  // has done a Connect-Gen before (either by the form question they just
  // answered OR by a prior signup row under the same email). When a flag
  // fires, auto-create an Open interaction so La'a can pre-call them.
  try {
    if (collectionName === "recurringEvents" && eventId === "CmkPXEpPwfAQ5sR377K2") {
      await detectAndFlagReturningCG(snap, signupData, signupId);
    }
  } catch (cgErr) {
    console.error(`returning-CG detection failed for signup ${signupId}:`, cgErr.message);
  }

  // ── No immediate "Complete Your Registration" email ──
  // The previous behavior fired this email the instant a signup doc was
  // created with status:"pending". Two-stage flow: signup modal creates
  // pending → user fills the registration form on the same page → status
  // flips to "confirmed" within minutes. The instant-fire meant inline
  // completers received an unnecessary "please finish" email even though
  // they did finish.
  //
  // The deferred sender (sendDeferredRegistrationEmails, scheduled every
  // minute) handles this now with a 10-minute grace window: it only
  // emails signups still pending after 10 minutes and not already sent.

  // ── Special-accommodations presenter task ──
  // If the signup carries a special-accommodations note, create an Open
  // follow-up routed to the presenter (or program creator) due on the
  // participant's earliest selected date. Own try/catch — never blocks signup.
  try {
    await createAccommodationsTask(snap, signupData, signupId, eventId, collectionName);
  } catch (accErr) {
    console.error(`accommodations task failed for signup ${signupId}:`, accErr.message);
  }

  return null;
}

// ── Returning-Connect-Gen detection helper ───────────────────────
// Two independent signals: form answer (priorConnectGen === "Yes") OR
// a prior non-cancelled signup row under the same email. If either
// fires, write isReturningCGFamily + returningCGSource on the new
// signup and auto-create an Open interaction owned by La'a so he can
// call the family 2 days before their session.
async function detectAndFlagReturningCG(snap, signupData, signupId) {
  const db = admin.firestore();

  // Idempotency: don't re-run on re-trigger / replay.
  if (signupData.isReturningCGFamily === true) return;

  // Signal A: the front-end form question. The CG signup modal renders
  // a required Yes/No radio for Connect-Gen events only.
  const formSignal = signupData.priorConnectGen === "Yes";

  // Signal B: any prior signup row under recurringEvents/<CG>/signups
  // with the same email (case-insensitive) AND status !== "cancelled"
  // AND a different doc id.
  let backendSignal = false;
  const email = (signupData.email || "").trim().toLowerCase();
  if (email) {
    try {
      const sigSnap = await db.collection("recurringEvents")
        .doc("CmkPXEpPwfAQ5sR377K2").collection("signups").get();
      for (const d of sigSnap.docs) {
        if (d.id === signupId) continue;
        const sd = d.data() || {};
        const other = (sd.email || "").trim().toLowerCase();
        if (!other || other !== email) continue;
        if (sd.status === "cancelled") continue;
        backendSignal = true;
        break;
      }
    } catch (err) {
      console.warn(`returning-CG backend signal scan failed: ${err.message}`);
    }
  }

  if (!formSignal && !backendSignal) return;

  let source = "both";
  if (formSignal && !backendSignal) source = "form";
  else if (!formSignal && backendSignal) source = "backend";

  // Idempotency: skip if an interactions doc already references this signup.
  try {
    const existing = await db.collection("interactions")
      .where("relatedSignupId", "==", signupId).limit(1).get();
    if (!existing.empty) {
      console.log(`returning-CG: interaction already exists for signup ${signupId}, skipping`);
      // Still set the flag on the signup if it's missing.
      if (signupData.isReturningCGFamily !== true) {
        await snap.ref.update({ isReturningCGFamily: true, returningCGSource: source });
      }
      return;
    }
  } catch (_) { /* non-blocking */ }

  // Flip the flag on the signup itself.
  try {
    await snap.ref.update({ isReturningCGFamily: true, returningCGSource: source });
  } catch (err) {
    console.warn(`returning-CG: signup flag update failed: ${err.message}`);
  }

  // Resolve owner via system/emailPersonas.personas.resourceCoordinator.uid
  // (set 2026-05-14). Fall back to the canonical La'a uid + persona name if
  // the doc is unreachable, so the interaction is never orphaned.
  let ownerUid = "";
  let ownerName = "";
  try {
    const p = await getPersona("resourceCoordinator");
    ownerUid = p && p.uid ? p.uid : "";
    ownerName = p && p.fullName ? p.fullName : "";
  } catch (_) {}
  if (!ownerUid) ownerUid = "hj6YnfnZ66Yul9mtnULRW5FTWKH3";
  if (!ownerName) ownerName = "La'a Salvani";

  const followUpDate = addDaysHst(toHstDateKey(new Date()), 2);

  const clientName = signupData.name
    || [signupData.firstName, signupData.lastName].filter(Boolean).join(" ").trim()
    || "Unknown";

  const sessionLabel = (Array.isArray(signupData.selectedSessions) && signupData.selectedSessions[0])
    || (Array.isArray(signupData.selectedDates) && signupData.selectedDates[0])
    || "(session not specified)";

  const interaction = {
    channel: "Connect-Gen Follow-Up",
    interactionType: "Returning Family Pre-Call",
    contactId: signupData.linkedContactId || null,
    contactName: clientName,
    contactType: "Parent/Guardian",
    grantProgram: "",
    summary: "Returning Connect-Gen family — verify they know what to expect. Session: "
      + sessionLabel + ". Signal: " + source + ".",
    followUpDate: followUpDate,
    status: "Open",
    notes: "Auto-created from Connect-Gen signup. Pre-call this family 2 days before their session date to confirm they know the format and what to bring.",
    isDraft: false,
    owner: ownerName,
    ownerUid: ownerUid,
    relatedSignupId: signupId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    const intRef = await db.collection("interactions").add(interaction);
    console.log(`returning-CG: interaction ${intRef.id} created for signup ${signupId} (source=${source})`);
  } catch (err) {
    console.error(`returning-CG: interaction write failed: ${err.message}`);
  }

  // Audit log so daily-report changelog picks it up automatically.
  try {
    await db.collection("auditLog").add({
      action: "Flagged returning Connect-Gen family",
      details: clientName + " -- session " + sessionLabel + " (signal: " + source + ")",
      performedBy: "System (auto)",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) { console.warn("returning-CG: auditLog write failed:", e.message); }
}

// ── Special-Accommodations presenter task ────────────────────────────
// When a signup carries a non-empty special-accommodations note, create an
// Open follow-up interaction routed to the event's presenter — or the program
// creator if no presenter is assigned yet, or La'a as a last resort so the
// note is never lost — so it's acted on before the event. Due = the
// participant's earliest selected date. Idempotent per signup. Fires for
// every event type that carries a note.
async function createAccommodationsTask(snap, signupData, signupId, eventId, collectionName) {
  const db = admin.firestore();

  // 1. Read the note — field name drifts; first non-empty wins.
  const reg = signupData.registration && typeof signupData.registration === "object"
    ? signupData.registration : {};
  const note = String(
    reg.accommodations || reg.accommodationsNeeded
    || signupData.accommodations || signupData.additionalComments || ""
  ).trim();
  if (!note) return;

  // 2. Idempotency — skip if this signup already has a Special Accommodations
  //    interaction. relatedSignupId is also used by returning-CG, so filter by
  //    type in code to avoid needing a composite index.
  try {
    const existing = await db.collection("interactions")
      .where("relatedSignupId", "==", signupId).get();
    if (existing.docs.some(d => (d.data() || {}).interactionType === "Special Accommodations")) {
      console.log(`accommodations: task already exists for signup ${signupId}, skipping`);
      return;
    }
  } catch (e) { console.warn(`accommodations: idempotency check failed: ${e.message}`); }

  // 3. Load the parent event for presenter / creator / title.
  let ev = {};
  try {
    const evSnap = await db.collection(collectionName).doc(eventId).get();
    if (evSnap.exists) ev = evSnap.data() || {};
  } catch (e) {
    console.error(`accommodations: event load failed for ${collectionName}/${eventId}: ${e.message}`);
    return; // can't route without the event — bail rather than guess
  }

  // 4. Earliest selected date (ISO sorts chronologically) + matching composite key.
  const dateKeys = (extractSignupSessionKeys(signupData) || []).filter(Boolean).sort();
  const earliestDate = dateKeys[0] || "";
  let compositeKey = "";
  if (Array.isArray(signupData.selectedSessions)) {
    compositeKey = signupData.selectedSessions.find((s) => {
      const head = String(s || "").split("|")[0].trim();
      return head === earliestDate || toHstDateKey(head) === earliestDate;
    }) || signupData.selectedSessions[0] || "";
  }

  // 5. Resolve assignee: presenter → program creator → La'a (never orphaned).
  let ownerUid = "", ownerName = "", autoRouted = false;
  // 5a. per-session presenter (recurring / multi-session one-time)
  if (compositeKey && ev.sessionSummaries && ev.sessionSummaries[compositeKey]
      && ev.sessionSummaries[compositeKey].presenterUid) {
    ownerUid = ev.sessionSummaries[compositeKey].presenterUid;
    ownerName = ev.sessionSummaries[compositeKey].presenter || "";
  }
  // 5b. event-level presenter (single-session one-time — the common case)
  if (!ownerUid && ev.summary && ev.summary.presenterUid) {
    ownerUid = ev.summary.presenterUid;
    ownerName = ev.summary.presenter || "";
  }
  // 5c. any session summary whose date matches the earliest selected date
  if (!ownerUid && earliestDate && ev.sessionSummaries) {
    for (const k of Object.keys(ev.sessionSummaries)) {
      const s = ev.sessionSummaries[k] || {};
      if (!s.presenterUid) continue;
      const head = String(k).split("|")[0].trim();
      if (head === earliestDate || toHstDateKey(head) === earliestDate) {
        ownerUid = s.presenterUid; ownerName = s.presenter || ""; break;
      }
    }
  }
  // 5d. no presenter → program creator
  if (!ownerUid) {
    ownerUid = ev.createdByUid || "";
    ownerName = ev.createdByName || "";
  }
  // 5e. last resort → La'a, so the note is never lost
  if (!ownerUid) {
    ownerUid = LIFECYCLE_LAA_UID;
    try { ownerName = await _lcResolveStaffName(db, LIFECYCLE_LAA_UID); } catch (_) {}
    autoRouted = true;
  }
  if (!ownerName && ownerUid) {
    try { ownerName = await _lcResolveStaffName(db, ownerUid); } catch (_) {}
  }

  // 6. Build + write the interaction.
  const clientName = signupData.name
    || [signupData.firstName, signupData.lastName].filter(Boolean).join(" ").trim()
    || "Unknown";
  const eventTitle = ev.title || "Event";
  const guidance = "A participant requested special accommodations for this event. "
    + "Review the note below and arrange what's needed before the session. "
    + "Contact the family if you need clarification.";
  const routedSuffix = autoRouted
    ? "\n\n(No presenter or event creator was assigned, so this was routed to La'a.)"
    : "";

  const interaction = {
    channel: "Event Prep",
    interactionType: "Special Accommodations",
    contactId: signupData.linkedContactId || null,
    contactName: clientName + " — " + eventTitle + (earliestDate ? " (" + earliestDate + ")" : ""),
    contactType: reg.role || signupData.role || "",
    grantProgram: "",
    summary: "Special accommodations requested by " + clientName + " — review before the event.",
    followUpDate: earliestDate,
    status: "Open",
    notes: guidance + "\n\nFrom " + clientName + ': "' + note + '"' + routedSuffix,
    isDraft: false,
    owner: ownerName,
    ownerUid: ownerUid,
    relatedSignupId: signupId,
    workflowEventId: eventId,
    workflowEventCollection: collectionName,
    workflowStep: "accommodationsNote",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    const ref = await db.collection("interactions").add(interaction);
    console.log(`accommodations: interaction ${ref.id} created for signup ${signupId} -> ${ownerName || ownerUid}`);
  } catch (e) {
    console.error(`accommodations: interaction write failed: ${e.message}`);
    return;
  }

  // Audit log so the daily-report changelog picks it up automatically.
  try {
    await db.collection("auditLog").add({
      action: "Created special-accommodations task",
      details: clientName + " — " + eventTitle + (earliestDate ? " (" + earliestDate + ")" : "")
        + " -> " + (ownerName || ownerUid),
      performedBy: "System (auto)",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) { console.warn(`accommodations: auditLog write failed: ${e.message}`); }
}

// ── Deferred Registration-Completion Email ─────────────────────────
// Runs every minute. For any signup still status:"pending" 10+ minutes
// after creation that hasn't been emailed yet, send the "Complete Your
// Registration" email. This replaces the immediate on-create send,
// which fired before inline-completers had a chance to finish their
// registration form on the same page.
const REGISTRATION_GRACE_MIN = 10;

exports.sendDeferredRegistrationEmails = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1, secrets: ["RESEND_API_KEY", "SMTP_FROM"] })
  .pubsub.schedule("every 1 minutes")
  .onRun(async () => {
    const db = admin.firestore();
    const cutoffMs = Date.now() - REGISTRATION_GRACE_MIN * 60 * 1000;
    let scanned = 0, sent = 0, skipped = 0, failed = 0;

    for (const collection of ["events", "recurringEvents"]) {
      const evs = await db.collection(collection).get();
      for (const ev of evs.docs) {
        const eventId = ev.id;
        const event = ev.data() || {};
        const sigs = await db.collection(collection).doc(eventId).collection("signups")
          .where("status", "==", "pending")
          .get();

        for (const s of sigs.docs) {
          scanned++;
          const data = s.data() || {};

          if (data.archived === true) { skipped++; continue; }
          if (!data.email) { skipped++; continue; }
          if (data.registrationEmailSentAt) { skipped++; continue; }

          // Grace period: skip if too fresh.
          const tsMs = (data.timestamp && data.timestamp.toMillis)
            ? data.timestamp.toMillis()
            : (data.timestamp && data.timestamp.seconds ? data.timestamp.seconds * 1000 : 0);
          if (!tsMs) { skipped++; continue; }
          if (tsMs > cutoffMs) { skipped++; continue; }

          // Build + send. Same body as before.
          const signupName = data.name || data.firstName || "there";
          let eventTitle = event.title || "an LDAH Event";
          let eventDate = "";
          try {
            const picked = Array.isArray(data.selectedDates) && data.selectedDates[0];
            eventDate = picked || formatEventDate(event.eventDate || event.date);
          } catch (_) {}
          const type = collection === "recurringEvents" ? "recurring" : "event";

          try {
            const orgFooterHtml = await getOrgFooterHtml();
            const htmlBody = buildRegistrationEmailHtml({
              name: signupName, eventTitle, eventDate,
              signupId: s.id, eventId, type, orgFooterHtml,
            });
            const fromAddress = process.env.SMTP_FROM || "onboarding@resend.dev";
            await sendEmailViaResend({
              from: `LDAH <${fromAddress}>`,
              to: data.email,
              subject: `Complete Your Registration -- ${eventTitle}`,
              html: htmlBody,
              type: "registration",
              relatedEventId: eventId,
              relatedSignupId: s.id,
              recipientName: signupName,
            });
            await s.ref.update({
              registrationEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            sent++;
            console.log(`Deferred registration email sent to ${data.email} for ${collection}/${eventId}/${s.id}`);
          } catch (err) {
            failed++;
            await s.ref.update({ registrationEmailError: err.message }).catch(() => {});
            console.error(`Deferred registration email failed for ${collection}/${eventId}/${s.id}:`, err.message);
          }
        }
      }
    }
    console.log(`sendDeferredRegistrationEmails: scanned=${scanned} sent=${sent} skipped=${skipped} failed=${failed}`);
    return null;
  });

// Find the most recent COMPLETED registration for a person (by linkedContactId,
// the canonical contact linkage — already has a collection-group index)
// completed within [sinceMs, now]. Excludes excludePath.
// Returns { id, path, registration, compMs } or null.
async function _findPriorCompletedRegistration(db, linkedContactId, excludePath, sinceMs) {
  if (!linkedContactId) return null;
  let snap;
  try {
    snap = await db.collectionGroup("signups").where("linkedContactId", "==", linkedContactId).get();
  } catch (e) { console.warn("_findPriorCompletedRegistration query:", e.message); return null; }
  let best = null;
  snap.forEach((d) => {
    if (d.ref.path === excludePath) return;
    const r = d.data() || {};
    if (r.archived === true) return;
    if (!(r.registration && typeof r.registration === "object")) return;
    const compMs = r.registrationCompletedAt && r.registrationCompletedAt.toMillis ? r.registrationCompletedAt.toMillis() : 0;
    if (!compMs || compMs < sinceMs) return; // unknown date or older than the window
    if (!best || compMs > best.compMs) best = { id: d.id, path: d.ref.path, registration: r.registration, compMs };
  });
  return best;
}

// ----------------------------------------------------------------------------
// processPendingParentRegistrations — daily 5 AM HST.
// For PENDING parent/guardian signups on one-time events (not Connect-Gen) with
// an upcoming session:
//   1. Auto-apply a prior completed registration (same email, last ~12 months)
//      -> marks them confirmed (the onUpdate confirmation email then fires).
//   2. Else remind every other day (reuse the registration email).
//   3. At <=4 days before the earliest upcoming session, create ONE call-task
//      for La'akea and STOP the emails (he takes over by phone).
// ----------------------------------------------------------------------------
exports.processPendingParentRegistrations = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1, secrets: ["RESEND_API_KEY", "SMTP_FROM"] })
  .pubsub.schedule("0 5 * * *").timeZone("Pacific/Honolulu")
  .onRun(async () => {
    const db = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;
    const nowMs = Date.now();
    const nowHst = new Date(new Date().toLocaleString("en-US", { timeZone: "Pacific/Honolulu" }));
    const todayKey = nowHst.getFullYear() + "-" + String(nowHst.getMonth() + 1).padStart(2, "0") + "-" + String(nowHst.getDate()).padStart(2, "0");
    const todayMs = new Date(todayKey + "T12:00:00-10:00").getTime();
    const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
    const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;
    const laaName = await _lcResolveStaffName(db, LIFECYCLE_LAA_UID);
    let applied = 0, emailed = 0, tasked = 0;

    const evs = await db.collection("events").get();           // one-time events only
    for (const ev of evs.docs) {
      const event = ev.data() || {};
      if (event.archived === true) continue;
      const eventId = ev.id;
      const sigs = await db.collection("events").doc(eventId).collection("signups").where("status", "==", "pending").get();
      for (const s of sigs.docs) {
        const data = s.data() || {};
        if (data.archived === true) continue;
        if (data.registration && typeof data.registration === "object") continue; // already registered
        const role = data.registrantType || data.role || (data.registration && data.registration.role) || "";
        if (role !== "Parent/Guardian") continue;
        const email = String(data.email || "").trim();
        if (!email) continue;                                  // needs an email to remind / match

        const sessions = getSignupSessions(data, event) || [];
        const upcoming = sessions.map((x) => x && x.dateKey).filter((dk) => dk && dk >= todayKey).sort();
        if (upcoming.length === 0) continue;                   // no upcoming session
        const earliest = upcoming[0];
        const daysUntil = Math.round((new Date(earliest + "T12:00:00-10:00").getTime() - todayMs) / (24 * 60 * 60 * 1000));

        // 1) Auto-apply a recent prior completed registration (by linkedContactId).
        const prior = data.linkedContactId
          ? await _findPriorCompletedRegistration(db, data.linkedContactId, s.ref.path, nowMs - TWELVE_MONTHS_MS)
          : null;
        if (prior) {
          await s.ref.update({
            registration: prior.registration,
            status: "confirmed",
            registrationCompletedAt: FieldValue.serverTimestamp(),
            registrationCompletedVia: "prior-auto",
            registrationAppliedFromSignupId: prior.id,
            updatedAt: FieldValue.serverTimestamp(),
          });
          applied++;
          console.log("processPendingParentRegistrations: applied prior reg to", s.ref.path, "from", prior.path);
          continue; // confirmation email fires via maybeSendRegistrationConfirmation onUpdate
        }

        // 2) Within 4 days of the earliest session -> La'akea call-task, stop emails.
        if (daysUntil <= 4) {
          const exist = await db.collection("interactions").where("workflowSignupPath", "==", s.ref.path).limit(5).get();
          const hasTask = exist.docs.some((d) => (d.data() || {}).workflowStep === "registrationAssist");
          if (!hasTask) {
            await db.collection("interactions").add({
              channel: "Registration",
              interactionType: "Registration Assist",
              contactId: data.linkedContactId || "",
              contactName: data.name || email,
              contactType: "",
              grantProgram: "",
              summary: "Call " + (data.name || email) + " to help finish registration",
              followUpDate: todayKey,
              status: "Open",
              notes: "Call " + (data.name || email) + (data.phone ? " at " + data.phone : "")
                + " — registration still pending for " + (event.title || "event") + " (" + upcoming.join(", ") + "). Offer to help them complete it.",
              isDraft: false,
              owner: laaName,
              ownerUid: LIFECYCLE_LAA_UID,
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
              workflowStep: "registrationAssist",
              workflowEventId: eventId,
              workflowEventCollection: "events",
              workflowSignupPath: s.ref.path,
              workflowContactId: data.linkedContactId || "",
            });
            tasked++;
            console.log("processPendingParentRegistrations: call-task for", s.ref.path);
          }
          continue; // task handles it from here — no more emails
        }

        // 3) Every-other-day reminder (until the 4-day handoff above).
        const lastMs = (data.pendingRegReminderLastAt && data.pendingRegReminderLastAt.toMillis ? data.pendingRegReminderLastAt.toMillis() : 0)
          || (data.registrationEmailSentAt && data.registrationEmailSentAt.toMillis ? data.registrationEmailSentAt.toMillis() : 0);
        if (lastMs && (nowMs - lastMs) < TWO_DAYS) continue;   // not yet 2 days
        try {
          const orgFooterHtml = await getOrgFooterHtml();
          const eventDate = (Array.isArray(data.selectedDates) && data.selectedDates[0]) || "";
          const htmlBody = buildRegistrationEmailHtml({ name: data.name || "there", eventTitle: event.title || "an LDAH Event", eventDate, signupId: s.id, eventId, type: "event", orgFooterHtml });
          const fromAddress = process.env.SMTP_FROM || "onboarding@resend.dev";
          await sendEmailViaResend({
            from: `LDAH <${fromAddress}>`, to: email,
            subject: `Reminder: Complete Your Registration -- ${event.title || "LDAH Event"}`,
            html: htmlBody, type: "registration-reminder", relatedEventId: eventId, relatedSignupId: s.id, recipientName: data.name || "",
          });
          await s.ref.update({ pendingRegReminderLastAt: FieldValue.serverTimestamp(), pendingRegReminderCount: FieldValue.increment(1) });
          emailed++;
        } catch (err) {
          console.error("processPendingParentRegistrations reminder failed for", s.ref.path, err.message);
        }
      }
    }
    console.log("processPendingParentRegistrations:", todayKey, "applied", applied, "emailed", emailed, "tasked", tasked);
    return null;
  });

// ── Resend Registration Email (callable from LDAH-Int admin) ─────
exports.resendRegistrationEmail = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 5, secrets: ["RESEND_API_KEY", "SMTP_FROM"] })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Max-Age", "3600");

    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const { collection, eventId, signupId } = req.body;
    if (!collection || !eventId || !signupId) {
      res.status(400).json({ error: "Missing collection, eventId, or signupId" });
      return;
    }

    try {
      const signupDoc = await admin.firestore()
        .collection(collection).doc(eventId).collection("signups").doc(signupId).get();
      if (!signupDoc.exists) { res.status(404).json({ error: "Signup not found" }); return; }

      const signupData = signupDoc.data();
      if (!signupData.email) { res.status(400).json({ error: "Signup has no email address" }); return; }
      if (signupData.status === "confirmed") { res.status(400).json({ error: "Already confirmed" }); return; }

      // Fetch event title
      let eventTitle = "an LDAH Event";
      let eventDate = "";
      try {
        const eventDoc = await admin.firestore().collection(collection).doc(eventId).get();
        if (eventDoc.exists) {
          const eventData = eventDoc.data();
          eventTitle = eventData.title || eventTitle;
          const picked = Array.isArray(signupData.selectedDates) && signupData.selectedDates[0];
          eventDate = picked || formatEventDate(eventData.eventDate || eventData.date);
        }
      } catch (_) { /* use defaults */ }

      const type = collection === "recurringEvents" ? "recurring" : "event";
      const signupName = signupData.name || signupData.firstName || "there";

      const orgFooterHtml = await getOrgFooterHtml();
      const htmlBody = buildRegistrationEmailHtml({
        name: signupName, eventTitle, eventDate, signupId, eventId, type, orgFooterHtml,
      });

      const fromAddress = process.env.SMTP_FROM || "onboarding@resend.dev";
      await sendEmailViaResend({
        from: `LDAH <${fromAddress}>`,
        to: signupData.email,
        subject: `Complete Your Registration -- ${eventTitle}`,
        html: htmlBody,
        type: "registration-resend",
        relatedEventId: eventId,
        relatedSignupId: signupId,
        recipientName: signupName,
      });

      await signupDoc.ref.update({
        registrationEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        registrationEmailError: admin.firestore.FieldValue.delete(),
      });

      console.log(`Resent registration email to ${signupData.email} for ${signupId}`);
      res.status(200).json({ success: true, email: signupData.email });
    } catch (err) {
      console.error("resendRegistrationEmail error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

const EMAIL_SECRETS = ["RESEND_API_KEY", "SMTP_FROM"];

// ── Check for a duplicate signup (same email + same event + overlapping date) ──
// Public, read-only. Used by the W2 + App signup forms to WARN (not block)
// before creating a possible duplicate. Mirrors the Part 1 definition: same
// email (case-insensitive) + same event + an overlapping ACTIVE date
// (archived / displaced / cancelled excluded). Reads the event's signups via
// admin SDK (public clients can't list signups). Returns the overlapping dates.
exports.checkDuplicateEventSignups = functions
  .runWith({ timeoutSeconds: 20, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "3600");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    try {
      const body = req.body || {};
      const collection = body.collection === "recurringEvents" ? "recurringEvents" : "events";
      const eventId = String(body.eventId || "");
      const email = String(body.email || "").trim().toLowerCase();
      const dates = Array.isArray(body.dates) ? body.dates.map(String) : [];
      if (!eventId || !email || dates.length === 0) {
        res.status(200).json({ overlappingDates: [] });
        return;
      }

      const snap = await admin.firestore()
        .collection(collection).doc(eventId).collection("signups").get();

      const want = {};
      dates.forEach((d) => { want[d] = true; });
      const overlapping = {};
      snap.forEach((doc) => {
        const s = doc.data() || {};
        if (String(s.email || "").trim().toLowerCase() !== email) return;
        if (s.status === "cancelled" || s.archived === true || s.displaced === true) return;
        const sd = Array.isArray(s.selectedDates) ? s.selectedDates
                 : (s.signupDates != null ? [].concat(s.signupDates) : []);
        const ov = (s.dateStatusOverrides && typeof s.dateStatusOverrides === "object") ? s.dateStatusOverrides : {};
        const cancelledKeys = Object.keys(ov).filter((k) => ov[k] === "cancelled");
        sd.forEach((d) => {
          const ds = String(d);
          const isCancelled = cancelledKeys.some((k) => k === ds || k.indexOf(ds) !== -1 || ds.indexOf(k) !== -1);
          if (!isCancelled && want[ds]) overlapping[ds] = true;
        });
      });
      res.status(200).json({ overlappingDates: Object.keys(overlapping) });
    } catch (err) {
      console.error("checkDuplicateEventSignups error:", err);
      // Fail open — never block a signup because the check broke.
      res.status(200).json({ overlappingDates: [], error: err.message });
    }
  });

// ── Find sibling pending signups for same email ─────────────────
// Used by W2/App registration forms: after a user completes registration,
// this returns their other pending signups so they can apply the same
// registration to them. Access: unauthenticated POST, but proof of
// ownership is required (valid source signupId that matches email).
exports.findSiblingPendingSignups = functions
  .runWith({ timeoutSeconds: 20, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "3600");

    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const { collection, eventId, signupId } = req.body || {};
    if (!collection || !eventId || !signupId) {
      res.status(400).json({ error: "Missing collection, eventId, or signupId" });
      return;
    }
    if (collection !== "events" && collection !== "recurringEvents") {
      res.status(400).json({ error: "Invalid collection" });
      return;
    }

    try {
      const db = admin.firestore();
      const sourceDoc = await db.collection(collection).doc(eventId).collection("signups").doc(signupId).get();
      if (!sourceDoc.exists) { res.status(404).json({ error: "Source signup not found" }); return; }
      const sourceData = sourceDoc.data();
      const email = (sourceData.email || "").trim().toLowerCase();
      if (!email) { res.status(400).json({ error: "Source signup has no email" }); return; }

      // Find all other pending signups with the same email (case-insensitive) across both collections.
      const siblings = [];
      const snap = await db.collectionGroup("signups").where("email", "==", sourceData.email).get();
      // Also check lowercased, in case emails were stored with different casing
      const seen = new Set();
      snap.forEach((d) => seen.add(d.ref.path));
      if (sourceData.email !== email) {
        const snap2 = await db.collectionGroup("signups").where("email", "==", email).get();
        snap2.forEach((d) => { if (!seen.has(d.ref.path)) { seen.add(d.ref.path); snap.docs.push(d); } });
      }

      const parentCache = {};
      for (const d of snap.docs) {
        const data = d.data();
        if (!data) continue;
        if (data.archived === true) continue;
        if (data.status !== "pending" && data.status !== "new") continue;
        if (data.registration && typeof data.registration === "object") continue;
        // Parse collection + eventId from path
        const parts = d.ref.path.split("/");
        if (parts.length !== 4) continue;
        const coll = parts[0];
        const eid = parts[1];
        const sid = parts[3];
        if (coll === collection && eid === eventId && sid === signupId) continue; // skip source
        // Fetch event title (cached)
        const cacheKey = coll + "/" + eid;
        let evTitle = parentCache[cacheKey];
        if (evTitle === undefined) {
          try {
            const evDoc = await db.collection(coll).doc(eid).get();
            evTitle = evDoc.exists ? (evDoc.data().title || "Untitled Event") : "Untitled Event";
          } catch (_) { evTitle = "Untitled Event"; }
          parentCache[cacheKey] = evTitle;
        }
        const sessionDate = Array.isArray(data.selectedDates) && data.selectedDates[0] ? data.selectedDates[0] : (data.sessionDate || "");
        siblings.push({
          collection: coll,
          eventId: eid,
          signupId: sid,
          eventTitle: evTitle,
          sessionDate: sessionDate,
          status: data.status,
        });
      }

      res.status(200).json({ siblings });
    } catch (err) {
      console.error("findSiblingPendingSignups error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

exports.onEventSignupCreated = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10, secrets: EMAIL_SECRETS })
  .firestore.document("events/{eventId}/signups/{signupId}")
  .onCreate(async (snap, context) => {
    return handleSignupCreated(snap, context, "events");
  });

exports.onRecurringEventSignupCreated = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10, secrets: EMAIL_SECRETS })
  .firestore.document("recurringEvents/{eventId}/signups/{signupId}")
  .onCreate(async (snap, context) => {
    return handleSignupCreated(snap, context, "recurringEvents");
  });

// ── Auto-Create Follow-Up Interaction from Feedback Survey ──────────
// When an attendee submits feedback with requiresFollowUp === 'Yes',
// drop an Open interaction so the home-page Recent Interactions panel
// AND the contact card timeline both surface it for staff follow-up.
exports.onEventFeedbackCreated = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10, secrets: EMAIL_SECRETS })
  .firestore.document("eventFeedback/{feedbackId}")
  .onCreate(async (snap, context) => {
    try {
      const data = snap.data() || {};
      if (data.requiresFollowUp !== "Yes") return null;

      const db = admin.firestore();
      const collection = data.eventCollection || "events";
      const eventId = data.eventId;
      const signupId = data.signupId;
      if (!eventId) return null;

      let contactId = data.linkedContactId || "";
      let contactName = "";
      let contactType = "";
      let eventTitle = "Unknown event";

      if (signupId) {
        try {
          const signupSnap = await db.collection(collection).doc(eventId)
            .collection("signups").doc(signupId).get();
          if (signupSnap.exists) {
            const su = signupSnap.data() || {};
            if (!contactId) contactId = su.linkedContactId || "";
            contactName = su.name || su.firstName || "";
          }
        } catch (_) {}
      }

      if (contactId) {
        try {
          const contactSnap = await db.collection("contacts").doc(contactId).get();
          if (contactSnap.exists) {
            const c = contactSnap.data() || {};
            contactName = c.displayName || contactName;
            contactType = c.type || "";
          }
        } catch (_) {}
      }

      let evData = {};
      try {
        const evSnap = await db.collection(collection).doc(eventId).get();
        if (evSnap.exists) {
          evData = evSnap.data() || {};
          eventTitle = evData.title || eventTitle;
        }
      } catch (_) {}

      const sessionLabel = data.sessionDate ? " (" + data.sessionDate + ")" : "";
      const summary = "Follow-up support requested after " + eventTitle + sessionLabel;
      const notes = (data.followUpDescription && String(data.followUpDescription).trim())
        || "(no detail provided in survey)";

      // +2 calendar days from today (HST) — gives staff a brief SLA window
      // before the interaction shows as overdue in the Follow-Ups KPI.
      const followUpDate = addDaysHst(toHstDateKey(new Date()), 2);

      // Resolve owner: prefer the session's presenter (multi-session map first,
      // single-session summary second), otherwise default to La'a as resource
      // coordinator. Interaction lands directly in the owner's LDAH-Int queue.
      // Event Summary form save may overwrite summary without preserving
      // presenterUid, so we also accept the presenter NAME and look up the uid.
      const sessionDateRaw = (data.sessionDate || "").trim();
      let ownerUid = "";
      let presenterNameFromEvent = "";
      if (sessionDateRaw
          && evData.sessionSummaries
          && evData.sessionSummaries[sessionDateRaw]) {
        const sEntry = evData.sessionSummaries[sessionDateRaw] || {};
        ownerUid = sEntry.presenterUid || "";
        presenterNameFromEvent = sEntry.presenter || "";
      }
      if (!ownerUid && evData.summary) {
        ownerUid = evData.summary.presenterUid || "";
        if (!presenterNameFromEvent) presenterNameFromEvent = evData.summary.presenter || "";
      }
      if (!ownerUid && presenterNameFromEvent) {
        try {
          const urSnap = await db.collection("userRoles")
            .where("displayName", "==", presenterNameFromEvent)
            .limit(1).get();
          if (!urSnap.empty) ownerUid = urSnap.docs[0].id;
        } catch (_) {}
      }
      if (!ownerUid) ownerUid = LIFECYCLE_LAA_UID;
      let ownerName = await _lcResolveStaffName(db, ownerUid);
      if (!ownerName) {
        ownerName = presenterNameFromEvent
          || (ownerUid === LIFECYCLE_LAA_UID ? "La'a Salvani" : "");
      }

      await db.collection("interactions").add({
        channel: "Event Feedback",
        interactionType: "Follow-up",
        contactId: contactId,
        contactName: contactName || "Unknown",
        contactType: contactType,
        grantProgram: "",
        summary: summary,
        followUpDate: followUpDate,
        status: "Open",
        notes: notes,
        isDraft: false,
        owner: ownerName,
        ownerUid: ownerUid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Audit log so the daily-report changelog picks it up the next morning.
      try {
        await db.collection("auditLog").add({
          action: "Follow-up support requested",
          details: (contactName || "Unknown") + " -- " + eventTitle + sessionLabel,
          performedBy: "System (auto)",
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) { console.warn("auditLog write failed:", e.message); }

      console.log(
        `onEventFeedbackCreated: auto-interaction created for ${contactName || "unknown"} ` +
        `(contact ${contactId || "--"}) from feedback ${snap.id}`,
      );
    } catch (err) {
      console.error("onEventFeedbackCreated error:", err.message);
    }
    return null;
  });

// ── Auto-Create Interaction from Provider Listing Request ──────────
// When the public Provider Request form (readiness.html) writes a new
// `providers/{id}` doc with status:"new", drop an Open interaction on
// Chassidy Kruse's queue with a +3 day follow-up. Interaction lands
// directly in LDAH-Int; no triage email — per-user alerts handle the ping.
exports.onProviderRequestCreated = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10 })
  .firestore.document("providers/{providerId}")
  .onCreate(async (snap, context) => {
    try {
      const data = snap.data() || {};
      if (data.status !== "new") return null;

      const db = admin.firestore();
      const providerId = context.params.providerId;

      // Idempotency: skip if an interaction already references this provider.
      const existing = await db.collection("interactions")
        .where("providerRequestId", "==", providerId)
        .limit(1).get();
      if (!existing.empty) {
        console.log(`onProviderRequestCreated: interaction already exists for ${providerId}, skipping`);
        return null;
      }

      // Owner resolution: Chassidy Kruse (provider intake). Falls back to
      // La'a if his userRoles doc is missing or marked inactive.
      const PROVIDER_INTAKE_UID = "B9iq7O46KJabCE3Skke4HXy8RV43";
      let ownerUid = PROVIDER_INTAKE_UID;
      try {
        const urDoc = await db.collection("userRoles").doc(ownerUid).get();
        if (!urDoc.exists || urDoc.data().active === false) {
          ownerUid = LIFECYCLE_LAA_UID;
        }
      } catch (_) {
        ownerUid = LIFECYCLE_LAA_UID;
      }
      let ownerName = await _lcResolveStaffName(db, ownerUid);
      if (!ownerName) {
        ownerName = ownerUid === LIFECYCLE_LAA_UID ? "La'a Salvani" : "Chassidy Kruse";
      }

      const orgName = (data.organizationName || "").trim() || "Unknown organization";
      const contactName = ((data.firstName || "") + " " + (data.lastName || "")).trim();
      const followUpDate = addDaysHst(toHstDateKey(new Date()), 3);
      const notesParts = [];
      if (contactName) notesParts.push(contactName);
      if (data.email)  notesParts.push(data.email);
      if (data.phone)  notesParts.push(data.phone);
      const notes = notesParts.join(" -- ") + (data.message ? "\n\n" + data.message : "");

      await db.collection("interactions").add({
        channel: "Provider Onboarding",
        interactionType: "Provider Request",
        contactId: "",
        contactName: orgName,
        contactType: "",
        grantProgram: "",
        summary: "New provider listing request from " + orgName,
        followUpDate: followUpDate,
        status: "Open",
        notes: notes,
        isDraft: false,
        owner: ownerName,
        ownerUid: ownerUid,
        providerRequestId: providerId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      try {
        await db.collection("auditLog").add({
          action: "Provider request received",
          details: orgName + (contactName ? " -- " + contactName : ""),
          performedBy: "System (auto)",
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) { console.warn("auditLog write failed:", e.message); }

      console.log(
        `onProviderRequestCreated: interaction created for ${orgName} ` +
        `(provider ${providerId}, owner ${ownerName})`,
      );
    } catch (err) {
      console.error("onProviderRequestCreated error:", err.message);
    }
    return null;
  });

// ── Auto-Create Interaction from Calendar Request ──────────────────
// When the public "Request an Event" form (events.html) writes a new
// `eventRequests/{id}` doc with status:"pending", drop an Open interaction
// on La'a's queue with a +3 day follow-up. Same shape as the Provider
// Request workflow.
exports.onCalendarRequestCreated = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10 })
  .firestore.document("eventRequests/{requestId}")
  .onCreate(async (snap, context) => {
    try {
      const data = snap.data() || {};
      if (data.status !== "pending") return null;

      const db = admin.firestore();
      const requestId = context.params.requestId;

      // Idempotency: skip if an interaction already references this request.
      const existing = await db.collection("interactions")
        .where("calendarRequestId", "==", requestId)
        .limit(1).get();
      if (!existing.empty) {
        console.log(`onCalendarRequestCreated: interaction already exists for ${requestId}, skipping`);
        return null;
      }

      // Owner: La'a Salvani. He's superAdmin so userRoles should always exist,
      // but defensive resolve for display name.
      const ownerUid = LIFECYCLE_LAA_UID;
      let ownerName = await _lcResolveStaffName(db, ownerUid);
      if (!ownerName) ownerName = "La'a Salvani";

      const requesterName = (data.name || "").trim() || "Unknown requester";
      const preferredDate = (data.preferredDate || "").trim();
      const preferredTime = (data.preferredTime || "").trim();
      const followUpDate = addDaysHst(toHstDateKey(new Date()), 3);
      const notesParts = [];
      if (data.email) notesParts.push(data.email);
      if (data.phone) notesParts.push(data.phone);
      if (preferredDate || preferredTime) {
        notesParts.push("Preferred: " + [preferredDate, preferredTime].filter(Boolean).join(" @ "));
      }
      if (data.sponsor) notesParts.push("Sponsor: " + data.sponsor);
      const notesHead = notesParts.join(" -- ");
      const notes = notesHead + (data.eventInfo ? "\n\n" + data.eventInfo : "");

      const summary = "New calendar request from " + requesterName
        + (preferredDate ? " for " + preferredDate : "");

      await db.collection("interactions").add({
        channel: "Calendar Onboarding",
        interactionType: "Calendar Request",
        contactId: "",
        contactName: requesterName,
        contactType: "",
        grantProgram: "",
        summary: summary,
        followUpDate: followUpDate,
        status: "Open",
        notes: notes,
        isDraft: false,
        owner: ownerName,
        ownerUid: ownerUid,
        calendarRequestId: requestId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      try {
        await db.collection("auditLog").add({
          action: "Calendar request received",
          details: requesterName + (preferredDate ? " (" + preferredDate + ")" : ""),
          performedBy: "System (auto)",
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) { console.warn("auditLog write failed:", e.message); }

      console.log(
        `onCalendarRequestCreated: interaction created for ${requesterName} ` +
        `(request ${requestId}, owner ${ownerName})`,
      );
    } catch (err) {
      console.error("onCalendarRequestCreated error:", err.message);
    }
    return null;
  });

// ── Auto-Create Interaction from Partner Resource Application ────
// When submitResourceApplication writes a new resourceApplications/{id}
// doc with status:"new", drop an Open interaction on La'a's queue with
// a +3 day follow-up. Closure happens automatically via
// onResourceApplicationUpdated when the CMS approve/decline buttons run.
exports.onResourceApplicationCreated = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10 })
  .firestore.document("resourceApplications/{appId}")
  .onCreate(async (snap, context) => {
    try {
      const data = snap.data() || {};
      if (data.status !== "new") return null;

      const db = admin.firestore();
      const appId = context.params.appId;

      // Idempotency: skip if an interaction already references this application.
      const existing = await db.collection("interactions")
        .where("partnerApplicationId", "==", appId)
        .limit(1).get();
      if (!existing.empty) {
        console.log(`onResourceApplicationCreated: interaction already exists for ${appId}, skipping`);
        return null;
      }

      // Owner: La'a Salvani (resource partner intake).
      const ownerUid = LIFECYCLE_LAA_UID;
      let ownerName = await _lcResolveStaffName(db, ownerUid);
      if (!ownerName) ownerName = "La'a Salvani";

      const orgName = (data.name || "").trim() || "Unknown organization";
      const contactName = (data.contactName || "").trim();
      const followUpDate = addDaysHst(toHstDateKey(new Date()), 3);

      const headerParts = [];
      if (contactName) headerParts.push(contactName);
      if (data.email)  headerParts.push(data.email);
      if (data.phone)  headerParts.push(data.phone);
      const locationLine = [data.city, data.island].filter(function (x) { return x; }).join(", ");
      const noteLines = [];
      if (headerParts.length) noteLines.push(headerParts.join(" -- "));
      if (locationLine)  noteLines.push("Location: " + locationLine);
      const _typeLabel = (Array.isArray(data.types) && data.types.length) ? data.types.join(", ") : (data.type || "");
      if (_typeLabel)    noteLines.push("Type: " + _typeLabel);
      if (data.services) noteLines.push("Services: " + data.services);
      if (data.website)  noteLines.push("Website: " + data.website);
      if (data.notes)    noteLines.push("\nApplicant notes:\n" + data.notes);
      const notes = noteLines.join("\n");

      await db.collection("interactions").add({
        channel: "Partner Onboarding",
        interactionType: "Partner Application",
        contactId: "",
        contactName: orgName,
        contactType: "",
        grantProgram: "",
        summary: "New partner resource application from " + orgName,
        followUpDate: followUpDate,
        status: "Open",
        notes: notes,
        isDraft: false,
        owner: ownerName,
        ownerUid: ownerUid,
        partnerApplicationId: appId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      try {
        await db.collection("auditLog").add({
          action: "Partner application received",
          details: orgName + (contactName ? " -- " + contactName : ""),
          performedBy: "System (auto)",
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) { console.warn("auditLog write failed:", e.message); }

      console.log(
        `onResourceApplicationCreated: interaction created for ${orgName} ` +
        `(app ${appId}, owner ${ownerName})`,
      );
    } catch (err) {
      console.error("onResourceApplicationCreated error:", err.message);
    }
    return null;
  });

// ── Close Partner Application Interaction on Approve / Decline ────
// When the LDAH-Int CMS approves or declines an application, the doc
// status flips new -> approved | declined. Find the matching open
// interaction by partnerApplicationId, append a closing note recording
// who acted and when, then set status:"Closed".
exports.onResourceApplicationUpdated = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10 })
  .firestore.document("resourceApplications/{appId}")
  .onUpdate(async (change, context) => {
    try {
      const before = change.before.data() || {};
      const after  = change.after.data()  || {};
      if (before.status === after.status) return null;
      if (before.status !== "new") return null;
      if (after.status !== "approved" && after.status !== "declined") return null;

      const db = admin.firestore();
      const appId = context.params.appId;

      const ints = await db.collection("interactions")
        .where("partnerApplicationId", "==", appId)
        .limit(5).get();
      if (ints.empty) {
        console.log(`onResourceApplicationUpdated: no interaction found for ${appId}, skipping`);
        return null;
      }

      // Resolve actor: approvedBy / declinedBy is stamped by the CMS as an
      // email. Look up the userRoles displayName so the note reads cleanly.
      const actorEmail = (after.status === "approved")
        ? (after.approvedBy || "")
        : (after.declinedBy || "");
      let actorName = "";
      if (actorEmail) {
        try {
          const urSnap = await db.collection("userRoles")
            .where("email", "==", actorEmail)
            .limit(1).get();
          if (!urSnap.empty) actorName = urSnap.docs[0].data().displayName || "";
        } catch (_) {}
      }
      if (!actorName) actorName = actorEmail || "an admin";

      const hstStamp = new Date().toLocaleString("en-US", {
        timeZone: "Pacific/Honolulu",
        dateStyle: "medium",
        timeStyle: "short",
      });
      const verb = after.status === "approved" ? "Approved" : "Declined";
      let closingNote = "\n\n— " + verb + " by " + actorName + " on " + hstStamp + " HST.";
      if (after.status === "approved" && after.linkedResourceId) {
        closingNote += " New resource: " + after.linkedResourceId + ".";
      }

      let closed = 0;
      for (const d of ints.docs) {
        if (d.data().status === "Closed") continue;
        const existingNotes = d.data().notes || "";
        await d.ref.update({
          notes: existingNotes + closingNote,
          status: "Closed",
          closedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        closed++;
      }
      console.log(
        `onResourceApplicationUpdated: closed ${closed} interaction(s) for ${appId} ` +
        `(${verb.toLowerCase()} by ${actorName})`,
      );
    } catch (err) {
      console.error("onResourceApplicationUpdated error:", err.message);
    }
    return null;
  });

// ── Auto-Create Interaction from Volunteer Application ─────────────
// When the public Volunteer form (volunteer.html) writes a new
// volunteers/{id} doc with status:"new", drop an Open interaction on
// Chassidy Kruse's queue with a +3 day follow-up. Closure happens
// automatically via onVolunteerApplicationUpdated when an admin moves
// the application to "accepted" or "declined" in the CMS.
exports.onVolunteerApplicationCreated = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10 })
  .firestore.document("volunteers/{appId}")
  .onCreate(async (snap, context) => {
    try {
      const data = snap.data() || {};
      if (data.status !== "new") return null;

      const db = admin.firestore();
      const appId = context.params.appId;

      const existing = await db.collection("interactions")
        .where("volunteerApplicationId", "==", appId)
        .limit(1).get();
      if (!existing.empty) {
        console.log(`onVolunteerApplicationCreated: interaction already exists for ${appId}, skipping`);
        return null;
      }

      // Owner: Chassidy Kruse (volunteer intake). Fallback to La'a if
      // Chassidy's userRoles doc is missing or marked inactive.
      const VOLUNTEER_INTAKE_UID = "B9iq7O46KJabCE3Skke4HXy8RV43";
      let ownerUid = VOLUNTEER_INTAKE_UID;
      try {
        const urDoc = await db.collection("userRoles").doc(ownerUid).get();
        if (!urDoc.exists || urDoc.data().active === false) {
          ownerUid = LIFECYCLE_LAA_UID;
        }
      } catch (_) {
        ownerUid = LIFECYCLE_LAA_UID;
      }
      let ownerName = await _lcResolveStaffName(db, ownerUid);
      if (!ownerName) {
        ownerName = ownerUid === LIFECYCLE_LAA_UID ? "La'a Salvani" : "Chassidy Kruse";
      }

      const applicantName = [data.firstName, data.lastName]
        .filter(function (x) { return x; }).join(" ").trim() || "Unknown applicant";
      const followUpDate = addDaysHst(toHstDateKey(new Date()), 3);

      const noteLines = [];
      if (data.email) noteLines.push(data.email);
      if (data.opportunityId) noteLines.push("Opportunity: " + data.opportunityId);
      if (data.subject) noteLines.push("\nApplicant message:\n" + data.subject);
      if (data.notes) noteLines.push("\nAdditional notes:\n" + data.notes);
      const notes = noteLines.join("\n");

      await db.collection("interactions").add({
        channel: "Volunteer Onboarding",
        interactionType: "Volunteer Application",
        contactId: "",
        contactName: applicantName,
        contactType: "",
        grantProgram: "",
        summary: "New volunteer application from " + applicantName,
        followUpDate: followUpDate,
        status: "Open",
        notes: notes,
        isDraft: false,
        owner: ownerName,
        ownerUid: ownerUid,
        volunteerApplicationId: appId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      try {
        await db.collection("auditLog").add({
          action: "Volunteer application received",
          details: applicantName + (data.email ? " -- " + data.email : ""),
          performedBy: "System (auto)",
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) { console.warn("auditLog write failed:", e.message); }

      console.log(
        `onVolunteerApplicationCreated: interaction created for ${applicantName} ` +
        `(app ${appId}, owner ${ownerName})`,
      );
    } catch (err) {
      console.error("onVolunteerApplicationCreated error:", err.message);
    }
    return null;
  });

// ── Close Volunteer Interaction on accepted / declined ─────────────
// When a volunteer application reaches its terminal status (accepted
// or declined), find the matching open interaction by
// volunteerApplicationId, append a closing note, and set status:"Closed".
// Intermediate statuses (contacted, interviewing) leave it open.
exports.onVolunteerApplicationUpdated = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10 })
  .firestore.document("volunteers/{appId}")
  .onUpdate(async (change, context) => {
    try {
      const before = change.before.data() || {};
      const after  = change.after.data()  || {};
      if (before.status === after.status) return null;
      const TERMINAL = ["accepted", "declined"];
      if (!TERMINAL.includes(after.status)) return null;
      if (TERMINAL.includes(before.status)) return null;

      const db = admin.firestore();
      const appId = context.params.appId;

      const ints = await db.collection("interactions")
        .where("volunteerApplicationId", "==", appId)
        .limit(5).get();
      if (ints.empty) {
        console.log(`onVolunteerApplicationUpdated: no interaction found for ${appId}, skipping`);
        return null;
      }

      const hstStamp = new Date().toLocaleString("en-US", {
        timeZone: "Pacific/Honolulu",
        dateStyle: "medium",
        timeStyle: "short",
      });
      const verb = after.status === "accepted" ? "Accepted" : "Declined";
      const closingNote = "\n\n— Application " + verb.toLowerCase() + " on " + hstStamp + " HST.";

      let closed = 0;
      for (const d of ints.docs) {
        if (d.data().status === "Closed") continue;
        const existingNotes = d.data().notes || "";
        await d.ref.update({
          notes: existingNotes + closingNote,
          status: "Closed",
          closedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        closed++;
      }
      console.log(
        `onVolunteerApplicationUpdated: closed ${closed} interaction(s) for ${appId} (${verb.toLowerCase()})`,
      );
    } catch (err) {
      console.error("onVolunteerApplicationUpdated error:", err.message);
    }
    return null;
  });

// ── Contact Enrichment on Registration Completion ────────────────
// When a signup transitions to status:"confirmed" with a registration
// object and a linkedContactId, enrich the contact record with
// location and type from the registration demographics.

async function handleSignupUpdated(change, context) {
  try {
    const before = change.before.data();
    const after = change.after.data();

    // Act when status transitions to "confirmed" OR when registration data is added
    const statusJustConfirmed = before.status !== "confirmed" && after.status === "confirmed";
    const registrationJustAdded = !before.registration && after.registration;
    if (!statusJustConfirmed && !registrationJustAdded) return null;
    if (after.status !== "confirmed") return null;

    // Must have registration data and a linked contact
    const registration = after.registration;
    const linkedContactId = after.linkedContactId;
    if (!registration || !linkedContactId) return null;

    const db = admin.firestore();
    const contactRef = db.collection("contacts").doc(linkedContactId);
    const contactSnap = await contactRef.get();
    if (!contactSnap.exists) {
      console.warn(`Contact ${linkedContactId} not found for enrichment (signup ${context.params.signupId})`);
      return null;
    }

    const contactData = contactSnap.data();
    const updates = {};

    // Enrich location if currently empty
    if (!contactData.location || contactData.location.trim() === "") {
      const city = (registration.city || "").trim();
      const zip = (registration.zipCode || "").trim();
      if (city || zip) {
        updates.location = city && zip ? city + ", " + zip : city || zip;
      }
    }

    // Enrich type if currently empty
    if (!contactData.type || contactData.type.trim() === "") {
      const role = (registration.role || "").trim();
      const validRoles = ["Parent/Guardian", "Professional", "Student", "Community Member"];
      if (validRoles.includes(role)) {
        updates.type = role;
      }
    }

    // Canonicalize legacy inputs from older form versions before mirroring.
    // Canonical schema (see feedback_demographic-schema-canonical.md, v120.1.0):
    //   militaryStatus → 'Not military' | 'Active Duty' | 'Veteran' | 'Reserves'
    //   militaryBranch → 'Marine Corps' (not 'Marines')
    //   child ageRange → drop 'yrs'/'H.S.' suffix on canonical keys
    const _canonMilStatus = (v) => {
      if (!v) return "";
      const s = String(v).trim();
      const lc = s.toLowerCase();
      if (lc === "none" || lc === "not military" || lc === "not military affiliated") return "Not military";
      if (lc === "active" || lc === "active duty" || lc === "active duty/military family") return "Active Duty";
      if (lc === "veteran") return "Veteran";
      if (lc === "reserves") return "Reserves";
      return s;
    };
    const _canonMilBranch = (v) => {
      if (!v) return "";
      const s = String(v).trim();
      if (s === "Marines") return "Marine Corps";
      return s;
    };

    // Enrich additional demographics — only if the contact field is empty/missing
    const stringFields = [
      "streetAddress", "city", "zipCode",
      "militaryStatus", "militaryBranch",
      "childAgeRange", "childGender",
      "ethnicity",
      "priorTraining", "priorTrainingDate",
      "howHeard", "accommodations",
    ];
    stringFields.forEach((field) => {
      let regVal = (registration[field] || "").trim();
      const contactVal = (contactData[field] || "").trim();
      if (field === "militaryStatus") regVal = _canonMilStatus(regVal);
      if (field === "militaryBranch") regVal = _canonMilBranch(regVal);
      if (regVal && !contactVal) {
        updates[field] = regVal;
      }
    });

    // preferredContact lives at the top level of the signup doc (not under
    // registration). Mirror to contact so future prefill lookups don't need
    // the per-signup fallback query.
    {
      const sigPref = (after.preferredContact || "").trim();
      const contactPref = (contactData.preferredContact || "").trim();
      if (sigPref && !contactPref) {
        updates.preferredContact = sigPref;
      }
    }

    // Enrich disabilityCategories (array) — only if contact has none
    if (
      Array.isArray(registration.disabilityCategories) &&
      registration.disabilityCategories.length > 0 &&
      (!Array.isArray(contactData.disabilityCategories) || contactData.disabilityCategories.length === 0)
    ) {
      updates.disabilityCategories = registration.disabilityCategories;
    }

    // Build child entry from registration child-specific fields
    // Canonical schema (v120.1.0): writes child.ageRange + child.gender
    // (legacy keys child.childAgeRange / child.childGender remain in old data
    //  and are tolerated by readers via _childAgeRange/_childGender helpers).
    // Strip legacy "yrs"/"H.S." suffix on age range so canonical values match
    // the canonical option set: '0-2'|'3-5'|'6-12'|'13-17'|'High School'|'Adult'.
    const _canonAgeRange = (v) => {
      if (!v) return "";
      const s = String(v).trim();
      // Map legacy form labels → canonical
      const map = {
        "Birth-2 yrs": "0-2", "Birth-2": "0-2", "0-2": "0-2",
        "3-5 yrs": "3-5", "3-5": "3-5",
        "6-11 yrs": "6-12", "6-11": "6-12", "6-12": "6-12",
        "12-14 yrs": "13-17", "12-14": "13-17", "15-18 yrs": "13-17", "15-18": "13-17", "13-17": "13-17",
        "Beyond H.S.": "Adult", "Beyond HS": "Adult", "Adult": "Adult",
        "High School": "High School",
      };
      return map[s] || s; // unknown — pass through
    };
    try {
      const childEntry = {};
      // Child name: prefer registration.childName; fall back to studentName
      // (recurring-event signups store the child's name there — the enrichment
      // used to drop it, leaving "Child 1" placeholders). Guard: studentName is
      // occasionally the registrant's OWN name mis-entered, so never use it when
      // it matches the parent/contact name. (2026-06-09)
      let _childNm = registration.childName ? String(registration.childName).trim() : "";
      if (!_childNm && registration.studentName) {
        const _sn = String(registration.studentName).trim();
        const _parent = String((contactData && contactData.displayName) || registration.name || "").trim();
        if (_sn && _sn.toLowerCase() !== _parent.toLowerCase()) _childNm = _sn;
      }
      if (_childNm) childEntry.name = _childNm;
      if (registration.childAgeRange) childEntry.ageRange = _canonAgeRange(registration.childAgeRange);
      if (registration.childGender) childEntry.gender = registration.childGender;
      if (registration.ethnicity) childEntry.ethnicity = registration.ethnicity;
      if (Array.isArray(registration.disabilityCategories) && registration.disabilityCategories.length) {
        childEntry.disabilityCategories = registration.disabilityCategories;
      }

      if (Object.keys(childEntry).length > 0) {
        // NB: FieldValue.serverTimestamp() throws inside array elements.
        // Use a plain Timestamp (admin SDK converts on write) — the whole
        // contact enrichment update was being rejected before this fix
        // (silent failure caught by the outer try/catch). Bug surfaced
        // 2026-05-02 when Jake Test's contact card showed empty
        // demographics despite a complete registration submit.
        childEntry.addedAt = admin.firestore.Timestamp.now();
        childEntry.sourceSignupId = context.params.signupId;

        const existingChildren = contactData.children || [];
        // Don't re-add if this exact signup already contributed a child.
        const alreadyAdded = existingChildren.some(c => c.sourceSignupId === context.params.signupId);
        if (!alreadyAdded) {
          // Dedup-at-source (2026-06-09): a returning family re-registers the
          // SAME child under a new signup. Match an existing child by NAME
          // (case-insensitive) and MERGE into it rather than appending a
          // duplicate. NAME-ONLY on purpose — the "Register Another Child" flow
          // means real siblings exist, so we never merge two children on
          // demographics alone (siblings can share age/gender/ethnicity/
          // disability). Nameless entries are always kept distinct (appended);
          // the rare nameless cross-event dupe is left for manual cleanup rather
          // than risk collapsing two real kids.
          const _norm = v => String(v == null ? "" : v).trim();
          const _matches = (a, b) => {
            const an = _norm(a.name).toLowerCase(); const bn = _norm(b.name).toLowerCase();
            return !!an && an === bn;   // merge only when both share a name
          };
          const idx = existingChildren.findIndex(c => _matches(c, childEntry));
          if (idx === -1) {
            existingChildren.push(childEntry);
          } else {
            // Merge into the existing child: fill blanks from the new entry,
            // union disability categories. Never overwrite existing
            // grade/school/notes (those come from staff-entered child records).
            const cur = existingChildren[idx];
            ["name", "ageRange", "gender", "ethnicity", "grade", "school", "notes"].forEach(f => {
              if (!_norm(cur[f]) && _norm(childEntry[f])) cur[f] = childEntry[f];
            });
            const disU = {};
            (cur.disabilityCategories || []).concat(childEntry.disabilityCategories || []).forEach(d => { if (_norm(d)) disU[_norm(d)] = true; });
            if (Object.keys(disU).length) cur.disabilityCategories = Object.keys(disU);
            existingChildren[idx] = cur;
          }
          updates.children = existingChildren;
        }
      }
    } catch (childErr) {
      console.error(`Children enrichment error (signup ${context.params.signupId}):`, childErr.message);
    }

    if (Object.keys(updates).length > 0) {
      updates.enrichedAt = admin.firestore.FieldValue.serverTimestamp();
      updates.enrichedFrom = "registration";
      await contactRef.update(updates);
      console.log(`Enriched contact ${linkedContactId} with:`, JSON.stringify(updates));
    }
  } catch (err) {
    // Never fail — log and move on
    console.error(`Contact enrichment error (signup ${context.params.signupId}):`, err.message);
  }

  return null;
}

exports.onEventSignupUpdated = functions
  .runWith({ timeoutSeconds: 60, maxInstances: 10, secrets: EMAIL_SECRETS })
  .firestore.document("events/{eventId}/signups/{signupId}")
  .onUpdate(async (change, context) => {
    await Promise.allSettled([
      handleSignupUpdated(change, context),
      maybeSendCatchupReminder(change, context, "events"),
      maybeSendRegistrationConfirmation(change, context, "events"),
      maybeSendFeedbackEmailOnAttendance(change, context, "events"),
      handleSignupLifecycleEmails(change, context, "events"),
    ]);
    return null;
  });

exports.onRecurringEventSignupUpdated = functions
  .runWith({ timeoutSeconds: 60, maxInstances: 10, secrets: EMAIL_SECRETS })
  .firestore.document("recurringEvents/{eventId}/signups/{signupId}")
  .onUpdate(async (change, context) => {
    await Promise.allSettled([
      handleSignupUpdated(change, context),
      maybeSendCatchupReminder(change, context, "recurringEvents"),
      maybeSendRegistrationConfirmation(change, context, "recurringEvents"),
      maybeSendFeedbackEmailOnAttendance(change, context, "recurringEvents"),
      handleSignupLifecycleEmails(change, context, "recurringEvents"),
    ]);
    return null;
  });

// ── Cancel & Reschedule Modal: per-signup cancellation email ──────
// Fires when crApplyDispositions (LDAH-Int Task 7) writes a new entry to
// the cancelledFromSession map on a signup in the flat `signups` collection.
// The flat collection is the write target for the C&R modal; it is distinct
// from the event-subcollection signups that onEventSignupUpdated watches.
//
// Idempotency: after sending we write cancellationEmailedAt back to the
// same map entry. On re-trigger (CF retry or concurrent invocations) we
// check that field and skip — so a retry storm sends at most one email
// per escapedKey.

async function handleCancelledFromSessionEmails(change, context) {
  try {
    const before = change.before.data() || {};
    const after = change.after.data() || {};

    const toEmail = (after.email || "").trim();
    if (!toEmail) return null;

    const beforeMap = (before.cancelledFromSession && typeof before.cancelledFromSession === "object")
      ? before.cancelledFromSession : {};
    const afterMap = (after.cancelledFromSession && typeof after.cancelledFromSession === "object")
      ? after.cancelledFromSession : {};

    // Identify keys that are newly present (not in beforeMap).
    const newKeys = Object.keys(afterMap).filter(function(k) { return !(k in beforeMap); });
    if (newKeys.length === 0) return null;

    const db = admin.firestore();
    const signupId = context.params.signupId;
    const signupRef = change.after.ref;
    const fromAddr = lifecycleFromAddress();
    const signupName = after.name || after.displayName || "";
    const eventTitle = after.eventTitle || "your LDAH program";

    for (const escapedKey of newKeys) {
      const entry = afterMap[escapedKey];
      if (!entry || !entry.fromKey) continue;

      // Idempotency: skip if we already sent for this entry (handles CF retries).
      if (entry.cancellationEmailedAt) continue;

      // Derive a human-readable session date from the composite key
      // format: "YYYY-MM-DD|Loc – Venue|time" (pipes and spaces escaped to _
      // in the key, but fromKey retains the original composite form).
      const fromKey = String(entry.fromKey);
      let sessionDateDisplay = "";
      try {
        // Extract the date prefix from the original composite key (before first "|").
        const datePart = fromKey.split("|")[0].trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
          const d = new Date(datePart + "T00:00:00");
          if (!isNaN(d.getTime())) {
            sessionDateDisplay = d.toLocaleDateString("en-US", {
              weekday: "long", month: "long", day: "numeric", year: "numeric",
              timeZone: "Pacific/Honolulu",
            });
          } else {
            sessionDateDisplay = datePart;
          }
        } else {
          sessionDateDisplay = datePart || fromKey;
        }
      } catch (_) {
        sessionDateDisplay = fromKey;
      }

      if (!sessionDateDisplay) {
        console.warn("onSignupCancelledFromSession: could not parse session date from fromKey=" + fromKey + " (signupId=" + signupId + "); skipping email");
        continue;
      }

      const html = buildSessionCancelledEmailHtml({
        name: signupName,
        eventTitle: eventTitle,
        sessionDate: sessionDateDisplay,
        reason: "a session cancellation",
      });
      const subject = "Session cancelled on " + sessionDateDisplay + " — " + eventTitle;

      try {
        await sendEmailViaResend({
          from: fromAddr,
          to: toEmail,
          subject: subject,
          html: html,
          type: "session-cancelled-cr-modal",
          relatedSignupId: signupId,
          recipientName: signupName,
        });

        // Write idempotency marker back to the entry. Use Timestamp.now() per
        // [[feedback-firestore-array-timestamp]]: serverTimestamp() is not allowed
        // inside map values. Dotted-path update avoids touching sibling keys.
        await signupRef.update({
          ["cancelledFromSession." + escapedKey + ".cancellationEmailedAt"]: admin.firestore.Timestamp.now(),
        });
        console.log("onSignupCancelledFromSession: sent session-cancelled email to " + toEmail + " for key=" + escapedKey + " signupId=" + signupId);
      } catch (sendErr) {
        console.error("onSignupCancelledFromSession: send failed (signupId=" + signupId + " key=" + escapedKey + "):", sendErr.message);
        // Continue to next key — don't let one failure abort the batch.
      }
    }
  } catch (err) {
    console.error("onSignupCancelledFromSession error (signupId=" + context.params.signupId + "):", err.message);
  }
  return null;
}

// crApplyDispositions (LDAH-Int) writes to the flat `signups` collection —
// a separate root collection from the subcollections under events/{id}/signups.
// This trigger watches only that flat collection; it does NOT fire for normal
// signup mutations (those hit onEventSignupUpdated / onRecurringEventSignupUpdated).
exports.onSignupCancelledFromSession = functions
  .runWith({ timeoutSeconds: 60, maxInstances: 10, secrets: EMAIL_SECRETS })
  .firestore.document("signups/{signupId}")
  .onUpdate(async (change, context) => {
    return handleCancelledFromSessionEmails(change, context);
  });

// ── Contact → Signup Sync ────────────────────────────────────────
// When a contact's name, email, or phone changes, propagate the new
// value to every signup doc that has a matching linkedContactId so
// resend-registration, daily reports, and any other signup-email
// consumers always use the corrected contact info.

exports.onContactUpdated = functions
  .runWith({ timeoutSeconds: 120, maxInstances: 5 })
  .firestore.document("contacts/{contactId}")
  .onUpdate(async (change, context) => {
    try {
      const before = change.before.data() || {};
      const after = change.after.data() || {};
      const contactId = context.params.contactId;

      const prevName = [before.firstName, before.lastName].filter(Boolean).join(" ").trim();
      const newName = [after.firstName, after.lastName].filter(Boolean).join(" ").trim();

      const syncFields = {};
      if ((before.email || "") !== (after.email || "") && after.email) {
        syncFields.email = after.email;
      }
      if ((before.phone || "") !== (after.phone || "") && after.phone) {
        syncFields.phone = after.phone;
      }
      if (prevName !== newName && newName) {
        syncFields.name = newName;
      }

      if (Object.keys(syncFields).length === 0) return null;

      const db = admin.firestore();
      // Single collectionGroup query covers every event + recurringEvent signup.
      const sigs = await db.collectionGroup("signups")
        .where("linkedContactId", "==", contactId)
        .get();

      if (sigs.empty) {
        console.log(`Contact ${contactId} changed (${Object.keys(syncFields).join(",")}) but no linked signups.`);
        return null;
      }

      const batch = db.batch();
      let writeCount = 0;
      sigs.forEach((doc) => {
        const s = doc.data();
        const updates = {};
        for (const k of Object.keys(syncFields)) {
          if ((s[k] || "") !== syncFields[k]) updates[k] = syncFields[k];
        }
        if (Object.keys(updates).length > 0) {
          batch.update(doc.ref, updates);
          writeCount++;
        }
      });

      if (writeCount > 0) {
        await batch.commit();
        console.log(`Contact ${contactId} sync: updated ${writeCount} signups with ${JSON.stringify(syncFields)}`);
      } else {
        console.log(`Contact ${contactId} sync: ${sigs.size} linked signups already in sync.`);
      }
    } catch (err) {
      console.error(`Contact sync error (${context.params.contactId}):`, err.message);
    }
    return null;
  });

// ── No-Show Re-Invite Email ───────────────────────────────────────

/**
 * Build the no-show re-invite email HTML.
 */
function buildNoShowEmailHtml({ name, eventTitle, nextEventTitle, nextEventDate, nextEventUrl, orgFooterHtml }) {
  const ctaUrl = nextEventTitle ? nextEventUrl : "https://ldahawaii.org/events.html";
  const ctaLabel = nextEventTitle ? "Sign Up" : "View Upcoming Events";
  const nextEventSection = nextEventTitle
    ? `<p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">
        We'd love to see you at our next workshop: <strong>${nextEventTitle}</strong> on ${nextEventDate}.
      </p>
      ${_emailBtn(ctaUrl, ctaLabel, { bg: "#1a73e8" })}`
    : `<p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">
        Check out our upcoming events:
      </p>
      ${_emailBtn(ctaUrl, ctaLabel, { bg: "#1a73e8" })}`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">

  <!-- Header -->
  <tr>
    <td style="background-color:#ffffff;padding:28px 32px 20px;text-align:center;border-bottom:3px solid #1a3c6e;">
      <img src="https://www.ldahawaii.org/logo_blue.png" alt="Leadership in Disabilities &amp; Achievement of Hawai'i" width="150" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;">
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="padding:32px;">
      <p style="margin:0 0 16px;font-size:16px;color:#333333;">Aloha ${name},</p>

      <p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">
        We're sorry we missed you at <strong>${eventTitle}</strong>. We hope you're doing well!
      </p>

      ${nextEventSection}

      <p style="margin:0 0 0;font-size:15px;color:#555555;line-height:1.5;">
        We look forward to seeing you at a future LDAH event. Mahalo!
      </p>

      ${_emailLinkFooter([{ label: ctaLabel, href: ctaUrl }])}
    </td>
  </tr>

  <!-- Footer -->
  ${orgFooterHtml || ''}

</table>
</td></tr>
</table>
</body>
</html>`;
}

exports.sendNoShowReInvites = functions
  .runWith({ timeoutSeconds: 60, maxInstances: 5, secrets: ["RESEND_API_KEY", "SMTP_FROM"] })
  .https.onRequest(async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Max-Age", "3600");

    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const { collection, eventId } = req.body;
    if (!collection || !eventId) {
      res.status(400).json({ error: "Missing collection or eventId" });
      return;
    }

    // Only allow one-time events — recurring program attendees just attend the next session
    if (collection === "recurringEvents") {
      res.status(400).json({ error: "Re-invites are only for one-time events. Recurring program attendees attend the next session." });
      return;
    }

    const db = admin.firestore();

    try {
      // Fetch event title
      let eventTitle = "an LDAH Event";
      const eventDoc = await db.collection(collection).doc(eventId).get();
      if (eventDoc.exists) {
        eventTitle = eventDoc.data().title || eventTitle;
      }

      // Get all signups for this event
      const signupsSnap = await db.collection(collection).doc(eventId).collection("signups").get();

      // Filter to no-shows with email that haven't already been emailed
      const noShows = [];
      signupsSnap.forEach((doc) => {
        const data = doc.data();
        if (data.attendanceStatus === "no-show" && data.email && !data.noShowEmailSentAt) {
          noShows.push({ id: doc.id, ref: doc.ref, ...data });
        }
      });

      if (noShows.length === 0) {
        res.status(200).json({ success: true, sent: 0, skipped: signupsSnap.size });
        return;
      }

      // Find next future event (one-time events only)
      let nextEventTitle = "";
      let nextEventDate = "";
      const nextEventUrl = "https://ldahawaii.org/events.html";
      const now = new Date();
      try {
        const nextSnap = await db.collection("events")
          .where("archived", "!=", true)
          .orderBy("archived")
          .orderBy("date")
          .limit(20)
          .get();
        for (const doc of nextSnap.docs) {
          const d = doc.data();
          if (doc.id === eventId) continue; // skip the current event
          let eventDateObj;
          if (d.date && d.date.toDate) eventDateObj = d.date.toDate();
          else if (d.date && d.date.seconds) eventDateObj = new Date(d.date.seconds * 1000);
          else if (d.date) eventDateObj = new Date(d.date);
          if (eventDateObj && eventDateObj > now) {
            nextEventTitle = d.title || "";
            nextEventDate = formatEventDate(d.date);
            break;
          }
        }
      } catch (err) {
        console.error("Error finding next event:", err.message);
        // Continue without next event info — email will use generic fallback
      }

      // Send emails
      const fromAddress = process.env.SMTP_FROM || "onboarding@resend.dev";
      let sent = 0;
      let skipped = 0;

      const orgFooterHtml = await getOrgFooterHtml();
      for (const signup of noShows) {
        const name = signup.name || signup.firstName || "there";
        const htmlBody = buildNoShowEmailHtml({
          name,
          eventTitle,
          nextEventTitle: nextEventTitle || "",
          nextEventDate: nextEventDate || "",
          nextEventUrl,
          orgFooterHtml,
        });

        try {
          await sendEmailViaResend({
            from: `LDAH <${fromAddress}>`,
            to: signup.email,
            subject: `We missed you at ${eventTitle}!`,
            html: htmlBody,
            type: "no-show-reinvite",
            relatedEventId: eventId,
            relatedSignupId: signup.id,
            recipientName: signup.data().name || "",
          });

          await signup.ref.update({
            noShowEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          sent++;
          console.log(`No-show re-invite sent to ${signup.email} for event ${eventId}`);
        } catch (err) {
          console.error(`Failed to send no-show email to ${signup.email}:`, err.message);
          skipped++;
        }
      }

      res.status(200).json({ success: true, sent, skipped });
    } catch (err) {
      console.error("sendNoShowReInvites error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

// ── Feedback Email HTML Builder ─────────────────────────────────
function buildFeedbackEmailHtml({ name, eventTitle, feedbackUrl, mode, donateHtml, orgFooterHtml }) {
  const isReminder = mode === "reminder";
  const intro = isReminder
    ? `Just a quick reminder — we would still love your feedback on <strong>${eventTitle}</strong> if you have a moment. Your input helps us continue to improve our programs.`
    : `Mahalo for attending <strong>${eventTitle}</strong>! We would love to hear your thoughts so we can continue to improve our programs.`;
  return _buildFeedbackEmailHtmlInner({ name, eventTitle, feedbackUrl, intro, donateHtml, orgFooterHtml });
}
function _buildFeedbackEmailHtmlInner({ name, eventTitle, feedbackUrl, intro, donateHtml, orgFooterHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">

  <!-- Header -->
  <tr>
    <td style="background-color:#ffffff;padding:28px 32px 20px;text-align:center;border-bottom:3px solid #1a3c6e;">
      <img src="https://www.ldahawaii.org/logo_blue.png" alt="Leadership in Disabilities &amp; Achievement of Hawai'i" width="150" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;">
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="padding:32px;">
      <p style="margin:0 0 16px;font-size:16px;color:#333333;">Aloha ${name},</p>

      <p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">
        ${intro}
      </p>

      <p style="margin:0 0 24px;font-size:16px;color:#333333;line-height:1.5;">
        It only takes a minute -- please share your feedback by clicking the button below.
      </p>

      ${_emailBtn(feedbackUrl, "Share Your Feedback", { bg: "#004E7C" })}

      <p style="margin:16px 0 0;font-size:15px;color:#555555;line-height:1.5;">
        Your feedback helps us improve our services and better support families
        and children with disabilities throughout Hawai'i.
      </p>

      ${_emailLinkFooter([{ label: "Share Your Feedback", href: feedbackUrl }])}

      ${donateHtml || ''}
    </td>
  </tr>

  <!-- Footer -->
  ${orgFooterHtml || ''}

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Send Feedback Emails (called from LDAH-Int) ─────────────────
exports.sendFeedbackEmails = functions
  .runWith({ timeoutSeconds: 60, maxInstances: 5, secrets: ["RESEND_API_KEY", "SMTP_FROM"] })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Max-Age", "3600");

    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const { collection, eventId, sessionDate } = req.body;
    if (!collection || !eventId) {
      res.status(400).json({ error: "Missing collection or eventId" });
      return;
    }

    try {
      const dbAdmin = admin.firestore();

      // Fetch event title
      let eventTitle = "an LDAH Event";
      try {
        const eventDoc = await dbAdmin.collection(collection).doc(eventId).get();
        if (eventDoc.exists) {
          eventTitle = eventDoc.data().title || eventTitle;
        }
      } catch (_) { /* use default */ }

      // Query all signups
      const signupsSnap = await dbAdmin
        .collection(collection).doc(eventId).collection("signups")
        .get();

      const type = collection === "recurringEvents" ? "recurring" : "event";
      const fromAddress = process.env.SMTP_FROM || "onboarding@resend.dev";
      let sent = 0;
      let skipped = 0;

      for (const doc of signupsSnap.docs) {
        const data = doc.data();

        // Must have email
        if (!data.email) {
          skipped++;
          continue;
        }

        // Per-session attendance check when sessionDate is provided
        // (recurring programs + multi-date one-time events). Falls back
        // to flat attendanceStatus for single-date one-time events.
        let isAttended;
        if (sessionDate && data.sessionAttendance && data.sessionAttendance[sessionDate]) {
          isAttended = data.sessionAttendance[sessionDate].status === "attended";
        } else if (!sessionDate) {
          isAttended = data.attendanceStatus === "attended";
        } else {
          // sessionDate given but no sessionAttendance entry for it
          isAttended = false;
        }
        if (!isAttended) {
          skipped++;
          continue;
        }

        // Per-session dedupe when sessionDate provided; otherwise flat flag
        if (sessionDate) {
          if (data.feedbackEmailsSent && data.feedbackEmailsSent[sessionDate]) {
            skipped++;
            continue;
          }
        } else if (data.feedbackEmailSentAt) {
          skipped++;
          continue;
        }

        const name = data.name || data.firstName || "there";
        const feedbackUrl =
          "https://ldahawaii.org/feedback.html?eventId=" + encodeURIComponent(eventId) +
          "&signupId=" + encodeURIComponent(doc.id) +
          "&type=" + encodeURIComponent(type) +
          (sessionDate ? "&sessionDate=" + encodeURIComponent(sessionDate) : "");

        const donateHtml = await buildDonateBlock('feedback');
        const orgFooterHtml = await getOrgFooterHtml();
        const htmlBody = buildFeedbackEmailHtml({ name, eventTitle, feedbackUrl, donateHtml, orgFooterHtml });

        try {
          await sendEmailViaResend({
            from: `LDAH <${fromAddress}>`,
            to: data.email,
            subject: `How was ${eventTitle}? We'd love your feedback`,
            html: htmlBody,
            type: "feedback-request",
            relatedEventId: eventId,
            relatedSignupId: doc.id,
            recipientName: name,
          });

          if (sessionDate) {
            await doc.ref.set({
              feedbackEmailsSent: {
                [sessionDate]: admin.firestore.FieldValue.serverTimestamp(),
              },
            }, { merge: true });
          } else {
            await doc.ref.update({
              feedbackEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
          sent++;
        } catch (emailErr) {
          console.error(`Failed to send feedback email to ${data.email}:`, emailErr.message);
          skipped++;
        }
      }

      console.log(`sendFeedbackEmails: sent=${sent}, skipped=${skipped} for ${collection}/${eventId}`);
      res.status(200).json({ success: true, sent, skipped });
    } catch (err) {
      console.error("sendFeedbackEmails error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

/**
 * Resend a previously logged email. Reads the original emailLog doc,
 * re-sends via Resend using the same HTML body + subject + from. A fresh
 * emailLog entry is written (by sendEmailViaResend) with type suffixed
 * "-resend" so the origin is traceable. BCC is NOT carried over — if the
 * original BCC'd Leilani, the resend goes to the addressee only.
 */
exports.resendLoggedEmail = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 5, secrets: ["RESEND_API_KEY", "SMTP_FROM"] })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Max-Age", "3600");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const { logId, overrideTo } = req.body || {};
    if (!logId) { res.status(400).json({ error: "Missing logId" }); return; }

    try {
      const db = admin.firestore();
      const doc = await db.collection("emailLog").doc(logId).get();
      if (!doc.exists) { res.status(404).json({ error: "Log entry not found" }); return; }
      const log = doc.data();
      if (!log.html) { res.status(400).json({ error: "No HTML body recorded for this entry — cannot resend" }); return; }
      const to = (overrideTo && String(overrideTo).trim()) || log.to;
      if (!to) { res.status(400).json({ error: "No recipient address" }); return; }

      const fromAddress = log.from || `LDAH <${process.env.SMTP_FROM || "onboarding@resend.dev"}>`;
      const result = await sendEmailViaResend({
        from: fromAddress,
        to,
        subject: log.subject || "(resend)",
        html: log.html,
        type: (log.type || "resend") + "-resend",
        relatedEventId: log.relatedEventId,
        relatedSignupId: log.relatedSignupId,
        recipientName: log.recipientName,
      });

      res.status(200).json({ success: true, id: (result && result.id) || null, to });
    } catch (err) {
      console.error("resendLoggedEmail error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

/**
 * Shared helper: send ONE feedback email (initial or reminder).
 * Caller is responsible for dedupe bookkeeping after this resolves.
 */
async function sendOneFeedbackEmail({ collection, eventId, signupId, signup, sessionDate, mode, event }) {
  const type = collection === "recurringEvents" ? "recurring" : "event";
  const fromAddress = process.env.SMTP_FROM || "onboarding@resend.dev";
  const eventTitle = (event && event.title) || "an LDAH Event";
  const name = signup.name || signup.firstName || "there";
  const feedbackUrl = "https://ldahawaii.org/feedback.html?eventId=" + encodeURIComponent(eventId) +
    "&signupId=" + encodeURIComponent(signupId) +
    "&type=" + encodeURIComponent(type) +
    (sessionDate ? "&sessionDate=" + encodeURIComponent(sessionDate) : "");
  const donateHtml = await buildDonateBlock('feedback');
  const orgFooterHtml = await getOrgFooterHtml();
  const html = buildFeedbackEmailHtml({ name, eventTitle, feedbackUrl, mode, donateHtml, orgFooterHtml });
  const subject = mode === "reminder"
    ? `Reminder: please share your feedback on ${eventTitle}`
    : `How was ${eventTitle}? We'd love your feedback`;
  return sendEmailViaResend({
    from: `LDAH <${fromAddress}>`,
    to: signup.email,
    subject,
    html,
    type: mode === "reminder" ? "feedback-reminder" : "feedback-request",
    relatedEventId: eventId,
    relatedSignupId: signupId,
    recipientName: name,
  });
}

/**
 * Trigger helper: when a signup's attendance is newly marked 'attended'
 * (either per-session or flat), send the initial feedback email. Dedupes
 * via feedbackEmailsSent[sessionDate] or flat feedbackEmailSentAt so a
 * re-save doesn't double-send.
 */
async function maybeSendFeedbackEmailOnAttendance(change, context, collection) {
  try {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    if (!after.email) return;
    if (after.archived === true) return;

    const eventId = context.params.eventId;
    const signupId = context.params.signupId;
    const db = admin.firestore();

    // Newly-attended per-session dates
    const beforeSA = (before.sessionAttendance && typeof before.sessionAttendance === "object") ? before.sessionAttendance : {};
    const afterSA = (after.sessionAttendance && typeof after.sessionAttendance === "object") ? after.sessionAttendance : {};
    const newlyAttendedSessions = [];
    for (const sd of Object.keys(afterSA)) {
      const wasAttended = beforeSA[sd] && beforeSA[sd].status === "attended";
      const isAttended = afterSA[sd].status === "attended";
      if (isAttended && !wasAttended) newlyAttendedSessions.push(sd);
    }

    // Flat (single-date one-time) transition
    const flatFlipped = before.attendanceStatus !== "attended" && after.attendanceStatus === "attended";

    if (newlyAttendedSessions.length === 0 && !flatFlipped) return;

    // Load event once (title + eventDate for context)
    const eventSnap = await db.collection(collection).doc(eventId).get();
    if (!eventSnap.exists) return;
    const event = eventSnap.data() || {};

    // Per-session sends
    for (const sessionDate of newlyAttendedSessions) {
      if (after.feedbackEmailsSent && after.feedbackEmailsSent[sessionDate]) continue;
      try {
        await sendOneFeedbackEmail({
          collection, eventId, signupId, signup: after,
          sessionDate, mode: "initial", event,
        });
        await change.after.ref.set({
          feedbackEmailsSent: {
            [sessionDate]: admin.firestore.FieldValue.serverTimestamp(),
          },
        }, { merge: true });
        console.log(`feedback initial (on-attendance) sent to ${after.email} for ${collection}/${eventId} session ${sessionDate}`);
      } catch (err) {
        console.error(`feedback initial (on-attendance) send failed for ${collection}/${eventId}/${signupId} on ${sessionDate}:`, err.message);
      }
    }

    // Flat flip → single-date one-time event
    if (flatFlipped && !after.feedbackEmailSentAt) {
      try {
        await sendOneFeedbackEmail({
          collection, eventId, signupId, signup: after,
          sessionDate: null, mode: "initial", event,
        });
        await change.after.ref.update({
          feedbackEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`feedback initial (on-attendance, single-date) sent to ${after.email} for ${collection}/${eventId}`);
      } catch (err) {
        console.error(`feedback initial (on-attendance, single-date) send failed for ${collection}/${eventId}/${signupId}:`, err.message);
      }
    }
  } catch (err) {
    console.error(`maybeSendFeedbackEmailOnAttendance error (${collection}/${context.params.eventId}/${context.params.signupId}):`, err.message);
  }
}

/**
 * Scheduled daily at 8 AM HST. Scans sessions 5-14 days old and sends
 * one feedback REMINDER to attendees who: received the initial feedback
 * email, haven't submitted feedback yet, and haven't already been
 * reminded for this session. Stops after one reminder per session.
 */
exports.sendFeedbackFollowups = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1, secrets: ["RESEND_API_KEY", "SMTP_FROM"] })
  .pubsub.schedule("0 8 * * *")
  .timeZone("Pacific/Honolulu")
  .onRun(async () => {
    const db = admin.firestore();
    const todayKey = toHstDateKey(new Date());
    const windowStart = addDaysHst(todayKey, -14);
    const windowEnd = addDaysHst(todayKey, -5);
    console.log(`sendFeedbackFollowups: window ${windowStart} .. ${windowEnd}`);

    let sent = 0, skipped = 0;

    // A session key may be composite "YYYY-MM-DD|loc|time" (recurring +
    // migrated events) or a raw "May 13, 2026, 5:00 pm - 6:00 pm" string
    // (one-time events). Reduce either to a YYYY-MM-DD date for the window
    // comparison below — comparing the raw key directly skipped every
    // one-time event, since "May..." sorts past any ISO date string.
    const sessionKeyDate = (sd) => {
      const head = String(sd || "").split("|")[0].trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head;
      return parseEventDateKey(head) || "";
    };

    async function processEvent(collection, evDoc) {
      const event = evDoc.data();
      const eventId = evDoc.id;
      const [signupsSnap, feedbackSnap] = await Promise.all([
        db.collection(collection).doc(eventId).collection("signups").get(),
        db.collection("eventFeedback").where("eventId", "==", eventId).get(),
      ]);

      // signupId -> Set of session keys that have submitted feedback
      // 'FLAT' represents a submission without a sessionDate (legacy / one-time).
      const submitted = {};
      feedbackSnap.forEach((fb) => {
        const f = fb.data();
        if (!f.signupId) return;
        const sd = f.sessionDate || "FLAT";
        if (!submitted[f.signupId]) submitted[f.signupId] = new Set();
        submitted[f.signupId].add(sd);
      });

      for (const doc of signupsSnap.docs) {
        const data = doc.data();
        if (!data.email) { skipped++; continue; }
        if (data.archived === true) { skipped++; continue; }

        const subSet = submitted[doc.id];

        // Per-session attendance path
        const sa = (data.sessionAttendance && typeof data.sessionAttendance === "object") ? data.sessionAttendance : null;
        if (sa) {
          for (const sd of Object.keys(sa)) {
            if (sa[sd].status !== "attended") continue;
            const sdDate = sessionKeyDate(sd);
            if (!sdDate || sdDate < windowStart || sdDate > windowEnd) continue;
            if (!data.feedbackEmailsSent || !data.feedbackEmailsSent[sd]) { skipped++; continue; }
            if (data.feedbackRemindersSent && data.feedbackRemindersSent[sd]) { skipped++; continue; }
            if (subSet && (subSet.has(sd) || subSet.has("FLAT"))) { skipped++; continue; }
            try {
              await sendOneFeedbackEmail({
                collection, eventId, signupId: doc.id, signup: data,
                sessionDate: sd, mode: "reminder", event,
              });
              await doc.ref.set({
                feedbackRemindersSent: {
                  [sd]: admin.firestore.FieldValue.serverTimestamp(),
                },
              }, { merge: true });
              sent++;
              console.log(`feedback reminder sent to ${data.email} for ${collection}/${eventId} session ${sd}`);
            } catch (e) {
              console.error(`feedback reminder failed ${collection}/${eventId}/${doc.id} ${sd}:`, e.message);
              skipped++;
            }
          }
          continue;
        }

        // Flat attendance (single-date one-time event)
        if (data.attendanceStatus !== "attended") { skipped++; continue; }
        const eventDateKey = toHstDateKey(event.eventDate || event.date);
        if (!eventDateKey || eventDateKey < windowStart || eventDateKey > windowEnd) { skipped++; continue; }
        if (!data.feedbackEmailSentAt) { skipped++; continue; }
        if (data.feedbackReminderSentAt) { skipped++; continue; }
        if (subSet) { skipped++; continue; }
        try {
          await sendOneFeedbackEmail({
            collection, eventId, signupId: doc.id, signup: data,
            sessionDate: null, mode: "reminder", event,
          });
          await doc.ref.update({
            feedbackReminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          sent++;
          console.log(`feedback reminder sent to ${data.email} for ${collection}/${eventId}`);
        } catch (e) {
          console.error(`feedback reminder failed ${collection}/${eventId}/${doc.id}:`, e.message);
          skipped++;
        }
      }
    }

    try {
      const [eventsSnap, recurringSnap] = await Promise.all([
        db.collection("events").get(),
        db.collection("recurringEvents").get(),
      ]);
      for (const ev of eventsSnap.docs) {
        try { await processEvent("events", ev); }
        catch (e) { console.error(`events/${ev.id} failed:`, e.message); }
      }
      for (const ev of recurringSnap.docs) {
        try { await processEvent("recurringEvents", ev); }
        catch (e) { console.error(`recurringEvents/${ev.id} failed:`, e.message); }
      }
    } catch (err) {
      console.error("sendFeedbackFollowups: scan failed:", err.message);
    }

    console.log(`sendFeedbackFollowups: sent=${sent}, skipped=${skipped}`);
    return null;
  });

// ── Daily Session Sheet Email ──────────────────────────────────────
// Sends a daily summary email at 6 AM HST to active recipients
// listed in the dailyReportRecipients collection. Includes today's
// sessions, signup counts, yesterday's activity, and items needing
// attention.

// Builds the "Website & App Analytics — Executive Summary (Year-to-Date)"
// body for the 1st-of-month daily report. Email-safe HTML/CSS bar charts (no
// JS). Mirrors the in-app report's siteAnalytics aggregation; tolerant of the
// legacy dotted-path docs. Returns inner HTML; caller adds the section header.
async function buildAnalyticsYtdHtml(db, esc, hawaiiNow) {
  const year = hawaiiNow.getFullYear();
  const yearStart = year + "-01-01";
  const PAGE_LABELS = { home:"Home", contact:"Contact", volunteer:"Volunteer", events:"Events", whoweare:"Who We Are", resources:"Resources", readiness:"Readiness", specialed:"Special Ed", military:"Military", pacific:"Pacific", community:"Community", install:"Install App", cms:"CMS", accessibility:"Accessibility" };
  const uniq = new Set();
  let pv=0, don=0, ph=0, em=0, ob=0, md=0, fm=0, dv=0;
  const pageBy={}, formBy={}, monthPV={};
  let minDate=null, maxDate=null;
  try {
    const snap = await db.collection("siteAnalytics").where("date", ">=", yearStart).get();
    snap.forEach((d) => {
      const day = d.data() || {};
      const date = day.date || d.id || "";
      if (/^\d{4}-\d{2}-\d{2}/.test(date)) { if (!minDate || date < minDate) minDate = date; if (!maxDate || date > maxDate) maxDate = date; }
      const ym = (date && date.length >= 7) ? date.slice(0,7) : null;
      const vids = Array.isArray(day.visitorIds) ? day.visitorIds : [];
      vids.forEach((v) => uniq.add(v));
      pv += day.totalPageviews || 0;
      if (ym) monthPV[ym] = (monthPV[ym] || 0) + (day.totalPageviews || 0);
      if (day.pageviews && typeof day.pageviews === "object") Object.keys(day.pageviews).forEach((p) => { pageBy[p] = (pageBy[p]||0) + (day.pageviews[p]||0); });
      Object.keys(day).forEach((k) => { if (k.indexOf("pageviews.")===0) { const p=k.slice(10); pageBy[p]=(pageBy[p]||0)+(day[k]||0); } });
      const e = day.events || {};
      don += e.donation_click||0; ph += e.phone_call||0; em += e.email_click||0; ob += e.outbound_click||0; md += e.modal_open_total||0; fm += e.form_submit_total||0; dv += e.document_view_total||0;
      don += day["events.donation_click"]||0; ph += day["events.phone_call"]||0; em += day["events.email_click"]||0; ob += day["events.outbound_click"]||0; md += day["events.modal_open_total"]||0; fm += day["events.form_submit_total"]||0; dv += day["events.document_view_total"]||0;
    });
  } catch (err) { console.warn("Analytics YTD query:", err.message); }
  const engagements = ph+em+ob+md+dv+fm;
  const n = (x) => Number(x||0).toLocaleString();

  const kpis = [["Unique Visitors",uniq.size],["Page Views",pv],["Total Engagements",engagements],["Form Submissions",fm],["Document Views",dv],["Donation Clicks",don]];
  let tiles = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>';
  kpis.forEach((k,i) => {
    tiles += '<td width="33%" style="padding:5px;"><div style="background:#0f3a5f;color:#fff;border-radius:8px;padding:10px 6px;text-align:center;"><div style="font-size:18px;font-weight:800;">'+n(k[1])+'</div><div style="font-size:9px;letter-spacing:.04em;text-transform:uppercase;opacity:.85;">'+esc(k[0])+'</div></div></td>';
    if (i % 3 === 2 && i !== kpis.length-1) tiles += '</tr><tr>';
  });
  tiles += '</tr></table>';

  // Fixed-width label + value columns so both charts' bars start at the same
  // left edge and the values right-align with each other and the summary table.
  function bars(rows, color) {
    const max = rows.reduce((m,r) => Math.max(m, r[1]), 0) || 1;
    let h = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;">';
    rows.forEach((r) => {
      const pct = r[1] > 0 ? Math.max(3, Math.round(r[1]/max*100)) : 0;
      h += '<tr><td style="width:118px;padding:3px 8px 3px 0;font-size:12px;color:#333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+esc(r[0])+'</td>'
        + '<td style="padding:3px 0;"><div style="background:#e8edf3;border-radius:4px;"><div style="background:'+color+';height:13px;border-radius:4px;width:'+pct+'%;">&nbsp;</div></div></td>'
        + '<td style="width:58px;padding:3px 10px 3px 8px;font-size:12px;color:#333;text-align:right;white-space:nowrap;">'+n(r[1])+'</td></tr>';
    });
    h += '</table>';
    return h;
  }

  const months = Object.keys(monthPV).sort();
  const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthlyRows = months.map((m) => { const mi=parseInt(m.split("-")[1],10)-1; return [MN[mi]+" "+m.split("-")[0].slice(2), monthPV[m]]; });
  const topPages = Object.entries(pageBy).sort((a,b)=>b[1]-a[1]).slice(0,6).map((e)=>[PAGE_LABELS[e[0]]||e[0], e[1]]);

  const rangeLabel = (minDate && maxDate) ? (minDate + " to " + maxDate) : (yearStart + " to date");
  const recap = pv>0
    ? "So far in "+year+", LDAH's website and app drew <strong>"+n(pv)+"</strong> page views from <strong>"+n(uniq.size)+"</strong> unique visitors, including <strong>"+n(fm)+"</strong> form submissions and <strong>"+n(dv)+"</strong> document views."
    : "No analytics recorded yet for "+year+".";

  const sumRows = kpis.concat([["Phone Call Taps",ph],["Email Link Clicks",em],["Outbound Links",ob],["Modal / Popup Opens",md]]);
  let sumTable = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;border-collapse:collapse;"><tr style="background:#f8f9fa;"><th style="padding:5px 10px;text-align:left;font-size:11px;color:#666;">Metric</th><th style="padding:5px 10px;text-align:right;font-size:11px;color:#666;">Total (YTD)</th></tr>';
  sumRows.forEach((r,i)=>{ const bg=i%2===0?"#ffffff":"#fafafa"; sumTable += '<tr style="background:'+bg+';"><td style="padding:5px 10px;font-size:12px;">'+esc(r[0])+'</td><td style="padding:5px 10px;font-size:12px;text-align:right;">'+n(r[1])+'</td></tr>'; });
  sumTable += '</table>';

  return '<p style="margin:0 0 12px;font-size:12px;color:#666;">Year to Date &middot; '+esc(rangeLabel)+' &middot; combined website + app</p>'
    + tiles
    + '<p style="margin:14px 0;font-size:13px;color:#333;line-height:1.5;">'+recap+'</p>'
    + '<h3 style="margin:16px 0 6px;font-size:13px;color:#0f3a5f;">Page Views by Month</h3>'+bars(monthlyRows.length?monthlyRows:[["No data",0]], "#0891b2")
    + '<h3 style="margin:16px 0 6px;font-size:13px;color:#0f3a5f;">Top Pages</h3>'+bars(topPages.length?topPages:[["No data",0]], "#0f3a5f")
    + '<h3 style="margin:16px 0 6px;font-size:13px;color:#0f3a5f;">Summary Metrics</h3>'+sumTable
    + '<div style="text-align:center;margin:20px 0 4px;"><a href="https://danpoahu.github.io/LDAH-Int/#wa-analytics" style="display:inline-block;background:#0891b2;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:700;font-size:13px;">View the full interactive report &rarr;</a></div>'
    + '<div style="text-align:center;font-size:11px;color:#666;">In LDAH-Int: Reports &rarr; Website &amp; App Analytics (staff login)</div>';
}

async function runDailyReport(overrideRecipients, opts) {
    const db = admin.firestore();
    const now = new Date();

    // Convert to Hawaii time for display and date matching
    const hawaiiNow = new Date(now.toLocaleString("en-US", { timeZone: "Pacific/Honolulu" }));
    // Display strings format directly from `now` with the HST timeZone —
    // a single conversion. Formatting from `hawaiiNow` (already shifted to
    // HST wall-clock) double-converts and lands a day earlier when the
    // 6 AM cron fires, e.g. subject "May 19" on a May 20 report.
    const todayStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "Pacific/Honolulu",
    });
    const todayFormatted = now.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "Pacific/Honolulu",
    });
    const todayDayOfWeek = now.toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "Pacific/Honolulu",
    });
    // YYYY-MM-DD for date field matching
    const yyyy = hawaiiNow.getFullYear();
    const mm = String(hawaiiNow.getMonth() + 1).padStart(2, "0");
    const dd = String(hawaiiNow.getDate()).padStart(2, "0");
    const todayISO = `${yyyy}-${mm}-${dd}`;

    // ── 1. Get active recipients ──
    let recipients = overrideRecipients || null;
    if (!recipients) {
      recipients = [];
      try {
        const recipSnap = await db.collection("dailyReportRecipients").where("active", "==", true).get();
        recipSnap.forEach((doc) => {
          const d = doc.data();
          if (d.email) recipients.push({ name: d.name || "", email: d.email });
        });
      } catch (err) {
        console.error("sendDailySessionSheet: failed to fetch recipients:", err.message);
        return null;
      }
    }

    if (recipients.length === 0) {
      console.log("sendDailySessionSheet: no recipients, skipping.");
      return null;
    }

    // Helper: format Firestore timestamp for display
    function fmtTs(ts) {
      if (!ts) return "";
      let d = null;
      if (ts.toDate) d = ts.toDate();
      else if (ts.seconds) d = new Date(ts.seconds * 1000);
      if (!d) return "";
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "Pacific/Honolulu" })
        + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Pacific/Honolulu" });
    }
    function esc(str) { return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

    const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const cutoffTimestamp = admin.firestore.Timestamp.fromDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));

    // ═══════════════════════════════════════════════════
    // SECTION 1: All Active Events & Programs with signups
    // ═══════════════════════════════════════════════════
    const allSessions = [];

    // Active one-time events (skip if archived, past moveToPastDate, or past removeDate —
    // matches the LDAH-Int CMS Active/Past/Expired categorization).
    try {
      const eventsSnap = await db.collection("events").get();
      for (const doc of eventsSnap.docs) {
        const data = doc.data();
        if (data.archived === true) continue;
        if (data.moveToPastDate && /^\d{4}-\d{2}-\d{2}$/.test(data.moveToPastDate) && data.moveToPastDate <= todayISO) continue;
        if (data.removeDate && /^\d{4}-\d{2}-\d{2}$/.test(data.removeDate) && data.removeDate <= todayISO) continue;
        const signups = [];
        try {
          const sSnap = await db.collection("events").doc(doc.id).collection("signups").get();
          sSnap.forEach((s) => { signups.push({ id: s.id, ...s.data() }); });
        } catch (_) {}
        // Skip events with no signups
        if (signups.length === 0) continue;

        const sigDates = Array.isArray(data.signupDates) ? data.signupDates : [];

        // Multi-date one-time event (e.g. Learning Labs with May 6 + May 13):
        // emit one card per signupDates entry, mirroring the recurring layout.
        if (sigDates.length > 1) {
          // Drop past dates (today inclusive — 6 AM HST report is for today's prep).
          // Unparseable strings are kept rather than silently hidden.
          const futureSigDates = sigDates.filter((dateStr) => {
            const key = parseEventDateKey(dateStr);
            if (!key) return true;
            return key >= todayISO;
          });
          // All sessions complete — drop event entirely (orphan card would otherwise
          // surface every signup since none matched a future date).
          if (futureSigDates.length === 0) continue;

          const matchedIds = new Set();
          for (const dateStr of futureSigDates) {
            const dateSignups = signups.filter((su) => {
              const sd = su.selectedDates || [];
              return sd.indexOf(dateStr) !== -1;
            });
            if (dateSignups.length === 0) continue;
            dateSignups.forEach((su) => matchedIds.add(su.id));
            // v129.0.2 — "prefix: For <signupDates string>"
            allSessions.push({
              title: reportEventPrefix(data.title || "Untitled Event") + ": For " + dateStr,
              date: "",
              time: "",
              location: data.location || "",
              signups: dateSignups,
              type: "event",
              id: doc.id,
              sessionKey: dateStr,
            });
          }
          // Orphan check uses FULL sigDates (not just future) so signups whose
          // only date is past don't get surfaced as "Unmatched."
          const matchedToAnySigDate = new Set();
          for (const dateStr of sigDates) {
            signups.forEach((su) => {
              const sd = su.selectedDates || [];
              if (sd.indexOf(dateStr) !== -1) matchedToAnySigDate.add(su.id);
            });
          }
          const orphans = signups.filter((su) => !matchedToAnySigDate.has(su.id) && su.status !== "cancelled" && su.archived !== true);
          if (orphans.length > 0) {
            allSessions.push({
              title: reportEventPrefix(data.title || "Untitled Event") + ": Unmatched signups",
              date: "",
              time: "",
              location: data.location || "",
              signups: orphans,
              type: "event",
              id: doc.id,
            });
          }
          continue;
        }

        // Single-date / no-date one-time event: original flat layout
        let dateDisplay = "";
        const rawDate = data.eventDate || data.date || "";
        if (rawDate) {
          if (typeof rawDate === "string") {
            try {
              const parsed = new Date(rawDate + "T12:00:00");
              dateDisplay = isNaN(parsed.getTime()) ? rawDate : parsed.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Pacific/Honolulu" });
            } catch (_) { dateDisplay = rawDate; }
          } else if (rawDate.toDate) {
            dateDisplay = rawDate.toDate().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Pacific/Honolulu" });
          } else if (rawDate.seconds) {
            dateDisplay = new Date(rawDate.seconds * 1000).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Pacific/Honolulu" });
          }
        }
        allSessions.push({
          title: data.title || "Untitled Event",
          date: dateDisplay,
          time: data.time || data.startTime || "",
          location: data.location || "",
          signups,
          type: "event",
          id: doc.id,
          sessionKey: (typeof rawDate === "string" ? rawDate : ""),
        });
      }
    } catch (err) {
      console.error("sendDailySessionSheet: error fetching events:", err.message);
    }

    console.log(`sendDailySessionSheet: ${allSessions.length} one-time events found`);

    // Active recurring programs — grouped by session date (matching session sheet logic)
    try {
      const recurringSnap = await db.collection("recurringEvents").get();
      for (const doc of recurringSnap.docs) {
        const data = doc.data();
        if (data.active === false) continue;
        const allSignups = [];
        try {
          const sSnap = await db.collection("recurringEvents").doc(doc.id).collection("signups").get();
          sSnap.forEach((s) => { allSignups.push({ id: s.id, ...s.data() }); });
        } catch (_) {}
        if (allSignups.length === 0) continue;

        // Generate session dates for next 90 days (matching session sheet)
        const rawCancelled = Array.isArray(data.cancelledDates) ? data.cancelledDates : [];
        const cancelledSet = {};
        for (const cd of rawCancelled) {
          if (typeof cd === "string") cancelledSet[cd] = true;
          else if (cd && cd.date) cancelledSet[cd.date] = true;
        }

        const upcomingSessions = [];
        if (Array.isArray(data.schedules)) {
          for (const sch of data.schedules) {
            const dow = typeof sch.dayOfWeek === "number" ? sch.dayOfWeek : -1;
            if (dow < 0) continue;
            for (let offset = 0; offset <= 90; offset++) {
              const d = new Date(hawaiiNow);
              d.setDate(d.getDate() + offset);
              if (d.getDay() !== dow) continue;
              const iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
              if (cancelledSet[iso]) continue;
              upcomingSessions.push({
                iso,
                dateLabel: DAY_NAMES[dow] + ", " + d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
                timeLabel: (sch.startTime && sch.endTime) ? sch.startTime + " - " + sch.endTime : (sch.startTime || ""),
                location: sch.location || "",
                venue: sch.venue || "",
              });
            }
          }
        }
        upcomingSessions.sort((a, b) => a.iso.localeCompare(b.iso));

        // Active signups only
        const active = allSignups.filter((su) => su.status !== "cancelled");
        const cancelled = allSignups.filter((su) => su.status === "cancelled");

        // Group signups by session date — match selectedSessions/selectedDates containing ISO date
        // (exact same logic as cmsGenerateRecurringSessionSheet in LDAH-Int)
        const sessionGroups = [];
        for (const sess of upcomingSessions) {
          const dateSignups = active.filter((su) => {
            const sDates = su.selectedSessions || su.selectedDates || [];
            return sDates.some((sd) => {
              const sdStr = String(sd);
              if (sdStr.indexOf(sess.iso) === -1) return false;
              // Cross-location check
              if (sess.location && (sdStr.indexOf("|") !== -1 || sdStr.indexOf("@ ") !== -1)) {
                return sdStr.indexOf(sess.location) !== -1;
              }
              return true;
            });
          });
          if (dateSignups.length === 0) continue;
          // Dedup: skip if we already have this date+location
          const key = sess.iso + "|" + sess.location;
          if (sessionGroups.some((g) => g.key === key)) continue;
          const loc = sess.location + (sess.venue ? " (" + sess.venue + ")" : "");
          sessionGroups.push({
            key,
            dateLabel: sess.dateLabel,
            timeLabel: sess.timeLabel,
            location: loc,
            signups: dateSignups,
          });
        }

        // Build one card per session group (sub-header style under the program name)
        if (sessionGroups.length > 0) {
          for (const sg of sessionGroups) {
            // Include cancelled count for this session
            const cancelledForSession = cancelled.filter((su) => {
              const sDates = su.selectedSessions || su.selectedDates || [];
              return sDates.some((sd) => String(sd).indexOf(sg.key.split("|")[0]) !== -1);
            });
            // v129.0.2 — "prefix: For <dateLabel [-- timeLabel]>"
            allSessions.push({
              title: reportEventPrefix(data.title) + ": For " + sg.dateLabel + (sg.timeLabel ? " -- " + sg.timeLabel : ""),
              date: "",
              time: "",
              location: sg.location,
              signups: [...sg.signups, ...cancelledForSession],
              type: "recurring",
              id: doc.id,
              sessionKey: sg.key,
            });
          }
        }
      }
    } catch (err) {
      console.error("sendDailySessionSheet: error fetching recurring events:", err.message);
    }

    // v129.0.2 — Shared prefix helper: everything before the first colon, or full title.
    function reportEventPrefix(eventTitle) {
      if (!eventTitle) return "";
      var idx = eventTitle.indexOf(":");
      return (idx > 0 ? eventTitle.slice(0, idx) : eventTitle).trim();
    }

    // Build session card HTML (email-safe, no JS — all expanded)
    function buildSessionCard(s) {
      let confirmed = 0, pending = 0, cancelled = 0, attended = 0, noshow = 0;
      s.signups.forEach((su) => {
        if (su.status === "confirmed") confirmed++;
        else if (su.status === "cancelled") cancelled++;
        else pending++;
        if (su.attendanceStatus === "attended") attended++;
        if (su.attendanceStatus === "no-show") noshow++;
      });
      const active = s.signups.filter((su) => su.status !== "cancelled");
      active.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

      const typeLabel = s.type === "recurring"
        ? `<span style="background:#7c3aed;color:white;padding:1px 6px;border-radius:6px;font-size:10px;font-weight:700;margin-left:6px;">RECURRING</span>`
        : `<span style="background:#1a73e8;color:white;padding:1px 6px;border-radius:6px;font-size:10px;font-weight:700;margin-left:6px;">EVENT</span>`;
      const attLine = (attended > 0 || noshow > 0)
        ? ` | <span style="color:#2e7d32;">${attended} attended</span>, <span style="color:#dc2626;">${noshow} no-show</span>` : "";

      let rows = "";
      for (const su of active) {
        const stColor = su.status === "confirmed" ? "#2e7d32" : "#e65100";
        const stLabel = su.status === "confirmed" ? "Confirmed" : "Pending";
        const regIcon = su.registrationCompletedAt ? "&#9745;" : "&#9744;";
        let attBadge = "";
        if (su.attendanceStatus === "attended") attBadge = `<span style="background:#2e7d32;color:white;padding:1px 6px;border-radius:8px;font-size:11px;font-weight:700;">Attended</span>`;
        else if (su.attendanceStatus === "no-show") attBadge = `<span style="background:#dc2626;color:white;padding:1px 6px;border-radius:8px;font-size:11px;font-weight:700;">No-Show</span>`;
        // Per-attendee mode override badge (inline on the status column)
        let modeBadge = "";
        const ovr = s.sessionKey ? getModeOverride(su, s.sessionKey) : null;
        if (ovr === "confirmed-in-person") {
          modeBadge = `<span style="display:inline-block;background:#fef3c7;color:#92400E;padding:1px 8px;border-radius:10px;font-size:.7rem;font-weight:700;margin-left:4px;">In-Person</span>`;
        } else if (ovr === "confirmed-virtual") {
          modeBadge = `<span style="display:inline-block;background:#dbeafe;color:#1d4ed8;padding:1px 8px;border-radius:10px;font-size:.7rem;font-weight:700;margin-left:4px;">Virtual</span>`;
        }
        rows += `<tr style="border-bottom:1px solid #eee;">`
          + `<td style="padding:5px 8px;font-size:12px;font-weight:600;">${esc(su.name || "Unknown")}</td>`
          + `<td style="padding:5px 8px;font-size:12px;">${esc(su.email || "--")}</td>`
          + `<td style="padding:5px 8px;font-size:12px;">${esc(su.phone || "--")}</td>`
          + `<td style="padding:5px 8px;font-size:12px;"><span style="color:${stColor};font-weight:700;">${stLabel}</span>${modeBadge}</td>`
          + `<td style="padding:5px 8px;font-size:12px;text-align:center;">${regIcon}</td>`
          + `<td style="padding:5px 8px;font-size:12px;">${attBadge}</td></tr>`;
      }
      if (cancelled > 0) {
        rows += `<tr><td colspan="6" style="padding:5px 8px;font-size:11px;color:#999;font-style:italic;">+ ${cancelled} cancelled/archived not shown</td></tr>`;
      }

      let detailLines = "";
      if (s.date) {
        const dateLines = String(s.date).split("\n");
        for (const dl of dateLines) {
          if (dl.trim()) detailLines += "<strong>" + esc(dl.trim()) + "</strong><br>";
        }
      }
      if (s.time) detailLines += "Time: <strong>" + esc(s.time) + "</strong><br>";
      if (s.location) detailLines += esc(s.location);

      // Header bar matching session sheet style
      const badgeText = `${confirmed} confirmed + ${pending} pending`;

      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;border:1px solid #ccc;border-radius:8px;overflow:hidden;">`
        // Dark header bar with title + badge
        + `<tr><td style="padding:10px 14px;background:#1a3c6e;color:white;">`
        + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>`
        + `<td style="font-size:14px;font-weight:800;color:white;">${esc(s.title)}</td>`
        + `<td style="text-align:right;"><span style="background:#4a7fb5;color:white;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;">${badgeText}</span></td>`
        + `</tr></table></td></tr>`
        // Detail lines (date, location, etc.)
        + (detailLines ? `<tr><td style="padding:6px 14px 2px;font-size:12px;color:#555;">${detailLines}</td></tr>` : "")
        // Signup table
        + `<tr><td style="padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`
        + `<tr style="background:#f0f0f0;">`
        + `<th style="padding:5px 8px;text-align:left;font-size:11px;color:#555;font-weight:800;">NAME</th>`
        + `<th style="padding:5px 8px;text-align:left;font-size:11px;color:#555;font-weight:800;">EMAIL</th>`
        + `<th style="padding:5px 8px;text-align:left;font-size:11px;color:#555;font-weight:800;">PHONE</th>`
        + `<th style="padding:5px 8px;text-align:left;font-size:11px;color:#555;font-weight:800;">STATUS</th>`
        + `<th style="padding:5px 8px;text-align:left;font-size:11px;color:#555;font-weight:800;">REG</th>`
        + `<th style="padding:5px 8px;text-align:left;font-size:11px;color:#555;font-weight:800;">ATT.</th>`
        + `</tr>${rows}</table></td></tr></table>`;
    }

    let sessionsHtml = "";
    if (allSessions.length === 0) {
      sessionsHtml = `<p style="color:#666;font-style:italic;">No active events or programs.</p>`;
    } else {
      for (const s of allSessions) { sessionsHtml += buildSessionCard(s); }
    }

    // ═══════════════════════════════════════════════════
    // SECTION 1B: Returning Connect-Gen Families (last 24h)
    // ═══════════════════════════════════════════════════
    // Surface any signups created in the report window flagged as
    // returning Connect-Gen families so La'a + admins see the pre-call
    // workload at a glance.
    const returningCGRows = [];
    try {
      const cgSigSnap = await db.collection("recurringEvents")
        .doc("CmkPXEpPwfAQ5sR377K2").collection("signups")
        .where("isReturningCGFamily", "==", true).get();
      cgSigSnap.forEach((d) => {
        const r = d.data() || {};
        const tsMs = (r.timestamp && r.timestamp.toMillis)
          ? r.timestamp.toMillis()
          : (r.timestamp && r.timestamp.seconds ? r.timestamp.seconds * 1000 : 0);
        if (!tsMs || tsMs < cutoffTimestamp.toMillis()) return;
        if (r.archived === true) return;
        const session = (Array.isArray(r.selectedSessions) && r.selectedSessions[0])
          || (Array.isArray(r.selectedDates) && r.selectedDates[0])
          || "(session not specified)";
        returningCGRows.push({
          name: r.name || [r.firstName, r.lastName].filter(Boolean).join(" ") || "Unknown",
          session: session,
          source: r.returningCGSource || "",
        });
      });
    } catch (err) { console.warn("Returning-CG section:", err.message); }

    let returningCGHtml = "";
    if (returningCGRows.length > 0) {
      returningCGHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">`;
      returningCGRows.forEach((r, idx) => {
        const bg = idx % 2 === 0 ? "#fafafa" : "#ffffff";
        const srcLabel = r.source ? ` <span style="color:#92400E;font-size:11px;background:#FEF3C7;padding:1px 6px;border-radius:8px;">${esc(r.source)}</span>` : "";
        returningCGHtml += `<tr style="background:${bg};">`
          + `<td style="padding:8px 14px;font-size:13px;color:#333;"><strong>${esc(r.name)}</strong>${srcLabel}</td>`
          + `<td style="padding:8px 14px;font-size:12px;color:#555;text-align:right;">${esc(r.session)}</td></tr>`;
      });
      returningCGHtml += `</table>`;
    }

    // ═══════════════════════════════════════════════════
    // SECTION 2: What Changed Since Yesterday (detailed)
    // ═══════════════════════════════════════════════════
    // Collect RAW change facts (structured), then group per person+event so
    // related lifecycle actions collapse to one line. See buildGroupedChangeLines.
    const rawChanges = [];

    // Groups signup/registration/status/new-contact facts by person+event into
    // a single line each; feedback/admin/session items stay as their own lines.
    function buildGroupedChangeLines(raw, escFn) {
      const groups = new Map();
      const singles = [];
      const newContacts = [];
      raw.forEach((it) => {
        if (it.single) { singles.push(it); return; }
        if (it.kind === "newContact") { newContacts.push(it); return; }
        if (it.person && it.event) {
          const k = it.person + "||" + it.event;
          let g = groups.get(k);
          if (!g) { g = { person: it.person, event: it.event, signedUp: false, completedReg: false, statusWord: "", newContact: false, sort: 0, time: "" }; groups.set(k, g); }
          if (it.kind === "signup") g.signedUp = true;
          else if (it.kind === "completedReg") g.completedReg = true;
          else if (it.kind === "status") g.statusWord = it.statusWord || g.statusWord;
          if ((it.sort || 0) >= g.sort) { g.sort = it.sort || 0; g.time = it.time || g.time; }
        } else { singles.push(it); }
      });
      // Fold "new contact created" into that person's event line when one exists.
      newContacts.forEach((nc) => {
        let attached = null, best = -1;
        groups.forEach((g) => { if (g.person === nc.person && g.sort > best) { best = g.sort; attached = g; } });
        if (attached) { attached.newContact = true; if ((nc.sort || 0) > attached.sort) { attached.sort = nc.sort || 0; attached.time = nc.time || attached.time; } }
        else { singles.push({ single: true, icon: "&#128100;", text: `New contact created: <strong>${escFn(nc.person)}</strong>${nc.source ? " (from " + escFn(nc.source) + ")" : ""}`, time: nc.time, sort: nc.sort || 0 }); }
      });
      const lines = [];
      groups.forEach((g) => {
        let verb;
        if (g.signedUp && g.completedReg) verb = "signed up &amp; completed registration for";
        else if (g.completedReg) verb = "completed registration for";
        else if (g.signedUp) verb = "signed up for";
        else verb = "was updated for";
        const tag = g.newContact ? ` <span style="color:#0891b2;font-weight:700;">(new)</span>` : "";
        let txt = `<strong>${escFn(g.person)}</strong>${tag} ${verb} <em>${escFn(g.event)}</em>`;
        if (g.statusWord) txt += ` <span style="color:#666;">&middot; ${escFn(g.statusWord)}</span>`;
        const icon = g.completedReg ? "&#9989;" : (g.signedUp ? "&#128221;" : "&#128260;");
        lines.push({ icon, text: txt, time: g.time, sort: g.sort });
      });
      singles.forEach((s) => lines.push({ icon: s.icon, text: s.text, time: s.time, sort: s.sort || 0 }));
      lines.sort((a, b) => b.sort - a.sort);
      return lines;
    }

    // New signups
    try {
      const nsSnap = await db.collectionGroup("signups").where("timestamp", ">=", cutoffTimestamp).get();
      for (const doc of nsSnap.docs) {
        const nd = doc.data();
        const parentRef = doc.ref.parent.parent;
        const parentDoc = await parentRef.get();
        const evTitle = (parentDoc.data() || {}).title || "Unknown Event";
        rawChanges.push({ kind: "signup", person: nd.name || "Someone", event: evTitle, time: fmtTs(nd.timestamp), sort: nd.timestamp ? (nd.timestamp.seconds || 0) : 0 });
      }
    } catch (err) { console.warn("Changelog signups:", err.message); }

    // Completed registrations
    try {
      const crSnap = await db.collectionGroup("signups").where("registrationCompletedAt", ">=", cutoffTimestamp).get();
      for (const doc of crSnap.docs) {
        const cd = doc.data();
        const parentRef = doc.ref.parent.parent;
        const parentDoc = await parentRef.get();
        const pTitle = (parentDoc.data() || {}).title || "Unknown Event";
        rawChanges.push({ kind: "completedReg", person: cd.name || "Someone", event: pTitle, time: fmtTs(cd.registrationCompletedAt), sort: cd.registrationCompletedAt ? (cd.registrationCompletedAt.seconds || 0) : 0 });
      }
    } catch (err) { console.warn("Changelog regs:", err.message); }

    // New feedback (own line)
    try {
      const fbSnap = await db.collection("eventFeedback").where("submittedAt", ">=", cutoffTimestamp).get();
      fbSnap.forEach((f) => {
        const fd = f.data();
        rawChanges.push({ single: true, icon: "&#128172;", text: `Feedback received for <em>${esc(fd.eventTitle || fd.eventId || "an event")}</em>${fd.presenterRating ? " (Presenter: " + esc(fd.presenterRating) + ")" : ""}`, time: fmtTs(fd.submittedAt), sort: fd.submittedAt ? (fd.submittedAt.seconds || 0) : 0 });
      });
    } catch (err) { console.warn("Changelog feedback:", err.message); }

    // New contacts
    try {
      const ctSnap = await db.collection("contacts").where("createdAt", ">=", cutoffTimestamp).get();
      ctSnap.forEach((c) => {
        const cdata = c.data();
        rawChanges.push({ kind: "newContact", person: cdata.displayName || cdata.firstName || "Unknown", source: cdata.source || "", time: fmtTs(cdata.createdAt), sort: cdata.createdAt ? (cdata.createdAt.seconds || 0) : 0 });
      });
    } catch (err) { console.warn("Changelog contacts:", err.message); }

    // Admin audit log — groupable status actions become structured; the rest are single lines.
    function auditToRaw(action, details) {
      if (!action || !details) return null;
      let m;
      if (action === "Updated signup status") {
        m = details.match(/^(.*?)\s+—\s+(.*?)\s+—\s+Status:\s+(.*)$/);
        if (m) return { kind: "status", person: m[1], event: m[2], statusWord: m[3] };
      }
      if (action === "Archived signup") { m = details.match(/^(.*?)\s+—\s+(.*)$/); if (m) return { kind: "status", person: m[1], event: m[2], statusWord: "archived" }; }
      if (action === "Restored signup") { m = details.match(/^(.*?)\s+—\s+(.*)$/); if (m) return { kind: "status", person: m[1], event: m[2], statusWord: "restored" }; }
      if (action === "Rescheduled signup") { m = details.match(/^(.*?)\s+—\s+from\s+(.*?)\s+to\s+(.*)$/); if (m) return { single: true, icon: "&#128197;", text: `<strong>${esc(m[1])}</strong> was rescheduled from ${esc(m[2])} to ${esc(m[3])}` }; }
      if (action === "Saved attendance") return { single: true, icon: "&#9989;", text: `Attendance saved — <em>${esc(details)}</em>` };
      if (action === "Cancelled session") return { single: true, icon: "&#10060;", text: `Session cancelled — <em>${esc(details)}</em>` };
      if (action === "Restored session") return { single: true, icon: "&#9200;", text: `Session restored — <em>${esc(details)}</em>` };
      if (action === "Sent no-show re-invites") return { single: true, icon: "&#128231;", text: `No-show re-invites sent — <em>${esc(details)}</em>` };
      if (action === "Follow-up support requested") {
        m = details.match(/^(.*?)\s+--\s+(.*)$/);
        if (m) return { single: true, icon: "&#128205;", text: `<strong>${esc(m[1])}</strong> requested follow-up support after <em>${esc(m[2])}</em>` };
        return { single: true, icon: "&#128205;", text: `Follow-up support requested — <em>${esc(details)}</em>` };
      }
      if (action === "Saved event summary") return { single: true, icon: "&#128203;", text: `Event summary saved — <em>${esc(details)}</em>` };
      if (action === "Updated signup notes") {
        m = details.match(/^(.*?)\s+—\s+(.*)$/);
        if (m) return { single: true, icon: "&#9999;", text: `Admin notes updated for <strong>${esc(m[1])}</strong> on <em>${esc(m[2])}</em>` };
      }
      return null;
    }

    try {
      const alSnap = await db.collection("auditLog").where("timestamp", ">=", cutoffTimestamp).get();
      alSnap.forEach((a) => {
        const ad = a.data();
        const r = auditToRaw(ad.action, ad.details);
        if (!r) return;
        r.time = fmtTs(ad.timestamp);
        r.sort = ad.timestamp ? (ad.timestamp.seconds || 0) : 0;
        if (r.single && ad.performedBy) r.text += ` <span style="color:#999;">(by ${esc(ad.performedBy)})</span>`;
        rawChanges.push(r);
      });
    } catch (err) { console.warn("Changelog audit:", err.message); }

    // Group related entries → one line per person+event.
    const changeLines = buildGroupedChangeLines(rawChanges, esc);

    let changelogHtml = "";
    if (changeLines.length === 0) {
      changelogHtml = `<p style="color:#666;font-style:italic;">No changes in the last 24 hours.</p>`;
    } else {
      changelogHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">`;
      changeLines.forEach((c, idx) => {
        const bg = idx % 2 === 0 ? "#fafafa" : "#ffffff";
        changelogHtml += `<tr style="background:${bg};">`
          + `<td style="padding:8px 14px;font-size:16px;width:30px;text-align:center;">${c.icon}</td>`
          + `<td style="padding:8px 14px;font-size:13px;color:#333;">${c.text}</td>`
          + `<td style="padding:8px 14px;font-size:11px;color:#999;white-space:nowrap;text-align:right;">${c.time}</td></tr>`;
      });
      changelogHtml += `</table>`;
    }

    // ═══════════════════════════════════════════════════
    // SECTION 2.5: Overdue / Due Today Interactions
    // ═══════════════════════════════════════════════════
    const overdueInt = [], dueTodayInt = [];
    try {
      const oiSnap = await db.collection("interactions").where("status", "==", "Open").get();
      oiSnap.forEach((d) => {
        const x = d.data();
        if (x.isDraft === true) return;
        const fu = x.followUpDate;
        if (!fu || !/^\d{4}-\d{2}-\d{2}$/.test(fu)) return;
        const row = { name: x.contactName || "(no contact)", summary: x.summary || x.interactionType || "", owner: x.owner || "", fu };
        if (fu < todayISO) overdueInt.push(row);
        else if (fu === todayISO) dueTodayInt.push(row);
      });
    } catch (err) { console.warn("Overdue interactions:", err.message); }
    overdueInt.sort((a, b) => (a.fu < b.fu ? -1 : (a.fu > b.fu ? 1 : 0)));
    const overdueCountTotal = overdueInt.length + dueTodayInt.length;

    let overdueHtml = "";
    if (overdueCountTotal === 0) {
      overdueHtml = `<p style="color:#666;font-style:italic;">No overdue or due-today follow-ups.</p>`;
    } else {
      const oiRow = (r, tag, color) =>
        `<tr style="border-bottom:1px solid #eee;">`
        + `<td style="padding:6px 10px;font-size:12px;font-weight:600;">${esc(r.name)}</td>`
        + `<td style="padding:6px 10px;font-size:12px;color:#333;">${esc((r.summary || "").substring(0, 90))}</td>`
        + `<td style="padding:6px 10px;font-size:12px;color:#555;">${esc(r.owner)}</td>`
        + `<td style="padding:6px 10px;font-size:12px;white-space:nowrap;">${esc(r.fu)}</td>`
        + `<td style="padding:6px 10px;font-size:11px;white-space:nowrap;"><span style="background:${color};color:#fff;padding:2px 8px;border-radius:10px;font-weight:700;">${tag}</span></td></tr>`;
      let oiRows = "";
      overdueInt.forEach((r) => { oiRows += oiRow(r, "Overdue", "#dc2626"); });
      dueTodayInt.forEach((r) => { oiRows += oiRow(r, "Due Today", "#d97706"); });
      overdueHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;border-collapse:collapse;">`
        + `<tr style="background:#f8f9fa;">`
        + `<th style="padding:6px 10px;text-align:left;font-size:11px;color:#666;font-weight:800;">Contact</th>`
        + `<th style="padding:6px 10px;text-align:left;font-size:11px;color:#666;font-weight:800;">Task</th>`
        + `<th style="padding:6px 10px;text-align:left;font-size:11px;color:#666;font-weight:800;">Owner</th>`
        + `<th style="padding:6px 10px;text-align:left;font-size:11px;color:#666;font-weight:800;">Due</th>`
        + `<th style="padding:6px 10px;text-align:left;font-size:11px;color:#666;font-weight:800;">Status</th></tr>`
        + oiRows + `</table>`;
    }

    // ═══════════════════════════════════════════════════
    // SECTION 3: Pending/New Public Submissions
    // ═══════════════════════════════════════════════════
    const formSections = [];

    // Helper: check if status is pending or new (or no status = new)
    function isPendingOrNew(status) { return !status || status === "pending" || status === "new"; }

    // Anti-Bullying Pledges (all pending/new)
    try {
      const plSnap = await db.collection("pledges").get();
      const plDocs = [];
      plSnap.forEach((p) => { const pd = p.data(); if (isPendingOrNew(pd.status)) plDocs.push(pd); });
      if (plDocs.length > 0) {
        let plRows = "";
        plDocs.forEach((pd) => { plRows += `<tr style="border-bottom:1px solid #eee;"><td style="padding:5px 8px;font-size:12px;font-weight:600;">${esc(pd.name)}</td><td style="padding:5px 8px;font-size:12px;">${esc(pd.email)}</td><td style="padding:5px 8px;font-size:12px;">${esc(pd.role)}</td><td style="padding:5px 8px;font-size:12px;">${esc(pd.zip)}</td></tr>`; });
        formSections.push({ title: "Anti-Bullying Pledges", count: plDocs.length, color: "#7c3aed", headers: "Name|Email|Role|Zip", rows: plRows });
      }
    } catch (_) {}

    // Volunteer Applications (all pending/new)
    try {
      const volSnap = await db.collection("volunteers").get();
      const volDocs = [];
      volSnap.forEach((v) => { const vd = v.data(); if (isPendingOrNew(vd.status)) volDocs.push(vd); });
      if (volDocs.length > 0) {
        let vRows = "";
        volDocs.forEach((vd) => { vRows += `<tr style="border-bottom:1px solid #eee;"><td style="padding:5px 8px;font-size:12px;font-weight:600;">${esc((vd.firstName || "") + " " + (vd.lastName || ""))}</td><td style="padding:5px 8px;font-size:12px;">${esc(vd.email)}</td><td style="padding:5px 8px;font-size:12px;">${esc(vd.subject)}</td><td style="padding:5px 8px;font-size:12px;">${esc((vd.notes || "").substring(0, 80))}</td></tr>`; });
        formSections.push({ title: "Volunteer Applications", count: volDocs.length, color: "#059669", headers: "Name|Email|Opportunity|Notes", rows: vRows });
      }
    } catch (_) {}

    // Contact Messages (all pending/new)
    try {
      const cmSnap = await db.collection("contactSubmissions").get();
      const cmDocs = [];
      cmSnap.forEach((c) => { const cd = c.data(); if (isPendingOrNew(cd.status)) cmDocs.push(cd); });
      if (cmDocs.length > 0) {
        let cmRows = "";
        cmDocs.forEach((cd) => { cmRows += `<tr style="border-bottom:1px solid #eee;"><td style="padding:5px 8px;font-size:12px;font-weight:600;">${esc(cd.name)}</td><td style="padding:5px 8px;font-size:12px;">${esc(cd.email)}</td><td style="padding:5px 8px;font-size:12px;">${esc(cd.phone)}</td><td style="padding:5px 8px;font-size:12px;">${esc((cd.message || "").substring(0, 100))}</td></tr>`; });
        formSections.push({ title: "Contact Messages", count: cmDocs.length, color: "#0891b2", headers: "Name|Email|Phone|Message", rows: cmRows });
      }
    } catch (_) {}

    // Event Requests (all pending/new)
    try {
      const erSnap = await db.collection("eventRequests").get();
      const erDocs = [];
      erSnap.forEach((r) => { const rd = r.data(); if (isPendingOrNew(rd.status)) erDocs.push(rd); });
      if (erDocs.length > 0) {
        let erRows = "";
        erDocs.forEach((rd) => { erRows += `<tr style="border-bottom:1px solid #eee;"><td style="padding:5px 8px;font-size:12px;font-weight:600;">${esc(rd.name)}</td><td style="padding:5px 8px;font-size:12px;">${esc(rd.email)}</td><td style="padding:5px 8px;font-size:12px;">${esc(rd.preferredDate)}</td><td style="padding:5px 8px;font-size:12px;">${esc((rd.eventInfo || "").substring(0, 100))}</td></tr>`; });
        formSections.push({ title: "Event Requests", count: erDocs.length, color: "#d97706", headers: "Name|Email|Preferred Date|Details", rows: erRows });
      }
    } catch (_) {}

    // Provider Requests (all pending/new)
    try {
      const prSnap = await db.collection("providers").get();
      const prDocs = [];
      prSnap.forEach((p) => { const pd = p.data(); if (isPendingOrNew(pd.status)) prDocs.push(pd); });
      if (prDocs.length > 0) {
        let prRows = "";
        prDocs.forEach((pd) => { prRows += `<tr style="border-bottom:1px solid #eee;"><td style="padding:5px 8px;font-size:12px;font-weight:600;">${esc(pd.organizationName)}</td><td style="padding:5px 8px;font-size:12px;">${esc((pd.firstName || "") + " " + (pd.lastName || ""))}</td><td style="padding:5px 8px;font-size:12px;">${esc(pd.email)}</td><td style="padding:5px 8px;font-size:12px;">${esc((pd.services || "").substring(0, 80))}</td></tr>`; });
        formSections.push({ title: "Provider Requests", count: prDocs.length, color: "#be185d", headers: "Organization|Contact|Email|Services", rows: prRows });
      }
    } catch (_) {}

    // Partner Resource Applications (Become a Partner Resource form)
    try {
      const raSnap = await db.collection("resourceApplications").where("status", "==", "new").get();
      const raDocs = [];
      raSnap.forEach((r) => { const rd = r.data() || {}; if (rd.archived !== true) raDocs.push(rd); });
      if (raDocs.length > 0) {
        let raRows = "";
        raDocs.forEach((rd) => {
          const cityIsland = [rd.city, rd.island].filter(Boolean).join(", ");
          raRows += `<tr style="border-bottom:1px solid #eee;"><td style="padding:5px 8px;font-size:12px;font-weight:600;">${esc(rd.name)}</td><td style="padding:5px 8px;font-size:12px;">${esc(rd.contactName)}</td><td style="padding:5px 8px;font-size:12px;">${esc(rd.email)}</td><td style="padding:5px 8px;font-size:12px;">${esc(rd.type)}</td><td style="padding:5px 8px;font-size:12px;">${esc(cityIsland)}</td></tr>`;
        });
        formSections.push({ title: "Partner Resource Applications", count: raDocs.length, color: "#dc2626", headers: "Organization|Contact|Email|Type|Location", rows: raRows });
      }
    } catch (_) {}

    let formsHtml = "";
    if (formSections.length === 0) {
      formsHtml = `<p style="color:#666;font-style:italic;">No pending submissions.</p>`;
    } else {
      for (const fs of formSections) {
        const headerCells = fs.headers.split("|").map((h) =>
          `<th style="padding:5px 8px;text-align:left;font-size:11px;color:#666;font-weight:800;">${h}</th>`
        ).join("");
        formsHtml += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;border:1px solid #ddd;border-radius:8px;overflow:hidden;">`
          + `<tr><td style="padding:10px 14px;background:${fs.color}10;border-left:4px solid ${fs.color};">`
          + `<span style="font-size:14px;font-weight:800;color:${fs.color};">${esc(fs.title)}</span>`
          + `&nbsp;&nbsp;<span style="background:${fs.color};color:white;padding:2px 10px;border-radius:10px;font-size:12px;font-weight:800;">${fs.count} pending</span>`
          + `</td></tr>`
          + `<tr><td style="padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`
          + `<tr style="background:#f8f9fa;">${headerCells}</tr>${fs.rows}</table></td></tr></table>`;
      }
    }

    // ═══════════════════════════════════════════════════
    // SECTION 4: Partner Resource Update Cycle progress
    // ═══════════════════════════════════════════════════
    // Mirrors the LDAH-Int dashboard panel (cmsRenderResourceCyclePanel).
    // Cycle starts every May 1 / Nov 1 with a 7-day grace window.
    let cycleHtml = "";
    try {
      const _yr = hawaiiNow.getFullYear();
      const _may1 = new Date(_yr, 4, 1).getTime();
      const _nov1 = new Date(_yr, 10, 1).getTime();
      const _nowMs = hawaiiNow.getTime();
      let cycleStartMs;
      if (_nowMs >= _nov1)      cycleStartMs = _nov1;
      else if (_nowMs >= _may1) cycleStartMs = _may1;
      else                       cycleStartMs = new Date(_yr - 1, 10, 1).getTime();
      const graceWindow = cycleStartMs - (7 * 24 * 60 * 60 * 1000);

      let resTotal = 0, confirmed = 0, pendingReview = 0, awaiting = 0, noEmail = 0;
      const resSnap = await db.collection("resources").get();
      resSnap.forEach((r) => {
        const rd = r.data() || {};
        if (rd.archived === true) return;
        const nm = (rd.name || "").trim();
        if (!nm) return; // skip Downloads entries
        resTotal++;
        const email = (rd.email || "").trim();
        const lu = rd.lastUpdateAt && rd.lastUpdateAt.toMillis ? rd.lastUpdateAt.toMillis() : 0;
        const reqAt = rd.updateRequestedAt && rd.updateRequestedAt.toMillis ? rd.updateRequestedAt.toMillis() : 0;
        const subAt = rd.updateSubmittedAt && rd.updateSubmittedAt.toMillis ? rd.updateSubmittedAt.toMillis() : 0;
        if (rd.pendingUpdate) pendingReview++;
        if (lu >= graceWindow || subAt >= graceWindow) {
          confirmed++;
        } else if (email && reqAt >= graceWindow) {
          awaiting++;
        } else if (!email) {
          noEmail++;
        } else {
          awaiting++;
        }
      });

      if (resTotal > 0) {
        const pct = (n) => resTotal > 0 ? Math.round((n / resTotal) * 100) : 0;
        const confirmedPct = pct(confirmed);
        const pendingPct = pct(pendingReview);
        const awaitingPct = pct(awaiting);
        const noEmailPct = Math.max(0, 100 - confirmedPct - pendingPct - awaitingPct);
        const cycleDate = new Date(cycleStartMs).toLocaleDateString("en-US", {
          month: "long", day: "numeric", year: "numeric", timeZone: "Pacific/Honolulu",
        });

        const chip = (color, label, n, p) =>
          `<td style="padding:0 6px 6px 0;"><table role="presentation" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:999px;background:#fff;">`
          + `<tr><td style="padding:6px 14px;font-size:13px;white-space:nowrap;">`
          + `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};vertical-align:middle;margin-right:6px;"></span>`
          + `<span style="font-weight:700;color:#0F172A;">${n}</span> `
          + `<span style="color:#64748B;">${label}${p > 0 ? ` (${p}%)` : ""}</span>`
          + `</td></tr></table></td>`;

        const barSeg = (p, color) => p > 0
          ? `<td width="${p}%" style="background:${color};font-size:0;line-height:0;">&nbsp;</td>`
          : "";

        cycleHtml =
          `<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:16px 18px;">`
          + `<h3 style="margin:0 0 2px;font-size:16px;color:#0F172A;">Partner Resource Update Cycle</h3>`
          + `<div style="font-size:12px;color:#64748B;margin-bottom:10px;">Cycle started ${cycleDate} &middot; ${confirmed} of ${resTotal} confirmed (${confirmedPct}%)</div>`
          + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:999px;overflow:hidden;border:1px solid #CBD5E1;background:#E2E8F0;margin-bottom:10px;height:14px;">`
          + `<tr>${barSeg(confirmedPct, "#16A34A")}${barSeg(pendingPct, "#F59E0B")}${barSeg(awaitingPct, "#0891B2")}${barSeg(noEmailPct, "#94A3B8")}</tr>`
          + `</table>`
          + `<table role="presentation" cellpadding="0" cellspacing="0"><tr>`
          + chip("#16A34A", "Confirmed this cycle", confirmed, confirmedPct)
          + chip("#F59E0B", "Pending review", pendingReview, pendingPct)
          + chip("#0891B2", "Sent, awaiting reply", awaiting, awaitingPct)
          + chip("#94A3B8", "No email on file", noEmail, noEmailPct)
          + `</tr></table>`
          + `</div>`;
      }
    } catch (err) {
      console.warn("sendDailySessionSheet: cycle panel error:", err.message);
    }

    // ═══════════════════════════════════════════════════
    // BUILD FULL HTML EMAIL
    // ═══════════════════════════════════════════════════
    // Monthly extra (1st of month HST, or forced for a preview): Website &
    // App Analytics year-to-date executive summary, as its own page.
    var _opts = opts || {};
    var isMonthly = _opts.forceMonthly === true || (hawaiiNow.getDate() === 1);
    let analyticsSummaryHtml = "";
    if (isMonthly) {
      try { analyticsSummaryHtml = await buildAnalyticsYtdHtml(db, esc, hawaiiNow); }
      catch (err) { console.warn("Analytics summary build failed:", err.message); analyticsSummaryHtml = ""; }
    }

    const orgFooterHtml = await getOrgFooterHtml();
    const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="800" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:800px;width:100%;">

  <!-- Header -->
  <tr>
    <td style="background-color:#1a3c6e;padding:24px 32px;text-align:center;">
      <img src="https://www.ldahawaii.org/logo_blue.png" alt="Leadership in Disabilities &amp; Achievement of Hawai'i" width="180" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;background-color:#ffffff;padding:14px 20px;border-radius:10px;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:0.5px;">
        LDAH Daily Report
      </h1>
      <p style="margin:4px 0 0;color:#b0c4de;font-size:14px;">${todayStr}</p>
    </td>
  </tr>

  ${cycleHtml ? `<tr><td style="padding:20px 28px 0;">${cycleHtml}</td></tr>` : ""}

  <!-- Section 1: All Active Events & Programs -->
  <tr>
    <td style="padding:24px 28px 8px;">
      <h2 style="margin:0;font-size:17px;color:#1a3c6e;border-bottom:2px solid #1a3c6e;padding-bottom:6px;">
        All Active Events &amp; Programs
      </h2>
      <p style="margin:4px 0 12px;font-size:12px;color:#666;">${allSessions.length} active</p>
    </td>
  </tr>
  <tr><td style="padding:0 28px 16px;">${sessionsHtml}</td></tr>

  ${returningCGRows.length > 0 ? `
  <!-- Section 1B: Returning Connect-Gen Families -->
  <tr>
    <td style="padding:24px 28px 8px;">
      <h2 style="margin:0;font-size:17px;color:#1a3c6e;border-bottom:2px solid #1a3c6e;padding-bottom:6px;">
        Returning Connect-Gen Families
      </h2>
      <p style="margin:4px 0 12px;font-size:12px;color:#666;">${returningCGRows.length} flagged in last 24 hours &mdash; pre-call 2 days before session</p>
    </td>
  </tr>
  <tr><td style="padding:0 28px 16px;">${returningCGHtml}</td></tr>
  ` : ""}

  <!-- Section 2: What Changed (Last 24 Hours) -->
  <tr>
    <td style="padding:24px 28px 8px;">
      <h2 style="margin:0;font-size:17px;color:#1a3c6e;border-bottom:2px solid #1a3c6e;padding-bottom:6px;">
        What Changed (Last 24 Hours)
      </h2>
      <p style="margin:4px 0 12px;font-size:12px;color:#666;">${changeLines.length} change(s)</p>
    </td>
  </tr>
  <tr><td style="padding:0 28px 16px;">${changelogHtml}</td></tr>

  <!-- Section 2.5: Overdue / Due Today Interactions -->
  <tr>
    <td style="padding:24px 28px 8px;">
      <h2 style="margin:0;font-size:17px;color:#1a3c6e;border-bottom:2px solid #1a3c6e;padding-bottom:6px;">
        Overdue / Due Today Interactions
      </h2>
      <p style="margin:4px 0 12px;font-size:12px;color:#666;">${overdueCountTotal} follow-up(s)</p>
    </td>
  </tr>
  <tr><td style="padding:0 28px 16px;">${overdueHtml}</td></tr>

  <!-- Section 3: Pending/New Public Submissions -->
  <tr>
    <td style="padding:24px 28px 8px;">
      <h2 style="margin:0;font-size:17px;color:#1a3c6e;border-bottom:2px solid #1a3c6e;padding-bottom:6px;">
        Pending Public Submissions
      </h2>
    </td>
  </tr>
  <tr><td style="padding:0 28px 16px;">${formsHtml}</td></tr>

  ${analyticsSummaryHtml ? `
  <!-- Page 2 (1st of month): Website & App Analytics — Executive Summary -->
  <tr><td style="padding:0;"><div style="page-break-before:always;line-height:0;font-size:0;">&nbsp;</div></td></tr>
  <tr>
    <td style="padding:24px 28px 8px;">
      <h2 style="margin:0;font-size:17px;color:#1a3c6e;border-bottom:2px solid #1a3c6e;padding-bottom:6px;">
        Website &amp; App Analytics &mdash; Executive Summary
      </h2>
    </td>
  </tr>
  <tr><td style="padding:0 28px 24px;">${analyticsSummaryHtml}</td></tr>
  ` : ''}

  <!-- Footer -->
  ${orgFooterHtml || ''}

</table>
</td></tr>
</table>
</body>
</html>`;

    // ── 6. Send to each active recipient ──
    const fromAddress = process.env.SMTP_FROM || "onboarding@resend.dev";
    const subject = `LDAH Daily Report -- ${todayFormatted}`;
    let sentCount = 0;

    for (const recipient of recipients) {
      try {
        await sendEmailViaResend({
          from: `LDAH <${fromAddress}>`,
          to: recipient.email,
          subject,
          html: emailHtml,
          type: "daily-session-sheet",
          recipientName: recipient.name || "",
        });
        sentCount++;
        console.log(`sendDailySessionSheet: sent to ${recipient.email}`);
      } catch (err) {
        console.error(`sendDailySessionSheet: failed to send to ${recipient.email}:`, err.message);
      }
    }

    console.log(`sendDailySessionSheet: complete. Sent to ${sentCount}/${recipients.length} recipients. Sessions: ${allSessions.length}`);
    return null;
}

exports.sendDailySessionSheet = functions
  .runWith({ timeoutSeconds: 120, maxInstances: 1, secrets: ["RESEND_API_KEY", "SMTP_FROM"] })
  .pubsub.schedule("0 6 * * *")
  .timeZone("Pacific/Honolulu")
  .onRun(async (context) => { return runDailyReport(null); });

// ── Event Reminder Emails (5-day + 1-day) ──────────────────────────
// Scheduled daily at 7 AM HST. Scans all confirmed, non-archived
// signups under events/ and recurringEvents/, and sends a reminder
// to each attendee 5 days and 1 day before their session. Dedupes
// per-session via sessionReminders map on the signup doc.
//
// Event body mirrors Leilani's manual template verbatim. BCCs
// LKailiawa@ldahawaii.org so Leilani has a paper trail.

// Leilani no longer wants to be BCC'd on every reminder — her inbox was
// getting flooded once the cron + catch-up + feedback pipelines came
// online. She'll only receive the ones actually addressed TO her.
const REMINDER_BCC = "";

/**
 * Extract session date keys (YYYY-MM-DD HST) from a signup doc.
 * Reads both `selectedDates` (Learning Labs shape — array of date
 * strings) and `selectedSessions` (Connect-Gen shape — pipe-delimited
 * "YYYY-MM-DD|venue|time"). De-duped across both.
 */
function extractSignupSessionKeys(signup) {
  const keys = new Set();
  if (signup && Array.isArray(signup.selectedDates)) {
    for (const raw of signup.selectedDates) {
      const k = parseEventDateKey(raw);
      if (k) keys.add(k);
    }
  }
  if (signup && Array.isArray(signup.selectedSessions)) {
    for (const raw of signup.selectedSessions) {
      const head = String(raw || "").split("|")[0].trim();
      const k = toHstDateKey(head);
      if (k) keys.add(k);
    }
  }
  return Array.from(keys);
}

/**
 * Parse a "5:00 pm" / "5:00pm" / "5 pm" style time string to {hour, minute}
 * in 24h. Returns null if not parseable. Used to pull session start times
 * out of selectedSessions / selectedDates entries for the day-of reminder.
 */
function _parseTimeOfDayParts(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // 24-hour form first ("15:00"). Required because
  // buildSessionsForRecurringEvent emits rawString times verbatim from
  // schedules[i].startTime, which the CMS writes as 24h. Without this branch
  // the day-of cron silently skipped Connect-Gen Monday-Virtual signups
  // (2026-05-18 incident).
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const mi = parseInt(m24[2], 10);
    if (!isNaN(h) && !isNaN(mi) && h >= 0 && h <= 23 && mi >= 0 && mi <= 59) {
      return { hour: h, minute: mi };
    }
  }
  // 12-hour form ("3:00 PM", "3pm", "3:00pm")
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]?\.?/);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3].toLowerCase();
  if (isNaN(hour) || isNaN(minute)) return null;
  if (meridiem === "p" && hour < 12) hour += 12;
  if (meridiem === "a" && hour === 12) hour = 0;
  return { hour, minute };
}

/**
 * Build a JS Date that represents the session start as a wall-clock time
 * in HST. Server runs UTC, so we construct via Date.UTC(y, m, d, h+10, min)
 * — HST is UTC-10 with no DST in Hawaii.
 *
 * Inputs supported:
 *   • Connect-Gen format "YYYY-MM-DD|venue|time" — parts[2] holds the time
 *     range "5:00 pm-6:00 pm". Take everything before the dash.
 *   • Learning Labs format "May 6, 2026, 5:00 pm-6:00 pm" — parseEventDateKey
 *     extracts the date prefix; a separate regex captures the time range
 *     (tolerant of inconsistent dash spacing per feedback_signupdates-parsing).
 *   • If no time portion in rawSession, fall back to event.startTime then
 *     event.time, paired with the date extracted from rawSession.
 *
 * Returns null when the date or start time can't be parsed.
 */
function extractSessionStartHst(rawSession, event) {
  if (!rawSession) return null;
  const raw = String(rawSession);

  // Pull date key first.
  let dateKey = "";
  let timeStr = "";
  if (raw.indexOf("|") !== -1) {
    const parts = raw.split("|");
    dateKey = toHstDateKey((parts[0] || "").trim());
    timeStr = (parts[2] || "").trim();
  } else {
    dateKey = parseEventDateKey(raw);
    // Strip the date prefix off and look for a "h:mm am-h:mm pm" range. Be
    // permissive about dash spacing/dash type (en-dash, em-dash, plain).
    const tm = raw.match(/(\d{1,2}(?::\d{2})?\s*[AaPp]\.?[Mm]?\.?)\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*[AaPp]\.?[Mm]?\.?)/);
    if (tm) timeStr = tm[1];
    else {
      const single = raw.match(/(\d{1,2}(?::\d{2})?\s*[AaPp]\.?[Mm]?\.?)/);
      if (single) timeStr = single[1];
    }
  }

  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;

  // Time range — take just the start portion (before any dash).
  let startStr = "";
  if (timeStr) {
    const splitMatch = timeStr.split(/\s*[-–—]\s*/);
    startStr = (splitMatch[0] || "").trim();
  }

  let parts = startStr ? _parseTimeOfDayParts(startStr) : null;
  if (!parts && event) {
    parts = _parseTimeOfDayParts(event.startTime || event.time || "");
  }
  if (!parts) return null;

  const [y, m, d] = dateKey.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return null;
  // HST = UTC-10 (no DST). To get the wall-clock moment in HST, shift forward
  // 10 hours when constructing the UTC instant.
  return new Date(Date.UTC(y, m - 1, d, parts.hour + 10, parts.minute));
}

/**
 * Parse a Learning-Labs-style date string like "May 6, 2026, 5:00 pm-6:00 pm"
 * by extracting the "Month Day, Year" prefix before any time range.
 * Builds the YYYY-MM-DD key directly from regex captures — NEVER routes
 * through new Date("Month D, YYYY") which parses as UTC midnight on Cloud
 * Functions (server tz = UTC), yielding the previous day in HST.
 * Falls back to toHstDateKey for plain ISO dates / timestamps.
 */
const MONTH_TO_NUM = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
/**
 * Look up a per-date attendance mode override on a signup. Overrides are
 * keyed by either the raw selectedSessions/selectedDates string
 * (e.g. "2026-04-27|Oahu|5:00 pm-6:00 pm") OR by the YYYY-MM-DD date prefix.
 * Returns "confirmed-in-person", "confirmed-virtual", or null.
 * Backward compatible: returns null when the field is missing.
 */
function getModeOverride(signup, sessionKey) {
  if (!signup || !signup.dateStatusOverrides || !sessionKey) return null;
  // Direct match first
  if (signup.dateStatusOverrides[sessionKey]) return signup.dateStatusOverrides[sessionKey];
  // Fallback: match by date prefix (first pipe segment)
  const dateOnly = String(sessionKey).split("|")[0];
  let found = null;
  Object.keys(signup.dateStatusOverrides).forEach(function(k) {
    if (String(k).split("|")[0] === dateOnly) found = signup.dateStatusOverrides[k];
  });
  return found;
}

/**
 * Parse the location portion of a signup's session key for a given date.
 * Supports both formats produced by the signup form / reschedule flow:
 *   "YYYY-MM-DD|Location – Venue|Time"  (pipe-delimited)
 *   "Day, YYYY-MM-DD — Time @ Location (Venue)"
 * Returns empty string when no matching entry or no location component.
 */
function getSessionLocationForDate(signup, sessionDateKey) {
  if (!signup || !sessionDateKey) return "";
  const entries = []
    .concat(Array.isArray(signup.selectedSessions) ? signup.selectedSessions : [])
    .concat(Array.isArray(signup.selectedDates) ? signup.selectedDates : []);
  for (const raw of entries) {
    const s = String(raw || "");
    if (s.indexOf(sessionDateKey) === -1) continue;
    if (s.indexOf("|") !== -1) {
      const parts = s.split("|");
      return (parts[1] || "").trim();
    }
    if (s.indexOf("@ ") !== -1) {
      return s.split("@ ").slice(1).join("@ ").trim();
    }
  }
  return "";
}

/**
 * Parse the TIME portion of a signup's session key for a given date and split
 * it into start/end display strings (e.g. "5:00 pm" / "6:00 pm").
 *
 * Mirrors getSessionLocationForDate: Connect-Gen / recurring programs carry
 * each session's time on the SIGNUP — pipe-delimited
 * "YYYY-MM-DD|Venue|5:00 pm-6:00 pm" (time range is parts[2]) — NOT on the
 * recurring-event document. Reminder emails that only read event.startTime/
 * event.time therefore rendered NO time for those programs (bug surfaced
 * 2026-06-22 — Connect-Gen reminders showed a date but no time).
 *
 * Falls back to event-level startTime/time + endTime when the signup carries
 * no per-session time (one-time events). Display strings are returned verbatim
 * (no 24h conversion) so the email reads the same as the source schedule.
 * Returns { startTime, endTime } ("" when unknown).
 */
function getSessionTimeForDate(signup, sessionDateKey, event) {
  const evStart = String((event && (event.startTime || event.time)) || "").trim();
  const evEnd = String((event && event.endTime) || "").trim();
  const fallback = { startTime: evStart, endTime: evEnd };
  if (!signup || !sessionDateKey) return fallback;
  const entries = []
    .concat(Array.isArray(signup.selectedSessions) ? signup.selectedSessions : [])
    .concat(Array.isArray(signup.selectedDates) ? signup.selectedDates : []);
  for (const raw of entries) {
    const s = String(raw || "");
    if (s.indexOf(sessionDateKey) === -1) continue;
    let timeStr = "";
    if (s.indexOf("|") !== -1) {
      // "YYYY-MM-DD|Venue|5:00 pm-6:00 pm" — time range is parts[2].
      timeStr = (s.split("|")[2] || "").trim();
    } else {
      // Non-pipe formats ("Day, YYYY-MM-DD — 5:00 pm - 6:00 pm @ Loc"): pull
      // the first time range out, tolerant of dash type/spacing per
      // feedback_signupdates-parsing.
      const m = s.match(/(\d{1,2}(?::\d{2})?\s*[AaPp]\.?[Mm]?\.?)\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*[AaPp]\.?[Mm]?\.?)/);
      if (m) timeStr = m[0];
    }
    if (!timeStr) continue;
    const splitMatch = timeStr.split(/\s*[-–—]\s*/);
    const startTime = (splitMatch[0] || "").trim();
    const endTime = (splitMatch[1] || "").trim();
    if (startTime) return { startTime, endTime: endTime || evEnd };
  }
  return fallback;
}

/**
 * Decide whether a session is virtual based on the signup's own location
 * string for that date. Falls back to event.location for events where the
 * signup has no per-session detail (single-date one-time events).
 * Matches the strings "Virtual", "Zoom", or "Online" case-insensitively.
 */
function isSessionVirtual(event, sessionDateKey, signup) {
  const loc = getSessionLocationForDate(signup, sessionDateKey);
  if (loc) return /virtual|zoom|online/i.test(loc);
  const evLoc = String((event && event.location) || "");
  return /virtual|zoom|online/i.test(evLoc);
}

/**
 * Session-level virtuality, honoring a per-date dateStatusOverrides entry
 * (a reschedule can flip a single date virtual/in-person). Falls back to
 * the session's own location via isSessionVirtual().
 */
function sessionIsVirtual(event, sessionDateKey, signup) {
  const override = getModeOverride(signup, sessionDateKey);
  if (override === "confirmed-virtual") return true;
  if (override === "confirmed-in-person") return false;
  return isSessionVirtual(event, sessionDateKey, signup);
}

/**
 * Connect-Gen requires a signed consent form before reminders go out — but
 * ONLY for virtual sessions (the Monday "All Islands Virtual" program).
 * In-person attendees (Thursday Oahu / Hilo / Kona) sign the consent form
 * on arrival, so their reminders are never gated on consentSignedAt.
 */
function sessionRequiresConsent(event, sessionDateKey, signup) {
  return !!(event && event.zoomMode === "program"
    && sessionIsVirtual(event, sessionDateKey, signup));
}

function parseEventDateKey(raw) {
  if (!raw) return "";
  if (typeof raw !== "string") return toHstDateKey(raw);
  const m = raw.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/);
  if (m) {
    const monthNum = MONTH_TO_NUM[m[1].toLowerCase()];
    if (monthNum) {
      return `${m[3]}-${String(monthNum).padStart(2, "0")}-${String(parseInt(m[2], 10)).padStart(2, "0")}`;
    }
  }
  return toHstDateKey(raw);
}

/**
 * Build the full set of candidate session date keys for an event:
 * the event's primary eventDate plus any parseable entries in signupDates.
 * Used so multi-date one-time events (Learning Labs) aren't skipped
 * when the primary eventDate is not in the reminder target window.
 */
function extractEventCandidateDateKeys(event) {
  const keys = new Set();
  if (!event) return [];
  const main = toHstDateKey(event.eventDate || event.date);
  if (main) keys.add(main);
  if (Array.isArray(event.signupDates)) {
    for (const raw of event.signupDates) {
      const k = parseEventDateKey(raw);
      if (k) keys.add(k);
    }
  }
  return Array.from(keys);
}

/**
 * Parse a date-like value to a YYYY-MM-DD string in HST.
 * Accepts: Firestore Timestamp, {seconds}, string "YYYY-MM-DD",
 * string like "Wednesday, April 22, 2026", or any Date-parsable string.
 * Returns "" if parsing fails.
 */
function toHstDateKey(value) {
  if (!value) return "";
  let d;
  try {
    if (value && typeof value === "object" && typeof value.toDate === "function") {
      d = value.toDate();
    } else if (value && typeof value === "object" && value.seconds) {
      d = new Date(value.seconds * 1000);
    } else if (typeof value === "string") {
      // Strict YYYY-MM-DD: treat as HST-local midnight to avoid UTC shift.
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        d = new Date(value + "T00:00:00-10:00");
      } else {
        d = new Date(value);
      }
    } else {
      d = new Date(value);
    }
    if (!d || isNaN(d.getTime())) return "";
  } catch (_) {
    return "";
  }
  // Format in HST
  const y = d.toLocaleString("en-US", { year: "numeric", timeZone: "Pacific/Honolulu" });
  const m = d.toLocaleString("en-US", { month: "2-digit", timeZone: "Pacific/Honolulu" });
  const day = d.toLocaleString("en-US", { day: "2-digit", timeZone: "Pacific/Honolulu" });
  return `${y}-${m}-${day}`;
}

/**
 * Given a YYYY-MM-DD string, return { dayName, formatted } in HST.
 * e.g. { dayName: "Wednesday", formatted: "April 22, 2026" }
 */
function formatHstDateParts(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return { dayName: "", formatted: ymd || "" };
  const d = new Date(ymd + "T00:00:00-10:00");
  if (isNaN(d.getTime())) return { dayName: "", formatted: ymd };
  const dayName = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "Pacific/Honolulu" });
  const formatted = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "Pacific/Honolulu" });
  return { dayName, formatted };
}

/**
 * Add N days to a YYYY-MM-DD string (HST) and return a new YYYY-MM-DD.
 */
function addDaysHst(ymd, days) {
  const d = new Date(ymd + "T00:00:00-10:00");
  d.setDate(d.getDate() + days);
  return toHstDateKey(d);
}

// ── Stage 3b-1: server-side session accessors ─────────────────────
// Mirror of the LDAH-Internal client helpers (_parseSessionString /
// _buildSessionsForOneTimeEvent / _buildSessionsForRecurringEvent /
// _getEventSessions / _getEventDateKeys), plus a new getSignupSessions
// helper that filters event sessions[] down to the entries this
// signup is attending. These are DORMANT in Stage 3b-1 — no email
// CF wires them up yet. Stage 3b-2 will migrate the email CFs one
// at a time. Every helper is non-throwing; failures degrade to [].

/** Classify a location string as virtual or in-person. */
function _sessionsModalityFor(location) {
  return /\b(zoom|virtual|online|webinar)\b/i.test(String(location || ""))
    ? "virtual" : "in-person";
}

/**
 * Parse a single signupDates[]-style raw entry to a structured session
 * record. Mirrors the client-side _parseSessionString shape:
 *   { dateKey, startTime, endTime, location, modality, rawString }
 * Returns null when the date can't be parsed. Wrapped in try/catch —
 * a single bad entry never throws.
 *
 * Inputs supported:
 *   • Connect-Gen pipe form  "YYYY-MM-DD|venue|5:00 pm-6:00 pm"
 *   • Learning Labs form     "May 6, 2026, 5:00 pm-6:00 pm"
 *   • Plain ISO date string  "2026-05-06"
 *   • Any Date-parsable form (Firestore Timestamp, etc.)
 */
function parseSessionString(rawString, fallbackLocation) {
  try {
    if (rawString == null) return null;
    const raw = String(rawString);

    // 1. Date — pipe form vs. Learning-Labs/plain form.
    let dateKey = "";
    let rest = "";
    let locFromEntry = "";
    if (raw.indexOf("|") !== -1) {
      const parts = raw.split("|");
      dateKey = toHstDateKey((parts[0] || "").trim());
      locFromEntry = (parts[1] || "").trim();
      rest = (parts[2] || "").trim();
    } else {
      dateKey = parseEventDateKey(raw);
      // Strip the date prefix to isolate "5:00 pm-6:00 pm[ | loc]" tail.
      rest = raw.replace(/^[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4}\s*,?\s*/, "").trim();
      if (rest.indexOf("|") !== -1) {
        const pieces = rest.split("|");
        rest = pieces[0].trim();
        locFromEntry = (pieces[1] || "").trim();
      }
    }
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;

    const location = locFromEntry || String(fallbackLocation || "").trim();

    // 2. Time range. Tolerate hyphen, en-dash, em-dash, missing seconds,
    // and ":mm" absent ("5 pm-6 pm"). The minutes default to "00" when
    // omitted so server output is stable HH:MM 24h.
    const toHHMM = (h, mn, ap) => {
      let hh = parseInt(h, 10);
      const ampm = String(ap || "").toLowerCase();
      const mins = (mn == null || mn === "") ? "00" : String(mn).padStart(2, "0");
      if (isNaN(hh)) return null;
      if (ampm === "pm" && hh < 12) hh += 12;
      if (ampm === "am" && hh === 12) hh = 0;
      return String(hh).padStart(2, "0") + ":" + mins;
    };
    let startTime = null;
    let endTime = null;
    const rangeRe = /(\d{1,2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]?\.?)?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]?\.?)?/;
    const rm = rest.match(rangeRe);
    if (rm) {
      const sAp = String(rm[3] || rm[6] || "").replace(/\./g, "");
      const eAp = String(rm[6] || rm[3] || "").replace(/\./g, "");
      startTime = toHHMM(rm[1], rm[2], sAp.charAt(0).toLowerCase() + (sAp.length > 1 ? "m" : ""));
      endTime = toHHMM(rm[4], rm[5], eAp.charAt(0).toLowerCase() + (eAp.length > 1 ? "m" : ""));
    } else {
      const single = rest.match(/(\d{1,2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]?\.?)/);
      if (single) {
        const ap = String(single[3] || "").replace(/\./g, "");
        startTime = toHHMM(single[1], single[2], ap.charAt(0).toLowerCase() + (ap.length > 1 ? "m" : ""));
      }
    }

    return {
      dateKey,
      startTime,
      endTime,
      location,
      modality: _sessionsModalityFor(location),
      rawString: raw,
    };
  } catch (err) {
    console.warn("parseSessionString: failed", err && err.message, rawString);
    return null;
  }
}

/**
 * Build sessions[] for a one-time event. Prefers event.signupDates (multi-date
 * one-time events like Learning Labs) and falls back to a single entry
 * derived from event.eventDate + event.startTime/endTime/time. Returns []
 * when nothing parses. Mirrors client _buildSessionsForOneTimeEvent.
 */
function buildSessionsForOneTimeEvent(event) {
  try {
    if (!event) return [];
    const fallbackLoc = event.location || "";
    const out = [];
    if (Array.isArray(event.signupDates) && event.signupDates.length > 0) {
      for (const entry of event.signupDates) {
        const sess = parseSessionString(entry, fallbackLoc);
        if (sess) out.push(sess);
      }
      if (out.length > 0) return out;
    }
    if (event.eventDate || event.date) {
      const dateKey = toHstDateKey(event.eventDate || event.date);
      if (dateKey) {
        const toHHMM = (raw) => {
          if (!raw) return null;
          const m = String(raw).match(/^(\d{1,2}):(\d{2})/);
          if (!m) return null;
          return m[1].padStart(2, "0") + ":" + m[2];
        };
        out.push({
          dateKey,
          startTime: toHHMM(event.startTime || event.time),
          endTime: toHHMM(event.endTime),
          location: fallbackLoc,
          modality: _sessionsModalityFor(fallbackLoc),
          rawString: String(event.eventDate || event.date),
        });
      }
    }
    return out;
  } catch (err) {
    console.warn("buildSessionsForOneTimeEvent: failed", err && err.message, event && event.id);
    return [];
  }
}

/**
 * Project a recurring event's schedules[] across [fromDateKey, toDateKey],
 * skipping dates listed in event.cancelledDates. Defaults to today HST
 * through +90 days when opts is omitted. Mirrors client
 * _buildSessionsForRecurringEvent. Tolerates schedule.dayOfWeek as either
 * a 0-6 number OR a weekday name string ("Monday"-"Sunday").
 */
function buildSessionsForRecurringEvent(event, opts) {
  try {
    if (!event || !Array.isArray(event.schedules) || event.schedules.length === 0) return [];
    opts = opts || {};
    const todayKey = toHstDateKey(new Date());
    const fromKey = opts.fromDateKey || todayKey;
    const toKey = opts.toDateKey || addDaysHst(todayKey, 90);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromKey) || !/^\d{4}-\d{2}-\d{2}$/.test(toKey)) return [];

    // Day-of-week name → number lookup. Matches what the LDAH-Int CMS writes.
    const DOW_NAME_TO_NUM = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    };
    const normalizeDow = (raw) => {
      if (raw == null) return null;
      if (typeof raw === "number" && raw >= 0 && raw <= 6) return raw;
      const n = parseInt(raw, 10);
      if (!isNaN(n) && n >= 0 && n <= 6) return n;
      const lookup = DOW_NAME_TO_NUM[String(raw).trim().toLowerCase()];
      return (lookup == null) ? null : lookup;
    };

    const cancelled = Array.isArray(event.cancelledDates) ? event.cancelledDates : [];
    const isCancelled = (dateKey, sch) => {
      return cancelled.some((cd) => {
        if (!cd) return false;
        if (typeof cd === "string") return cd === dateKey;
        if (cd.date !== dateKey) return false;
        if (!cd.location) return true;
        if (cd.location !== (sch.location || "")) return false;
        if (cd.venue && cd.venue !== (sch.venue || "")) return false;
        return true;
      });
    };

    const toHHMM = (raw) => {
      if (!raw) return null;
      const mm = String(raw).match(/^(\d{1,2}):(\d{2})/);
      if (!mm) return null;
      return mm[1].padStart(2, "0") + ":" + mm[2];
    };

    // Iterate days in [fromKey, toKey]. Build dates as HST-local midnight so
    // getDay() returns the correct HST weekday (no UTC shift bugs).
    const out = [];
    let cursor = fromKey;
    let guard = 0;
    while (cursor <= toKey && guard < 4000) {
      guard++;
      const [cy, cm, cd] = cursor.split("-").map((n) => parseInt(n, 10));
      const cursorDate = new Date(cy, cm - 1, cd); // local-midnight is fine for getDay()
      const dow = cursorDate.getDay();
      const dayOfMonth = cursorDate.getDate();
      const weekNum = Math.ceil(dayOfMonth / 7);

      for (const sch of event.schedules) {
        if (!sch) continue;
        const schDow = normalizeDow(sch.dayOfWeek);
        if (schDow == null || schDow !== dow) continue;
        let match = false;
        if (!sch.frequency || sch.frequency === "weekly") match = true;
        else if (sch.frequency === "monthly-nth") {
          if (weekNum === sch.weekOfMonth) match = true;
        } else {
          // Unknown frequency — default to weekly to avoid silent skips.
          match = true;
        }
        if (!match) continue;
        if (isCancelled(cursor, sch)) continue;
        const loc = sch.location || "";
        out.push({
          dateKey: cursor,
          startTime: toHHMM(sch.startTime),
          endTime: toHHMM(sch.endTime),
          location: loc,
          modality: _sessionsModalityFor(loc),
          rawString: cursor + "|" + loc + "|" + (sch.startTime || "") + "-" + (sch.endTime || ""),
        });
      }
      cursor = addDaysHst(cursor, 1);
      if (!cursor) break;
    }

    out.sort((a, b) => {
      if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
      return String(a.startTime || "").localeCompare(String(b.startTime || ""));
    });
    return out;
  } catch (err) {
    console.warn("buildSessionsForRecurringEvent: failed", err && err.message, event && event.id);
    return [];
  }
}

/**
 * Preferred accessor: returns a structured sessions[] for any event.
 * Priority order (matches LDAH-Internal _getEventSessions):
 *   1. event.sessions[] non-empty (Stage 1 canonical array on the doc)
 *   2. recurring projection (if event has schedules[] or opts.isRecurring)
 *   3. one-time fallback via buildSessionsForOneTimeEvent
 *   4. last-resort synthesis from event.eventDate + event.startTime/time
 *   5. [] if nothing parses
 * Always returns an array; never throws. opts: { fromDateKey, toDateKey,
 * isRecurring } — date keys bound the recurring projector window.
 */
function getEventSessions(event, opts) {
  opts = opts || {};
  try {
    if (!event) return [];
    if (Array.isArray(event.sessions) && event.sessions.length > 0) {
      return event.sessions;
    }
    const isRecurring = opts.isRecurring === true ||
      event.collection === "recurringEvents" ||
      (Array.isArray(event.schedules) && event.schedules.length > 0);
    if (isRecurring) {
      const rec = buildSessionsForRecurringEvent(event, opts) || [];
      if (rec.length > 0) return rec;
    }
    const one = buildSessionsForOneTimeEvent(event) || [];
    if (one.length > 0) return one;
    // Last-resort synthesis from top-level fields.
    const rawDate = event.eventDate || event.startDate || event.date || null;
    if (rawDate) {
      const dateKey = toHstDateKey(rawDate);
      if (dateKey) {
        const toHHMM = (raw) => {
          if (!raw) return null;
          const m = String(raw).match(/^(\d{1,2}):(\d{2})/);
          if (!m) return null;
          return m[1].padStart(2, "0") + ":" + m[2];
        };
        const loc = event.location || "";
        return [{
          dateKey,
          startTime: toHHMM(event.startTime || event.time),
          endTime: toHHMM(event.endTime),
          location: loc,
          modality: _sessionsModalityFor(loc),
          rawString: String(rawDate),
        }];
      }
    }
    return [];
  } catch (err) {
    console.warn("getEventSessions: unexpected event shape", err && err.message, event && event.id);
    return [];
  }
}

/** Thin wrapper for callers that only need dateKey strings. */
function getEventDateKeys(event, opts) {
  try {
    return getEventSessions(event, opts)
      .map((s) => s && s.dateKey)
      .filter(Boolean);
  } catch (err) {
    console.warn("getEventDateKeys: failed", err && err.message, event && event.id);
    return [];
  }
}

/**
 * Stage 3b-1 NEW: filter event sessions down to the entries THIS signup is
 * attending. This is the central helper the email CFs will adopt in Stage
 * 3b-2 so they iterate the correct sessions for the parent.
 *
 * Algorithm:
 *   1. eventSessions = getEventSessions(event)
 *   2. signupKeys    = extractSignupSessionKeys(signup)
 *   3. Filter eventSessions to those whose dateKey appears in signupKeys.
 *   4. When the signup uses selectedSessions (pipe-delimited Connect-Gen
 *      shape with location embedded), refine multi-session same-day matches
 *      by also matching on location — so a parent who picked Hilo doesn't
 *      get the Oahu session record back.
 *   5. Sort by dateKey ascending. Returns [] if nothing matches.
 *
 * Never throws — wraps in try/catch and degrades to [].
 */
function getSignupSessions(signup, event) {
  try {
    if (!signup || !event) return [];
    const eventSessions = getEventSessions(event) || [];
    if (eventSessions.length === 0) return [];

    const signupKeys = extractSignupSessionKeys(signup);
    if (signupKeys.length === 0) return [];
    const signupKeySet = new Set(signupKeys);

    // Build a per-date location refinement map from selectedSessions (the
    // pipe-delimited Connect-Gen shape carries "YYYY-MM-DD|Location|time").
    // We only refine when a date has 2+ event sessions AND the signup string
    // pins a location — otherwise the date-only match is authoritative.
    const dateLocationMap = {}; // dateKey -> Set of location substrings
    if (Array.isArray(signup.selectedSessions)) {
      for (const raw of signup.selectedSessions) {
        const s = String(raw || "");
        const parts = s.split("|");
        if (parts.length < 2) continue;
        const dk = toHstDateKey((parts[0] || "").trim());
        const loc = (parts[1] || "").trim();
        if (!dk || !loc) continue;
        if (!dateLocationMap[dk]) dateLocationMap[dk] = new Set();
        dateLocationMap[dk].add(loc);
      }
    }
    // Also tolerate selectedDates entries with "@ Location" suffix.
    if (Array.isArray(signup.selectedDates)) {
      for (const raw of signup.selectedDates) {
        const s = String(raw || "");
        if (s.indexOf("@ ") === -1) continue;
        const dk = parseEventDateKey(s);
        const loc = s.split("@ ").slice(1).join("@ ").trim();
        if (!dk || !loc) continue;
        if (!dateLocationMap[dk]) dateLocationMap[dk] = new Set();
        dateLocationMap[dk].add(loc);
      }
    }

    // Group event sessions by dateKey so we can detect same-day duplicates.
    const sessionsByDate = {};
    for (const sess of eventSessions) {
      if (!sess || !sess.dateKey) continue;
      if (!sessionsByDate[sess.dateKey]) sessionsByDate[sess.dateKey] = [];
      sessionsByDate[sess.dateKey].push(sess);
    }

    const out = [];
    for (const dateKey of Object.keys(sessionsByDate)) {
      if (!signupKeySet.has(dateKey)) continue;
      const sessions = sessionsByDate[dateKey];
      const locHints = dateLocationMap[dateKey];
      if (sessions.length === 1 || !locHints || locHints.size === 0) {
        // No ambiguity — push every event session for that date the signup
        // is attending (typically just one).
        for (const sess of sessions) out.push(sess);
        continue;
      }
      // Multiple same-day event sessions AND the signup pinned location(s) —
      // include only those whose location matches a hint (substring either
      // direction, case-insensitive).
      const hintLowers = Array.from(locHints).map((h) => String(h).toLowerCase());
      const matched = sessions.filter((sess) => {
        const sl = String(sess.location || "").toLowerCase();
        if (!sl) return false;
        return hintLowers.some((h) => h === sl || sl.indexOf(h) !== -1 || h.indexOf(sl) !== -1);
      });
      if (matched.length > 0) {
        for (const sess of matched) out.push(sess);
      } else {
        // Fallback: signup picked a location that no event session matches
        // (data drift). Surface all same-day sessions rather than dropping
        // the parent silently.
        for (const sess of sessions) out.push(sess);
      }
    }

    out.sort((a, b) => {
      if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
      return String(a.startTime || "").localeCompare(String(b.startTime || ""));
    });
    return out;
  } catch (err) {
    console.warn("getSignupSessions: failed", err && err.message,
      signup && signup.id, event && event.id);
    return [];
  }
}

/**
 * Build the event reminder email HTML. Mirrors Leilani's template.
 */
function buildEventReminderEmailHtml({
  recipientName, eventTitle, dayName, dateFormatted,
  startTime, endTime, isVirtual, zoomUrl, meetingId, passcode,
  locationLabel, surveyUrl, mode,
  signatureHtml, donateHtml, orgFooterHtml,
}) {
  const virt = !!isVirtual;
  const locLbl = String(locationLabel || "").trim();
  const timeLine = (startTime || endTime)
    ? ` from ${startTime || ""}${endTime ? " to " + endTime : ""}`
    : "";

  const zoomEarlyLine = virt
    ? `<p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">
         We will have the zoom room open 15 minutes early for any questions that you may have.
       </p>`
    : "";

  const seeYouLine = `<p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">
      We are looking forward to seeing you${virt ? " virtually" : ""} on ${dayName}, ${dateFormatted}${timeLine}${!virt && locLbl ? " at " + locLbl : ""}.
    </p>`;

  const belowIsLine = `<p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">
      Below is the ${virt ? "zoom link and " : (locLbl ? "meeting location and " : "")}evaluation survey (${virt ? "To please be completed before logging off" : "please complete after the session"}):
    </p>`;

  const zoomBlock = virt && zoomUrl
    ? `<div style="margin:16px 0;padding:16px 18px;background-color:#f4f8fc;border-left:4px solid #1a3c6e;border-radius:4px;">
         <p style="margin:0 0 4px;font-size:15px;color:#1a3c6e;font-weight:bold;">Join Zoom Meeting</p>
         ${_emailBtn(zoomUrl, "Open Zoom", { bg: "#1a3c6e", align: "left" })}
         ${meetingId ? `<p style="margin:8px 0 0;font-size:14px;color:#333333;">Meeting ID: <strong>${meetingId}</strong></p>` : ""}
         ${passcode ? `<p style="margin:4px 0 0;font-size:14px;color:#333333;">Passcode: <strong>${passcode}</strong></p>` : ""}
       </div>`
    : "";

  const locationBlock = (!virt && locLbl)
    ? `<div style="margin:16px 0;padding:16px 18px;background-color:#f4f8fc;border-left:4px solid #1a3c6e;border-radius:4px;">
         <p style="margin:0 0 6px;font-size:15px;color:#1a3c6e;font-weight:bold;">In-Person Location</p>
         <p style="margin:0;font-size:15px;color:#333333;">${locLbl}</p>
       </div>`
    : "";

  const surveyBlock = `<div style="margin:16px 0;padding:16px 18px;background-color:#fff8e8;border-left:4px solid #c79400;border-radius:4px;">
      <p style="margin:0 0 4px;font-size:15px;color:#8a6600;font-weight:bold;">Evaluation Survey Link</p>
      ${_emailBtn(surveyUrl, "Open Evaluation Survey", { bg: "#c79400", align: "left" })}
    </div>`;

  const linkFooter = _emailLinkFooter([
    virt && zoomUrl ? { label: "Zoom Meeting", href: zoomUrl } : null,
    { label: "Evaluation Survey", href: surveyUrl },
  ]);

  const zoomTroubleLine = virt
    ? `<p style="margin:0 0 16px;font-size:15px;color:#555555;line-height:1.5;">
         If on the day and time of the event, you have trouble getting onto zoom, please contact Leilani at
         <strong>808-479-2604</strong> (Work cellphone).
       </p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">

  <!-- Header -->
  <tr>
    <td style="background-color:#ffffff;padding:28px 32px 20px;text-align:center;border-bottom:3px solid #1a3c6e;">
      <img src="https://www.ldahawaii.org/logo_blue.png" alt="Leadership in Disabilities &amp; Achievement of Hawai'i" width="150" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;">
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="padding:32px;">
      <p style="margin:0 0 16px;font-size:16px;color:#333333;">Aloha, ${recipientName},</p>

      <p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">
        We hope you and your family are doing well. Mahalo Nui Loa for registering for <strong>${eventTitle}</strong>.
      </p>

      ${zoomEarlyLine}

      ${seeYouLine}

      ${belowIsLine}

      ${zoomBlock}

      ${locationBlock}

      ${surveyBlock}

      <p style="margin:16px 0;font-size:15px;color:#555555;line-height:1.5;">
        If you have further questions, please call us at <strong>808-536-9684</strong>. We are here to support you.
      </p>

      ${zoomTroubleLine}

      <p style="margin:24px 0 4px;font-size:15px;color:#333333;line-height:1.5;">With gratitude,</p>
      <p style="margin:0 0 16px;font-size:15px;color:#333333;line-height:1.5;"><strong>LDAH Team</strong></p>

      ${donateHtml || ''}

      ${signatureHtml || ''}

      ${linkFooter}
    </td>
  </tr>

  <!-- Footer -->
  ${orgFooterHtml || ''}

</table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Resolve the recipient-facing "name" from a signup doc.
 */
function resolveReminderRecipientName(signup) {
  const n = (signup && signup.name ? String(signup.name).trim() : "");
  if (n) return n;
  const e = (signup && signup.email ? String(signup.email).trim() : "");
  if (e && e.indexOf("@") > 0) {
    const first = e.split("@")[0].split(/[._-]/)[0];
    if (first) return first;
  }
  return "there";
}

// Resolve which Zoom slot to use for a given event doc.
// settings/zoomDefault holds two sub-objects: programZoom (Connect-Gen and any
// future recurring program flagged with zoomMode='program') and eventZoom
// (everything else — Learning Labs, Parent Talk Cafe, all one-off events).
// Routing is per-event via event.zoomMode, NOT by Firestore collection,
// because Learning Labs lives in `events` and Connect-Gen lives in
// `recurringEvents` — collection alone is the wrong split.
//
// Legacy shape support: docs may still have flat {meetingUrl, meetingId,
// passcode} — treat that as programZoom (the original single-link era was
// always the Connect-Gen link).
//
// Safety fallback: if eventZoom isn't set yet, fall back to programZoom so
// reminder emails never silently lose their link.
function pickZoomForEvent(zoomDoc, event, collection) {
  if (!zoomDoc) return null;
  const hasNested = (s) => s && typeof s === "object" && (s.meetingUrl || s.meetingId || s.passcode);
  const programZoom = hasNested(zoomDoc.programZoom)
    ? zoomDoc.programZoom
    : ((zoomDoc.meetingUrl || zoomDoc.meetingId || zoomDoc.passcode)
        ? { meetingUrl: zoomDoc.meetingUrl || "", meetingId: zoomDoc.meetingId || "", passcode: zoomDoc.passcode || "" }
        : null);
  const eventZoom = hasNested(zoomDoc.eventZoom) ? zoomDoc.eventZoom : null;

  // Resolution rule:
  //   1. If the doc has an explicit zoomMode, honor it.
  //   2. Otherwise default by collection: recurringEvents -> Program Zoom,
  //      events -> Event Zoom. Matches how Daniel categorizes them — adding
  //      a brand-new program automatically inherits Program Zoom.
  let mode;
  if (event && event.zoomMode === "program") mode = "program";
  else if (event && event.zoomMode === "event") mode = "event";
  else mode = (collection === "recurringEvents") ? "program" : "event";

  if (mode === "program") return programZoom || eventZoom; // fallback if program slot empty
  return eventZoom || programZoom;                          // fallback if event slot empty
}

/**
 * Build the full params + send one reminder email. Shared by the
 * scheduled job and the test endpoint. Returns the Resend result.
 */
async function sendOneReminderEmail({
  collection, eventId, signupId, signup, event, sessionDateKey, sessionDateRaw, mode, zoomDefault, skipBcc, cc,
}) {
  const type = collection === "recurringEvents" ? "recurring" : "event";
  const { dayName, formatted } = formatHstDateParts(sessionDateKey);
  const recipientName = resolveReminderRecipientName(signup);
  const eventTitle = (event && event.title) || "an LDAH Event";
  // Per-session time: Connect-Gen / recurring programs carry each session's
  // time on the signup, not the event doc — read it the same way location is.
  const { startTime, endTime } = getSessionTimeForDate(signup, sessionDateKey, event);

  // Per-session virtual detection: parse the signup's own session key for
  // this date (recurring programs have Virtual vs Oahu/Hilo/Kona schedules
  // mixed in one program). Zoom info is only attached when the session is
  // actually virtual; in-person sessions get a location block instead.
  let isVirtual = isSessionVirtual(event, sessionDateKey, signup);

  // Per-attendee override: lets CMS flip this specific signup to in-person
  // or virtual for this specific date without editing the session's default.
  const modeOverride = getModeOverride(signup, sessionDateKey);
  if (modeOverride === "confirmed-in-person") isVirtual = false;
  else if (modeOverride === "confirmed-virtual") isVirtual = true;

  const zoomUrl = isVirtual && zoomDefault && zoomDefault.meetingUrl ? String(zoomDefault.meetingUrl).trim() : "";
  const meetingId = isVirtual && zoomDefault && zoomDefault.meetingId ? String(zoomDefault.meetingId).trim() : "";
  const passcode = isVirtual && zoomDefault && zoomDefault.passcode ? String(zoomDefault.passcode).trim() : "";
  let locationLabel = isVirtual ? "" : getSessionLocationForDate(signup, sessionDateKey);
  // If override flipped this attendee to in-person but the session key had
  // no location component (e.g. virtual-by-default program), fall back to
  // any address on the event/schedule before landing on a safe contact line.
  if (!isVirtual && !locationLabel) {
    const evLoc = String((event && (event.location || event.address)) || "").trim();
    if (evLoc && !/virtual|zoom|online/i.test(evLoc)) {
      locationLabel = evLoc;
    } else if (Array.isArray(event && event.schedules)) {
      for (const sch of event.schedules) {
        const schLoc = String((sch && (sch.location || sch.venue || sch.address)) || "").trim();
        if (schLoc && !/virtual|zoom|online/i.test(schLoc)) { locationLabel = schLoc; break; }
      }
    }
    if (!locationLabel) locationLabel = "Contact LDAH office";
  }

  // sessionDate is REQUIRED in this URL for recurring/multi-date events —
  // without it, the feedback doc gets written with no sessionDate and the
  // Event Summary modal can't attribute it to the right session. Bug
  // surfaced 2026-05-02 (Rommel del Mundo / Connect-Gen 4/30 session).
  //
  // CANONICAL SHAPE: verbatim event.signupDates entry (NOT ISO yyyy-mm-dd).
  // See feedback_canonical-sessiondate.md. Mirror of 2026-05-14 day-of fix
  // (d6b0b24); without sessionDateRaw the 3-day reminder URL splits the
  // Feedback Report into two groups (verbatim from attendance-trigger paths
  // vs ISO from reminder paths). Falls back to ISO only if raw is missing.
  const sessionDateForUrl = sessionDateRaw || sessionDateKey;
  const surveyUrl =
    "https://ldahawaii.org/feedback.html?signupId=" + encodeURIComponent(signupId) +
    "&eventId=" + encodeURIComponent(eventId) +
    "&type=" + encodeURIComponent(type) +
    (sessionDateForUrl ? "&sessionDate=" + encodeURIComponent(sessionDateForUrl) : "");

  const signatureHtml = await buildSignatureBlock('eventCoordinator');
  const donateHtml = await buildDonateBlock('universal');
  const orgFooterHtml = await getOrgFooterHtml();
  const html = buildEventReminderEmailHtml({
    recipientName, eventTitle, dayName, dateFormatted: formatted,
    startTime, endTime, isVirtual, zoomUrl, meetingId, passcode,
    locationLabel, surveyUrl, mode,
    signatureHtml, donateHtml, orgFooterHtml,
  });

  const subject = `Reminder: ${eventTitle} -- ${dayName}, ${formatted}`;

  const fromAddress = process.env.SMTP_FROM || "onboarding@resend.dev";
  const emailType = "event-reminder-3day";

  return sendEmailViaResend({
    from: `LDAH <${fromAddress}>`,
    to: signup.email,
    bcc: skipBcc ? undefined : REMINDER_BCC,
    cc: cc,
    subject,
    html,
    type: emailType,
    relatedEventId: eventId,
    relatedSignupId: signupId,
    recipientName,
  });
}

/**
 * Catch-up reminder: when a signup becomes confirmed (or registration
 * is just added), check whether any of its sessions fall inside the
 * next 3 days. For each one that does and hasn't already received a
 * 3-day reminder, send one immediately. This handles late registrants
 * who would otherwise miss the 3-day window entirely.
 */
async function maybeSendCatchupReminder(change, context, collection) {
  try {
    const before = change.before.data() || {};
    const after = change.after.data() || {};

    // Only care about newly confirmed signups with an email.
    const statusJustConfirmed = before.status !== "confirmed" && after.status === "confirmed";
    const registrationJustAdded = !before.registration && !!after.registration;
    if (!statusJustConfirmed && !registrationJustAdded) return;
    if (after.status !== "confirmed") return;
    if (after.archived === true) return;
    if (!after.email) return;

    const eventId = context.params.eventId;
    const signupId = context.params.signupId;
    const db = admin.firestore();

    // Load event + zoom defaults in parallel
    const [eventSnap, zoomSnap] = await Promise.all([
      db.collection(collection).doc(eventId).get(),
      db.collection("settings").doc("zoomDefault").get(),
    ]);
    if (!eventSnap.exists) return;
    const event = eventSnap.data() || {};
    const zoomDoc = zoomSnap.exists ? (zoomSnap.data() || null) : null;
    const zoomDefault = pickZoomForEvent(zoomDoc, event, collection);

    // Parent Talk Cafe — Zoom reminders never apply; the PTC confirmation
    // email is the only touchpoint.
    if (event.zoomMode === "parent_talk_cafe") {
      return;
    }
    // (Connect-Gen consent gate is applied per-session in the loop below —
    // only virtual sessions require a signed consent.)

    // Determine candidate session dates within [today, today+3] HST.
    const todayKey = toHstDateKey(new Date());
    const windowKeys = {};
    for (let d = 0; d <= 3; d++) {
      const k = addDaysHst(todayKey, d);
      if (k) windowKeys[k] = true;
    }

    let sessionKeys = extractSignupSessionKeys(after);
    if (sessionKeys.length === 0) {
      const key = toHstDateKey(event.eventDate || event.date);
      if (key) sessionKeys = [key];
    }
    const candidateDates = sessionKeys.filter((k) => !!windowKeys[k]);
    if (candidateDates.length === 0) return;

    const existing = (after.sessionReminders && typeof after.sessionReminders === "object")
      ? after.sessionReminders : {};

    // Look up the verbatim signupDates entry per ISO date so the feedback
    // URL carries the canonical shape (2026-05-14 fix, mirrors d6b0b24).
    const rawSessionMap = buildSignupRawSessionMap(after) || {};

    for (const sessionDateKey of candidateDates) {
      if (existing[sessionDateKey] && existing[sessionDateKey].threeDay) continue;
      if (sessionRequiresConsent(event, sessionDateKey, after) && !after.consentSignedAt) {
        console.log(`catch-up reminder skipped (virtual Connect-Gen, consent unsigned) ${collection}/${eventId}/${signupId} ${sessionDateKey}`);
        continue;
      }
      try {
        await sendOneReminderEmail({
          collection, eventId, signupId,
          signup: after, event,
          sessionDateKey,
          sessionDateRaw: rawSessionMap[sessionDateKey] || "",
          mode: "3day", zoomDefault,
        });
        await change.after.ref.set({
          sessionReminders: {
            [sessionDateKey]: {
              threeDay: admin.firestore.FieldValue.serverTimestamp(),
            },
          },
        }, { merge: true });
        console.log(`catch-up reminder sent to ${after.email} for ${collection}/${eventId} on ${sessionDateKey}`);
      } catch (sendErr) {
        console.error(`catch-up reminder send failed for ${collection}/${eventId}/${signupId} on ${sessionDateKey}:`, sendErr.message);
      }
    }
  } catch (err) {
    // Never fail — log and move on
    console.error(`maybeSendCatchupReminder error (${collection}/${context.params.eventId}/${context.params.signupId}):`, err.message);
  }
}

// Scheduled daily at 7 AM HST.
// Stage 3b-2 step 2 (2026-05-11): primary session-derivation now flows
// through getSignupSessions(signup, event) — the canonical accessor added
// in Stage 3b-1. Falls back to legacySessionsForSignup() on empty result
// so signups attached to events with non-standard shapes are never
// silently dropped. Idempotency key shape is unchanged
// (signup.sessionReminders[<dateKey>].threeDay) so existing dedupe state
// continues to match. Window logic (3 days out, HST) is preserved verbatim.
exports.sendEventReminders = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1, secrets: EMAIL_SECRETS })
  .pubsub.schedule("0 16 * * *")
  .timeZone("Pacific/Honolulu")
  .onRun(async (context) => {
    const db = admin.firestore();

    // 1. Load zoom defaults doc (gracefully handle missing). The doc holds
    // both programZoom and eventZoom slots; pickZoomForEvent() picks
    // the right one per signup based on the event's own zoomMode field.
    let zoomDoc = null;
    try {
      const zSnap = await db.collection("settings").doc("zoomDefault").get();
      if (zSnap.exists) zoomDoc = zSnap.data() || null;
    } catch (err) {
      console.warn("sendEventReminders: failed to read settings/zoomDefault:", err.message);
    }

    // 2. Compute target dates in HST
    const now = new Date();
    const todayKey = toHstDateKey(now);
    const target3d = addDaysHst(todayKey, 3);
    const targetSet = {};
    targetSet[target3d] = "threeDay";

    console.log(`sendEventReminders: today=${todayKey} target3d=${target3d}`);

    let candidates = 0;
    let viaAccessor = 0;
    let viaLegacy = 0;
    let sent = 0;
    let skipped = 0;
    let skippedExisting = 0;

    // Helper: process one signup doc. For each matching session date,
    // send (with dedupe) and update sessionReminders.
    async function processSignup({ collection, eventId, event, signupDoc }) {
      const signup = signupDoc.data() || {};
      const signupId = signupDoc.id;

      // Filter: confirmed, not archived, has email
      if (signup.status !== "confirmed") { skipped++; return; }
      if (signup.archived === true) { skipped++; return; }
      if (!signup.email) { skipped++; return; }

      // (Connect-Gen consent gate is applied per-session in the loop below —
      // only virtual sessions require a signed consent.)

      // Parent Talk Cafe — the confirmation email IS the only reminder.
      if (event && event.zoomMode === "parent_talk_cafe") {
        skipped++;
        return;
      }

      candidates++;

      // Stage 3b-2 primary path: canonical accessor.
      let sessions = getSignupSessions(signup, event);
      let usedLegacy = false;
      if (!sessions || sessions.length === 0) {
        // Defensive fallback — preserves pre-migration behavior for any
        // event/signup combo the accessor can't synthesize from.
        sessions = legacySessionsForSignup(signup, event);
        usedLegacy = sessions.length > 0;
      }
      if (!sessions || sessions.length === 0) return;

      if (usedLegacy) viaLegacy++; else viaAccessor++;

      // Filter to sessions in the 3-day target window. Same semantics as
      // the legacy code's `signupSessionKeys.filter((k) => !!targetSet[k])`
      // but operating on the canonical session entries so downstream code
      // gets startTime/endTime/location/modality without legacy lookups.
      const matching = sessions.filter((s) => s && s.dateKey && !!targetSet[s.dateKey]);
      if (matching.length === 0) return;

      const existing = (signup.sessionReminders && typeof signup.sessionReminders === "object")
        ? signup.sessionReminders : {};

      for (const session of matching) {
        const sessionDateKey = session.dateKey;
        const which = targetSet[sessionDateKey]; // "threeDay"
        const mode = which === "threeDay" ? "3day" : null;
        if (!mode) { skipped++; continue; }
        if (sessionRequiresConsent(event, sessionDateKey, signup) && !signup.consentSignedAt) {
          skipped++;
          continue;
        }
        if (existing[sessionDateKey] && existing[sessionDateKey][which]) {
          skippedExisting++;
          continue;
        }

        try {
          const zoomDefault = pickZoomForEvent(zoomDoc, event, collection);
          await sendOneReminderEmail({
            collection, eventId, signupId, signup, event,
            sessionDateKey,
            // Pass verbatim rawString so the feedback URL embeds the canonical
            // shape that matches event.signupDates (not ISO). 2026-05-14 fix
            // (mirrors d6b0b24 day-of fix).
            sessionDateRaw: (session && session.rawString) || "",
            mode, zoomDefault,
          });
          // Dedupe write — merge so other session keys + the other flag survive.
          await signupDoc.ref.set({
            sessionReminders: {
              [sessionDateKey]: {
                [which]: admin.firestore.FieldValue.serverTimestamp(),
              },
            },
          }, { merge: true });
          sent++;
          console.log(`sendEventReminders: sent ${mode} to ${signup.email} for ${collection}/${eventId} on ${sessionDateKey}`);
        } catch (err) {
          // per-signup guard so a bad row doesn't kill the run
          console.error(`sendEventReminders: failed ${collection}/${eventId}/signups/${signupId} (${mode}) on ${sessionDateKey}:`, err.message);
        }
      }
    }

    // 3. One-time events
    try {
      const eventsSnap = await db.collection("events").get();
      for (const eDoc of eventsSnap.docs) {
        const event = eDoc.data();
        // Build the event's full set of candidate dates (eventDate + parsed
        // signupDates entries) so multi-date events don't get skipped when
        // the primary eventDate isn't in the 3-day target window.
        const candidateKeys = extractEventCandidateDateKeys(event);
        if (!candidateKeys.some((k) => !!targetSet[k])) continue; // quick skip
        try {
          const sSnap = await db.collection("events").doc(eDoc.id).collection("signups").get();
          for (const sDoc of sSnap.docs) {
            await processSignup({ collection: "events", eventId: eDoc.id, event, signupDoc: sDoc });
          }
        } catch (err) {
          console.error(`sendEventReminders: failed to list signups for events/${eDoc.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error("sendEventReminders: events scan failed:", err.message);
    }

    // 4. Recurring events
    try {
      const recSnap = await db.collection("recurringEvents").get();
      for (const eDoc of recSnap.docs) {
        const event = eDoc.data();
        if (event && event.active === false) continue;
        try {
          const sSnap = await db.collection("recurringEvents").doc(eDoc.id).collection("signups").get();
          for (const sDoc of sSnap.docs) {
            await processSignup({ collection: "recurringEvents", eventId: eDoc.id, event, signupDoc: sDoc });
          }
        } catch (err) {
          console.error(`sendEventReminders: failed to list signups for recurringEvents/${eDoc.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error("sendEventReminders: recurringEvents scan failed:", err.message);
    }

    console.log(`sendEventReminders: candidates=${candidates}, viaAccessor=${viaAccessor}, viaLegacy=${viaLegacy}, sent=${sent}, skippedExisting=${skippedExisting}, skipped=${skipped}`);
    return null;
  });

// ── Day-of reminder ────────────────────────────────────────────
// Hourly cron at :30 (Pacific/Honolulu). For each confirmed,
// non-archived signup, find sessions whose start time falls in
// [now+15min, now+45min] HST and send a "just in case" email
// lifted (subject + body) from send-learninglabs-justincase-2026-05-06.js.

/**
 * Build a per-signup map of dateKey -> raw session entry. The raw entry
 * preserves the original time portion so the day-of cron can compute the
 * actual session start time in HST. Pairs with extractSessionStartHst().
 */
function buildSignupRawSessionMap(signup) {
  const map = {};
  if (!signup) return map;
  const entries = []
    .concat(Array.isArray(signup.selectedDates) ? signup.selectedDates : [])
    .concat(Array.isArray(signup.selectedSessions) ? signup.selectedSessions : []);
  for (const raw of entries) {
    const s = String(raw || "");
    let key = "";
    if (s.indexOf("|") !== -1) {
      key = toHstDateKey(s.split("|")[0].trim());
    } else {
      key = parseEventDateKey(s);
    }
    if (key && !map[key]) map[key] = s;
  }
  return map;
}

/**
 * Pick a "this morning / afternoon / tonight" subject phrase based on the
 * session's HST start hour.
 */
function _dayOfSubjectPhrase(startHst) {
  if (!startHst || isNaN(startHst.getTime())) return "See you soon";
  const hourStr = startHst.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Pacific/Honolulu" });
  const hour = parseInt(hourStr, 10);
  if (isNaN(hour)) return "See you soon";
  if (hour < 12) return "See you this morning";
  if (hour < 17) return "See you this afternoon";
  return "See you tonight";
}

/**
 * Day-of "just in case" email. Body lifted verbatim from
 * functions/send-learninglabs-justincase-2026-05-06.js (kept untouched
 * as historical record). Subject is time-aware — picks morning/afternoon/
 * tonight based on the session's HST start hour.
 */
function buildDayOfEmail({
  name, eventTitle, startTime, endTime, isVirtual, locationLabel,
  zoomUrl, meetingId, passcode,
  feedbackUrl, donateHtml, signatureHtml, orgFooterHtml,
}) {
  const greetingName = _emailEsc(name || "there");
  const safeTitle = _emailEsc(eventTitle || "your LDAH session");
  const timeRange = startTime
    ? (endTime ? `${_emailEsc(startTime)} – ${_emailEsc(endTime)} HST` : `${_emailEsc(startTime)} HST`)
    : "";
  const virt = !!isVirtual && !!zoomUrl;

  // Virtual: Zoom button + meeting details block. In-person: location block.
  const zoomDetailsBlock = (virt && (meetingId || passcode))
    ? `<div style="margin:14px 0 0;padding:12px 16px;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:6px;font-size:13px;color:#0C4A6E;line-height:1.6;">
         ${meetingId ? `<div><strong>Meeting ID:</strong> ${_emailEsc(meetingId)}</div>` : ""}
         ${passcode ? `<div><strong>Passcode:</strong> ${_emailEsc(passcode)}</div>` : ""}
       </div>`
    : "";
  const zoomButton = virt
    ? _emailBtn(zoomUrl, "Join the Zoom Session", { bg: "#0891B2", align: "center" })
    : "";
  const locBlock = (!virt && locationLabel)
    ? `<div style="margin:14px 0 0;padding:14px 16px;background:#F4F8FC;border-left:4px solid #1A3C6E;border-radius:6px;font-size:15px;color:#1A3C6E;line-height:1.6;">
         <div style="font-weight:bold;margin-bottom:4px;">In-person session</div>
         <div>${_emailEsc(locationLabel)}</div>
       </div>`
    : "";

  // Subject-paragraph copy is virtual-aware: "your Zoom link" vs "the details".
  const reminderLine = virt
    ? `<strong>Just in case the earlier confirmation got buried in your inbox</strong>, here's your Zoom link one more time so it's easy to find when you're ready to join.`
    : `<strong>Just in case the earlier confirmation got buried in your inbox</strong>, here are the details one more time so they're easy to find. We look forward to seeing you in person${locationLabel ? ` at <strong>${_emailEsc(locationLabel)}</strong>` : ""}.`;

  const linkRows = [
    virt ? { label: "Join the Zoom Session", href: zoomUrl } : null,
    { label: "Share After-Session Feedback", href: feedbackUrl },
  ].filter(Boolean);

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
        We are so excited to see you in just a little while at <strong>${safeTitle}</strong>${timeRange ? `, today at <strong>${timeRange}</strong>` : ""}!
      </p>

      <p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">
        ${reminderLine}
      </p>

      ${zoomButton}

      ${zoomDetailsBlock}

      ${locBlock}

      <p style="margin:28px 0 8px;font-size:16px;color:#333333;line-height:1.5;">
        <strong>After the session</strong>, we would love to hear how it went. Your feedback helps us shape every session that comes next — it only takes a minute.
      </p>

      ${_emailBtn(feedbackUrl, "Share After-Session Feedback", { bg: "#004E7C", align: "center" })}

      <p style="margin:24px 0 0;font-size:15px;color:#555555;line-height:1.5;">
        Mahalo nui for being part of our LDAH 'ohana — it means the world to us, and to the families we serve together.
      </p>

      ${donateHtml || ""}

      ${_emailLinkFooter(linkRows)}

      ${signatureHtml || ""}
    </td>
  </tr>

  ${orgFooterHtml || `
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
  </tr>`}

</table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Build params + send one day-of "just in case" email. Shared by the
 * scheduled hourly job and the test endpoint.
 */
async function sendOneDayOfReminderEmail({
  collection, eventId, signupId, signup, event, sessionDateKey, sessionDateRaw, startHst, zoomDefault, skipBcc, cc,
}) {
  const type = collection === "recurringEvents" ? "recurring" : "event";
  const recipientName = resolveReminderRecipientName(signup);
  const eventTitle = (event && event.title) || "an LDAH Event";
  // Per-session time: Connect-Gen / recurring programs carry each session's
  // time on the signup, not the event doc — read it the same way location is.
  const { startTime, endTime } = getSessionTimeForDate(signup, sessionDateKey, event);

  // CRITICAL: per-session virtual/in-person check. Connect-Gen has mixed
  // schedules (Thursdays in-person, other days Zoom) — without this gate,
  // every day-of email shipped a Zoom link including for in-person sessions.
  const isVirtual = isSessionVirtual(event, sessionDateKey, signup);
  const locationLabel = isVirtual ? "" : (getSessionLocationForDate(signup, sessionDateKey) || (event && event.location) || "");

  const zoomUrl = isVirtual && zoomDefault && zoomDefault.meetingUrl ? String(zoomDefault.meetingUrl).trim() : "";
  const meetingId = isVirtual && zoomDefault && zoomDefault.meetingId ? String(zoomDefault.meetingId).trim() : "";
  const passcode = isVirtual && zoomDefault && zoomDefault.passcode ? String(zoomDefault.passcode).trim() : "";

  // Survey URL — must include sessionDate for proper feedback grouping.
  // CANONICAL SHAPE: verbatim event.signupDates entry (NOT ISO yyyy-mm-dd).
  // See feedback_canonical-sessiondate.md. Prior bug (fixed 2026-05-14)
  // wrote ISO here, which split the Feedback Report into two groups
  // (e.g. "Session: May 13, 2026, 5:00 pm - 6:00 pm" + "Session: 2026-05-13").
  // Falls back to ISO sessionDateKey ONLY if the verbatim string is unavailable.
  const sessionDateForUrl = sessionDateRaw || sessionDateKey;
  const surveyUrl =
    "https://ldahawaii.org/feedback.html?signupId=" + encodeURIComponent(signupId) +
    "&eventId=" + encodeURIComponent(eventId) +
    "&type=" + encodeURIComponent(type) +
    (sessionDateForUrl ? "&sessionDate=" + encodeURIComponent(sessionDateForUrl) : "");

  const signatureHtml = await buildSignatureBlock('eventCoordinator');
  const donateHtml = await buildDonateBlock('universal');
  const orgFooterHtml = await getOrgFooterHtml();
  const html = buildDayOfEmail({
    name: recipientName, eventTitle, startTime, endTime,
    isVirtual, locationLabel,
    zoomUrl, meetingId, passcode,
    feedbackUrl: surveyUrl,
    donateHtml, signatureHtml, orgFooterHtml,
  });

  const phrase = _dayOfSubjectPhrase(startHst);
  const subject = isVirtual
    ? `${phrase} -- ${eventTitle} Zoom link inside`
    : `${phrase} -- ${eventTitle}`;

  const fromAddress = process.env.SMTP_FROM || "onboarding@resend.dev";

  return sendEmailViaResend({
    from: `LDAH <${fromAddress}>`,
    to: signup.email,
    bcc: skipBcc ? undefined : REMINDER_BCC,
    cc: cc,
    subject,
    html,
    type: "event-reminder-dayof",
    relatedEventId: eventId,
    relatedSignupId: signupId,
    recipientName,
  });
}

/**
 * Stage 3b-2 (step 1) — legacy session-derivation factored out of
 * sendDayOfReminders. Returns canonical-shape session entries built from
 * the pre-3b-1 helpers (buildSignupRawSessionMap + extractSessionStartHst
 * + getSessionLocationForDate + isSessionVirtual). Used as a defensive
 * fallback when getSignupSessions(signup, event) returns [] for a signup
 * whose event has a non-standard shape that hasn't been re-saved since
 * Stage 1. Mirrors the canonical shape so the caller can treat both paths
 * uniformly: { dateKey, startTime, endTime, location, modality, rawString }.
 *
 * startTime is left null when the legacy helper cannot derive it — the
 * caller falls back to extractSessionStartHst for window math, which is
 * exactly how the pre-migration code behaved.
 */
function legacySessionsForSignup(signup, event) {
  if (!signup || !event) return [];
  const sessionMap = buildSignupRawSessionMap(signup) || {};
  let dateKeys = Object.keys(sessionMap);
  if (dateKeys.length === 0) {
    const key = toHstDateKey((event && (event.eventDate || event.date)) || null);
    if (key) {
      dateKeys = [key];
      sessionMap[key] = ""; // forces extractSessionStartHst to use event.startTime
    }
  }
  const out = [];
  for (const dateKey of dateKeys) {
    if (!dateKey) continue;
    const rawString = sessionMap[dateKey] || "";
    const location = getSessionLocationForDate(signup, dateKey) || (event.location || "");
    const isVirtual = isSessionVirtual(event, dateKey, signup);
    out.push({
      dateKey,
      startTime: null,
      endTime: null,
      location,
      modality: isVirtual ? "virtual" : "in-person",
      rawString,
    });
  }
  return out;
}

// Day-of "just in case" reminder. Cron fires every :00 and :30.
//  - Virtual sessions: email any signup whose session starts in the next
//    15-45 minutes (~30 min before start).
//  - In-person sessions: attendees travel to the venue, so email at the
//    first run at/after 8 AM HST instead — well ahead of start.
//
// Stage 3b-2 step 1 (2026-05-11): primary session-derivation now flows
// through getSignupSessions(signup, event) — the canonical accessor added
// in Stage 3b-1. Falls back to legacySessionsForSignup() on empty result
// so signups attached to events with non-standard shapes are never
// silently dropped. Idempotency key remains sessionDateKey (stored at
// signup.sessionReminders[<dateKey>].dayOf) so existing dedupe state
// continues to match.
exports.sendDayOfReminders = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1, secrets: EMAIL_SECRETS })
  .pubsub.schedule("0,30 * * * *")
  .timeZone("Pacific/Honolulu")
  .onRun(async (context) => {
    const db = admin.firestore();

    let zoomDoc = null;
    try {
      const zSnap = await db.collection("settings").doc("zoomDefault").get();
      if (zSnap.exists) zoomDoc = zSnap.data() || null;
    } catch (err) {
      console.warn("sendDayOfReminders: failed to read settings/zoomDefault:", err.message);
    }

    const now = new Date();
    const windowStartMs = now.getTime() + 15 * 60 * 1000;
    const windowEndMs = now.getTime() + 45 * 60 * 1000;
    const todayKey = toHstDateKey(now);
    const hstHour = new Date(now.getTime() - 10 * 3600 * 1000).getUTCHours(); // HST = UTC-10

    let candidates = 0;
    let viaAccessor = 0;
    let viaLegacy = 0;
    let sent = 0;
    let skipped = 0;
    let skippedExisting = 0;

    async function processSignup({ collection, eventId, event, signupDoc }) {
      const signup = signupDoc.data() || {};
      const signupId = signupDoc.id;

      if (signup.status !== "confirmed") { skipped++; return; }
      if (signup.archived === true) { skipped++; return; }
      if (!signup.email) { skipped++; return; }

      // (Connect-Gen consent gate is applied per-session in the loop below.)
      // Parent Talk Cafe — no Zoom reminders.
      if (event && event.zoomMode === "parent_talk_cafe") {
        skipped++;
        return;
      }

      candidates++;

      // Stage 3b-2 primary path: canonical accessor.
      let sessions = getSignupSessions(signup, event);
      let usedLegacy = false;
      if (!sessions || sessions.length === 0) {
        // Defensive fallback — preserves pre-migration behavior for any
        // event/signup combo the accessor can't synthesize from.
        sessions = legacySessionsForSignup(signup, event);
        usedLegacy = sessions.length > 0;
      }
      if (!sessions || sessions.length === 0) return;

      if (usedLegacy) viaLegacy++; else viaAccessor++;

      // Quick narrow: only sessions whose date is today HST. The [+15, +45]
      // minute window cannot cross a date boundary at :30 cron firings
      // except at midnight, where same-day still applies.
      const todaySessions = sessions.filter((s) => s && s.dateKey === todayKey);
      if (todaySessions.length === 0) return;

      const existing = (signup.sessionReminders && typeof signup.sessionReminders === "object")
        ? signup.sessionReminders : {};

      for (const session of todaySessions) {
        const sessionDateKey = session.dateKey;
        try {
          // Virtual Connect-Gen sessions need a signed consent first;
          // in-person sessions do not.
          if (sessionRequiresConsent(event, sessionDateKey, signup) && !signup.consentSignedAt) {
            skipped++;
            continue;
          }
          // Prefer the canonical session's startTime when present; fall
          // back to legacy parse for synthesized/dateless entries.
          const startHst = extractSessionStartHst(session.rawString || sessionDateKey, event);
          if (!startHst) { skipped++; continue; }
          const startMs = startHst.getTime();

          // Virtual → ~30 min before start ([+15,+45] window). In-person →
          // attendees travel, so send at the first run at/after 8 AM HST,
          // as long as the session hasn't started yet.
          const virtual = sessionIsVirtual(event, sessionDateKey, signup);
          const inPerson = !virtual && !!(session && session.location
            && String(session.location).trim());
          if (inPerson) {
            if (hstHour < 8 || startMs <= now.getTime()) { skipped++; continue; }
          } else {
            if (startMs < windowStartMs || startMs > windowEndMs) { skipped++; continue; }
          }

          if (existing[sessionDateKey] && existing[sessionDateKey].dayOf) {
            skippedExisting++;
            continue;
          }

          const zoomDefault = pickZoomForEvent(zoomDoc, event, collection);
          await sendOneDayOfReminderEmail({
            collection, eventId, signupId, signup, event,
            sessionDateKey,
            // Pass verbatim rawString so the feedback URL embeds the canonical
            // shape that matches event.signupDates (not ISO). 2026-05-14 fix.
            sessionDateRaw: (session && session.rawString) || "",
            startHst, zoomDefault,
          });
          await signupDoc.ref.set({
            sessionReminders: {
              [sessionDateKey]: {
                dayOf: admin.firestore.FieldValue.serverTimestamp(),
              },
            },
          }, { merge: true });
          sent++;
          console.log(`sendDayOfReminders: sent dayof to ${signup.email} for ${collection}/${eventId} on ${sessionDateKey}`);
        } catch (err) {
          console.error(`sendDayOfReminders: failed ${collection}/${eventId}/signups/${signupId} on ${sessionDateKey}:`, err.message);
        }
      }
    }

    // 1. One-time events
    try {
      const eventsSnap = await db.collection("events").get();
      for (const eDoc of eventsSnap.docs) {
        const event = eDoc.data();
        const candidateKeys = extractEventCandidateDateKeys(event);
        if (!candidateKeys.includes(todayKey)) continue; // quick skip
        try {
          const sSnap = await db.collection("events").doc(eDoc.id).collection("signups").get();
          for (const sDoc of sSnap.docs) {
            await processSignup({ collection: "events", eventId: eDoc.id, event, signupDoc: sDoc });
          }
        } catch (err) {
          console.error(`sendDayOfReminders: failed to list signups for events/${eDoc.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error("sendDayOfReminders: events scan failed:", err.message);
    }

    // 2. Recurring events
    try {
      const recSnap = await db.collection("recurringEvents").get();
      for (const eDoc of recSnap.docs) {
        const event = eDoc.data();
        if (event && event.active === false) continue;
        try {
          const sSnap = await db.collection("recurringEvents").doc(eDoc.id).collection("signups").get();
          for (const sDoc of sSnap.docs) {
            await processSignup({ collection: "recurringEvents", eventId: eDoc.id, event, signupDoc: sDoc });
          }
        } catch (err) {
          console.error(`sendDayOfReminders: failed to list signups for recurringEvents/${eDoc.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error("sendDayOfReminders: recurringEvents scan failed:", err.message);
    }

    console.log(`sendDayOfReminders: candidates=${candidates}, viaAccessor=${viaAccessor}, viaLegacy=${viaLegacy}, sent=${sent}, skippedExisting=${skippedExisting}, skipped=${skipped}`);
    return null;
  });

// Test endpoint — send one reminder on demand, skip dedupe.
// Restricted by ALLOWED_ORIGIN CORS + an optional token param.
// To enable token gating, set the REMINDER_TEST_TOKEN secret and the
// caller must pass the same value in body.token or ?token=. When the
// secret is not set, the CORS origin restriction is the only gate —
// fine for an admin tool but bump the secret in before widespread use.
exports.sendEventRemindersTest = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 3, secrets: EMAIL_SECRETS })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Max-Age", "3600");

    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const { signupId, eventId, collection, mode } = body;
    const token = body.token || req.query.token;
    const skipBcc = body.skipBcc === true || body.skipBcc === "true";
    const ccList = Array.isArray(body.cc) ? body.cc : (body.cc ? [body.cc] : []);

    // Optional token gate. If REMINDER_TEST_TOKEN is configured at
    // runtime (via environment), require it. Otherwise rely on CORS
    // origin restriction above.
    const expected = process.env.REMINDER_TEST_TOKEN || "";
    if (expected && (!token || token !== expected)) {
      res.status(401).json({ error: "Invalid token" }); return;
    }

    if (!signupId || !eventId || !collection || !mode) {
      res.status(400).json({ error: "Missing signupId, eventId, collection, or mode" });
      return;
    }
    if (collection !== "events" && collection !== "recurringEvents") {
      res.status(400).json({ error: "Invalid collection" });
      return;
    }
    if (mode !== "3day" && mode !== "dayof") {
      res.status(400).json({ error: "mode must be '3day' or 'dayof'" });
      return;
    }

    try {
      const db = admin.firestore();

      // Load zoom defaults doc + the event in parallel so we can resolve
      // the right zoom slot (programZoom vs eventZoom) from event.zoomMode.
      const [zSnap, eventDoc] = await Promise.all([
        db.collection("settings").doc("zoomDefault").get().catch(() => null),
        db.collection(collection).doc(eventId).get(),
      ]);
      if (!eventDoc || !eventDoc.exists) { res.status(404).json({ error: "Event not found" }); return; }
      const event = eventDoc.data() || {};
      const zoomDoc = (zSnap && zSnap.exists) ? (zSnap.data() || null) : null;
      const zoomDefault = pickZoomForEvent(zoomDoc, event, collection);

      const signupDoc = await db.collection(collection).doc(eventId).collection("signups").doc(signupId).get();
      if (!signupDoc.exists) { res.status(404).json({ error: "Signup not found" }); return; }
      const signup = signupDoc.data() || {};
      if (!signup.email) { res.status(400).json({ error: "Signup has no email" }); return; }

      // Pick a session date + raw entry for the subject/body.
      let sessionDateKey = "";
      let rawSessionEntry = "";
      const sessionMap = buildSignupRawSessionMap(signup);
      const allKeys = Object.keys(sessionMap);
      if (allKeys.length > 0) {
        sessionDateKey = allKeys[0];
        rawSessionEntry = sessionMap[sessionDateKey] || "";
      } else {
        sessionDateKey = toHstDateKey(event.eventDate || event.date);
      }
      if (!sessionDateKey) {
        // Fallback: use today in HST so the email still renders sensibly
        const todayKey = toHstDateKey(new Date());
        sessionDateKey = mode === "dayof" ? todayKey : addDaysHst(todayKey, 3);
      }

      if (mode === "dayof") {
        const startHst = extractSessionStartHst(rawSessionEntry, event)
          || extractSessionStartHst(sessionDateKey, event); // fallback uses event.startTime
        const result = await sendOneDayOfReminderEmail({
          collection, eventId, signupId, signup, event,
          sessionDateKey,
          sessionDateRaw: rawSessionEntry,
          startHst, zoomDefault,
          skipBcc: skipBcc,
          cc: ccList,
        });
        res.status(200).json({ success: true, id: (result && result.id) || null, to: signup.email, sessionDateKey });
        return;
      }

      const result = await sendOneReminderEmail({
        collection, eventId, signupId, signup, event,
        sessionDateKey,
        sessionDateRaw: rawSessionEntry,
        mode, zoomDefault,
        skipBcc: skipBcc,
        cc: ccList,
      });

      res.status(200).json({ success: true, id: (result && result.id) || null, to: signup.email, sessionDateKey });
    } catch (err) {
      console.error("sendEventRemindersTest error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

// ── Event Announcement Blast ────────────────────────────────────
// Feature added 2026-04-23 — superAdmin-triggered blast to all contacts
// with email + marketingOptOut: false. One-click unsubscribe compliant
// with CAN-SPAM. Daily cap prevents sender-reputation damage during
// Resend Free tier warm-up.
const ANNOUNCEMENT_DAILY_CAP = 50; // Bump after Resend Pro upgrade

function buildUnsubscribePage({ title, body, ok }) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + ' - LDAH</title>' +
    '<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f5f7fa;margin:0;padding:40px 20px;color:#1f2937}' +
    '.card{max-width:520px;margin:40px auto;background:#fff;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.08);padding:40px 32px;text-align:center}' +
    'h1{color:#004E7C;font-size:24px;margin:0 0 16px}p{color:#475569;font-size:15px;line-height:1.6}' +
    '.icon{width:64px;height:64px;border-radius:50%;background:' + (ok ? '#ecfdf5' : '#fef3c7') + ';display:flex;align-items:center;justify-content:center;margin:0 auto 20px}' +
    '.icon svg{width:32px;height:32px}</style></head><body>' +
    '<div class="card"><div class="icon">' +
    (ok
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="#D97706" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
    ) + '</div><h1>' + title + '</h1><p>' + body + '</p>' +
    '<p style="margin-top:24px;font-size:13px;color:#94a3b8">Leadership in Disabilities and Achievement of Hawai\'i</p>' +
    '</div></body></html>';
}

exports.handleUnsubscribe = functions
  .runWith({ timeoutSeconds: 20, maxInstances: 5 })
  .https.onRequest(async (req, res) => {
    const token = (req.query && req.query.token) ? String(req.query.token).trim() : '';
    if (!token) {
      res.set('Content-Type', 'text/html');
      res.status(400).send(buildUnsubscribePage({
        title: 'Invalid link',
        body: 'This unsubscribe link is missing its token. If you want to stop receiving emails, reply to any LDAH email and we will update you manually.',
        ok: false,
      }));
      return;
    }
    try {
      const snap = await admin.firestore().collection('contacts')
        .where('unsubscribeToken', '==', token).limit(1).get();
      if (snap.empty) {
        res.set('Content-Type', 'text/html');
        res.status(404).send(buildUnsubscribePage({
          title: 'Link not recognized',
          body: 'This unsubscribe link is no longer valid. If you still want to stop receiving emails, reply to any LDAH email and we will update you manually.',
          ok: false,
        }));
        return;
      }
      const contactDoc = snap.docs[0];
      const contact = contactDoc.data();
      await contactDoc.ref.update({
        marketingOptOut: true,
        unsubscribedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      const name = (contact.displayName || contact.firstName || '').trim();
      res.set('Content-Type', 'text/html');
      res.status(200).send(buildUnsubscribePage({
        title: 'You have been unsubscribed',
        body: (name ? name + ', you' : 'You') + ' will no longer receive event announcement emails from LDAH. You will still receive emails about events you have signed up for. Changed your mind? Reply to any past email and we will get you back on the list.',
        ok: true,
      }));
    } catch (err) {
      console.error('handleUnsubscribe error:', err.message);
      res.set('Content-Type', 'text/html');
      res.status(500).send(buildUnsubscribePage({
        title: 'Something went wrong',
        body: 'Please try again later or reply to any LDAH email to unsubscribe manually.',
        ok: false,
      }));
    }
  });

function buildAnnouncementEmailHtml({ event, contact, unsubscribeUrl, eventId, sessionDate }) {
  const displayName = (contact.displayName || '').trim();
  const firstName = displayName ? displayName.split(/\s+/)[0] : 'Friend';
  const title = event.title || 'Upcoming LDAH Event';
  let dateStr = '';
  // For a date-targeted announcement, show the chosen date; otherwise the first.
  if (sessionDate) dateStr = sessionDate;
  else if (Array.isArray(event.signupDates) && event.signupDates[0]) dateStr = event.signupDates[0];
  else if (event.eventDate) dateStr = formatEventDate(event.eventDate);
  else if (event.date) dateStr = formatEventDate(event.date);
  const location = event.location || '';
  const rawDescription = event.description || event.details || '';
  const descTrim = rawDescription.slice(0, 400);
  const descMore = rawDescription.length > 400 ? '...' : '';
  const flyerUrl = event.flyerUrl || event.imageUrl || event.flyer || '';
  // Deep-link straight into the signup modal with name/email/phone pre-filled
  // from the recipient's contact doc (events.html reads these params).
  const signupUrl = 'https://www.ldahawaii.org/events.html' +
    '?eventId=' + encodeURIComponent(eventId || '') +
    '&prefill=' + encodeURIComponent(contact.unsubscribeToken || '') +
    '&autoOpen=1';

  const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1f2937">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff">' +
    '<div style="background-color:#004E7C;background:linear-gradient(135deg,#004E7C,#0891B2);padding:24px;text-align:center;color:#fff">' +
    '<h1 style="margin:0;font-size:22px;font-weight:700">New LDAH Event</h1></div>' +
    (flyerUrl ? '<img src="' + esc(flyerUrl) + '" alt="' + esc(title) + '" style="width:100%;display:block">' : '') +
    '<div style="padding:32px 24px">' +
    '<p style="margin:0 0 16px;font-size:16px">Aloha ' + esc(firstName) + ',</p>' +
    '<h2 style="margin:0 0 12px;color:#004E7C;font-size:24px">' + esc(title) + '</h2>' +
    (dateStr ? '<p style="margin:0 0 8px;color:#475569"><strong>When:</strong> ' + esc(dateStr) + '</p>' : '') +
    (location ? '<p style="margin:0 0 16px;color:#475569"><strong>Where:</strong> ' + esc(location) + '</p>' : '') +
    (descTrim ? '<p style="margin:0 0 24px;color:#334155;line-height:1.6">' + esc(descTrim) + esc(descMore) + '</p>' : '') +
    '<p style="text-align:center;margin:32px 0">' +
    '<a href="' + signupUrl + '" style="background-color:#0891B2;background:linear-gradient(135deg,#0891B2,#0E7490);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">Sign Up</a>' +
    '</p>' +
    _emailLinkFooter([{ label: "Sign Up for " + title, href: signupUrl }]) +
    '</div>' +
    '<div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;font-size:12px;color:#94a3b8;text-align:center">' +
    '<p style="margin:0 0 8px">Leadership in Disabilities and Achievement of Hawai\'i</p>' +
    '<p style="margin:0">You received this because you are in our contact list. <a href="' + unsubscribeUrl + '" style="color:#0891B2">Unsubscribe</a> from future announcements.</p>' +
    '</div></div></body></html>';
}

// Returns minimal contact identity (name + email + phone) for a contact
// matched by their unsubscribeToken. Used by events.html to pre-fill the
// signup modal when someone clicks "Sign Up" in an announcement email.
exports.getContactForPrefill = functions
  .runWith({ timeoutSeconds: 20, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

    const token = (req.query && req.query.token) ? String(req.query.token).trim() : "";
    const emailParam = (req.query && req.query.email) ? String(req.query.email).trim().toLowerCase() : "";

    // Must provide either a token (announcement-email deep-link) or an email (on-blur lookup)
    if (!token && !emailParam) { res.status(400).json({ error: "Missing token or email" }); return; }

    try {
      const db = admin.firestore();
      let doc;

      if (token) {
        // Original path: unsubscribeToken lookup (announcement-email prefill)
        const snap = await db.collection("contacts").where("unsubscribeToken", "==", token).limit(1).get();
        if (snap.empty) { res.status(404).json({ error: "Not found" }); return; }
        doc = snap.docs[0];
      } else {
        // New path: email lookup for on-blur prefill (v62.0.0)
        // If multiple contacts share the email, use the most-recently-updated one.
        const snap = await db.collection("contacts").where("email", "==", emailParam).get();
        if (snap.empty) { res.status(404).json({ error: "Not found" }); return; }
        // Pick most-recently-updated doc
        let best = snap.docs[0];
        snap.docs.forEach(function(d) {
          const dUp = (d.data().updatedAt && d.data().updatedAt.toMillis) ? d.data().updatedAt.toMillis() : 0;
          const bUp = (best.data().updatedAt && best.data().updatedAt.toMillis) ? best.data().updatedAt.toMillis() : 0;
          if (dUp > bUp) best = d;
        });
        doc = best;
      }

      const c = doc.data() || {};

      // preferredContact lives on signup docs, not on contacts historically.
      // Read from contact first; if missing, fall back to most-recent signup
      // by email. Wrapped in try/catch so a missing collection-group index
      // doesn't break the whole prefill.
      let preferredContact = c.preferredContact || "";
      if (!preferredContact && (c.email || emailParam)) {
        try {
          const sigSnap = await db.collectionGroup("signups")
            .where("email", "==", (c.email || emailParam).toLowerCase())
            .get();
          let bestSig = null;
          let bestSigMs = 0;
          sigSnap.forEach(function(d) {
            const sd = d.data();
            const ms = (sd.createdAt && sd.createdAt.toMillis) ? sd.createdAt.toMillis() : 0;
            if (sd.preferredContact && ms >= bestSigMs) {
              bestSigMs = ms;
              bestSig = sd;
            }
          });
          if (bestSig) preferredContact = bestSig.preferredContact || "";
        } catch (e) {
          console.warn("getContactForPrefill: signup fallback failed:", e.message);
        }
      }

      res.status(200).json({
        contactId: doc.id,
        firstName: c.firstName || "",
        lastName: c.lastName || "",
        displayName: c.displayName || "",
        email: c.email || "",
        phone: c.phone || "",
        // Extra fields returned for on-blur prefill (v62.0.0)
        streetAddress: c.streetAddress || "",
        city: c.city || "",
        zipCode: c.zipCode || "",
        reasonForAttending: c.reasonForAttending || "",
        priorTraining: c.priorTraining || "",
        priorTrainingDate: c.priorTrainingDate || "",
        howHeard: c.howHeard || "",
        howHeardOther: c.howHeardOther || "",
        accommodations: c.accommodations || "",
        ethnicity: c.ethnicity || "",
        militaryStatus: c.militaryStatus || "",
        militaryBranch: c.militaryBranch || "",
        role: c.type || c.role || "",
        preferredContact: preferredContact,
      });
    } catch (err) {
      console.error("getContactForPrefill error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

exports.sendEventAnnouncement = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1, secrets: EMAIL_SECRETS })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const { eventId, collection, testMode, testEmail, dryRun, audienceFilter, recipientIds, sessionDate } = req.body || {};
    // Date-targeted announcement (multi-date events): when present, skip only
    // people signed up FOR this date, show this date in the email, and track
    // sent state per date. Absent => event-wide (original behavior).
    const _sessionDate = (typeof sessionDate === 'string' && sessionDate.trim()) ? sessionDate.trim() : null;
    if (!eventId || !collection) { res.status(400).json({ error: 'Missing eventId or collection' }); return; }
    if (collection !== 'events' && collection !== 'recurringEvents') {
      res.status(400).json({ error: 'Invalid collection' });
      return;
    }
    // audienceFilter: 'all' (default, backwards-compat) or 'parents' (strict
    // match on contact.type === 'Parent/Guardian' — see canonical schema doc).
    const _audience = (audienceFilter === 'parents') ? 'parents' : 'all';

    try {
      const db = admin.firestore();
      const eventRef = db.collection(collection).doc(eventId);
      const eventSnap = await eventRef.get();
      if (!eventSnap.exists) { res.status(404).json({ error: 'Event not found' }); return; }
      const event = eventSnap.data();

      let recipients;
      if (testMode) {
        if (!testEmail) { res.status(400).json({ error: 'testMode requires testEmail' }); return; }
        recipients = [{
          id: '__test__',
          displayName: 'Test Recipient',
          email: String(testEmail).trim(),
          unsubscribeToken: 'test-token-noop',
        }];
      } else {
        const contactsSnap = await db.collection('contacts')
          .where('marketingOptOut', '==', false).get();
        recipients = [];
        contactsSnap.forEach(d => {
          const c = d.data();
          const email = (c.email || '').trim();
          if (!email) return;
          if (!c.unsubscribeToken) return;
          // Parents-only filter: STRICT match on canonical 'Parent/Guardian'.
          // Legacy/empty/other types are excluded by design — no backfill.
          if (_audience === 'parents' && (c.type || '').trim() !== 'Parent/Guardian') return;
          const displayName = (c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ')).trim() || 'Friend';
          recipients.push({ id: d.id, displayName, email, unsubscribeToken: c.unsubscribeToken });
        });
        // Guard: if a filter selected zero recipients, fail loudly instead of
        // silently sending to nobody (dryRun returns counts; real send errors).
        if (!dryRun && _audience === 'parents' && recipients.length === 0) {
          res.status(400).json({ error: 'No contacts match the Parents-only filter (type === "Parent/Guardian"). Nothing was sent.' });
          return;
        }
      }

      const recipientColl = eventRef.collection('announcementRecipients');
      const priorSnap = await recipientColl.get();
      const alreadySent = new Set();
      priorSnap.forEach(d => {
        const rd = d.data() || {};
        // Per-date "already emailed": only count prior sends for the SAME date
        // (event-wide sends have sessionDate null). Legacy docs have no
        // recipientId/sessionDate — they read as event-wide (null) keyed by id.
        if ((rd.sessionDate || null) === _sessionDate) alreadySent.add(rd.recipientId || d.id);
      });

      // Skip anyone with an active signup — they already know about it. Match by
      // lowercase email or linked contact id; cancelled/archived signups don't
      // count. For a date-targeted send, skip only people signed up FOR THAT
      // DATE (Option A) so other-date attendees and new contacts stay invitable.
      // Test sends bypass the filter so admins can preview their template.
      const signupEmailSkip = new Set();
      const signupIdSkip = new Set();
      if (!testMode) {
        const signupsSnap = await eventRef.collection('signups').get();
        signupsSnap.forEach(d => {
          const s = d.data() || {};
          if (s.status === 'cancelled' || s.archived === true) return;
          if (_sessionDate) {
            const sel = Array.isArray(s.selectedDates) ? s.selectedDates : [];
            if (sel.indexOf(_sessionDate) === -1) return; // not in this session — fair game
          }
          const e = String(s.email || '').trim().toLowerCase();
          if (e) signupEmailSkip.add(e);
          if (s.linkedContactId) signupIdSkip.add(s.linkedContactId);
        });
      }

      const _isSignedUp = (r) =>
        signupEmailSkip.has(String(r.email || '').trim().toLowerCase()) ||
        signupIdSkip.has(r.id);

      const newRecipients = recipients.filter(r => {
        if (alreadySent.has(r.id)) return false;
        if (_isSignedUp(r)) return false;
        return true;
      });
      // Count ALL eligible recipients who are signed up (by email OR linked
      // contact id), regardless of whether they were already sent — so the
      // "will skip" figure reflects who is on the list and signed up, not just
      // the not-yet-sent subset (which is usually 0 on a re-send).
      const alreadySignedUp = recipients.filter(_isSignedUp).length;

      if (dryRun) {
        res.status(200).json({
          dryRun: true,
          eventTitle: event.title || '(untitled)',
          totalEligible: recipients.length,
          alreadySent: alreadySent.size,
          alreadySignedUp,
          willSendTo: newRecipients.length,
          audienceFilter: _audience,
          // Full recipient list so the modal can show a selectable roster with
          // signed-up rows flagged (green check + locked) and already-emailed
          // rows marked. Sorted by name for a stable display.
          recipients: recipients
            .map(r => ({
              id: r.id,
              displayName: r.displayName,
              email: r.email,
              signedUp: _isSignedUp(r),
              alreadySent: alreadySent.has(r.id),
            }))
            .sort((a, b) => (a.displayName || '').toLowerCase().localeCompare((b.displayName || '').toLowerCase())),
        });
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      const throttleRef = db.collection('system').doc('announcementThrottle').collection('days').doc(today);
      const throttleDoc = await throttleRef.get();
      const sentToday = throttleDoc.exists ? (throttleDoc.data().count || 0) : 0;
      const remaining = ANNOUNCEMENT_DAILY_CAP - sentToday;

      if (remaining <= 0 && !testMode) {
        res.status(429).json({ error: 'Daily announcement cap reached', sentToday, cap: ANNOUNCEMENT_DAILY_CAP });
        return;
      }

      // Who actually gets this send:
      //  - testMode: the single test recipient.
      //  - explicit recipientIds (hand-picked from the modal roster): exactly
      //    those, minus any signed-up (safety rail), regardless of already-sent
      //    so admins can remind people who got the first blast.
      //  - otherwise: the auto list (not already-sent, not signed-up).
      let sendList;
      if (testMode) {
        sendList = newRecipients;
      } else if (Array.isArray(recipientIds) && recipientIds.length) {
        const idSet = new Set(recipientIds);
        sendList = recipients.filter(r => idSet.has(r.id) && !_isSignedUp(r));
      } else {
        sendList = newRecipients;
      }
      const batch = testMode ? sendList : sendList.slice(0, remaining);
      const fromAddress = process.env.SMTP_FROM || 'onboarding@resend.dev';
      const unsubscribeBaseUrl = 'https://us-central1-ldah-932d5.cloudfunctions.net/handleUnsubscribe';

      let sent = 0, failed = 0;
      const failures = [];

      for (const r of batch) {
        try {
          const unsubscribeUrl = unsubscribeBaseUrl + '?token=' + encodeURIComponent(r.unsubscribeToken);
          const html = buildAnnouncementEmailHtml({ event, contact: r, unsubscribeUrl, eventId, sessionDate: _sessionDate });
          await sendEmailViaResend({
            from: 'LDAH <' + fromAddress + '>',
            to: r.email,
            subject: 'New Event: ' + (event.title || 'Upcoming LDAH Event'),
            html,
            type: 'event-announcement',
            relatedEventId: eventId,
            recipientName: r.displayName,
          });
          if (!testMode) {
            // Per-date record so the same contact can be emailed for a
            // different date later. Event-wide sends keep the plain id (back-compat).
            const recDocId = _sessionDate ? (r.id + '::' + _sessionDate.replace(/\//g, '_')) : r.id;
            await recipientColl.doc(recDocId).set({
              recipientId: r.id,
              email: r.email,
              name: r.displayName,
              sentAt: admin.firestore.FieldValue.serverTimestamp(),
              sessionDate: _sessionDate,
            });
          }
          sent++;
        } catch (err) {
          failed++;
          failures.push({ email: r.email, error: err.message });
          console.error('Announcement send failed for ' + r.email + ':', err.message);
        }
      }

      if (!testMode && sent > 0) {
        await throttleRef.set({ count: admin.firestore.FieldValue.increment(sent) }, { merge: true });
        const updates = { announcementRecipientCount: admin.firestore.FieldValue.increment(sent) };
        if (_sessionDate) {
          // Per-date sent map (whole-map set; keys may contain spaces/commas/
          // colons — same as sessionAttendance/recordingEmailSent keys).
          const cur = Object.assign({}, event.announcementSentDates || {});
          const prev = (cur[_sessionDate] && cur[_sessionDate].count) || 0;
          cur[_sessionDate] = { sentAt: admin.firestore.Timestamp.now(), count: prev + sent };
          updates.announcementSentDates = cur;
        } else if (!event.announcementSent) {
          updates.announcementSent = true;
          updates.announcementSentAt = admin.firestore.FieldValue.serverTimestamp();
        }
        await eventRef.update(updates);
      }

      res.status(200).json({
        success: true,
        testMode: !!testMode,
        sent,
        failed,
        failures,
        queued: sendList.length - batch.length,
        sentToday: sentToday + sent,
        cap: ANNOUNCEMENT_DAILY_CAP,
      });
    } catch (err) {
      console.error('sendEventAnnouncement error:', err);
      res.status(500).json({ error: err.message });
    }
  });

// ── Lifecycle Email Notifications (F-1 + F-2) ──────────────────
// Transactional emails (not marketing) sent when signup/event state
// changes in ways the recipient needs to know about. No unsubscribe
// footer: these are operational, directly related to a user action.
//
// F-1 — Signup-scoped emails (fired from onEventSignupUpdated /
//       onRecurringEventSignupUpdated alongside existing handlers):
//   - Cancellation confirmation when status flips to 'cancelled'
//   - Reschedule notice when selectedDates content changes
//
// F-2 — Event-scoped emails (fired from new onEventUpdated /
//       onRecurringEventUpdated triggers):
//   - Event cancelled (one-time): archived/cancelled flipped true
//   - Event rescheduled (one-time): eventDate/signupDates changed
//   - Session cancelled (recurring): new entry added to cancelledDates
//
// SCHEMA DECISIONS:
// - "Event cancelled" = `archived === true` OR `cancelled === true`.
//   Either flag is treated as a cancellation signal.
// - Reason field is read from `cancellationReason` first, then
//   `cancelledReason`, then falls back to "unforeseen circumstances".
// - Idempotency markers live at
//     {collectionName}/{eventId}/eventLifecycleNotifications/{signupId}-{kind}
//   to survive retries and rapid-fire updates without double-sending.
// - One email per recipient per change: priority
//     cancellation > reschedule > session-cancel

const LIFECYCLE_EMAIL_FROM_FALLBACK = "LDAH <registration@ldahawaii.org>";
const LIFECYCLE_SEND_DELAY_MS = 200; // ~5/sec cap for Resend

function lifecycleFromAddress() {
  const raw = (process.env.SMTP_FROM || "").trim();
  if (!raw) return LIFECYCLE_EMAIL_FROM_FALLBACK;
  // Allow either "Name <addr>" or bare addr
  if (raw.indexOf("<") !== -1) return raw;
  return "LDAH <" + raw + ">";
}

function lifecycleEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function lifecycleFirstName(nameLike) {
  const s = String(nameLike || "").trim();
  if (!s) return "Friend";
  return s.split(/\s+/)[0];
}

function lifecycleReason(eventData) {
  const raw = (eventData && (eventData.cancellationReason || eventData.cancelledReason)) || "";
  const s = String(raw).trim();
  return s || "unforeseen circumstances";
}

function lifecycleFormatDateList(dates) {
  if (!dates) return "";
  if (Array.isArray(dates)) return dates.filter(Boolean).map(lifecycleFormatSessionEntry).join(", ");
  return lifecycleFormatSessionEntry(dates);
}

// Convert a Connect-Gen pipe-delimited session key
// ("2026-05-04|Hilo – Venue|10:00 AM – 12:00 PM") into a friendlier
// "Mon, May 4 — 10:00 AM – 12:00 PM @ Hilo – Venue". Plain date strings
// (e.g., Learning Labs / one-time selectedDates) pass through unchanged.
function lifecycleFormatSessionEntry(s) {
  const str = String(s == null ? "" : s).trim();
  if (!str || str.indexOf("|") === -1) return str;
  const parts = str.split("|").map((p) => p.trim());
  const datePart = parts[0] || "";
  const locPart = parts[1] || "";
  const timePart = parts[2] || "";
  let nice = datePart;
  const m = datePart.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    if (!isNaN(d.getTime())) nice = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  let out = nice;
  if (timePart) out += " — " + timePart;
  if (locPart) out += " @ " + locPart;
  return out;
}

// ── Template helpers ────────────────────────────────────────────

// F-1: signup-scoped (cancellation OR reschedule)
function buildLifecycleEmailHtml({ kind, name, eventTitle, oldDates, newDates, signatureHtml, donateHtml }) {
  const firstName = lifecycleFirstName(name);
  const title = lifecycleEsc(eventTitle || "your LDAH event");
  const oldStr = lifecycleEsc(lifecycleFormatDateList(oldDates));
  const newStr = lifecycleEsc(lifecycleFormatDateList(newDates));

  let headerLabel, headerGradient, headerColor, bodyHtml, heading;
  if (kind === "cancellation") {
    headerLabel = "Signup Cancelled";
    headerGradient = "linear-gradient(135deg,#991b1b,#dc2626)";
    headerColor = "#991b1b";
    heading = "Your signup was cancelled";
    bodyHtml =
      '<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.6">' +
        'Your signup for <strong>' + title + '</strong>' +
        (oldStr ? ' on <strong>' + oldStr + '</strong>' : '') +
        ' has been cancelled.' +
      '</p>' +
      '<p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6">' +
        "If this was a mistake, you're welcome to sign up again on our events page. " +
        'Mahalo for letting us know.' +
      '</p>';
  } else {
    headerLabel = "Schedule Update";
    headerGradient = "linear-gradient(135deg,#1e40af,#0891B2)";
    headerColor = "#1e40af";
    heading = "Your session dates have changed";
    bodyHtml =
      '<p style="margin:0 0 12px;font-size:16px;color:#334155;line-height:1.6">' +
        'A heads up about <strong>' + title + '</strong>:' +
      '</p>' +
      (oldStr
        ? '<p style="margin:0 0 8px;font-size:15px;color:#475569"><strong>Previously scheduled:</strong> ' + oldStr + '</p>'
        : '') +
      (newStr
        ? '<p style="margin:0 0 16px;font-size:15px;color:#475569"><strong>Now scheduled:</strong> ' + newStr + '</p>'
        : '') +
      '<p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6">' +
        'No action needed on your end — we just wanted to keep you in the loop. Mahalo.' +
      '</p>';
  }

  // Standard Leilani signature block — mirrors the reminder + recording email
  // templates so all outbound LDAH event emails close with the same contact info.
  bodyHtml +=
    '<p style="margin:24px 0 4px;font-size:15px;color:#333333;line-height:1.5;">If you have any questions, please contact us.</p>' +
    '<p style="margin:0 0 4px;font-size:15px;color:#333333;line-height:1.5;">With gratitude,</p>' +
    '<p style="margin:0 0 16px;font-size:15px;color:#333333;line-height:1.5;"><strong>LDAH Team</strong></p>' +
    (donateHtml || '') +
    (signatureHtml || '');

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + lifecycleEsc(heading) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1f2937">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff">' +
    '<div style="background-color:' + headerColor + ';background:' + headerGradient + ';padding:24px;text-align:center;color:#fff">' +
    '<h1 style="margin:0;font-size:22px;font-weight:700">' + lifecycleEsc(headerLabel) + '</h1></div>' +
    '<div style="padding:32px 24px">' +
    '<p style="margin:0 0 16px;font-size:16px">Aloha ' + lifecycleEsc(firstName) + ',</p>' +
    '<h2 style="margin:0 0 16px;color:#004E7C;font-size:22px">' + lifecycleEsc(heading) + '</h2>' +
    bodyHtml +
    '</div>' +
    '<div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;font-size:12px;color:#94a3b8;text-align:center">' +
    '<p style="margin:0">Leadership in Disabilities and Achievement of Hawai\'i</p>' +
    '</div></div></body></html>';
}

// F-2A: event cancelled (one-time)
function buildEventCancelledEmailHtml({ name, eventTitle, eventDate, reason }) {
  const firstName = lifecycleFirstName(name);
  const title = lifecycleEsc(eventTitle || "your LDAH event");
  const when = lifecycleEsc(eventDate || "");
  const why = lifecycleEsc(reason || "unforeseen circumstances");

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Event Cancelled</title></head>' +
    '<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1f2937">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff">' +
    '<div style="background-color:#991b1b;background:linear-gradient(135deg,#991b1b,#dc2626);padding:24px;text-align:center;color:#fff">' +
    '<h1 style="margin:0;font-size:22px;font-weight:700">Event Cancelled</h1></div>' +
    '<div style="padding:32px 24px">' +
    '<p style="margin:0 0 16px;font-size:16px">Aloha ' + lifecycleEsc(firstName) + ',</p>' +
    '<h2 style="margin:0 0 16px;color:#991b1b;font-size:22px">We\'re sorry</h2>' +
    '<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.6">' +
      '<strong>' + title + '</strong>' +
      (when ? ' scheduled for <strong>' + when + '</strong>' : '') +
      ' has been cancelled due to ' + why + '.' +
    '</p>' +
    '<p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6">' +
      'We appreciate your interest and hope to see you at a future event. If you have questions, please reach out to us at registration@ldahawaii.org.' +
    '</p>' +
    '<p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6">Mahalo for your understanding.</p>' +
    '</div>' +
    '<div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;font-size:12px;color:#94a3b8;text-align:center">' +
    '<p style="margin:0">Leadership in Disabilities and Achievement of Hawai\'i</p>' +
    '</div></div></body></html>';
}

// F-2B: event rescheduled (one-time)
function buildEventRescheduledEmailHtml({ name, eventTitle, oldDate, newDate, reason }) {
  const firstName = lifecycleFirstName(name);
  const title = lifecycleEsc(eventTitle || "your LDAH event");
  const oldStr = lifecycleEsc(oldDate || "");
  const newStr = lifecycleEsc(newDate || "");
  const why = lifecycleEsc(reason || "");

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Event Rescheduled</title></head>' +
    '<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1f2937">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff">' +
    '<div style="background-color:#1e40af;background:linear-gradient(135deg,#1e40af,#0891B2);padding:24px;text-align:center;color:#fff">' +
    '<h1 style="margin:0;font-size:22px;font-weight:700">Event Rescheduled</h1></div>' +
    '<div style="padding:32px 24px">' +
    '<p style="margin:0 0 16px;font-size:16px">Aloha ' + lifecycleEsc(firstName) + ',</p>' +
    '<h2 style="margin:0 0 16px;color:#004E7C;font-size:22px">Heads up &mdash; the date has changed</h2>' +
    '<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.6">' +
      '<strong>' + title + '</strong> has been rescheduled' +
      (why && why !== lifecycleEsc("unforeseen circumstances") ? ' (' + why + ')' : '') +
      '.' +
    '</p>' +
    (oldStr ? '<p style="margin:0 0 8px;font-size:15px;color:#475569"><strong>Previous date:</strong> ' + oldStr + '</p>' : '') +
    (newStr ? '<p style="margin:0 0 16px;font-size:15px;color:#475569"><strong>New date:</strong> ' + newStr + '</p>' : '') +
    '<p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6">' +
      'Your signup has been carried forward. No action needed. If the new date doesn\'t work for you, please let us know at registration@ldahawaii.org.' +
    '</p>' +
    '<p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6">Mahalo.</p>' +
    '</div>' +
    '<div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;font-size:12px;color:#94a3b8;text-align:center">' +
    '<p style="margin:0">Leadership in Disabilities and Achievement of Hawai\'i</p>' +
    '</div></div></body></html>';
}

// F-2C: single session cancelled (recurring)
function buildSessionCancelledEmailHtml({ name, eventTitle, sessionDate, reason }) {
  const firstName = lifecycleFirstName(name);
  const title = lifecycleEsc(eventTitle || "your LDAH program");
  const when = lifecycleEsc(sessionDate || "");
  const why = lifecycleEsc(reason || "unforeseen circumstances");

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Session Cancelled</title></head>' +
    '<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1f2937">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff">' +
    '<div style="background-color:#b45309;background:linear-gradient(135deg,#b45309,#f59e0b);padding:24px;text-align:center;color:#fff">' +
    '<h1 style="margin:0;font-size:22px;font-weight:700">Session Cancelled</h1></div>' +
    '<div style="padding:32px 24px">' +
    '<p style="margin:0 0 16px;font-size:16px">Aloha ' + lifecycleEsc(firstName) + ',</p>' +
    '<h2 style="margin:0 0 16px;color:#b45309;font-size:22px">Just this session</h2>' +
    '<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.6">' +
      'The <strong>' + title + '</strong> session' +
      (when ? ' on <strong>' + when + '</strong>' : '') +
      ' has been cancelled due to ' + why + '.' +
    '</p>' +
    '<p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6">' +
      'Your other sessions for this program are still on the schedule. No action needed.' +
    '</p>' +
    '<p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6">Mahalo for your flexibility.</p>' +
    '</div>' +
    '<div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;font-size:12px;color:#94a3b8;text-align:center">' +
    '<p style="margin:0">Leadership in Disabilities and Achievement of Hawai\'i</p>' +
    '</div></div></body></html>';
}

// ── F-1: signup lifecycle handler ───────────────────────────────
async function handleSignupLifecycleEmails(change, context, collectionName) {
  try {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    const eventId = context.params.eventId;
    const signupId = context.params.signupId;
    const db = admin.firestore();

    const toEmail = (after.email || "").trim();
    if (!toEmail) return;

    // If the event doc is being processed for a fleet-wide cancellation /
    // reschedule, the event-level handler will email instead.
    // We skip this signup-level handler if the signup state changed purely
    // because an event-level lifecycle email was sent to it (marker present).
    // That marker is written by handleEventLifecycleEmails.

    // Detect transitions
    const wasCancelled = before.status === "cancelled";
    const nowCancelled = after.status === "cancelled";
    const justCancelled = !wasCancelled && nowCancelled;

    // Connect-Gen recurring events use selectedSessions (pipe-delimited keys).
    // Learning Labs / one-time use selectedDates. Pick whichever is populated;
    // selectedSessions wins when both shapes coexist.
    const beforeSess = Array.isArray(before.selectedSessions) ? before.selectedSessions.filter(Boolean) : [];
    const afterSess = Array.isArray(after.selectedSessions) ? after.selectedSessions.filter(Boolean) : [];
    const beforeDatesRaw = Array.isArray(before.selectedDates) ? before.selectedDates.filter(Boolean) : [];
    const afterDatesRaw = Array.isArray(after.selectedDates) ? after.selectedDates.filter(Boolean) : [];
    const useSessions = beforeSess.length > 0 || afterSess.length > 0;
    const beforeDates = useSessions ? beforeSess : beforeDatesRaw;
    const afterDates = useSessions ? afterSess : afterDatesRaw;
    const beforeKey = JSON.stringify(beforeDates.slice().sort());
    const afterKey = JSON.stringify(afterDates.slice().sort());
    const datesChanged = beforeDates.length > 0 && afterDates.length > 0 && beforeKey !== afterKey;
    // Skip if the only delta is that new dates were added (sibling sharing) —
    // i.e., afterDates is a strict superset of beforeDates.
    const isPureAdd = beforeDates.every((d) => afterDates.indexOf(d) !== -1) && afterDates.length > beforeDates.length;

    if (!justCancelled && !datesChanged) return;
    if (datesChanged && isPureAdd) {
      // Pure add (e.g., sharing registration to new sessions) — not a reschedule
      if (!justCancelled) return;
    }

    // Priority: cancellation wins over reschedule
    const kind = justCancelled ? "cancellation" : "reschedule";
    if (kind === "reschedule" && nowCancelled) return; // covered by cancel email

    // Fetch event title for subject/body
    let eventTitle = "LDAH Event";
    try {
      const evSnap = await db.collection(collectionName).doc(eventId).get();
      if (evSnap.exists) eventTitle = (evSnap.data() && evSnap.data().title) || eventTitle;
    } catch (_) { /* ignore */ }

    // Idempotency: store the post-update afterKey on the signup so retries of
    // the same Firestore trigger don't double-send, but a *new* reschedule
    // (different key) still emails. Old "_sentAt" timestamp markers from
    // earlier deploys are ignored — those signups will email once more on
    // their next genuine state change, which is the intended behavior.
    const markerField = "lifecycleEmail_" + kind + "_lastKey";
    if (after[markerField] && after[markerField] === afterKey) return;

    const subject = kind === "cancellation"
      ? "Your signup was cancelled — " + eventTitle
      : "Your session dates have changed — " + eventTitle;

    const signatureHtml = await buildSignatureBlock('eventCoordinator');
    const donateHtml = await buildDonateBlock('universal');
    const html = buildLifecycleEmailHtml({
      kind,
      name: after.name || after.displayName || "",
      eventTitle,
      oldDates: beforeDates,
      newDates: afterDates,
      signatureHtml,
      donateHtml,
    });

    try {
      await sendEmailViaResend({
        from: lifecycleFromAddress(),
        to: toEmail,
        subject,
        html,
        type: kind === "cancellation" ? "signup-cancellation" : "signup-reschedule",
        relatedEventId: eventId,
        relatedSignupId: signupId,
        recipientName: after.name || after.displayName || "",
      });
      // Write marker so we don't re-fire on the next unrelated update
      await change.after.ref.set({
        [markerField]: afterKey,
        ["lifecycleEmail_" + kind + "_sentAt"]: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      console.log("lifecycle " + kind + " email sent to " + toEmail + " for " + collectionName + "/" + eventId + "/" + signupId);
    } catch (sendErr) {
      console.error("handleSignupLifecycleEmails send failed (" + collectionName + "/" + eventId + "/" + signupId + "):", sendErr.message);
    }
  } catch (err) {
    console.error("handleSignupLifecycleEmails error (" + collectionName + "/" + context.params.eventId + "/" + context.params.signupId + "):", err.message);
  }
}

// ── F-2: event lifecycle handler ────────────────────────────────

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Escapes a composite session key so it can be used as a Firestore field name.
// Regex MUST match crEscapeSessionKey in LDAH-Internal index.html EXACTLY —
// divergence produces silent lookup misses in the C&R skip-check below.
// Frontend regex: /[.~\/\[\]#?*$ |]/g  (includes pipe and space, preserves en-dash)
function crEscapeSessionKey(key) {
  if (key == null) return "";
  return String(key).replace(/[.~\/\[\]#?*$ |]/g, "_");
}

// Returns true if markerKey (an escaped composite session key written by crApplyDispositions)
// corresponds to the given cancelledEntry ({date, location?, venue?}).
// The key MUST start with escapedDate. If cancelledEntry has no location, any key starting
// with escapedDate matches (legacy date-wide cancel). Otherwise location AND (if present)
// venue must also appear anywhere in the key.
function _markerKeyMatchesCancelledEntry(markerKey, cancelledEntry) {
  if (!markerKey || !cancelledEntry || !cancelledEntry.date) return false;
  var escapedDate = crEscapeSessionKey(cancelledEntry.date);
  if (markerKey.indexOf(escapedDate) !== 0) return false; // must START with the date
  // If the cancelled entry has no location, legacy date-wide cancel — match by date only.
  if (!cancelledEntry.location) return true;
  var escapedLoc = crEscapeSessionKey(cancelledEntry.location);
  if (markerKey.indexOf(escapedLoc) === -1) return false;
  if (cancelledEntry.venue) {
    var escapedVenue = crEscapeSessionKey(cancelledEntry.venue);
    if (markerKey.indexOf(escapedVenue) === -1) return false;
  }
  return true;
}

// Build a human-readable version of an event's one-time date for subjects/body.
function eventDateDisplay(eventData) {
  if (!eventData) return "";
  if (Array.isArray(eventData.signupDates) && eventData.signupDates[0]) return String(eventData.signupDates[0]);
  if (eventData.eventDate) return formatEventDate(eventData.eventDate);
  if (eventData.date) return formatEventDate(eventData.date);
  return "";
}

function oneTimeDatesFingerprint(eventData) {
  if (!eventData) return "";
  const parts = [];
  if (Array.isArray(eventData.signupDates)) parts.push(eventData.signupDates.slice().join("|"));
  else parts.push("");
  // normalize eventDate / date to ISO-ish strings
  const norm = (v) => {
    if (!v) return "";
    if (v.toDate && typeof v.toDate === "function") return v.toDate().toISOString();
    if (v.seconds) return new Date(v.seconds * 1000).toISOString();
    return String(v);
  };
  parts.push(norm(eventData.eventDate));
  parts.push(norm(eventData.date));
  return parts.join("::");
}

async function handleEventLifecycleEmails(change, context, collectionName) {
  try {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    const eventId = context.params.eventId;
    const db = admin.firestore();
    const eventRef = db.collection(collectionName).doc(eventId);

    // Today's date key in HST — used to skip past-only signups so a
    // recurring-program archive doesn't email already-attended registrants.
    // (Daniel's incident 5-29: archiving Connect-Gen emailed 12 past-only.)
    const nowHst = new Date(new Date().toLocaleString("en-US", { timeZone: "Pacific/Honolulu" }));
    const todayKey = nowHst.getFullYear() + "-" + String(nowHst.getMonth()+1).padStart(2,"0") + "-" + String(nowHst.getDate()).padStart(2,"0");

    function _lifecycleSignupHasUpcomingDate(sd, ev) {
      const dates = Array.isArray(sd.selectedDates) ? sd.selectedDates :
                    Array.isArray(sd.selectedSessions) ? sd.selectedSessions : [];
      if (dates.length > 0) {
        return dates.some(function(s){
          const m = String(s).match(/(\d{4}-\d{2}-\d{2})/);
          return m && m[1] >= todayKey;
        });
      }
      // No selectedDates: fall back to the event's own date(s)
      const evDates = Array.isArray(ev && ev.signupDates) ? ev.signupDates : [];
      if (evDates.length > 0) {
        return evDates.some(function(s){
          const m = String(s).match(/(\d{4}-\d{2}-\d{2})/);
          return m && m[1] >= todayKey;
        });
      }
      if (ev && ev.eventDate) {
        const m = String(ev.eventDate).match(/(\d{4}-\d{2}-\d{2})/);
        if (m) return m[1] >= todayKey;
      }
      // Indeterminate — don't filter out (safety).
      return true;
    }

    // Safeguard: don't spam right after an announcement blast.
    if (after.announcementSent && !before.announcementSent) return;

    // Detect transitions
    const wasCancelled = before.archived === true || before.cancelled === true;
    const nowCancelled = after.archived === true || after.cancelled === true;
    const justCancelled = !wasCancelled && nowCancelled;

    const beforeFp = oneTimeDatesFingerprint(before);
    const afterFp = oneTimeDatesFingerprint(after);
    const datesChanged = !justCancelled && beforeFp !== afterFp && afterFp.length > 2;

    const beforeCancelled = Array.isArray(before.cancelledDates) ? before.cancelledDates : [];
    const afterCancelled = Array.isArray(after.cancelledDates) ? after.cancelledDates : [];
    // cancelledDates entries may be plain strings (legacy) or {date,location,venue,reason}
    // objects (written by cmsToggleSessionCancel / crApplyDispositions). Normalize both
    // shapes to a stable fingerprint string so Set-based diff works correctly.
    const _cdFingerprint = (cd) => {
      if (!cd) return "";
      if (typeof cd === "string") return cd;
      return [cd.date || "", cd.location || "", cd.venue || ""].join("|");
    };
    const beforeSet = new Set(beforeCancelled.map(_cdFingerprint));
    // Keep the original entry object so we can reconstruct the session key later.
    const newlyCancelledDates = afterCancelled
      .filter((cd) => { const fp = _cdFingerprint(cd); return fp && !beforeSet.has(fp); });

    if (!justCancelled && !datesChanged && newlyCancelledDates.length === 0) return;

    const eventTitle = after.title || before.title || "LDAH Event";
    const reason = lifecycleReason(after) || lifecycleReason(before);
    const oldDateStr = eventDateDisplay(before);
    const newDateStr = eventDateDisplay(after);

    // Resolve which kind this update represents, in priority order.
    let mode;
    if (justCancelled) mode = "event-cancelled";
    else if (datesChanged) mode = "event-rescheduled";
    else mode = "session-cancelled";

    // Collect signups that need to hear about this.
    const signupsSnap = await eventRef.collection("signups").get();
    const recipients = [];
    signupsSnap.forEach((d) => {
      const sd = d.data() || {};
      if (sd.archived === true) return;
      const email = (sd.email || "").trim();
      if (!email) return;
      if (sd.status === "cancelled") return;
      // Skip past-only signups — they don't need to hear about a cancellation
      // or reschedule that no longer affects them. (Daniel's incident 5-29:
      // archiving a recurring program emailed 12 already-attended registrants.)
      if ((mode === "event-cancelled" || mode === "event-rescheduled") &&
          !_lifecycleSignupHasUpcomingDate(sd, after)) {
        return;
      }
      recipients.push({ id: d.id, data: sd, email });
    });

    if (mode === "event-cancelled" || mode === "event-rescheduled") {
      console.log("handleEventLifecycleEmails(" + collectionName + "/" + eventId + ") mode=" + mode + " recipients=" + recipients.length + " (past-date filtered)");
    }

    if (recipients.length === 0) return;

    const markerColl = eventRef.collection("eventLifecycleNotifications");
    const fromAddr = lifecycleFromAddress();

    if (mode === "event-cancelled" || mode === "event-rescheduled") {
      // Fleet send: one email per recipient.
      const kindKey = mode === "event-cancelled" ? "event-cancelled" : "event-rescheduled";
      for (const r of recipients) {
        const markerId = r.id + "-" + kindKey;
        try {
          const markerSnap = await markerColl.doc(markerId).get();
          if (markerSnap.exists) continue;
        } catch (_) { /* proceed */ }

        let html, subject, typeTag;
        if (mode === "event-cancelled") {
          html = buildEventCancelledEmailHtml({
            name: r.data.name || r.data.displayName || "",
            eventTitle,
            eventDate: oldDateStr || newDateStr,
            reason,
          });
          subject = "Event cancelled: " + eventTitle;
          typeTag = "event-cancelled";
        } else {
          html = buildEventRescheduledEmailHtml({
            name: r.data.name || r.data.displayName || "",
            eventTitle,
            oldDate: oldDateStr,
            newDate: newDateStr,
            reason,
          });
          subject = eventTitle + " has a new date";
          typeTag = "event-rescheduled";
        }

        try {
          await sendEmailViaResend({
            from: fromAddr,
            to: r.email,
            subject,
            html,
            type: typeTag,
            relatedEventId: eventId,
            relatedSignupId: r.id,
            recipientName: r.data.name || r.data.displayName || "",
          });
          await markerColl.doc(markerId).set({
            signupId: r.id,
            kind: kindKey,
            email: r.email,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (sendErr) {
          console.error("handleEventLifecycleEmails send failed (" + collectionName + "/" + eventId + " -> " + r.email + "):", sendErr.message);
        }
        await sleepMs(LIFECYCLE_SEND_DELAY_MS);
      }
    } else if (mode === "session-cancelled") {
      // For each newly cancelled date, email recipients whose selectedDates/selectedSessions
      // include it. newlyCancelledDates entries may be plain strings (legacy) or
      // {date,location,venue,reason} objects (current CMS + C&R modal format).
      for (const cdEntry of newlyCancelledDates) {
        // Normalise: extract the ISO date key and a human-readable label from either shape.
        const _cdIsObj = cdEntry && typeof cdEntry === "object";
        const _cdDateKey = _cdIsObj ? (cdEntry.date || "") : String(cdEntry || "");
        const _cdLabel   = _cdIsObj
          ? [cdEntry.date, cdEntry.location, cdEntry.venue].filter(Boolean).join(" – ")
          : String(cdEntry || "");

        const _m = _cdDateKey.match(/(\d{4}-\d{2}-\d{2})/);
        if (_m && _m[1] < todayKey) {
          console.log("handleEventLifecycleEmails: skipping past session-cancelled date " + _cdDateKey);
          continue;
        }
        if (!_cdDateKey) continue;

        for (const r of recipients) {
          // Match against both selectedDates (bare strings / Learning Labs) and
          // selectedSessions (composite pipe-keys / Connect-Gen). For object-format
          // cancelledDates, a session matches if:
          //   • selectedDates contains the bare date string, OR
          //   • a selectedSessions entry starts with "DATE|" (and location/venue match
          //     when present — match by date prefix is sufficient for the skip-check).
          const _selDates = Array.isArray(r.data.selectedDates) ? r.data.selectedDates.map(String) : [];
          const _selSess  = Array.isArray(r.data.selectedSessions) ? r.data.selectedSessions.map(String) : [];
          const _dateMatch = _selDates.indexOf(_cdDateKey) !== -1;
          // A selectedSessions entry covers this date if it starts with "DATE|".
          const _sessMatch = _selSess.some((sk) => {
            if (!sk.startsWith(_cdDateKey + "|")) return false;
            // If the cancelledDates entry has location info, verify it appears in the key.
            if (_cdIsObj && cdEntry.location && sk.indexOf(cdEntry.location) === -1) return false;
            return true;
          });
          if (!_dateMatch && !_sessMatch) continue;

          // Cancel & Reschedule modal skip-check (Task 8, tightened):
          // crApplyDispositions (LDAH-Int Task 7) writes rescheduledFrom[escapedKey] or
          // cancelledFromSession[escapedKey] on each signup BEFORE writing the parent
          // cancelledDates entry. Match on date + location + venue so that a rescheduled
          // Pearl City slot does NOT suppress a Hilo cancellation email on the same date.
          var _wasHandled = false;
          if (r.data.rescheduledFrom && typeof r.data.rescheduledFrom === "object") {
            var rfKeys = Object.keys(r.data.rescheduledFrom);
            for (var rfi = 0; rfi < rfKeys.length; rfi++) {
              if (_markerKeyMatchesCancelledEntry(rfKeys[rfi], _cdIsObj ? cdEntry : { date: _cdDateKey })) {
                _wasHandled = true;
                break;
              }
            }
          }
          if (!_wasHandled && r.data.cancelledFromSession && typeof r.data.cancelledFromSession === "object") {
            var cfsKeys = Object.keys(r.data.cancelledFromSession);
            for (var ci = 0; ci < cfsKeys.length; ci++) {
              if (_markerKeyMatchesCancelledEntry(cfsKeys[ci], _cdIsObj ? cdEntry : { date: _cdDateKey })) {
                _wasHandled = true;
                break;
              }
            }
          }
          if (_wasHandled) {
            console.log(
              "handleEventLifecycleEmails: skipping signup " + r.id +
              " for date " + _cdDateKey +
              (_cdIsObj && cdEntry.location ? " / " + cdEntry.location : "") +
              " — handled by Cancel & Reschedule modal"
            );
            continue;
          }

          const markerId = r.id + "-session-cancelled-" + _cdDateKey.replace(/[^0-9A-Za-z-]/g, "_");
          try {
            const markerSnap = await markerColl.doc(markerId).get();
            if (markerSnap.exists) continue;
          } catch (_) { /* proceed */ }

          const html = buildSessionCancelledEmailHtml({
            name: r.data.name || r.data.displayName || "",
            eventTitle,
            sessionDate: _cdLabel,
            reason,
          });
          const subject = "Session cancelled on " + _cdLabel + " — " + eventTitle;

          try {
            await sendEmailViaResend({
              from: fromAddr,
              to: r.email,
              subject,
              html,
              type: "session-cancelled",
              relatedEventId: eventId,
              relatedSignupId: r.id,
              recipientName: r.data.name || r.data.displayName || "",
            });
            await markerColl.doc(markerId).set({
              signupId: r.id,
              kind: "session-cancelled",
              sessionDate: _cdLabel,
              email: r.email,
              sentAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          } catch (sendErr) {
            console.error("handleEventLifecycleEmails session-cancel send failed (" + collectionName + "/" + eventId + " -> " + r.email + "):", sendErr.message);
          }
          await sleepMs(LIFECYCLE_SEND_DELAY_MS);
        }
      }
    }
  } catch (err) {
    console.error("handleEventLifecycleEmails error (" + collectionName + "/" + context.params.eventId + "):", err.message);
  }
}

exports.onEventUpdated = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 5, secrets: EMAIL_SECRETS })
  .firestore.document("events/{eventId}")
  .onUpdate(async (change, context) => handleEventLifecycleEmails(change, context, "events"));

exports.onRecurringEventUpdated = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 5, secrets: EMAIL_SECRETS })
  .firestore.document("recurringEvents/{eventId}")
  .onUpdate(async (change, context) => handleEventLifecycleEmails(change, context, "recurringEvents"));

// ── Event Recording & Slides Emails ────────────────────────────────
// Admin sends a post-event follow-up with a Zoom recording link and a
// slides PDF (attached AND linked). Auto-expires from Storage after
// 2 weeks + 1 day via pruneExpiredRecordings.

const RECORDING_RETENTION_DAYS = 15;

function buildRecordingEmailHtml({
  bodyText, eventTitle, recordingUrl, passcode, slidesDownloadUrl, slidesFileName,
  slidesFiles,
  signatureHtml, donateHtml, orgFooterHtml,
}) {
  // Backward-compat: callers may pass a single slidesDownloadUrl/slidesFileName
  // OR a slidesFiles array of { downloadUrl, fileName }. Normalize to an array.
  let fileLinks = Array.isArray(slidesFiles) ? slidesFiles.filter(f => f && f.downloadUrl) : null;
  if (!fileLinks || !fileLinks.length) {
    fileLinks = slidesDownloadUrl
      ? [{ downloadUrl: slidesDownloadUrl, fileName: slidesFileName || "" }]
      : [];
  }
  // Convert admin-authored plain-text body to HTML paragraphs.
  const paras = String(bodyText || "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p style="margin:0 0 14px;font-size:16px;color:#333333;line-height:1.5;">${_emailEsc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

  const zoomBlock = recordingUrl
    ? `<div style="margin:16px 0;padding:16px 18px;background-color:#f4f8fc;border-left:4px solid #1a3c6e;border-radius:4px;">
         <p style="margin:0 0 4px;font-size:15px;color:#1a3c6e;font-weight:bold;">Zoom Recording</p>
         ${_emailBtn(recordingUrl, "Watch Recording", { bg: "#1a3c6e", align: "left" })}
         ${passcode ? `<p style="margin:8px 0 4px;font-size:14px;color:#333333;">Passcode: <span style="font-family:Courier,monospace;background:#ffffff;border:1px solid #d1d5db;padding:2px 8px;border-radius:4px;font-weight:700;">${_emailEsc(passcode)}</span></p>` : ""}
         <p style="margin:6px 0 0;font-size:12px;color:#8a6600;font-style:italic;">Available for two weeks.</p>
       </div>`
    : "";

  // One slidesBlock per file (preserves the original single-link markup/styling).
  const slidesBlock = fileLinks.map((f) =>
    `<div style="margin:16px 0;padding:16px 18px;background-color:#fff8e8;border-left:4px solid #c79400;border-radius:4px;">
         <p style="margin:0 0 4px;font-size:15px;color:#8a6600;font-weight:bold;">Attachment</p>
         <p style="margin:0 0 8px;font-size:14px;color:#333333;line-height:1.5;">This file is attached to this email. You can also download it below:</p>
         ${_emailBtn(f.downloadUrl, "Download", { bg: "#c79400", align: "left" })}
         ${f.fileName ? `<p style="margin:8px 0 0;font-size:12px;color:#6b7280;">File: ${_emailEsc(f.fileName)}</p>` : ""}
         <p style="margin:6px 0 0;font-size:12px;color:#8a6600;font-style:italic;">Available for two weeks.</p>
       </div>`
  ).join("");

  const linkFooter = _emailLinkFooter([
    recordingUrl ? { label: "Watch Recording", href: recordingUrl } : null,
    ...fileLinks.map((f) => ({ label: "Download " + (f.fileName || "file"), href: f.downloadUrl })),
  ]);

  const confidentiality = `<p style="margin:18px 0 0;font-size:11px;color:#999999;line-height:1.5;border-top:1px solid #eeeeee;padding-top:12px;">
      <strong>CONFIDENTIALITY STATEMENT</strong><br>
      This message may contain legal, privileged, and/or confidential information. If you are not the intended recipient or the employee or agent responsible for delivery of this message to the intended recipient, you are hereby notified that any dissemination, distribution, or copying of this message is strictly prohibited. If you have received this message in error, please immediately notify the sender and delete this message from your computer.
    </p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
  <tr><td style="background-color:#ffffff;padding:28px 32px 20px;text-align:center;border-bottom:3px solid #1a3c6e;">
    <img src="https://www.ldahawaii.org/logo_blue.png" alt="Leadership in Disabilities &amp; Achievement of Hawai'i" width="150" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;">
  </td></tr>
  <tr><td style="padding:32px;">
    ${paras}
    ${zoomBlock}
    ${slidesBlock}
    <p style="margin:24px 0 4px;font-size:15px;color:#333333;line-height:1.5;">With gratitude,</p>
    <p style="margin:0 0 16px;font-size:15px;color:#333333;line-height:1.5;"><strong>LDAH Team</strong></p>
    ${donateHtml || ''}
    ${signatureHtml || ''}
    ${linkFooter}
    ${confidentiality}
  </td></tr>
  ${orgFooterHtml || ''}
</table>
</td></tr></table></body></html>`;
}

async function fetchStorageAsBase64(storagePath) {
  if (!storagePath) return null;
  const bucket = admin.storage().bucket();
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buf] = await file.download();
  return buf.toString("base64");
}

// Fixed "sorry we missed you" body for no-show recipients. Not editable
// from the LDAH-Int modal — the staff-edited body applies to attendees only.
// v120.7.5: takes a `name` so the greeting can be personalized per recipient.
function buildNoShowRecordingBody({ name, eventTitle, nextSessionsBlurb }) {
  const safeName = (name && String(name).trim()) ? String(name).trim() : "there";
  const lines = [
    `Aloha ${safeName},`,
    "",
    `We're sorry we missed you at ${eventTitle}. We hope everything is well, and we wanted to make sure you still have what was shared during the session.`,
    "",
    "The recording and slides are below — please take your time with them, and reach out anytime if you have questions about anything covered.",
  ];
  if (nextSessionsBlurb) {
    lines.push("");
    lines.push(nextSessionsBlurb);
  }
  lines.push("");
  lines.push("Mahalo nui for being part of the LDAH 'ohana — we hope to connect with you at our next session.");
  return lines.join("\n");
}

// v120.7.5: simple {name} placeholder substitution for attendee bodies. The
// admin-edited body in the LDAH-Int modal can include `{name}` and we'll
// replace it per recipient. Falls back to "there" when the signup has no
// usable display name. Also strips the placeholder cleanly when no name
// substitution is needed.
function _firstNameOnly(full) {
  const s = String(full == null ? "" : full).trim();
  if (!s) return "";
  return s.split(/\s+/)[0];
}
function applyRecipientNameMerge(template, recipientName) {
  const first = _firstNameOnly(recipientName) || "there";
  return String(template || "").replace(/\{name\}/gi, first);
}

exports.sendEventRecordingEmail = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB", maxInstances: 3, secrets: ["RESEND_API_KEY", "SMTP_FROM"] })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Max-Age", "3600");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    try {
      const {
        collection, eventId, sessionKey, sessionDate, eventTitle,
        subject, body, recordingUrl, passcode,
        pdfStoragePath, pdfDownloadUrl, pdfFileName,
        recipients,
        nextSessionsBlurb,
      } = req.body || {};

      // Force re-send: bypass the per-recipient "already sent" idempotency guard
      // so staff can deliberately re-deliver. Re-stamping is intentional.
      const force = req.body.force === true || req.body.force === 'true';

      // Multiple files (PDF + JPG ...). Backward-compatible: if no `files`
      // array is supplied, fall back to the legacy single-PDF payload.
      let files = Array.isArray(req.body.files) ? req.body.files : null;
      if (!files || !files.length) {
        if (req.body.pdfStoragePath) {
          files = [{
            storagePath: req.body.pdfStoragePath,
            downloadUrl: req.body.pdfDownloadUrl || '',
            fileName: req.body.pdfFileName || 'attachment.pdf',
            contentType: 'application/pdf',
          }];
        } else {
          files = [];
        }
      }

      if (!collection || !eventId) { res.status(400).json({ error: "collection + eventId required" }); return; }
      if (!Array.isArray(recipients) || !recipients.length) { res.status(400).json({ error: "At least one recipient required" }); return; }
      // For attendee sends, subject + body must be provided (admin-editable).
      // For no-show-only sends, the CF generates them itself.
      const hasAttendeeRecipient = recipients.some((r) => r && r.email && (r.audience || "attended") === "attended");
      if (hasAttendeeRecipient && (!subject || !body)) {
        res.status(400).json({ error: "subject + body required for attendee recipients" });
        return;
      }

      const signatureHtml = await buildSignatureBlock('eventCoordinator');
      const donateHtml = await buildDonateBlock('universal');
      const orgFooterHtml = await getOrgFooterHtml();

      // v120.7.5: HTML is now built per-recipient inside the send loop so
      // the greeting can be personalized. {name} placeholder in the
      // admin-edited attendee body is replaced with each recipient's first
      // name; the no-show body is regenerated per recipient with their name
      // baked into the greeting.
      const attendeeBodyTemplate = (subject && body) ? body : null;
      const noShowSubject = `Sorry we missed you -- ${eventTitle || "LDAH session"}`;

      // Fetch all attachment files once and reuse for all recipients. Cap the
      // combined raw attachment size; if exceeded, attach nothing (links still
      // appear in the email body / footer).
      const MAX_ATTACH_BYTES = 20 * 1024 * 1024;
      const attachments = [];
      let totalBytes = 0;
      let attachSkippedForSize = false;
      for (const f of files) {
        if (!f || !f.storagePath) continue;
        try {
          const b64 = await fetchStorageAsBase64(f.storagePath);
          if (!b64) continue;
          const approxBytes = Math.floor((b64.length * 3) / 4);
          if (totalBytes + approxBytes > MAX_ATTACH_BYTES) { attachSkippedForSize = true; continue; }
          totalBytes += approxBytes;
          attachments.push({ filename: f.fileName || "attachment", content: b64 });
        } catch (e) { console.error("attach fetch failed", f.storagePath, e.message || e); }
      }
      // Links rendered in the email body (only files that have a downloadUrl).
      const slidesFileLinks = files
        .filter((f) => f && f.downloadUrl)
        .map((f) => ({ downloadUrl: f.downloadUrl, fileName: f.fileName || "" }));

      const fromAddress = process.env.SMTP_FROM || "onboarding@resend.dev";
      const from = `LDAH <${fromAddress}>`;
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) { res.status(500).json({ error: "RESEND_API_KEY missing" }); return; }

      let sentAttended = 0, sentNoShow = 0, failed = 0, skippedDuplicate = 0;
      const errors = [];

      for (const r of recipients) {
        if (!r || !r.email) { failed++; continue; }
        const audience = r.audience === "noShow" ? "noShow" : "attended";
        const isNoShow = audience === "noShow";
        const recipSubject = isNoShow ? noShowSubject : subject;

        // v120.7.5: build HTML per recipient so the name shows up.
        let recipHtml = null;
        if (isNoShow) {
          const nsBody = buildNoShowRecordingBody({
            name: r.name || "",
            eventTitle: eventTitle || "the session",
            nextSessionsBlurb: nextSessionsBlurb || "",
          });
          recipHtml = buildRecordingEmailHtml({
            bodyText: nsBody, eventTitle: eventTitle || "",
            recordingUrl: recordingUrl || "", passcode: passcode || "",
            slidesFiles: slidesFileLinks,
            signatureHtml, donateHtml, orgFooterHtml,
          });
        } else if (attendeeBodyTemplate) {
          const merged = applyRecipientNameMerge(attendeeBodyTemplate, r.name || "");
          recipHtml = buildRecordingEmailHtml({
            bodyText: merged, eventTitle: eventTitle || "",
            recordingUrl: recordingUrl || "", passcode: passcode || "",
            slidesFiles: slidesFileLinks,
            signatureHtml, donateHtml, orgFooterHtml,
          });
        }
        const recipType = isNoShow ? "event-recording-noshow" : "event-recording";
        if (!recipHtml) { failed++; errors.push(r.email + ": missing html for audience " + audience); continue; }

        // Idempotency guard — never double-deliver the recording email for
        // the same session + audience. Catches a re-clicked / double-submitted
        // send (one happened 2026-05-15). The stamp lives on the signup doc,
        // mirroring feedbackEmailsSent. Intentional resends use the separate
        // resendEventRecordingEmail endpoint. Recipients with no signupId
        // can't be guarded and fall through to send.
        const recKey = sessionKey || "_single";
        let signupRef = null;
        if (r.signupId) {
          signupRef = admin.firestore().collection(collection).doc(eventId)
            .collection("signups").doc(r.signupId);
          // When `force` is set, skip the guard entirely and re-send to everyone.
          if (!force) {
            try {
              const sgSnap = await signupRef.get();
              const res = sgSnap.exists ? (sgSnap.data().recordingEmailSent || null) : null;
              if (res && res[recKey] && res[recKey][audience]) {
                skippedDuplicate++;
                continue;
              }
            } catch (e) { /* read failed — fall through and send */ }
          }
        }

        const resendBody = { from, to: [r.email], subject: recipSubject, html: recipHtml };
        if (attachments.length) {
          resendBody.attachments = attachments;
        }
        try {
          const resp = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
            body: JSON.stringify(resendBody),
          });
          if (!resp.ok) {
            const t = await resp.text();
            failed++; errors.push(r.email + ": " + resp.status + " " + t);
            await logEmailSend({
              from, to: r.email, bcc: "", subject: recipSubject, html: recipHtml,
              type: recipType,
              relatedEventId: eventId, relatedSignupId: r.signupId || "",
              recipientName: r.name || "",
              success: false,
              error: "Resend API error (" + resp.status + "): " + t,
            });
            continue;
          }
          const result = await resp.json();
          if (isNoShow) sentNoShow++; else sentAttended++;
          // Log each send individually (mirrors other bulk email flows)
          await logEmailSend({
            from, to: r.email, bcc: "", subject: recipSubject, html: recipHtml,
            type: recipType,
            relatedEventId: eventId, relatedSignupId: r.signupId || "",
            recipientName: r.name || "",
            success: true,
            resendId: (result && result.id) || null,
          });
          // Stamp the signup so a re-clicked send can't double-deliver.
          if (signupRef) {
            try {
              await signupRef.set({
                recordingEmailSent: {
                  [recKey]: { [audience]: admin.firestore.FieldValue.serverTimestamp() },
                },
              }, { merge: true });
            } catch (e) { console.warn("recordingEmailSent stamp failed:", e.message); }
          }
          // Attach extra metadata so Email Log can detect the attachment+expiry
          try {
            const lastSnap = await admin.firestore().collection("emailLog")
              .where("relatedEventId", "==", eventId)
              .where("to", "==", r.email)
              .where("type", "==", recipType)
              .orderBy("sentAt", "desc").limit(1).get();
            if (!lastSnap.empty) {
              await lastSnap.docs[0].ref.update({
                recordingStoragePath: (files[0] && files[0].storagePath) || pdfStoragePath || "",
                recordingSessionKey: sessionKey || "",
              });
            }
          } catch (e) { /* index-missing is non-fatal */ }
        } catch (e) {
          failed++; errors.push(r.email + ": " + (e.message || e));
        }
      }

      const sent = sentAttended + sentNoShow;

      // Stamp event doc so the button state flips in the UI.
      // New shape: recordingEmailSent[key] = { attended: {...}, noShow: {...} }.
      // Only stamp the audience(s) actually sent in this request — uses
      // dot-paths so the other audience's prior state isn't clobbered.
      try {
        const evRef = admin.firestore().collection(collection).doc(eventId);
        const key = sessionKey || "_single";
        const stamp = (count) => ({
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          recipientCount: count,
          sessionDate: sessionDate || "",
          // Backward-compat: keep single storagePath (first file), plus the full set.
          storagePath: (files[0] && files[0].storagePath) || pdfStoragePath || "",
          recordingUrl: recordingUrl || "",
          files: files.map((f) => ({
            storagePath: f.storagePath || "",
            fileName: f.fileName || "",
            downloadUrl: f.downloadUrl || "",
          })),
        });
        const updates = {};
        if (sentAttended > 0) updates[`recordingEmailSent.${key}.attended`] = stamp(sentAttended);
        if (sentNoShow > 0) updates[`recordingEmailSent.${key}.noShow`] = stamp(sentNoShow);
        if (failed > 0) updates[`recordingEmailSent.${key}.lastFailedCount`] = failed;
        if (Object.keys(updates).length) {
          await evRef.update(updates);
        }
      } catch (e) { console.warn("Failed to stamp event doc recordingEmailSent:", e.message); }

      // Schedule auto-deletion of each attachment file 15 days from now (one
      // deletion doc per storagePath).
      for (const f of files) {
        if (!f || !f.storagePath) continue;
        try {
          const expiresAt = new Date(Date.now() + RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1000);
          await admin.firestore().collection("scheduledDeletions").add({
            storagePath: f.storagePath,
            expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
            eventId, sessionKey: sessionKey || "_single", eventTitle: eventTitle || "",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            reason: "event-recording-attachment",
          });
        } catch (e) { console.warn("scheduledDeletions write failed:", e.message); }
      }

      res.status(200).json({ success: true, sent, sentAttended, sentNoShow, failed, skippedDuplicate, attachSkippedForSize, errors });
    } catch (err) {
      console.error("sendEventRecordingEmail error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

// Daily 3 AM HST (13:00 UTC) — delete recording PDFs whose 2-week window expired
exports.pruneExpiredRecordings = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1 })
  .pubsub.schedule("0 3 * * *")
  .timeZone("Pacific/Honolulu")
  .onRun(async () => {
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const now = admin.firestore.Timestamp.now();
    const snap = await db.collection("scheduledDeletions")
      .where("expiresAt", "<=", now)
      .limit(200).get();
    let deleted = 0, missing = 0, errs = 0;
    for (const doc of snap.docs) {
      const d = doc.data();
      try {
        if (d.storagePath) {
          const f = bucket.file(d.storagePath);
          const [exists] = await f.exists();
          if (exists) { await f.delete(); deleted++; }
          else { missing++; }
        }
        await doc.ref.delete();
      } catch (e) {
        errs++; console.warn("pruneExpiredRecordings failed for " + doc.id + ":", e.message);
      }
    }
    console.log(`pruneExpiredRecordings: deleted=${deleted} missing=${missing} errors=${errs} scanned=${snap.size}`);
    return null;
  });

// Helper used by an extended resendLoggedEmail flow (if type=event-recording,
// re-attach the PDF from Storage when the file is still there; otherwise
// send just the HTML — the recipient still has a link in the body which
// will 404 gracefully past the retention window).
exports.resendEventRecordingEmail = functions
  .runWith({ timeoutSeconds: 60, maxInstances: 5, secrets: ["RESEND_API_KEY", "SMTP_FROM"] })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    try {
      const { logId, overrideTo } = req.body || {};
      if (!logId) { res.status(400).json({ error: "Missing logId" }); return; }

      const db = admin.firestore();
      const doc = await db.collection("emailLog").doc(logId).get();
      if (!doc.exists) { res.status(404).json({ error: "Log entry not found" }); return; }
      const log = doc.data();
      if (!log.html) { res.status(400).json({ error: "No HTML body recorded" }); return; }
      const to = (overrideTo && String(overrideTo).trim()) || log.to;
      if (!to) { res.status(400).json({ error: "No recipient" }); return; }

      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) { res.status(500).json({ error: "RESEND_API_KEY missing" }); return; }
      const fromAddress = log.from || `LDAH <${process.env.SMTP_FROM || "onboarding@resend.dev"}>`;

      // Try to re-attach the PDF if still in Storage
      let attachments = undefined;
      let attachmentStatus = "none";
      if (log.recordingStoragePath) {
        const b64 = await fetchStorageAsBase64(log.recordingStoragePath).catch(() => null);
        if (b64) {
          attachments = [{ filename: (log.recordingStoragePath.split("/").pop()) || "slides.pdf", content: b64 }];
          attachmentStatus = "attached";
        } else {
          attachmentStatus = "expired";
        }
      }

      const body = { from: fromAddress, to: [to], subject: log.subject || "(resend)", html: log.html };
      if (attachments) body.attachments = attachments;

      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) { const t = await resp.text(); throw new Error("Resend error (" + resp.status + "): " + t); }
      const result = await resp.json();

      await logEmailSend({
        from: fromAddress, to, bcc: "", subject: log.subject || "", html: log.html,
        type: (log.type || "event-recording") + "-resend",
        relatedEventId: log.relatedEventId || "", relatedSignupId: log.relatedSignupId || "",
        recipientName: log.recipientName || "",
        success: true, resendId: (result && result.id) || null,
      });

      res.status(200).json({ success: true, id: (result && result.id) || null, to, attachmentStatus });
    } catch (err) {
      console.error("resendEventRecordingEmail error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

// ── Resource Update Request Workflow ───────────────────────────
// Semi-annual cycle where partner orgs review their resource card
// (name, type, services, contact info) and submit changes for admin
// approval. Logo uploads stay manual via email to Leilani.

const RESOURCE_UPDATE_FORM_BASE = "https://www.ldahawaii.org/update-resource.html";
const RESOURCE_UPDATE_EDITABLE_FIELDS = [
  "name", "type", "services", "city", "island", "phone", "email", "website",
];
const RESOURCE_UPDATE_RESEND_DAYS = 30; // cycle length: don't re-spam within a single cycle

// Stable test-preview token so admins clicking the link in a test email
// land on a working form populated with sample data instead of a 404.
const RESOURCE_TEST_PREVIEW_TOKEN = "preview-bgch";
const RESOURCE_TEST_PREVIEW_DATA = Object.freeze({
  resourceId: "preview",
  name: "Boys & Girls Club of Hawai'i",
  type: "Youth Development",
  services: "After-school programs, summer camps, mentorship, leadership and STEM activities for youth statewide.",
  city: "Honolulu",
  island: "Statewide",
  phone: "(808) 949-4203",
  email: "info@bgch.com",
  website: "https://www.bgch.com",
});

function resourceUpdateLink(token) {
  return RESOURCE_UPDATE_FORM_BASE + "?token=" + encodeURIComponent(token);
}

function resourceUpdateEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// Server-side mirror of the client validators. Returns the cleaned URL
// or null if invalid (caller decides whether to reject the submission).
// Empty input is fine — website is optional.
function validateAndNormalizeWebsiteUrl(input) {
  const raw = String(input == null ? "" : input).trim();
  if (!raw) return { ok: true, normalized: "" };
  if (/\s/.test(raw)) return { ok: false, reason: "Multiple URLs or spaces are not allowed in the website field." };
  if (raw.indexOf(",") !== -1) return { ok: false, reason: "Multiple URLs or commas are not allowed in the website field." };
  const withScheme = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
  try {
    const u = new URL(withScheme);
    if (!u.hostname || u.hostname.indexOf(".") === -1) {
      return { ok: false, reason: "Invalid web address." };
    }
    return { ok: true, normalized: u.href };
  } catch (e) {
    return { ok: false, reason: "Invalid web address." };
  }
}

function buildResourceUpdateEmailHtml({ resource, token, isNudge, signatureHtml, donateHtml, resourceCoordinatorEmail }) {
  // Resource recipients are organizations, not individuals — splitting the
  // org name to fake a first name produced "Aloha Boys," for "Boys & Girls
  // Club of Hawai'i". Just greet the org generically instead.
  const orgName = resourceUpdateEsc((resource && resource.name) || "your organization");
  const link = resourceUpdateLink(token);
  const heading = isNudge ? "Quick reminder" : "Time for your semi-annual update";
  const headerLabel = isNudge ? "Reminder" : "Resource Card Update";
  const headerGradient = isNudge
    ? "linear-gradient(135deg,#b45309,#f59e0b)"
    : "linear-gradient(135deg,#1e40af,#0891B2)";
  const headerColor = isNudge ? "#b45309" : "#1e40af";
  const lead = isNudge
    ? "Just a quick nudge in case our earlier note got lost. Twice a year we ask each partner organization to take a couple of minutes to review the resource card we keep for you on the LDAH website."
    : "Twice a year we ask each partner organization to take a couple of minutes to review the resource card we keep for you on the LDAH website. This keeps the families and individuals who rely on our resource directory pointed to current information for " + orgName + ".";

  let bodyHtml =
    '<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.6">' + lead + '</p>' +
    '<p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6">' +
      'Click the button below to review your card. If everything looks good, you can confirm in one tap. If anything needs to change, edit the fields and submit &mdash; our team will review and post the update.' +
    '</p>' +
    '<p style="text-align:center;margin:32px 0">' +
      '<a href="' + link + '" style="background-color:#0891B2;background:linear-gradient(135deg,#0891B2,#0E7490);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block">Review Your Card</a>' +
    '</p>' +
    '<p style="margin:0 0 16px;font-size:14px;color:#64748b;line-height:1.6">' +
      'If your logo has changed since we last spoke, please email the new file to <a href="mailto:' + resourceUpdateEsc(resourceCoordinatorEmail) + '" style="color:#1a73e8;text-decoration:none;">' + resourceUpdateEsc(resourceCoordinatorEmail) + '</a> and we\'ll update it for you.' +
    '</p>';

  // Resource-update emails go out under La'a's name (Administrative
  // Assistant), distinct from the F-1 lifecycle emails which sign as Leilani.
  bodyHtml +=
    '<p style="margin:24px 0 4px;font-size:15px;color:#333333;line-height:1.5;">If you have any questions, please contact us.</p>' +
    '<p style="margin:0 0 4px;font-size:15px;color:#333333;line-height:1.5;">With gratitude,</p>' +
    '<p style="margin:0 0 16px;font-size:15px;color:#333333;line-height:1.5;"><strong>LDAH Team</strong></p>' +
    (donateHtml || '') +
    (signatureHtml || '');

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + resourceUpdateEsc(heading) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1f2937">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff">' +
    '<div style="background-color:' + headerColor + ';background:' + headerGradient + ';padding:18px 24px 22px;text-align:center;color:#fff">' +
    '<img src="https://www.ldahawaii.org/logo_blue.png" alt="LDAH" width="120" style="display:block;margin:0 auto 10px;background:#fff;border-radius:10px;padding:8px 14px;border:0;outline:none;text-decoration:none;">' +
    '<h1 style="margin:0;font-size:22px;font-weight:700">' + resourceUpdateEsc(headerLabel) + '</h1></div>' +
    '<div style="padding:32px 24px">' +
    '<p style="margin:0 0 16px;font-size:16px">Aloha ' + orgName + ' team,</p>' +
    '<h2 style="margin:0 0 16px;color:#004E7C;font-size:22px">' + resourceUpdateEsc(heading) + '</h2>' +
    bodyHtml +
    '</div>' +
    '<div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;font-size:12px;color:#94a3b8;text-align:center">' +
    '<p style="margin:0">Leadership in Disabilities and Achievement of Hawai\'i</p>' +
    '</div></div></body></html>';
}

exports.sendResourceUpdateRequests = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1, secrets: EMAIL_SECRETS })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const dryRun = body.dryRun === true;
    const testMode = body.testMode === true;
    const testEmail = (body.testEmail || "").trim();
    const adminEmail = (body.adminEmail || "").trim();
    const mode = body.mode === "nonResponders" ? "nonResponders" : "all";
    const targetResourceId = (body.targetResourceId || "").trim();

    try {
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const fromAddress = lifecycleFromAddress();
      const signatureHtml = await buildSignatureBlock('resourceCoordinator');
      const donateHtml = await buildDonateBlock('universal');
      const resCoord = await getPersona('resourceCoordinator');
      const resourceCoordinatorEmail = resCoord.email;

      // Single-resource path — admin clicked "Send Update Request" on one
      // partner card. Bypasses the collection scan + cycle eligibility
      // entirely; just regenerates the token and sends. Throttle still
      // applies (counts toward the 50/day cap).
      if (targetResourceId) {
        const docSnap = await db.collection("resources").doc(targetResourceId).get();
        if (!docSnap.exists) { res.status(404).json({ error: "Resource not found" }); return; }
        const r = docSnap.data() || {};
        if (r.archived === true) { res.status(400).json({ error: "Resource is archived" }); return; }
        const email = String(r.email || "").trim();
        if (!email) { res.status(400).json({ error: "This partner has no email on file." }); return; }

        // Throttle check (shared with the bulk send).
        const today = new Date().toISOString().slice(0, 10);
        const throttleRef = db.collection("system").doc("resourceUpdateThrottle").collection("days").doc(today);
        const throttleDoc = await throttleRef.get();
        const sentToday = throttleDoc.exists ? (throttleDoc.data().count || 0) : 0;
        if (sentToday >= ANNOUNCEMENT_DAILY_CAP) {
          res.status(429).json({ error: "Daily cap reached", sentToday, cap: ANNOUNCEMENT_DAILY_CAP });
          return;
        }

        const token = crypto.randomBytes(16).toString("hex");
        try {
          await docSnap.ref.update({
            updateToken: token,
            updateRequestedAt: FieldValue.serverTimestamp(),
            updateRequestedBy: adminEmail,
            updateNudgeCount: 0,
            lastUpdateNudgeAt: null,
            updateSubmittedAt: null,
            pendingUpdate: null,
          });
          const html = buildResourceUpdateEmailHtml({ resource: r, token, isNudge: false, signatureHtml, donateHtml, resourceCoordinatorEmail });
          await sendEmailViaResend({
            from: fromAddress,
            to: email,
            subject: "Action Required: Update your LDAH Resource Card",
            html,
            type: "resource-update-request",
            recipientName: r.name || "",
          });
          await throttleRef.set({ count: FieldValue.increment(1) }, { merge: true });
          res.status(200).json({ success: true, sent: 1, to: email, name: r.name || "" });
        } catch (err) {
          console.error("sendResourceUpdateRequests (single) failed for " + email + ":", err.message);
          res.status(500).json({ error: err.message });
        }
        return;
      }

      if (testMode) {
        if (!testEmail) { res.status(400).json({ error: "testMode requires testEmail" }); return; }
        // Use the stable preview token so the link in the test email resolves
        // to a working form populated with sample data.
        const html = buildResourceUpdateEmailHtml({
          resource: RESOURCE_TEST_PREVIEW_DATA,
          token: RESOURCE_TEST_PREVIEW_TOKEN,
          isNudge: false,
          signatureHtml,
          donateHtml,
          resourceCoordinatorEmail,
        });
        await sendEmailViaResend({
          from: fromAddress,
          to: testEmail,
          subject: "Action Required: Update your LDAH Resource Card",
          html,
          type: "resource-update-request",
          recipientName: RESOURCE_TEST_PREVIEW_DATA.name,
        });
        res.status(200).json({ success: true, testMode: true, sentTo: testEmail });
        return;
      }

      const snap = await db.collection("resources").get();
      const now = Date.now();
      const cycleCutoffMs = now - (RESOURCE_UPDATE_RESEND_DAYS * 24 * 60 * 60 * 1000);

      const eligible = [];
      let totalResources = 0;
      let withoutEmail = 0;
      let alreadySentThisCycle = 0;

      snap.forEach((d) => {
        totalResources++;
        const r = d.data() || {};
        if (r.archived === true) return;
        const email = String(r.email || "").trim();
        if (!email) { withoutEmail++; return; }

        const reqAt = r.updateRequestedAt && r.updateRequestedAt.toMillis ? r.updateRequestedAt.toMillis() : 0;
        const submittedAt = r.updateSubmittedAt && r.updateSubmittedAt.toMillis ? r.updateSubmittedAt.toMillis() : 0;

        if (mode === "all") {
          if (reqAt && reqAt > cycleCutoffMs && !submittedAt) {
            // Active cycle in flight — skip to avoid double-sending; nudges
            // handle the follow-up.
            alreadySentThisCycle++;
            return;
          }
          eligible.push({ id: d.id, data: r, email });
        } else {
          if (!r.updateToken) return;
          if (!reqAt || reqAt <= cycleCutoffMs) return;
          if (submittedAt) return;
          eligible.push({ id: d.id, data: r, email });
        }
      });

      if (dryRun) {
        res.status(200).json({
          dryRun: true,
          totalResources,
          withoutEmail,
          alreadySentThisCycle,
          willSendTo: eligible.length,
          mode,
        });
        return;
      }

      // Separate throttle namespace from announcements so a same-day
      // announcement blast and update-request blast don't fight over the
      // shared 50/day Resend cap.
      const today = new Date().toISOString().slice(0, 10);
      const throttleRef = db.collection("system").doc("resourceUpdateThrottle").collection("days").doc(today);
      const throttleDoc = await throttleRef.get();
      const sentToday = throttleDoc.exists ? (throttleDoc.data().count || 0) : 0;
      const remaining = ANNOUNCEMENT_DAILY_CAP - sentToday;

      if (remaining <= 0) {
        res.status(429).json({ error: "Daily cap reached", sentToday, cap: ANNOUNCEMENT_DAILY_CAP });
        return;
      }

      const batch = eligible.slice(0, remaining);
      let sent = 0;
      let failed = 0;
      const failures = [];

      for (const item of batch) {
        const token = crypto.randomBytes(16).toString("hex");
        try {
          await db.collection("resources").doc(item.id).update({
            updateToken: token,
            updateRequestedAt: FieldValue.serverTimestamp(),
            updateRequestedBy: adminEmail,
            updateNudgeCount: 0,
            lastUpdateNudgeAt: null,
            updateSubmittedAt: null,
            pendingUpdate: null,
          });

          const html = buildResourceUpdateEmailHtml({ resource: item.data, token, isNudge: false, signatureHtml, donateHtml, resourceCoordinatorEmail });
          await sendEmailViaResend({
            from: fromAddress,
            to: item.email,
            subject: "Action Required: Update your LDAH Resource Card",
            html,
            type: "resource-update-request",
            recipientName: item.data.name || "",
          });
          sent++;
        } catch (err) {
          failed++;
          failures.push({ resourceId: item.id, email: item.email, error: err.message });
          console.error("sendResourceUpdateRequests failed for " + item.email + ":", err.message);
        }
      }

      if (sent > 0) {
        await throttleRef.set({ count: FieldValue.increment(sent) }, { merge: true });
      }

      res.status(200).json({
        success: true,
        sent,
        failed,
        failures,
        queued: eligible.length - batch.length,
        sentToday: sentToday + sent,
        cap: ANNOUNCEMENT_DAILY_CAP,
        mode,
      });
    } catch (err) {
      console.error("sendResourceUpdateRequests error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

// ----------------------------------------------------------------------------
// sendResourceUpdateRequestsAuto — daily 5 AM HST.
// Kicks off each cycle's initial "please update your listing" request emails
// automatically (no button press needed). Eligible = active partner-directory
// entries with an email that have NOT been requested during the current cycle
// (updateRequestedAt < cycle start). This naturally fires the batch on the
// cycle start date (May 1 / Nov 1 from system/resourceNudgeCycle), spreads it
// over days if it exceeds the daily cap, and is idempotent (once a partner is
// requested this cycle they're skipped). Stops once past the cycle deadline.
// The weekly nudge cron then follows up; call-tasks cover the rest.
// ----------------------------------------------------------------------------
exports.sendResourceUpdateRequestsAuto = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1, secrets: EMAIL_SECRETS })
  .pubsub.schedule("0 5 * * *").timeZone("Pacific/Honolulu")
  .onRun(async () => {
    const db = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;
    const now = Date.now();

    const cycleConfig = await _loadNudgeCycleConfig(db);
    const cyc = _resourceCycleForNow(now, cycleConfig);
    if (now > cyc.deadlineMs) {
      console.log("sendResourceUpdateRequestsAuto: past deadline " + cyc.deadlineDateKey + " — not starting requests");
      return null;
    }

    const snap = await db.collection("resources").get();
    const eligible = [];
    snap.forEach((d) => {
      const r = d.data() || {};
      if (r.archived === true) return;
      if (!String(r.name || "").trim()) return;          // skip Downloads-metadata docs
      const email = String(r.email || "").trim();
      if (!email) return;                                // no email -> handled by call-tasks
      const reqAt = r.updateRequestedAt && r.updateRequestedAt.toMillis ? r.updateRequestedAt.toMillis() : 0;
      // "Already handled this cycle" uses the GRACE window (not the bare cycle
      // start) — requests may go out up to 7 days early (e.g. Apr 30 for the May
      // 1 cycle). Skip if requested OR already confirmed this cycle: a partner
      // added/updated/approved mid-cycle (recent lastUpdateAt/updateSubmittedAt,
      // e.g. a self-added partner) is already current and must NOT be asked to
      // "update" — mirrors the nudge + dashboard "confirmed" bucket.
      if (reqAt >= cyc.graceWindowMs) return;
      const lu = r.lastUpdateAt && r.lastUpdateAt.toMillis ? r.lastUpdateAt.toMillis() : 0;
      const subAt = r.updateSubmittedAt && r.updateSubmittedAt.toMillis ? r.updateSubmittedAt.toMillis() : 0;
      const created = r.createdAt && r.createdAt.toMillis ? r.createdAt.toMillis() : 0;
      // Skip if requested, confirmed, OR newly added this cycle. createdAt is the
      // belt-and-suspenders for any partner-add path (e.g. application approval
      // like Sharky Hearts 6-3) — a partner who joined this cycle is current and
      // must not be asked to "update."
      if (lu >= cyc.graceWindowMs || subAt >= cyc.graceWindowMs || created >= cyc.graceWindowMs) return;
      eligible.push({ id: d.id, data: r, email });
    });
    if (eligible.length === 0) { console.log("sendResourceUpdateRequestsAuto: nothing to send for cycle " + cyc.cycleKey); return null; }

    const fromAddress = lifecycleFromAddress();
    const signatureHtml = await buildSignatureBlock("resourceCoordinator");
    const donateHtml = await buildDonateBlock("universal");
    const resCoord = await getPersona("resourceCoordinator");
    const resourceCoordinatorEmail = resCoord ? resCoord.email : "";

    // Daily cap (shared resource-update throttle namespace).
    const nowHst = new Date(new Date().toLocaleString("en-US", { timeZone: "Pacific/Honolulu" }));
    const todayKey = nowHst.getFullYear() + "-" + String(nowHst.getMonth() + 1).padStart(2, "0") + "-" + String(nowHst.getDate()).padStart(2, "0");
    const throttleRef = db.collection("system").doc("resourceUpdateThrottle").collection("days").doc(todayKey);
    const throttleDoc = await throttleRef.get();
    const sentToday = throttleDoc.exists ? (throttleDoc.data().count || 0) : 0;
    const remaining = ANNOUNCEMENT_DAILY_CAP - sentToday;
    if (remaining <= 0) { console.log("sendResourceUpdateRequestsAuto: daily cap reached"); return null; }

    const batch = eligible.slice(0, remaining);
    let sent = 0, failed = 0;
    for (const item of batch) {
      const token = crypto.randomBytes(16).toString("hex");
      try {
        await db.collection("resources").doc(item.id).update({
          updateToken: token,
          updateRequestedAt: FieldValue.serverTimestamp(),
          updateRequestedBy: "auto (cycle start)",
          updateNudgeCount: 0,
          lastUpdateNudgeAt: null,
          updateSubmittedAt: null,
          pendingUpdate: null,
        });
        const html = buildResourceUpdateEmailHtml({ resource: item.data, token, isNudge: false, signatureHtml, donateHtml, resourceCoordinatorEmail });
        await sendEmailViaResend({
          from: fromAddress, to: item.email,
          subject: "Action Required: Update your LDAH Resource Card",
          html, type: "resource-update-request", recipientName: item.data.name || "",
        });
        sent++;
      } catch (err) {
        failed++;
        console.error("sendResourceUpdateRequestsAuto failed for " + item.email + ":", err.message);
      }
    }
    if (sent > 0) await throttleRef.set({ count: FieldValue.increment(sent) }, { merge: true });
    console.log("sendResourceUpdateRequestsAuto: cycle " + cyc.cycleKey + " sent " + sent + ", failed " + failed + ", queued " + (eligible.length - batch.length));
    return null;
  });

exports.getResourceForUpdate = functions
  .runWith({ timeoutSeconds: 20, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

    const token = (req.query && req.query.token) ? String(req.query.token).trim() : "";
    if (!token) { res.status(400).json({ error: "Missing token" }); return; }

    if (token === RESOURCE_TEST_PREVIEW_TOKEN) {
      res.status(200).json(Object.assign({}, RESOURCE_TEST_PREVIEW_DATA, { isTestPreview: true }));
      return;
    }

    try {
      const db = admin.firestore();
      const snap = await db.collection("resources").where("updateToken", "==", token).limit(1).get();
      if (snap.empty) { res.status(404).json({ error: "Invalid or expired link" }); return; }
      const doc = snap.docs[0];
      const r = doc.data() || {};
      if (r.updateSubmittedAt) { res.status(410).json({ error: "This link has already been used" }); return; }

      res.status(200).json({
        resourceId: doc.id,
        name: r.name || "",
        type: r.type || "",
        services: r.services || "",
        city: r.city || "",
        island: r.island || "",
        phone: r.phone || "",
        email: r.email || "",
        website: r.website || "",
      });
    } catch (err) {
      console.error("getResourceForUpdate error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

exports.submitResourceUpdate = functions
  .runWith({ timeoutSeconds: 20, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const token = (body.token || "").toString().trim();
    const noChanges = body.noChanges === true;
    const fields = (body.fields && typeof body.fields === "object") ? body.fields : null;

    if (!token) { res.status(400).json({ error: "Missing token" }); return; }
    if (!noChanges && !fields) { res.status(400).json({ error: "Provide noChanges or fields" }); return; }

    if (token === RESOURCE_TEST_PREVIEW_TOKEN) {
      res.status(200).json({ ok: true, mode: noChanges ? "noChanges" : "pending", testPreview: true });
      return;
    }

    try {
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const snap = await db.collection("resources").where("updateToken", "==", token).limit(1).get();
      if (snap.empty) { res.status(404).json({ error: "Invalid or expired link" }); return; }
      const doc = snap.docs[0];
      const r = doc.data() || {};
      if (r.updateSubmittedAt) { res.status(410).json({ error: "This link has already been used" }); return; }

      if (noChanges) {
        await doc.ref.update({
          updateSubmittedAt: FieldValue.serverTimestamp(),
          lastUpdateAt: FieldValue.serverTimestamp(),
          updateToken: FieldValue.delete(),
          pendingUpdate: null,
        });
        res.status(200).json({ ok: true, mode: "noChanges" });
        return;
      }

      const cleaned = {};
      RESOURCE_UPDATE_EDITABLE_FIELDS.forEach((k) => {
        if (Object.prototype.hasOwnProperty.call(fields, k)) {
          cleaned[k] = String(fields[k] == null ? "" : fields[k]);
        }
      });
      // Defense-in-depth website URL validation — client-side checks live
      // in update-resource.html and LDAH-Int's resource editor; this catches
      // anything that bypasses them (older cached forms, scripted POSTs).
      if (Object.prototype.hasOwnProperty.call(cleaned, "website")) {
        const wcheck = validateAndNormalizeWebsiteUrl(cleaned.website);
        if (!wcheck.ok) { res.status(400).json({ error: wcheck.reason }); return; }
        cleaned.website = wcheck.normalized;
      }
      cleaned.submittedAt = FieldValue.serverTimestamp();

      await doc.ref.update({
        pendingUpdate: cleaned,
        updateSubmittedAt: FieldValue.serverTimestamp(),
      });

      // Create La'a's "Resource Update Review" task (one open per resource). Never fail the submission on error.
      try {
        const _rid = doc.id;
        const _orgName = (r && r.name) || (cleaned && cleaned.name) || "Partner";
        const _existing = await db.collection("interactions").where("workflowEventId", "==", _rid).get();
        const _alreadyOpen = _existing.docs.some((d) => {
          const x = d.data();
          return x.workflowStep === "resourceUpdateReview" && x.status === "Open";
        });
        if (!_alreadyOpen) {
          await db.collection("interactions").add({
            channel: "Partner Resources", interactionType: "Resource Update Review",
            contactId: "", contactName: _orgName, contactType: "", grantProgram: "",
            summary: "Review pending resource update — " + _orgName,
            notes: _orgName + " submitted updates to their community resource listing. Open the resource to review and Approve or Reject.",
            followUpDate: addDaysHst(toHstDateKey(new Date()), 3), status: "Open", isDraft: false,
            owner: "La'a Salvani", ownerUid: LIFECYCLE_LAA_UID,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            createdBy: "System", createdByUid: "system",
            workflowEventId: _rid, workflowEventCollection: "resources",
            workflowEventTitle: _orgName,
            workflowStep: "resourceUpdateReview", workflowSessionKey: "update:" + new Date().toISOString(),
          });
        }
      } catch (e) { console.error("resourceUpdateReview task create failed", e); }

      res.status(200).json({ ok: true, mode: "pending" });
    } catch (err) {
      console.error("submitResourceUpdate error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

/* ──────────────────────────────────────────────────────────────────────────
   Connect-Gen consent flow.
   - On Connect-Gen signup confirmation, send a "consent required" email
     instead of the standard confirmation. Email links to a public form.
   - Parent submits consent → submitConnectGenConsent stamps the signup,
     mirrors to the contact, and fires the prep-docs email (with the 13
     PDFs hosted in connect-gen-prep-docs/ Storage path). Reminder cron
     skips Connect-Gen signups where consentSignedAt is null.
   ──────────────────────────────────────────────────────────────────────── */

const CONSENT_TEXT_VERSION = "02/2021; RR";
const CONSENT_TEXT = "In order for me, [PARENT NAME], to participate in LDAH's Connect Gen Session (CG), on [SESSION DATE], I grant my permission for LDAH to receive, view and discuss my child's confidential documents with me. I am sending the most current Individualized Education Program (IEP) and most current Evaluation(s)/Assessment(s) via fax, email, or postal service. By receiving my documents, it does not obligate LDAH employees to provide additional services to me. LDAH will determine through CG, my need for additional support or services within 48 hours from the date of the CG virtual attendance. My child's confidential documents will be held until a determination is made about receiving additional support with LDAH, such as case advocacy. If I do not require additional supports, my child's confidential documents will be destroyed within 24 hours of attendance date. I agree to send LDAH my child's confidential documents as described above.";

function buildConsentRequiredEmailHtml({ name, eventTitle, datesPhrase, consentUrl, signatureHtml, donateHtml }) {
  const safeName = lifecycleEsc(name || "there");
  const safeTitle = lifecycleEsc(eventTitle || "Connect-Gen");
  const safeDates = lifecycleEsc(datesPhrase || "");
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1f2937">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff">' +
    '<div style="background-color:#1e40af;background:linear-gradient(135deg,#1e40af,#0891B2);padding:18px 24px 22px;text-align:center;color:#fff">' +
    '<img src="https://www.ldahawaii.org/logo_blue.png" alt="LDAH" width="120" style="display:block;margin:0 auto 10px;background:#fff;border-radius:10px;padding:8px 14px;">' +
    '<h1 style="margin:0;font-size:22px;font-weight:700">Action Required</h1></div>' +
    '<div style="padding:32px 24px">' +
    '<p style="margin:0 0 16px;font-size:16px">Aloha ' + safeName + ',</p>' +
    '<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.6">Mahalo for signing up for <strong>' + safeTitle + '</strong>' + (safeDates ? '<strong>' + safeDates + '</strong>' : '') + '. Before we can confirm your appointment, we need a signed consent form on file.</p>' +
    '<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.6">The consent gives LDAH permission to view and discuss your child\'s confidential documents (IEP and Evaluation/Assessment) during the session. Please read it carefully and sign by clicking the button below.</p>' +
    '<p style="text-align:center;margin:32px 0">' +
    _emailBtn(consentUrl, "Read & Sign the Consent Form", { bg: "#0891B2" }) +
    '</p>' +
    '<p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6"><strong>Until we receive your signed consent, this appointment is not yet confirmed.</strong> Once signed, we will send you a confirmation along with the prep documents you should review before the meeting.</p>' +
    '<p style="margin:24px 0 4px;font-size:15px;color:#333;line-height:1.5;">Questions? Reach out anytime.</p>' +
    '<p style="margin:0 0 4px;font-size:15px;color:#333;line-height:1.5;">With gratitude,</p>' +
    (donateHtml || '') +
    (signatureHtml || '') +
    '</div></div></body></html>';
}

function buildConnectGenPrepEmailHtml({ name, eventTitle, datesPhrase, prepDocs, signatureHtml, donateHtml, modality, locationLine }) {
  const safeName = lifecycleEsc(name || "there");
  const safeTitle = lifecycleEsc(eventTitle || "Connect-Gen");
  const safeDates = lifecycleEsc(datesPhrase || "");
  const safeLocation = lifecycleEsc(locationLine || "");

  // Conditional session-detail block: virtual sessions get the Zoom note
  // (the Zoom link itself arrives in the 3-day + day-of reminder emails);
  // in-person sessions get the meeting location. Mixed signups get both.
  const zoomNote =
    '<div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:14px 18px;margin:16px 0;font-size:.92rem;color:#0C4A6E;line-height:1.5;">' +
      '<strong>Zoom details:</strong> we\'ll send you the Zoom link in our reminder emails — once 3 days before the session and again on the day of the session, so it\'s easy to find when you need it.' +
    '</div>';
  const inPersonNote =
    '<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:14px 18px;margin:16px 0;font-size:.92rem;color:#14532D;line-height:1.5;">' +
      '<strong>Location:</strong> Please join us in person at <strong>' + (safeLocation || 'the LDAH office') + '</strong>. We\'ll send a reminder with everything you need 3 days before the session and again on the day of.' +
    '</div>';
  let zoomNoteBlock;
  if (modality === "in-person") zoomNoteBlock = inPersonNote;
  else if (modality === "mixed") zoomNoteBlock = inPersonNote + zoomNote;
  else zoomNoteBlock = zoomNote; // virtual (default)

  let docsHtml = '';
  if (prepDocs && prepDocs.length) {
    docsHtml = '<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:16px;margin:16px 0;">' +
      '<div style="font-weight:700;color:#0F172A;margin-bottom:10px;">Prep Documents</div>' +
      '<div style="font-size:.92rem;color:#475569;margin-bottom:10px;">Please review these before our session:</div>';
    prepDocs.forEach(function (d) {
      docsHtml += '<div style="margin:6px 0;">' +
        '<a href="' + lifecycleEsc(d.url) + '" style="color:#1a73e8;text-decoration:none;font-size:.95rem;">' + lifecycleEsc(d.title) + '</a>' +
      '</div>';
    });
    docsHtml += '</div>';
  }

  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1f2937">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff">' +
    '<div style="background-color:#15803d;background:linear-gradient(135deg,#15803d,#16A34A);padding:18px 24px 22px;text-align:center;color:#fff">' +
    '<img src="https://www.ldahawaii.org/logo_blue.png" alt="LDAH" width="120" style="display:block;margin:0 auto 10px;background:#fff;border-radius:10px;padding:8px 14px;">' +
    '<h1 style="margin:0;font-size:22px;font-weight:700">You\'re Confirmed</h1></div>' +
    '<div style="padding:32px 24px">' +
    '<p style="margin:0 0 16px;font-size:16px">Aloha ' + safeName + ',</p>' +
    '<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.6">Mahalo for returning your signed consent. Your appointment for <strong>' + safeTitle + '</strong>' + (safeDates ? '<strong>' + safeDates + '</strong>' : '') + ' is confirmed.</p>' +
    '<div style="background:#FFFBEB;border:2px solid #F59E0B;border-radius:10px;padding:14px 18px;margin:18px 0;">' +
      '<div style="font-weight:700;color:#92400E;font-size:1rem;margin-bottom:4px;">Important — please bring to the session</div>' +
      '<div style="font-size:.95rem;color:#78350F;line-height:1.5;">Your child\'s most current <strong>IEP</strong> and the <strong>Evaluation that created the IEP</strong>. We won\'t be able to do a meaningful review without both of these on hand.</div>' +
      '<div style="font-size:.95rem;color:#78350F;line-height:1.5;margin-top:8px;">Please also begin to fill out the <strong>Parent Report Worksheet — Concerns Affecting Education</strong> before attending.</div>' +
    '</div>' +
    zoomNoteBlock +
    docsHtml +
    '<p style="margin:24px 0 4px;font-size:15px;color:#333;line-height:1.5;">If anything changes or you have questions, please reach out.</p>' +
    '<p style="margin:0 0 4px;font-size:15px;color:#333;line-height:1.5;">With gratitude,</p>' +
    (donateHtml || '') +
    (signatureHtml || '') +
    '</div></div></body></html>';
}

// GET endpoint — public form fetches signup details to pre-render.
exports.getConnectGenConsent = functions
  .runWith({ timeoutSeconds: 20, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

    const token = (req.query.token || "").toString().trim();
    if (!token) { res.status(400).json({ error: "Missing token" }); return; }

    try {
      const db = admin.firestore();
      const snap = await db.collectionGroup("signups").where("consentToken", "==", token).limit(1).get();
      if (snap.empty) { res.status(404).json({ error: "Invalid or expired link" }); return; }
      const doc = snap.docs[0];
      const s = doc.data() || {};
      if (s.consentSignedAt) { res.status(410).json({ error: "This consent has already been signed", alreadySigned: true }); return; }

      // Resolve event title + dates phrase for display.
      const parentRef = doc.ref.parent.parent;
      const eventSnap = await parentRef.get();
      const event = eventSnap.exists ? (eventSnap.data() || {}) : {};
      const sessionKeys = extractSignupSessionKeys(s);
      const datesPhrase = formatDatesPhrase(sessionKeys);

      res.status(200).json({
        ok: true,
        signupName: s.name || "",
        eventTitle: event.title || "Connect-Gen",
        datesPhrase,
      });
    } catch (err) {
      console.error("getConnectGenConsent error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

// POST endpoint — parent submits the signed consent.
exports.submitConnectGenConsent = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 5, secrets: EMAIL_SECRETS })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const token = (body.token || "").toString().trim();
    const typedName = (body.typedName || "").toString().trim();
    const agree = body.agree === true;
    if (!token) { res.status(400).json({ error: "Missing token" }); return; }
    if (!typedName) { res.status(400).json({ error: "Please type your full name to sign." }); return; }
    if (typedName.length < 3 || typedName.indexOf(" ") === -1) {
      res.status(400).json({ error: "Please type your first AND last name to sign." }); return;
    }
    if (!agree) { res.status(400).json({ error: "You must agree to the consent terms to submit." }); return; }

    try {
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const snap = await db.collectionGroup("signups").where("consentToken", "==", token).limit(1).get();
      if (snap.empty) { res.status(404).json({ error: "Invalid or expired link" }); return; }
      const doc = snap.docs[0];
      const s = doc.data() || {};
      if (s.consentSignedAt) { res.status(410).json({ error: "This consent has already been signed" }); return; }

      // Stamp the signup with the signature record. Keep consentText so we
      // have an immutable snapshot of exactly what they agreed to.
      const ip = (req.headers["x-forwarded-for"] || req.ip || "").toString().split(",")[0].trim();
      // Flip status from 'pending' → 'confirmed' now that consent is on file.
      // Non-Connect-Gen signups skip this gate entirely (registration alone
      // confirms them), but for Connect-Gen the registration form leaves the
      // signup at 'pending' until this moment.
      const _statusUpdate = (s.status === "pending") ? { status: "confirmed" } : {};

      // Phase B: mint an uploadAuthToken so the upload step (which runs after
      // we've deleted the original consentToken) has its own short-lived
      // credential. 7-day window — long enough for a parent who picks
      // "I'll upload later" but short enough to avoid stale credentials
      // sitting around forever. 24 random bytes vs. 16 for consentToken so
      // the two are visibly distinct in logs/Firestore.
      const uploadAuthToken = crypto.randomBytes(24).toString("hex");
      const uploadExpiryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const uploadAuthExpiresAt = admin.firestore.Timestamp.fromDate(uploadExpiryDate);

      await doc.ref.update({
        consentSignedAt: FieldValue.serverTimestamp(),
        consentSignedName: typedName,
        consentText: CONSENT_TEXT,
        consentVersion: CONSENT_TEXT_VERSION,
        consentSignedIp: ip,
        consentToken: FieldValue.delete(),
        uploadAuthToken,
        uploadAuthExpiresAt,
        ..._statusUpdate,
      });

      // Mirror to the linked contact doc so it surfaces in the contact card.
      // Field is `linkedContactId` on the signup (set by handleSignupCreated),
      // NOT `contactId` — the earlier draft of this CF used the wrong key
      // and silently dropped the mirror in the catch block.
      try {
        if (s.linkedContactId) {
          await db.collection("contacts").doc(s.linkedContactId).update({
            connectGenConsent: {
              signedAt: FieldValue.serverTimestamp(),
              signedName: typedName,
              version: CONSENT_TEXT_VERSION,
              eventId: doc.ref.parent.parent.id,
              signupId: doc.id,
            },
          });
        }
      } catch (e) {
        console.warn("Mirror consent to contact failed (non-fatal):", e.message);
      }

      // Now send the prep-docs email. NO Zoom link in this email — that
      // arrives in the 5-day + 1-day reminder emails, matching every other
      // event. This keeps stale Zoom links from showing up weeks before
      // the session and matches the standard reminder cadence.
      try {
        const eventId = doc.ref.parent.parent.id;
        const collection = doc.ref.parent.parent.parent.id; // 'recurringEvents' or 'events'
        const eventSnap = await db.collection(collection).doc(eventId).get();
        const event = eventSnap.exists ? (eventSnap.data() || {}) : {};

        const prepSnap = await db.collection("system").doc("connectGenPrepDocs").get();
        const prepDocs = (prepSnap.exists && Array.isArray(prepSnap.data().docs)) ? prepSnap.data().docs : [];

        // Stage 3b-2 step 5 (2026-05-11): location collection now sources
        // from getSignupSessions(signup, event) — the canonical accessor
        // added in Stage 3b-1. Falls back to legacySessionsForSignup() on
        // empty result so signups attached to events with non-standard
        // shapes still get a populated location list.
        let viaAccessor = 0;
        let viaLegacy = 0;
        let sessions = getSignupSessions(s, event);
        let usedLegacy = false;
        if (!sessions || sessions.length === 0) {
          sessions = legacySessionsForSignup(s, event);
          usedLegacy = sessions.length > 0;
        }
        if (usedLegacy) viaLegacy++; else if (sessions && sessions.length) viaAccessor++;

        const sessionKeys = (sessions || []).map((x) => x && x.dateKey).filter(Boolean);
        const datesPhrase = formatDatesPhrase(sessionKeys);
        const modality = detectSignupModality(s, event);
        // Collect every distinct non-virtual location from the signup's
        // canonical sessions. Connect-Gen meets at three separate physical
        // locations (Oahu, Hilo, Kona) plus virtual Mondays, so a parent
        // who signed up for sessions on multiple islands should see all
        // of them listed, not just the first.
        const inPersonSessions = (sessions || []).filter((x) => x && x.modality !== "virtual" && !!x.location);
        const locArr = Array.from(new Set(inPersonSessions.map((x) => x.location)));
        const locationLine = locArr.length === 0 ? ""
          : locArr.length === 1 ? locArr[0]
          : locArr.length === 2 ? locArr.join(" and ")
          : locArr.slice(0, -1).join(", ") + ", and " + locArr[locArr.length - 1];
        const signatureHtml = await buildSignatureBlock('eventCoordinator');
        const donateHtml = await buildDonateBlock('universal');
        const html = buildConnectGenPrepEmailHtml({
          name: s.name || typedName,
          eventTitle: event.title || "Connect-Gen",
          datesPhrase,
          prepDocs,
          signatureHtml,
          donateHtml,
          modality,
          locationLine,
        });

        const fromAddress = lifecycleFromAddress();
        await sendEmailViaResend({
          from: fromAddress,
          to: s.email,
          subject: "Confirmed -- Connect-Gen prep documents inside",
          html,
          type: "connect-gen-prep",
          relatedEventId: eventId,
          relatedSignupId: doc.id,
          recipientName: s.name || typedName,
        });
        await doc.ref.update({
          confirmationEmailSentAt: FieldValue.serverTimestamp(),
          prepDocsEmailSentAt: FieldValue.serverTimestamp(),
        });
        console.log(`submitConnectGenConsent: scanned=1, sent=1, skipped=0, errors=0, viaAccessor=${viaAccessor}, viaLegacy=${viaLegacy}`);
      } catch (e) {
        console.error("Prep-docs email failed (consent saved):", e.message);
      }

      // Phase B: return the uploadAuthToken so the consent page can hand it
      // straight to requestConnectGenUploadUrl / confirmConnectGenUpload
      // without the parent needing to authenticate again. Existing clients
      // that ignore these extra fields keep working unchanged.
      res.status(200).json({
        ok: true,
        uploadAuthToken,
        uploadAuthExpiresAt: uploadExpiryDate.toISOString(),
      });
    } catch (err) {
      console.error("submitConnectGenConsent error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

// ---------- Connect-Gen secure document upload (Phase B) ----------
//
// Three-step signed-Storage-URL pattern, picked over a single CF body-upload
// because the CF onRequest body limit is ~10 MB and parents send 25 MB IEPs.
//
//   1. submitConnectGenConsent  -> mints + returns uploadAuthToken (above)
//   2. requestConnectGenUploadUrl -> validates and returns a 10-minute
//      signed PUT URL pointing at connectGen/{eventId}/{signupId}/...
//   3. confirmConnectGenUpload  -> verifies the file landed in Storage,
//      records connectGenDocuments.{iep|evaluation} on the signup, writes
//      an audit-log entry, and best-effort deletes any prior version.
//
// The signed-URL approach means the bytes flow Browser -> Storage directly,
// never crossing the Cloud Function. Firebase-admin's Storage SDK has v4
// signed-URL support built in; no new npm dependency required.

// Allowed mime types + matching file extensions for IEP / Evaluation docs.
// Tight allowlist — anything else is rejected. HEIC/HEIF cover iPhone camera
// captures so a parent can photograph the printed IEP without converting.
const CONNECT_GEN_UPLOAD_MIME_EXT = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
};
const CONNECT_GEN_UPLOAD_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

// Look up the active signup by uploadAuthToken AND verify the token hasn't
// expired. Returns { doc, signup } or null.
async function _findConnectGenSignupByUploadToken(db, token) {
  const snap = await db.collectionGroup("signups")
    .where("uploadAuthToken", "==", token)
    .limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const s = doc.data() || {};
  const expiresAt = s.uploadAuthExpiresAt;
  if (!expiresAt || typeof expiresAt.toDate !== "function") return null;
  if (expiresAt.toDate().getTime() <= Date.now()) return null;
  return { doc, signup: s };
}

// Returns true if any candidate session date is today (HST) or in the future.
// Daniel's "pre-event only" rule — once the event has passed we shouldn't be
// accepting fresh confidential documents through this flow.
function _connectGenEventStillUpcoming(event, signup) {
  const candidateKeys = new Set(extractEventCandidateDateKeys(event));
  for (const k of extractSignupSessionKeys(signup)) candidateKeys.add(k);
  if (candidateKeys.size === 0) return true; // no parseable date -> don't block
  const todayKey = toHstDateKey(new Date());
  for (const key of candidateKeys) {
    if (key && key >= todayKey) return true;
  }
  return false;
}

// Step 2: parent picked their files; mint a 10-minute signed PUT URL the
// browser can write directly to Cloud Storage with.
exports.requestConnectGenUploadUrl = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const uploadAuthToken = (body.uploadAuthToken || "").toString().trim();
    const documentType = (body.documentType || "").toString().trim();
    const mimeType = (body.mimeType || "").toString().trim();
    const sizeBytes = Number(body.sizeBytes);
    const originalFilename = (body.originalFilename || "").toString().trim();

    if (!uploadAuthToken) { res.status(400).json({ error: "Missing uploadAuthToken" }); return; }
    if (documentType !== "iep" && documentType !== "evaluation") {
      res.status(400).json({ error: "documentType must be 'iep' or 'evaluation'" }); return;
    }
    const ext = CONNECT_GEN_UPLOAD_MIME_EXT[mimeType];
    if (!ext) {
      res.status(400).json({ error: "File type not allowed. Please use PDF, JPG, PNG, or HEIC." }); return;
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      res.status(400).json({ error: "Invalid file size." }); return;
    }
    if (sizeBytes > CONNECT_GEN_UPLOAD_MAX_BYTES) {
      res.status(400).json({ error: "File is larger than 25 MB. Please choose a smaller file." }); return;
    }
    if (!originalFilename) {
      res.status(400).json({ error: "Missing originalFilename" }); return;
    }

    try {
      const db = admin.firestore();
      const found = await _findConnectGenSignupByUploadToken(db, uploadAuthToken);
      if (!found) {
        res.status(401).json({ error: "Upload link has expired or is no longer valid. Please contact LDAH for a new consent link." }); return;
      }
      const { doc, signup } = found;
      const eventId = doc.ref.parent.parent.id;
      const signupId = doc.id;

      // Pre-event-only gate: refuse new uploads once every session is past.
      const collection = doc.ref.parent.parent.parent.id;
      const eventSnap = await db.collection(collection).doc(eventId).get();
      const event = eventSnap.exists ? (eventSnap.data() || {}) : {};
      if (!_connectGenEventStillUpcoming(event, signup)) {
        res.status(400).json({ error: "Your session has already passed. Please contact LDAH directly to share your documents." }); return;
      }

      const ts = Date.now();
      const storagePath = `connectGen/${eventId}/${signupId}/${documentType}-${ts}.${ext}`;
      // Explicitly target the correct bucket name. The default bucket on
      // this project was migrated to the new firebasestorage.app naming;
      // the old appspot.com name no longer resolves.
      const bucket = admin.storage().bucket("ldah-932d5.firebasestorage.app");
      console.log("requestConnectGenUploadUrl: bucket=", bucket.name, "path=", storagePath);
      // Use a resumable-upload session URI instead of a V4 signed URL.
      // Resumable sessions use the SA's regular Storage write permission
      // (which the App Engine default SA has) and bypass the IAM-signing
      // dance that V4 signed URLs require. The session URI is single-use,
      // tied to the specific path, and expires automatically.
      const [uploadUrl] = await bucket.file(storagePath).createResumableUpload({
        origin: "https://www.ldahawaii.org",
        metadata: { contentType: mimeType },
      });

      res.status(200).json({ ok: true, uploadUrl, storagePath });
    } catch (err) {
      console.error("requestConnectGenUploadUrl error:",
        "msg=", err.message,
        "code=", err.code,
        "details=", err.details,
        "errors=", JSON.stringify(err.errors || []),
        "stack=", (err.stack || "").split("\n").slice(0, 5).join(" | ")
      );
      res.status(500).json({ error: err.message || ("FAILED_PRECONDITION code=" + err.code) });
    }
  });

// Step 3: browser PUT'd the file at the signed URL; record it on the signup.
exports.confirmConnectGenUpload = functions
  .runWith({ memory: "2GB", timeoutSeconds: 180, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const uploadAuthToken = (body.uploadAuthToken || "").toString().trim();
    const documentType = (body.documentType || "").toString().trim();
    let storagePath = (body.storagePath || "").toString().trim();
    let originalFilename = (body.originalFilename || "").toString().trim();
    let sizeBytes = Number(body.sizeBytes);
    let mimeType = (body.mimeType || "").toString().trim();

    if (!uploadAuthToken) { res.status(400).json({ error: "Missing uploadAuthToken" }); return; }
    if (documentType !== "iep" && documentType !== "evaluation") {
      res.status(400).json({ error: "documentType must be 'iep' or 'evaluation'" }); return;
    }
    if (!storagePath) { res.status(400).json({ error: "Missing storagePath" }); return; }
    if (!originalFilename) { res.status(400).json({ error: "Missing originalFilename" }); return; }
    if (!CONNECT_GEN_UPLOAD_MIME_EXT[mimeType]) {
      res.status(400).json({ error: "File type not allowed." }); return;
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > CONNECT_GEN_UPLOAD_MAX_BYTES) {
      res.status(400).json({ error: "Invalid file size." }); return;
    }

    try {
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const found = await _findConnectGenSignupByUploadToken(db, uploadAuthToken);
      if (!found) {
        res.status(401).json({ error: "Upload link has expired or is no longer valid." }); return;
      }
      const { doc, signup } = found;
      const eventId = doc.ref.parent.parent.id;
      const signupId = doc.id;

      // Path scoping — never let a confirm call attribute a file in someone
      // else's signup folder to this signup. The signed URL minted in step 2
      // also enforces this on the Storage side, but we re-check here so a
      // tampered confirm body can't write a bad path on the signup doc.
      const expectedPrefix = `connectGen/${eventId}/${signupId}/`;
      if (!storagePath.startsWith(expectedPrefix)) {
        res.status(400).json({ error: "Storage path does not belong to this signup." }); return;
      }

      const bucket = admin.storage().bucket("ldah-932d5.firebasestorage.app");
      const [exists] = await bucket.file(storagePath).exists();
      if (!exists) {
        res.status(400).json({ error: "Upload not found in storage. Please try again." }); return;
      }

      // Inline HEIC/HEIF -> JPG conversion. iPhone uploads land as HEIC,
      // which most browsers won't render inline. Staff need to view these
      // in the document review modal, so we convert at confirm-time and
      // rewrite storagePath/mimeType/sizeBytes before the metadata write.
      // Conversion failures are non-fatal: we keep the original HEIC so the
      // file is never lost, and the audit log notes the failure.
      let convertedFromHeic = false;
      let conversionError = null;
      if (mimeType === "image/heic" || mimeType === "image/heif") {
        try {
          const [heicBuffer] = await bucket.file(storagePath).download();
          const jpgBuffer = await heicConvert({
            buffer: heicBuffer,
            format: "JPEG",
            quality: 0.85,
          });
          const newPath = storagePath.replace(/\.(heic|heif)$/i, ".jpg");
          await bucket.file(newPath).save(jpgBuffer, {
            metadata: { contentType: "image/jpeg" },
            resumable: false,
          });
          const originalPath = storagePath;
          await bucket.file(originalPath).delete().catch(() => {});
          storagePath = newPath;
          mimeType = "image/jpeg";
          originalFilename = originalFilename.replace(/\.(heic|heif)$/i, ".jpg");
          sizeBytes = jpgBuffer.length;
          convertedFromHeic = true;
        } catch (convErr) {
          console.error("HEIC conversion failed (keeping original):", convErr.message);
          conversionError = convErr.message;
        }
      }

      // Best-effort: if a prior version of this same documentType is on file,
      // delete its bytes from Storage now that the new one has landed. We
      // intentionally swallow errors — the new pointer is what matters.
      const existingDocs = (signup.connectGenDocuments && typeof signup.connectGenDocuments === "object")
        ? signup.connectGenDocuments : {};
      const prior = existingDocs[documentType];
      if (prior && prior.storagePath && prior.storagePath !== storagePath) {
        try { await bucket.file(prior.storagePath).delete(); }
        catch (e) { console.warn("Prior Connect-Gen doc cleanup failed (non-fatal):", e.message); }
      }

      const updatedDocs = Object.assign({}, existingDocs, {
        [documentType]: {
          storagePath,
          originalFilename,
          sizeBytes,
          mimeType,
          uploadedAt: FieldValue.serverTimestamp(),
        },
      });
      await doc.ref.update({ connectGenDocuments: updatedDocs });

      // Audit log — matches the existing pattern (auditLog.add with action +
      // details + performedBy + timestamp), so the daily-report changelog
      // picks it up automatically. No new collection or schema.
      try {
        let details = documentType + ": " + originalFilename + " (" + sizeBytes + " bytes)";
        if (convertedFromHeic) {
          details += " (converted from HEIC)";
        } else if (conversionError) {
          details += " (HEIC conversion failed: " + conversionError + ")";
        }
        await db.collection("auditLog").add({
          action: "Connect-Gen document uploaded",
          details,
          performedBy: signup.email || "system",
          timestamp: FieldValue.serverTimestamp(),
          signupPath: doc.ref.path,
        });
      } catch (e) { console.warn("auditLog write failed:", e.message); }

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("confirmConnectGenUpload error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

// ---------- Connect-Gen "I'll upload later" email ----------
//
// When the parent has signed the consent but isn't ready to upload yet, the
// consent page POSTs the minted uploadAuthToken here and we email a magic
// link to the standalone connect-gen-upload.html page. The link is valid
// for the same window as the uploadAuthToken itself (7 days from consent).
//
// Phase F promotion: flip CONNECT_GEN_UPLOAD_BASE_URL below from the STAGE
// path to the live path. No other code changes required.
const CONNECT_GEN_UPLOAD_BASE_URL = "https://www.ldahawaii.org/connect-gen-upload.html";

function _buildConnectGenUploadLaterEmailHtml({ firstName, uploadUrl, expiresFormatted, signatureHtml }) {
  const safeFirst = lifecycleEsc(firstName || "there");
  const safeExpires = lifecycleEsc(expiresFormatted || "");
  const btn = _emailBtn(uploadUrl, "Upload Documents", { bg: "#1a3c6e" });
  const linkFooter = _emailLinkFooter([{ label: "Upload your documents", href: uploadUrl }]);
  return [
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f7;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f4f7;padding:24px 0;">',
    '<tr><td align="center">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">',
    '<tr><td style="background:#1a3c6e;padding:18px 24px;">',
    '<p style="margin:0;font-size:18px;color:#ffffff;font-weight:700;">Upload your Connect-Gen documents</p>',
    '</td></tr>',
    '<tr><td style="padding:24px;">',
    '<p style="margin:0 0 14px;font-size:15px;color:#222;line-height:1.55;">Aloha ' + safeFirst + ',</p>',
    '<p style="margin:0 0 14px;font-size:15px;color:#222;line-height:1.55;">',
    'Mahalo for signing your Connect-Gen consent. When you\'re ready, please upload your child\'s most recent IEP and Evaluation using the secure link below:',
    '</p>',
    btn,
    '<div style="background:#FFFBEB;border:1.5px solid #F59E0B;border-left:4px solid #D97706;border-radius:8px;padding:12px 16px;margin:18px 0;color:#78350F;font-size:14px;line-height:1.55;">',
    '<strong style="color:#7C2D12;">Please upload as soon as possible.</strong> LDAH staff needs several days before your session to review the documents and prepare the most useful guidance for your family.',
    '</div>',
    (safeExpires
      ? '<p style="margin:0 0 14px;font-size:14px;color:#555;line-height:1.55;">This link will work until <strong>' + safeExpires + ' HST</strong>. If it expires before you upload, reply to this email and we\'ll send you a fresh link.</p>'
      : '<p style="margin:0 0 14px;font-size:14px;color:#555;line-height:1.55;">If the link stops working, reply to this email and we\'ll send you a fresh one.</p>'),
    '<p style="margin:18px 0 4px;font-size:15px;color:#333;line-height:1.55;">Mahalo,</p>',
    (signatureHtml || ''),
    linkFooter,
    '</td></tr>',
    '</table>',
    '</td></tr></table></body></html>',
  ].join('');
}

// Format a JS Date as a human-friendly HST string (e.g. "May 17, 2026, 3:42 PM").
function _formatHstDateTime(d) {
  if (!d || isNaN(d.getTime())) return "";
  try {
    return d.toLocaleString("en-US", {
      timeZone: "Pacific/Honolulu",
      month: "long", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch (_) {
    return d.toISOString();
  }
}

exports.sendConnectGenUploadLaterEmail = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 5, secrets: EMAIL_SECRETS })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const uploadAuthToken = (body.uploadAuthToken || "").toString().trim();
    if (!uploadAuthToken) {
      res.status(400).json({ error: "Missing uploadAuthToken" });
      return;
    }

    try {
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;

      // _findConnectGenSignupByUploadToken already enforces token presence
      // AND uploadAuthExpiresAt > now, so a null return == invalid or expired.
      const found = await _findConnectGenSignupByUploadToken(db, uploadAuthToken);
      if (!found) {
        res.status(401).json({ error: "Upload link has expired or is no longer valid." });
        return;
      }
      const { doc, signup } = found;

      // Resolve recipient email. Match the rest of the lifecycle: signup.email
      // is the canonical address (set by handleSignupCreated from the form),
      // with registration.email as a backup if a legacy signup is missing it.
      const recipientEmail = String(
        (signup && signup.email) ||
        (signup && signup.registration && signup.registration.email) ||
        ""
      ).trim();
      if (!recipientEmail) {
        res.status(400).json({ error: "Signup has no email on file. Please contact LDAH." });
        return;
      }

      // Names — same priority as setConnectGenDisposition / destruct-alert.
      const familyName = String(
        (signup && signup.name) ||
        (signup && signup.firstName) ||
        ""
      ).trim();
      const firstName = lifecycleFirstName(familyName || recipientEmail);

      const uploadUrl = CONNECT_GEN_UPLOAD_BASE_URL +
        "?upload=" + encodeURIComponent(uploadAuthToken);

      // Format the existing expiry (set at consent-submit time, 7-day window)
      // for the email so the parent knows their window.
      let expiresFormatted = "";
      try {
        if (signup.uploadAuthExpiresAt && typeof signup.uploadAuthExpiresAt.toDate === "function") {
          expiresFormatted = _formatHstDateTime(signup.uploadAuthExpiresAt.toDate());
        }
      } catch (_) {}

      const signatureHtml = await buildSignatureBlock("eventCoordinator");
      const html = _buildConnectGenUploadLaterEmailHtml({
        firstName, uploadUrl, expiresFormatted, signatureHtml,
      });

      const subject = "Upload your Connect-Gen documents -- " +
        (familyName || "LDAH");
      const fromAddress = lifecycleFromAddress();
      const eventId = doc.ref.parent.parent.id;

      await sendEmailViaResend({
        from: fromAddress,
        to: recipientEmail,
        subject,
        html,
        type: "connect-gen-upload-later",
        relatedEventId: eventId,
        relatedSignupId: doc.id,
        recipientName: familyName || "",
      });

      // Audit log so the daily-report changelog picks it up automatically.
      try {
        await db.collection("auditLog").add({
          action: "Connect-Gen upload-later email sent",
          details: "email=" + recipientEmail + ", signupPath=" + doc.ref.path,
          performedBy: recipientEmail,
          timestamp: FieldValue.serverTimestamp(),
          signupPath: doc.ref.path,
        });
      } catch (e) {
        console.warn("auditLog write failed (non-fatal):", e.message);
      }

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("sendConnectGenUploadLaterEmail error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

// Public submission endpoint for "Want to become a partner resource".
// Writes to a separate resourceApplications collection so a junk submission
// can't accidentally surface on the public Resources directory. An admin
// reviews each application in LDAH-Int and approves -> creates a real
// resources doc, or declines.
exports.submitResourceApplication = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10, secrets: EMAIL_SECRETS })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const fields = (body.fields && typeof body.fields === "object") ? body.fields : null;
    if (!fields) { res.status(400).json({ error: "Missing fields" }); return; }

    const name = String(fields.name || "").trim();
    const email = String(fields.email || "").trim();
    const contactName = String(fields.contactName || "").trim();
    if (!name) { res.status(400).json({ error: "Organization name is required." }); return; }
    if (!email) { res.status(400).json({ error: "Email is required." }); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: "Email looks invalid." }); return; }

    // Server-side URL validation — same gate as submitResourceUpdate.
    const websiteRaw = String(fields.website || "").trim();
    let websiteNormalized = "";
    if (websiteRaw) {
      const wcheck = validateAndNormalizeWebsiteUrl(websiteRaw);
      if (!wcheck.ok) { res.status(400).json({ error: wcheck.reason }); return; }
      websiteNormalized = wcheck.normalized;
    }

    // Logo URL — only accept Firebase Storage URLs from our own bucket so
    // a malicious submitter can't slip in a hotlink to anywhere else.
    const logoUrlRaw = String(fields.logoUrl || "").trim();
    let logoUrl = "";
    if (logoUrlRaw) {
      const allowed = /^https:\/\/firebasestorage\.googleapis\.com\/.+resource-application-logos%2F/i;
      if (!allowed.test(logoUrlRaw)) {
        res.status(400).json({ error: "Logo URL must be uploaded through this form." }); return;
      }
      logoUrl = logoUrlRaw;
    }

    try {
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      // Resource types: prefer the canonical `types` array; fall back to the
      // legacy single/joined `type` string for older form payloads. (2026-06-05)
      let typesArr = Array.isArray(fields.types)
        ? fields.types.map((t) => String(t || "").trim()).filter(Boolean)
        : String(fields.type || "").split(",").map((t) => t.trim()).filter(Boolean);
      typesArr = Array.from(new Set(typesArr)).slice(0, 12); // dedupe + sane cap
      const application = {
        name,
        types: typesArr,
        type: typesArr[0] || "",
        services: String(fields.services || "").trim(),
        city: String(fields.city || "").trim(),
        island: String(fields.island || "").trim(),
        phone: String(fields.phone || "").trim(),
        email,
        website: websiteNormalized,
        logoUrl,
        contactName,
        notes: String(fields.notes || "").trim(),
        status: "new",
        archived: false,
        submittedAt: FieldValue.serverTimestamp(),
      };
      const ref = await db.collection("resourceApplications").add(application);

      // Send confirmation to the applicant. La'a is the persona for the
      // partner-resource workflow (matches the update-request emails).
      try {
        const fromAddress = lifecycleFromAddress();
        const safeName = resourceUpdateEsc(name);
        const resCoord = await getPersona('resourceCoordinator');
        const resourceCoordinatorEmail = resCoord.email;
        const safeResEmail = resourceUpdateEsc(resourceCoordinatorEmail);
        const html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
          '<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1f2937">' +
          '<div style="max-width:600px;margin:0 auto;background:#fff">' +
          '<div style="background-color:#1e40af;background:linear-gradient(135deg,#1e40af,#0891B2);padding:18px 24px 22px;text-align:center;color:#fff">' +
          '<img src="https://www.ldahawaii.org/logo_blue.png" alt="LDAH" width="120" style="display:block;margin:0 auto 10px;background:#fff;border-radius:10px;padding:8px 14px;border:0;outline:none;text-decoration:none;">' +
          '<h1 style="margin:0;font-size:22px;font-weight:700">Resource Partner Application</h1></div>' +
          '<div style="padding:32px 24px">' +
          '<p style="margin:0 0 16px;font-size:16px">Aloha' + (contactName ? " " + resourceUpdateEsc(contactName) : "") + ',</p>' +
          '<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.6">Mahalo for your interest in joining the LDAH resource directory. We have received your application for <strong>' + safeName + '</strong> and will review it within 5 business days.</p>' +
          '<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.6">If approved, your listing will go live on <a href="https://www.ldahawaii.org/resources.html" style="color:#1a73e8;text-decoration:none;">ldahawaii.org</a>. If we have questions about your application, we will reach out at the email you provided.</p>' +
          '<p style="margin:24px 0 4px;font-size:15px;color:#333;line-height:1.5;">Questions in the meantime? Email <a href="mailto:' + safeResEmail + '" style="color:#1a73e8;text-decoration:none;">' + safeResEmail + '</a>.</p>' +
          '<p style="margin:16px 0 4px;font-size:15px;color:#333;line-height:1.5;">With gratitude,</p>' +
          '<p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.5;"><strong>LDAH Team</strong></p>' +
          '</div>' +
          '<div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;font-size:12px;color:#94a3b8;text-align:center">' +
          '<p style="margin:0">Leadership in Disabilities and Achievement of Hawai\'i</p>' +
          '</div></div></body></html>';
        await sendEmailViaResend({
          from: fromAddress,
          to: email,
          subject: "Application received — LDAH resource partner",
          html,
          type: "resource-application-confirmation",
          recipientName: contactName || name,
        });
      } catch (emailErr) {
        // Don't fail the whole submit if confirmation email fails — log it.
        console.error("submitResourceApplication confirmation email failed:", emailErr.message);
      }

      res.status(200).json({ ok: true, applicationId: ref.id });
    } catch (err) {
      console.error("submitResourceApplication error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

// ---------------------------------------------------------------------------
// Resource update nudge cycle schedule.
// Source of truth is the Firestore doc system/resourceNudgeCycle, which staff
// edit from LDAH-Int (Resources page) — so the dates self-manage across years
// with no code change. If the doc is missing/malformed we fall back to the
// historical hardcoded cadence: Spring May 1 -> Jul 31, Fall Nov 1 -> Jan 31,
// 7-day grace. A deadline month earlier than the start month rolls the deadline
// into the NEXT calendar year (that's how Fall's Jan 31 is derived).
// ---------------------------------------------------------------------------
const RESOURCE_NUDGE_CYCLE_DEFAULTS = {
  graceDays: 7,
  cycles: [
    { label: "Spring", startMonth: 5,  startDay: 1, deadlineMonth: 7, deadlineDay: 31 },
    { label: "Fall",   startMonth: 11, startDay: 1, deadlineMonth: 1, deadlineDay: 31 }
  ]
};

async function _loadNudgeCycleConfig(db) {
  try {
    const snap = await db.collection("system").doc("resourceNudgeCycle").get();
    if (snap.exists) {
      const c = snap.data() || {};
      if (Array.isArray(c.cycles) && c.cycles.length) {
        return { graceDays: (typeof c.graceDays === "number" ? c.graceDays : 7), cycles: c.cycles };
      }
    }
  } catch (e) { console.warn("_loadNudgeCycleConfig:", e.message); }
  return RESOURCE_NUDGE_CYCLE_DEFAULTS;
}

function _ndPad2(n) { return String(n).padStart(2, "0"); }

// Resolve the cycle currently in effect for `nowMs` from the config. Returns:
//   { cycleStartMs, graceWindowMs, deadlineMs, deadlineDateKey, cycleKey, label }
// deadlineMs is 23:59:59 HST on the deadline date.
function _resourceCycleForNow(nowMs, config) {
  const cycles = (config && config.cycles && config.cycles.length) ? config.cycles : RESOURCE_NUDGE_CYCLE_DEFAULTS.cycles;
  const graceDays = (config && typeof config.graceDays === "number") ? config.graceDays : 7;
  const nowYr = new Date(nowMs).getUTCFullYear();
  const candidates = [];
  for (const yr of [nowYr - 1, nowYr, nowYr + 1]) {
    for (const cyc of cycles) {
      const startMs = Date.UTC(yr, cyc.startMonth - 1, cyc.startDay);
      if (startMs > nowMs) continue;
      const dlYear = (cyc.deadlineMonth < cyc.startMonth) ? yr + 1 : yr;
      candidates.push({
        cycleStartMs: startMs,
        deadlineMs: Date.UTC(dlYear, cyc.deadlineMonth - 1, cyc.deadlineDay, 23 + 10, 59, 59),
        deadlineDateKey: dlYear + "-" + _ndPad2(cyc.deadlineMonth) + "-" + _ndPad2(cyc.deadlineDay),
        cycleKey: yr + "-" + _ndPad2(cyc.startMonth) + "-" + _ndPad2(cyc.startDay),
        label: cyc.label || ""
      });
    }
  }
  candidates.sort((a, b) => b.cycleStartMs - a.cycleStartMs);
  const cur = candidates[0] || {
    cycleStartMs: Date.UTC(nowYr, 4, 1),
    deadlineMs: Date.UTC(nowYr, 6, 31, 23 + 10, 59, 59),
    deadlineDateKey: nowYr + "-07-31", cycleKey: nowYr + "-05-01", label: "Spring"
  };
  cur.graceWindowMs = cur.cycleStartMs - graceDays * 24 * 60 * 60 * 1000;
  return cur;
}

// Shared helper used by the Wednesday cron and the manual HTTPS trigger.
// Eligibility matches the CMS dashboard's "awaiting" bucket exactly:
//   - Is a partner directory entry (has non-empty `name`)
//   - Not archived
//   - Has email
//   - Has an updateToken (so the form link works)
//   - lastUpdateAt AND updateSubmittedAt both older than the 7-day grace
//     window before the current cycle start (May 1 / Nov 1)
//
// Notes:
//   - No per-resource cadence (the Wednesday cron is the cadence)
//   - No nudge cap (we keep nudging until they respond or deadline)
//   - updateNudgeCount + lastUpdateNudgeAt still increment for reporting,
//     just not used as gates
async function _runResourceUpdateNudges(opts) {
  const dryRun = !!(opts && opts.dryRun);
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;
  const now = Date.now();

  const cycleConfig = await _loadNudgeCycleConfig(db);
  const cyc = _resourceCycleForNow(now, cycleConfig);
  if (now > cyc.deadlineMs) {
    console.log("_runResourceUpdateNudges: past deadline " + cyc.deadlineDateKey + ", skipping all sends");
    return { scanned: 0, eligible: 0, sent: 0, failed: 0, skippedDeadline: true };
  }

  const graceWindow = cyc.graceWindowMs;
  const fromAddress = lifecycleFromAddress();
  const signatureHtml = await buildSignatureBlock("resourceCoordinator");
  const donateHtml = await buildDonateBlock("universal");
  const resCoord = await getPersona("resourceCoordinator");
  const resourceCoordinatorEmail = resCoord ? resCoord.email : "";

  const snap = await db.collection("resources").get();
  let scanned = 0;
  let eligible = 0;
  let sent = 0;
  let failed = 0;
  const eligibleList = [];

  for (const d of snap.docs) {
    scanned++;
    const r = d.data() || {};
    if (r.archived === true) continue;
    const name = String(r.name || "").trim();
    if (!name) continue; // skip Downloads-metadata docs in the same collection
    const email = String(r.email || "").trim();
    if (!email) continue;
    if (!r.updateToken) continue;
    const lu = r.lastUpdateAt && r.lastUpdateAt.toMillis ? r.lastUpdateAt.toMillis() : 0;
    const subAt = r.updateSubmittedAt && r.updateSubmittedAt.toMillis ? r.updateSubmittedAt.toMillis() : 0;
    if (lu >= graceWindow || subAt >= graceWindow) continue;

    eligible++;
    eligibleList.push({ id: d.id, name, email });
    if (dryRun) continue;

    try {
      const html = buildResourceUpdateEmailHtml({
        resource: r, token: r.updateToken, isNudge: true,
        signatureHtml, donateHtml, resourceCoordinatorEmail,
      });
      await sendEmailViaResend({
        from: fromAddress,
        to: email,
        subject: "Reminder: Update your LDAH Resource Card",
        html,
        type: "resource-update-nudge",
        recipientName: name,
      });
      await d.ref.update({
        updateNudgeCount: FieldValue.increment(1),
        lastUpdateNudgeAt: FieldValue.serverTimestamp(),
      });
      sent++;
    } catch (err) {
      failed++;
      console.error("_runResourceUpdateNudges failed for " + email + ":", err.message);
    }
  }

  console.log("_runResourceUpdateNudges: scanned=" + scanned + " eligible=" + eligible + " sent=" + sent + " failed=" + failed + (dryRun ? " (dryRun)" : ""));
  return { scanned, eligible, sent, failed, eligibleList };
}

// Weekly Wednesday 9am HST. Synchronous nudge wave to every partner whose
// resource card hasn't been confirmed this cycle. Replaces the previous
// per-resource daily cadence with 3-nudge cap — the cron itself is the
// cadence now.
exports.sendResourceUpdateNudges = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1, secrets: EMAIL_SECRETS })
  .pubsub.schedule("0 9 * * 3")
  .timeZone("Pacific/Honolulu")
  .onRun(async () => {
    await _runResourceUpdateNudges({});
    return null;
  });

// Manual fire button. Same logic as the cron. Pass ?dryRun=1 to get the
// eligible-partner list without sending. No auth — the URL is admin-scoped
// by being unguessable (same posture as sendResourceUpdateRequests).
exports.triggerResourceUpdateNudgesNow = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1, secrets: EMAIL_SECRETS })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true" || (req.body && req.body.dryRun === true);
    try {
      const stats = await _runResourceUpdateNudges({ dryRun });
      res.status(200).json({ ok: true, dryRun, ...stats });
    } catch (err) {
      console.error("triggerResourceUpdateNudgesNow error:", err);
      res.status(500).json({ ok: false, error: err.message || String(err) });
    }
  });

// ─────────────────────────────────────────────────────────────────────
// cleanupStalePendings — daily 8 AM HST sweep of ghost-pending signups
//
// Why: signups can get stuck on status='pending' even after their lifecycle
// is complete (session passed + attendance marked or feedback submitted).
// The most common cause is share-registration chains where a parent signup
// stays "pending" forever after its session passes. Result: the dashboard
// pending count is inflated and admins see "2 pending" but only 1 visible.
//
// What: scans events + recurringEvents subcollections; for any signup where
// status in ('pending','new'), archived !== true, ALL selectedSessions are
// in the past, AND (sessionAttendance has at least one entry OR
// feedbackSubmittedAt is set), flips it to status='completed', archived=true,
// stamps closedReason. Refreshes parent's denormalized signupCount/pendingCount.
//
// Safe rerun: idempotent — only acts on docs that match the rule.
// ─────────────────────────────────────────────────────────────────────
exports.cleanupStalePendings = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1 })
  .pubsub.schedule("0 8 * * *")
  .timeZone("Pacific/Honolulu")
  .onRun(async () => {
    const db = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;
    const todayKey = toHstDateKey(new Date());

    function extractDate(s) {
      if (!s) return null;
      const m = String(s).match(/^(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : null;
    }

    let scanned = 0;
    let closed = 0;
    const touchedParents = new Set();

    for (const col of ["events", "recurringEvents"]) {
      const parentSnap = await db.collection(col).get();
      for (const parent of parentSnap.docs) {
        const sigs = await parent.ref.collection("signups").get();
        for (const s of sigs.docs) {
          scanned++;
          const d = s.data() || {};
          if (d.archived === true) continue;
          if (d.status !== "pending" && d.status !== "new") continue;

          const dates = (d.selectedSessions || []).map(extractDate).filter(Boolean);
          if (!dates.length) continue;
          const allPast = dates.every((dt) => dt < todayKey);
          if (!allPast) continue;

          const hasAttendance = d.sessionAttendance && Object.keys(d.sessionAttendance).length > 0;
          const hasFeedback = !!d.feedbackSubmittedAt;
          if (!hasAttendance && !hasFeedback) continue;

          try {
            await s.ref.update({
              status: "completed",
              archived: true,
              archivedAt: FieldValue.serverTimestamp(),
              archivedBy: "cleanupStalePendings",
              archivedReason: "Auto-closed: all sessions past, lifecycle complete (attendance=" +
                hasAttendance + ", feedback=" + hasFeedback + ")",
            });
            closed++;
            touchedParents.add(col + "/" + parent.id);
            console.log("cleanupStalePendings: closed " + col + "/" + parent.id +
              "/signups/" + s.id + " (" + (d.name || d.email || "?") + ")");
          } catch (err) {
            console.error("cleanupStalePendings: failed to close " + s.id + ":", err.message);
          }
        }
      }
    }

    // Refresh denormalized counts on any parent that had a close-out
    for (const path of touchedParents) {
      try {
        const [col, eventId] = path.split("/");
        const allSnap = await db.collection(col).doc(eventId).collection("signups").get();
        let pc = 0;
        let sc = 0;
        allSnap.forEach((doc) => {
          const d = doc.data();
          if (d.archived === true) return;
          sc++;
          if (d.status === "pending" || d.status === "new") pc++;
        });
        await db.collection(col).doc(eventId).update({ signupCount: sc, pendingCount: pc });
      } catch (err) {
        console.warn("cleanupStalePendings: count refresh skipped for " + path + ":", err.message);
      }
    }

    console.log("cleanupStalePendings: scanned=" + scanned + " closed=" + closed +
      " parentsRecounted=" + touchedParents.size);
    return null;
  });

// ─────────────────────────────────────────────────────────────────────
// Pre-fill verification (B'' flow — Daniel approved 2026-05-02)
//
// Returning families type their email on the signup form; we look up
// their contact, send a 6-digit code to their email, they type it back,
// and the form pre-populates with everything we have on file (name,
// phone, address, demographics, children). Editable on the spot.
//
// Privacy gate: a stranger who knows somebody else's email can't see
// their data. The OTP proves the requester has access to that inbox.
//
// Anti-enumeration: requestPrefillCode ALWAYS returns ok=true, even
// when no contact exists. The legitimate user knows whether they have
// an account; we don't reveal it to attackers.
//
// Rate limits:
//   - Max 1 code request per email per 60 seconds (replay protection)
//   - Code expires after 10 minutes
//   - 5 wrong attempts locks the code (must request a new one)
//
// Storage: prefillCodes/{base64email} doc with {codeHash, expiresAt,
// attempts, requestedAt}. Code is sha256-hashed at rest.
// ─────────────────────────────────────────────────────────────────────

const PREFILL_CODE_TTL_MS = 10 * 60 * 1000;
const PREFILL_CODE_MIN_INTERVAL_MS = 60 * 1000;
const PREFILL_CODE_MAX_ATTEMPTS = 5;

function _prefillEmailKey(email) {
  // Base64url(email-lowercase) — Firestore doc ID safe, deterministic.
  return Buffer.from(String(email || "").trim().toLowerCase(), "utf8")
    .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function _hashCode(code, email) {
  return crypto.createHash("sha256")
    .update(String(code) + "|" + String(email || "").trim().toLowerCase())
    .digest("hex");
}
function _generatePrefillCode() {
  // 6 digits, leading zeros preserved.
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

exports.requestPrefillCode = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10, secrets: ["RESEND_API_KEY", "SMTP_FROM"] })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const email = String((req.body || {}).email || "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      // Bad input — still return ok to avoid leaking format checks.
      res.status(200).json({ ok: true });
      return;
    }

    const db = admin.firestore();
    const codeKey = _prefillEmailKey(email);
    const codeRef = db.collection("prefillCodes").doc(codeKey);

    try {
      // Rate limit: refuse if a code was requested in the last 60s.
      const existing = await codeRef.get();
      if (existing.exists) {
        const d = existing.data() || {};
        const reqAtMs = (d.requestedAt && d.requestedAt.toMillis) ? d.requestedAt.toMillis() : 0;
        if (reqAtMs && (Date.now() - reqAtMs) < PREFILL_CODE_MIN_INTERVAL_MS) {
          // Within rate-limit window — still return ok (don't reveal we're rate-limiting).
          res.status(200).json({ ok: true });
          return;
        }
      }

      // Look up the contact. If none exists, return ok WITHOUT sending an
      // email or storing a code — anti-enumeration plus no wasted Resend send.
      const contactSnap = await db.collection("contacts").where("email", "==", email).limit(1).get();
      if (contactSnap.empty) {
        res.status(200).json({ ok: true });
        return;
      }

      // Generate + store the code (hashed).
      const code = _generatePrefillCode();
      const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + PREFILL_CODE_TTL_MS);
      await codeRef.set({
        codeHash: _hashCode(code, email),
        expiresAt,
        attempts: 0,
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Send the email. Subject contains the code so it shows in inbox previews.
      const fromAddress = process.env.SMTP_FROM || "registration@ldahawaii.org";
      const html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
        '<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;">' +
        '<tr><td align="center" style="padding:24px 16px;">' +
        '<table role="presentation" width="500" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;max-width:500px;width:100%;">' +
        '<tr><td style="background:#1a3c6e;padding:20px 24px;text-align:center;">' +
          '<img src="https://www.ldahawaii.org/logo_blue.png" alt="LDAH" width="100" style="display:block;margin:0 auto 8px;background:#fff;border-radius:8px;padding:8px;">' +
          '<h1 style="margin:0;color:#fff;font-size:18px;">Verification Code</h1>' +
        '</td></tr>' +
        '<tr><td style="padding:32px 24px;">' +
          '<p style="margin:0 0 16px;font-size:15px;color:#333;">Use this 6-digit code to pre-fill your LDAH registration with your information on file:</p>' +
          '<div style="background:#f0f9ff;border:2px solid #1a3c6e;border-radius:10px;padding:20px;text-align:center;margin:18px 0;">' +
            '<div style="font-size:36px;font-weight:700;letter-spacing:6px;color:#1a3c6e;font-family:Courier,monospace;">' + code + '</div>' +
          '</div>' +
          '<p style="margin:0 0 8px;font-size:13px;color:#666;">This code expires in 10 minutes. If you didn\'t request it, you can safely ignore this email.</p>' +
        '</td></tr>' +
        '</table></td></tr></table></body></html>';
      try {
        await sendEmailViaResend({
          from: `LDAH <${fromAddress}>`,
          to: email,
          subject: "Your LDAH verification code: " + code,
          html,
          type: "prefill-code",
          recipientName: "",
        });
      } catch (sendErr) {
        // Logged but don't reveal failure to caller (anti-enumeration).
        console.error("requestPrefillCode send failed for", email, ":", sendErr.message);
      }
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("requestPrefillCode error:", err.message);
      // Still return ok — never leak server state.
      res.status(200).json({ ok: true });
    }
  });

exports.verifyPrefillCodeAndPrefill = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").trim();
    if (!email || !code) { res.status(400).json({ error: "Missing email or code" }); return; }
    if (!/^\d{6}$/.test(code)) { res.status(400).json({ error: "Code must be 6 digits" }); return; }

    const db = admin.firestore();
    const codeKey = _prefillEmailKey(email);
    const codeRef = db.collection("prefillCodes").doc(codeKey);

    try {
      const snap = await codeRef.get();
      if (!snap.exists) { res.status(400).json({ error: "Invalid or expired code. Please request a new one." }); return; }
      const d = snap.data() || {};

      // Expired?
      const expiresMs = (d.expiresAt && d.expiresAt.toMillis) ? d.expiresAt.toMillis() : 0;
      if (!expiresMs || expiresMs < Date.now()) {
        await codeRef.delete().catch(() => {});
        res.status(400).json({ error: "Code expired. Please request a new one." }); return;
      }

      // Locked?
      if ((d.attempts || 0) >= PREFILL_CODE_MAX_ATTEMPTS) {
        await codeRef.delete().catch(() => {});
        res.status(400).json({ error: "Too many attempts. Please request a new code." }); return;
      }

      // Hash compare.
      const submittedHash = _hashCode(code, email);
      if (submittedHash !== d.codeHash) {
        await codeRef.update({ attempts: admin.firestore.FieldValue.increment(1) });
        const remaining = PREFILL_CODE_MAX_ATTEMPTS - ((d.attempts || 0) + 1);
        res.status(400).json({ error: "Wrong code. " + (remaining > 0 ? remaining + " attempt(s) left." : "Please request a new code.") }); return;
      }

      // Verified — burn the code and return contact data.
      await codeRef.delete().catch(() => {});

      const contactSnap = await db.collection("contacts").where("email", "==", email).limit(1).get();
      if (contactSnap.empty) {
        res.status(404).json({ error: "Contact not found." }); return;
      }
      const c = contactSnap.docs[0].data() || {};

      // Return the demographic shape the registration form needs. Match the
      // canonical schema (feedback_demographic-schema-canonical.md) so the
      // form can drop these straight into its inputs.
      res.status(200).json({
        ok: true,
        prefill: {
          firstName: c.firstName || "",
          lastName: c.lastName || "",
          displayName: c.displayName || "",
          email: c.email || "",
          phone: c.phone || "",
          streetAddress: c.streetAddress || "",
          city: c.city || "",
          zipCode: c.zipCode || "",
          militaryStatus: c.militaryStatus || "",
          militaryBranch: c.militaryBranch || "",
          ethnicity: c.ethnicity || "",
          priorTraining: c.priorTraining || "",
          priorTrainingDate: c.priorTrainingDate || "",
          howHeard: c.howHeard || "",
          accommodations: c.accommodations || "",
          children: Array.isArray(c.children) ? c.children.map(ch => ({
            name: ch.name || "",
            ageRange: ch.ageRange || ch.childAgeRange || "",
            gender: ch.gender || ch.childGender || "",
            ethnicity: ch.ethnicity || "",
            disabilityCategories: Array.isArray(ch.disabilityCategories) ? ch.disabilityCategories : [],
          })) : [],
        },
      });
    } catch (err) {
      console.error("verifyPrefillCodeAndPrefill error:", err.message);
      res.status(500).json({ error: "Server error. Please try again." });
    }
  });

// ──────────────────────────────────────────────────────────────────────────
// Anti-Bullying Pledge → confirmation email
// Fires on Firestore create at pledges/{id}. Sends a thank-you email with
// the pledge text restated, a link to the Bullying Response Kit on the
// public community page, and a curated list of the most useful PDF
// resources. Donate block included for Parent / Professional / Both;
// SKIPPED for Student per Daniel's spec.
// Idempotent: writes confirmationEmailSentAt — re-runs are no-ops.
// ──────────────────────────────────────────────────────────────────────────

const PLEDGE_TEXT =
  "I pledge to help end bullying in my community. I will support others who have been hurt or harmed, treat others with kindness, be more accepting of people's differences, and help include those who are left out.";

const PLEDGE_RESOURCES = [
  { label: "Bullying Checklist", href: "https://www.ldahawaii.org/assets/docs/wp/Bullying-Check-list.pdf" },
  { label: "IDEA Sample Letter to Principal", href: "https://www.ldahawaii.org/assets/docs/wp/IDEA-Sample-Letter-to-Principal.pdf" },
  { label: "504 Sample Letter to Principal", href: "https://www.ldahawaii.org/assets/docs/wp/504-Sample-Letter-to-Principal.pdf" },
  { label: "Elementary Cyberbullying Prevention", href: "https://www.ldahawaii.org/assets/docs/wp/BP-101-elementary-cyberbullying.pdf" },
  { label: "Middle/High School Cyberbullying Prevention", href: "https://www.ldahawaii.org/assets/docs/wp/BP-101-middle-high-cyberbullying.pdf" },
];

function buildPledgeConfirmationEmailHtml({
  name, role, signatureHtml, donateHtml, orgFooterHtml,
}) {
  const safeName = _emailEsc(name || "friend");
  const greeting = `Aloha ${safeName},`;
  const resourcesList = PLEDGE_RESOURCES
    .map((r) => `<li style="margin:6px 0;font-size:15px;color:#333333;line-height:1.5;">
      <a href="${_emailEsc(r.href)}" target="_blank" style="color:#1a3c6e;text-decoration:underline;">${_emailEsc(r.label)}</a>
    </li>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
  <tr><td style="background-color:#ffffff;padding:28px 32px 20px;text-align:center;border-bottom:3px solid #1a3c6e;">
    <img src="https://www.ldahawaii.org/logo_blue.png" alt="Leadership in Disabilities &amp; Achievement of Hawai'i" width="150" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;">
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="margin:0 0 16px;font-size:16px;color:#333333;">${greeting}</p>

    <p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">
      <strong>Mahalo nui loa</strong> for taking the pledge to help end bullying in our community. Your commitment matters &mdash; together we can make our schools and neighborhoods safer for every keiki.
    </p>

    <div style="margin:16px 0;padding:16px 18px;background:#f4f8fc;border-left:4px solid #1a3c6e;border-radius:4px;">
      <p style="margin:0 0 4px;font-size:14px;color:#1a3c6e;font-weight:bold;text-transform:uppercase;letter-spacing:.04em;">Your Pledge</p>
      <p style="margin:0;font-size:15px;color:#333333;line-height:1.6;font-style:italic;">${_emailEsc(PLEDGE_TEXT)}</p>
    </div>

    <p style="margin:24px 0 12px;font-size:16px;color:#333333;line-height:1.5;">
      We&rsquo;ve put together a <strong>Bullying Response Kit</strong> with practical tools you can use right away &mdash; sample letters, checklists, and prevention guides for every age group.
    </p>

    ${_emailBtn("https://www.ldahawaii.org/community.html", "View the Full Response Kit", { bg: "#1a3c6e", align: "center" })}

    <p style="margin:28px 0 8px;font-size:15px;color:#333333;line-height:1.5;font-weight:700;">A few resources to start with:</p>
    <ul style="margin:0 0 20px;padding-left:22px;">${resourcesList}</ul>

    <p style="margin:20px 0 0;font-size:15px;color:#555555;line-height:1.6;">
      If you ever need to talk through a specific situation, our team is here. Call us at <strong>(808) 536-9684</strong> or reply to this email.
    </p>

    <p style="margin:24px 0 4px;font-size:15px;color:#333333;line-height:1.5;">With gratitude,</p>
    <p style="margin:0 0 16px;font-size:15px;color:#333333;line-height:1.5;"><strong>The LDAH Team</strong></p>

    ${donateHtml || ""}
    ${signatureHtml || ""}
  </td></tr>
  ${orgFooterHtml || ""}
</table>
</td></tr></table></body></html>`;
}

exports.onPledgeCreated = functions
  .runWith({ timeoutSeconds: 60, secrets: ["RESEND_API_KEY", "SMTP_FROM"] })
  .firestore.document("pledges/{pledgeId}")
  .onCreate(async (snap, context) => {
    const pledge = snap.data() || {};
    const email = (pledge.email || "").trim();
    if (!email) {
      console.log(`onPledgeCreated: no email on pledge ${snap.id}, skipping.`);
      return null;
    }
    if (pledge.confirmationEmailSentAt) {
      // Idempotent guard — re-runs (e.g., from data backfills) shouldn't double-send.
      return null;
    }

    const name = (pledge.name || "").trim() || "friend";
    const role = String(pledge.role || "").trim();

    // Donate block conditional: Parent / Professional / Both → include; Student → skip.
    const includeDonate = role !== "Student";
    const signatureHtml = await buildSignatureBlock("eventCoordinator");
    const donateHtml = includeDonate ? await buildDonateBlock("universal") : "";
    const orgFooterHtml = await getOrgFooterHtml();

    const html = buildPledgeConfirmationEmailHtml({
      name, role, signatureHtml, donateHtml, orgFooterHtml,
    });
    const subject = "Mahalo for taking the pledge -- your Bullying Response Kit";
    const fromAddress = process.env.SMTP_FROM || "onboarding@resend.dev";

    try {
      await sendEmailViaResend({
        from: `LDAH <${fromAddress}>`,
        to: email,
        subject,
        html,
        type: "anti-bullying-pledge-confirmation",
        relatedSignupId: snap.id,
        recipientName: name,
      });
      // Auto-acknowledge: flips the LDAH-Int pledge card out of the
      // "new" alert bucket so staff don't see redundant action items
      // for pledges the system already responded to.
      await snap.ref.update({
        confirmationEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        status: "acknowledged",
        statusChangedAt: admin.firestore.FieldValue.serverTimestamp(),
        statusChangedBy: "system (auto-ack on email send)",
      });
    } catch (err) {
      console.error("onPledgeCreated send failed:", err.message);
      await snap.ref.update({
        confirmationEmailError: String(err.message || err),
      }).catch(() => {});
    }
    return null;
  });

// ───────────────────────────────────────────────────────────────────────
// Connect-Gen Phase D: staff-side document review CFs
//
// These complement Phase A-C (parent upload). They are POST endpoints
// authenticated via a Firebase Auth ID token in the request body — the CF
// verifies the token, looks up userRoles/{uid}, and enforces
// admin/superAdmin only. All writes/deletes route through here so audit
// logging is server-authoritative and Storage rules continue to block
// direct client deletes.
//
//   - setConnectGenDisposition   : mark family as noSupport or caseAdvocacy.
//                                  noSupport also destroys files immediately
//                                  (consent: destroyed within 24h of session).
//   - destroyConnectGenDocuments : manual destroy regardless of disposition.
// ───────────────────────────────────────────────────────────────────────

// Verify the ID token in the request body, then look up userRoles/{uid} and
// confirm admin/superAdmin. Returns { uid, email, role, name } on success,
// or throws an Error tagged with .statusCode = 401/403 for the caller.
async function _verifyStaffIdToken(idTokenRaw) {
  const idToken = String(idTokenRaw || "").trim();
  if (!idToken) { const e = new Error("Missing idToken"); e.statusCode = 401; throw e; }
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    const e = new Error("Invalid or expired idToken");
    e.statusCode = 401;
    throw e;
  }
  const uid = decoded.uid;
  const roleSnap = await admin.firestore().collection("userRoles").doc(uid).get();
  if (!roleSnap.exists) {
    const e = new Error("No staff role on file for this user");
    e.statusCode = 403;
    throw e;
  }
  const data = roleSnap.data() || {};
  const role = data.role || "";
  if (role !== "admin" && role !== "superAdmin") {
    const e = new Error("Admin only");
    e.statusCode = 403;
    throw e;
  }
  return {
    uid,
    email: decoded.email || data.email || "",
    role,
    name: data.name || decoded.name || decoded.email || uid,
  };
}

// Best-effort delete of both Connect-Gen storage files referenced by the
// signup's connectGenDocuments map. Swallows not-found errors. Returns the
// list of paths actually deleted (for audit detail).
async function _destroyConnectGenStorageFiles(connectGenDocuments) {
  const bucket = admin.storage().bucket("ldah-932d5.firebasestorage.app");
  const deleted = [];
  const errors = [];
  const docs = (connectGenDocuments && typeof connectGenDocuments === "object") ? connectGenDocuments : {};
  for (const type of ["iep", "evaluation"]) {
    const rec = docs[type];
    if (!rec || !rec.storagePath) continue;
    try {
      await bucket.file(rec.storagePath).delete();
      deleted.push(rec.storagePath);
    } catch (err) {
      // Treat "not found" as success — file may have been removed earlier.
      if (err && (err.code === 404 || /no such object/i.test(err.message || ""))) {
        deleted.push(rec.storagePath + " (already gone)");
      } else {
        errors.push(type + ": " + (err.message || String(err)));
      }
    }
  }
  return { deleted, errors };
}

// Resolve the signup doc, accepting either an explicit collection override
// or defaulting to recurringEvents -> events. Connect-Gen lives at
// recurringEvents/CmkPXEpPwfAQ5sR377K2/signups/{id} but we keep events/
// support so a one-off Connect-Gen-style event could reuse this CF later.
async function _findConnectGenSignupDoc(eventId, signupId, preferredCollection) {
  const db = admin.firestore();
  const order = preferredCollection === "events"
    ? ["events", "recurringEvents"]
    : ["recurringEvents", "events"];
  for (const col of order) {
    const ref = db.collection(col).doc(eventId).collection("signups").doc(signupId);
    const snap = await ref.get();
    if (snap.exists) return { ref, snap, collection: col };
  }
  return null;
}

exports.setConnectGenDisposition = functions
  .runWith({ timeoutSeconds: 60, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const eventId = String(body.eventId || "").trim();
    const signupId = String(body.signupId || "").trim();
    const disposition = String(body.disposition || "").trim();
    const preferredCollection = String(body.collection || "").trim();

    if (!eventId) { res.status(400).json({ error: "Missing eventId" }); return; }
    if (!signupId) { res.status(400).json({ error: "Missing signupId" }); return; }
    if (disposition !== "noSupport" && disposition !== "caseAdvocacy") {
      res.status(400).json({ error: "disposition must be 'noSupport' or 'caseAdvocacy'" });
      return;
    }

    let staff;
    try {
      staff = await _verifyStaffIdToken(body.idToken);
    } catch (err) {
      res.status(err.statusCode || 401).json({ error: err.message }); return;
    }

    try {
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const found = await _findConnectGenSignupDoc(eventId, signupId, preferredCollection);
      if (!found) { res.status(404).json({ error: "Signup not found" }); return; }
      const { ref, snap } = found;
      const signup = snap.data() || {};

      const performedBy = staff.email || staff.name || staff.uid;
      const updates = {
        connectGenDisposition: disposition,
        connectGenDispositionAt: FieldValue.serverTimestamp(),
        connectGenDispositionBy: performedBy,
      };

      let destroyDetail = "";
      if (disposition === "noSupport") {
        // Same-day destroy per consent terms.
        const result = await _destroyConnectGenStorageFiles(signup.connectGenDocuments);
        destroyDetail = " — files deleted: " + (result.deleted.length || 0) +
          (result.errors.length ? " (errors: " + result.errors.join("; ") + ")" : "");
        updates.connectGenDocuments = FieldValue.delete();
        updates.connectGenDocumentsDestroyedAt = FieldValue.serverTimestamp();
        updates.connectGenDocumentsDestroyedBy = performedBy;
        updates.connectGenDocumentsDestroyedReason = "disposition: No Additional Support";
      }

      await ref.update(updates);

      const dispLabel = disposition === "noSupport"
        ? "No Additional Support (documents destroyed)"
        : "Case Advocacy (documents retained)";
      try {
        await db.collection("auditLog").add({
          action: "Connect-Gen disposition: " + dispLabel,
          details: (signup.name || signup.firstName || "(unknown)") +
            " — signup " + signupId + destroyDetail,
          performedBy,
          performedByRole: staff.role,
          timestamp: FieldValue.serverTimestamp(),
          signupPath: ref.path,
        });
      } catch (e) { console.warn("auditLog write failed:", e.message); }

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("setConnectGenDisposition error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

exports.destroyConnectGenDocuments = functions
  .runWith({ timeoutSeconds: 60, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const eventId = String(body.eventId || "").trim();
    const signupId = String(body.signupId || "").trim();
    const reasonRaw = String(body.reason || "").trim();
    const reason = reasonRaw || "manual destroy";
    const preferredCollection = String(body.collection || "").trim();

    if (!eventId) { res.status(400).json({ error: "Missing eventId" }); return; }
    if (!signupId) { res.status(400).json({ error: "Missing signupId" }); return; }

    let staff;
    try {
      staff = await _verifyStaffIdToken(body.idToken);
    } catch (err) {
      res.status(err.statusCode || 401).json({ error: err.message }); return;
    }

    try {
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const found = await _findConnectGenSignupDoc(eventId, signupId, preferredCollection);
      if (!found) { res.status(404).json({ error: "Signup not found" }); return; }
      const { ref, snap } = found;
      const signup = snap.data() || {};

      const result = await _destroyConnectGenStorageFiles(signup.connectGenDocuments);
      const performedBy = staff.email || staff.name || staff.uid;

      await ref.update({
        connectGenDocuments: FieldValue.delete(),
        connectGenDocumentsDestroyedAt: FieldValue.serverTimestamp(),
        connectGenDocumentsDestroyedBy: performedBy,
        connectGenDocumentsDestroyedReason: reason,
      });

      try {
        await db.collection("auditLog").add({
          action: "Connect-Gen documents destroyed: " + reason,
          details: (signup.name || signup.firstName || "(unknown)") +
            " — signup " + signupId + " — files deleted: " + (result.deleted.length || 0) +
            (result.errors.length ? " (errors: " + result.errors.join("; ") + ")" : ""),
          performedBy,
          performedByRole: staff.role,
          timestamp: FieldValue.serverTimestamp(),
          signupPath: ref.path,
        });
      } catch (e) { console.warn("auditLog write failed:", e.message); }

      res.status(200).json({ ok: true, deleted: result.deleted.length, errors: result.errors });
    } catch (err) {
      console.error("destroyConnectGenDocuments error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

// ───────────────────────────────────────────────────────────────────────
// getConnectGenDocumentDownloadUrl
// ───────────────────────────────────────────────────────────────────────
// Returns a short-lived V4 signed READ URL for a Connect-Gen confidential
// document (IEP or Evaluation). All staff document reads route through
// this CF instead of client-side firebase.storage().getDownloadURL() so:
//   1. Storage rules can keep `allow read: if false` (no client SDK reads).
//   2. Every URL issuance is audit-logged with staff identity.
//   3. Signed URLs expire in 10 minutes — easy to invalidate by policy.
// V4 signing relies on the App Engine default SA having the
// roles/iam.serviceAccountTokenCreator role on itself, plus the
// iamcredentials.googleapis.com API enabled (both set up 2026-05-10).
// ───────────────────────────────────────────────────────────────────────
exports.getConnectGenDocumentDownloadUrl = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const eventId = String(body.eventId || "").trim();
    const signupId = String(body.signupId || "").trim();
    const documentType = String(body.documentType || "").trim();
    const preferredCollection = String(body.collection || "").trim();

    if (!eventId) { res.status(400).json({ error: "Missing eventId" }); return; }
    if (!signupId) { res.status(400).json({ error: "Missing signupId" }); return; }
    if (documentType !== "iep" && documentType !== "evaluation") {
      res.status(400).json({ error: "documentType must be 'iep' or 'evaluation'" });
      return;
    }

    let staff;
    try {
      staff = await _verifyStaffIdToken(body.idToken);
    } catch (err) {
      res.status(err.statusCode || 401).json({ error: err.message }); return;
    }

    try {
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const found = await _findConnectGenSignupDoc(eventId, signupId, preferredCollection);
      if (!found) { res.status(404).json({ error: "Signup not found" }); return; }
      const { ref, snap } = found;
      const signup = snap.data() || {};

      const docs = (signup.connectGenDocuments && typeof signup.connectGenDocuments === "object")
        ? signup.connectGenDocuments : {};
      const rec = docs[documentType];
      if (!rec || !rec.storagePath) {
        res.status(404).json({ error: "Document not found on signup" });
        return;
      }
      const storagePath = String(rec.storagePath || "");
      const expectedPrefix = "connectGen/" + eventId + "/" + signupId + "/";
      if (storagePath.indexOf(expectedPrefix) !== 0) {
        // Defense-in-depth: the storagePath on the doc must live under the
        // event/signup folder it claims to belong to. Refuse to sign any
        // other path even if the caller is admin.
        res.status(400).json({ error: "storagePath does not match event/signup folder" });
        return;
      }

      const expiresAt = Date.now() + 10 * 60 * 1000;
      const bucket = admin.storage().bucket("ldah-932d5.firebasestorage.app");
      const [url] = await bucket.file(storagePath).getSignedUrl({
        version: "v4",
        action: "read",
        expires: expiresAt,
      });

      const performedBy = staff.email || staff.name || staff.uid;
      try {
        await db.collection("auditLog").add({
          action: "Connect-Gen document URL issued",
          details: (signup.name || signup.firstName || "(unknown)") +
            " — signup " + signupId + " — " + documentType + " — " + storagePath,
          performedBy,
          performedByRole: staff.role,
          timestamp: FieldValue.serverTimestamp(),
          signupPath: ref.path,
        });
      } catch (e) { console.warn("auditLog write failed:", e.message); }

      res.status(200).json({ ok: true, url, expiresAt });
    } catch (err) {
      console.error("getConnectGenDocumentDownloadUrl error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

// ───────────────────────────────────────────────────────────────────────
// requestStaffConnectGenUploadUrl / confirmStaffConnectGenUpload
// ───────────────────────────────────────────────────────────────────────
// Staff-authenticated re-upload path. Mirrors the parent pair
// (requestConnectGenUploadUrl / confirmConnectGenUpload) but:
//   • authenticates with a staff idToken (admin/superAdmin) instead of a
//     parent uploadAuthToken, and
//   • drops the parent-only "pre-event only" gate
//     (no "Your session has already passed" rejection),
// so staff can re-collect documents that were auto-destroyed (or never
// uploaded) even after the session has passed. Same mime allowlist, 25 MB
// cap, storage path scheme, bucket, HEIC→JPG conversion, and audit pattern.

// Step 2 (staff): mint a resumable signed PUT URL for a staff re-upload.
exports.requestStaffConnectGenUploadUrl = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const eventId = String(body.eventId || "").trim();
    const signupId = String(body.signupId || "").trim();
    const preferredCollection = String(body.collection || "").trim();
    const documentType = String(body.documentType || "").trim();
    const mimeType = String(body.mimeType || "").trim();
    const sizeBytes = Number(body.sizeBytes);
    const originalFilename = String(body.originalFilename || "").trim();

    if (!eventId) { res.status(400).json({ error: "Missing eventId" }); return; }
    if (!signupId) { res.status(400).json({ error: "Missing signupId" }); return; }
    if (documentType !== "iep" && documentType !== "evaluation") {
      res.status(400).json({ error: "documentType must be 'iep' or 'evaluation'" }); return;
    }
    const ext = CONNECT_GEN_UPLOAD_MIME_EXT[mimeType];
    if (!ext) {
      res.status(400).json({ error: "File type not allowed. Please use PDF, JPG, PNG, or HEIC." }); return;
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      res.status(400).json({ error: "Invalid file size." }); return;
    }
    if (sizeBytes > CONNECT_GEN_UPLOAD_MAX_BYTES) {
      res.status(400).json({ error: "File is larger than 25 MB. Please choose a smaller file." }); return;
    }
    if (!originalFilename) {
      res.status(400).json({ error: "Missing originalFilename" }); return;
    }

    let staff;
    try {
      staff = await _verifyStaffIdToken(body.idToken);
    } catch (err) {
      res.status(err.statusCode || 401).json({ error: err.message }); return;
    }

    try {
      // Confirm the signup exists before minting an upload URL. No
      // uploadAuthToken and no pre-event-only gate here — staff are trusted
      // to re-collect documents at any point in the event lifecycle.
      const found = await _findConnectGenSignupDoc(eventId, signupId, preferredCollection);
      if (!found) { res.status(404).json({ error: "Signup not found" }); return; }

      const ts = Date.now();
      const storagePath = `connectGen/${eventId}/${signupId}/${documentType}-${ts}.${ext}`;
      const bucket = admin.storage().bucket("ldah-932d5.firebasestorage.app");
      console.log("requestStaffConnectGenUploadUrl: bucket=", bucket.name, "path=", storagePath, "by=", staff.email || staff.uid);
      // CORS origin for the browser PUT: echo the caller's origin (the LDAH-Int
      // dashboard runs from https://danpoahu.github.io for both live and STAGE,
      // NOT www.ldahawaii.org like the parent flow). Caller is already staff-
      // authed, so trusting the request origin here is safe; fall back to the
      // known dashboard origin.
      const _staffOrigin = req.headers.origin || "https://danpoahu.github.io";
      const [uploadUrl] = await bucket.file(storagePath).createResumableUpload({
        origin: _staffOrigin,
        metadata: { contentType: mimeType },
      });

      res.status(200).json({ ok: true, uploadUrl, storagePath });
    } catch (err) {
      console.error("requestStaffConnectGenUploadUrl error:",
        "msg=", err.message,
        "code=", err.code,
        "details=", err.details,
        "errors=", JSON.stringify(err.errors || []),
        "stack=", (err.stack || "").split("\n").slice(0, 5).join(" | ")
      );
      res.status(500).json({ error: err.message || ("FAILED_PRECONDITION code=" + err.code) });
    }
  });

// Step 3 (staff): record the uploaded file on the signup. Mirrors
// confirmConnectGenUpload, including HEIC→JPG conversion, but also clears any
// stale destroy markers so a re-uploaded document shows again, stamps
// uploadedByStaff, and audit-logs under the staff identity.
exports.confirmStaffConnectGenUpload = functions
  .runWith({ memory: "2GB", timeoutSeconds: 180, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const eventId = String(body.eventId || "").trim();
    const signupId = String(body.signupId || "").trim();
    const preferredCollection = String(body.collection || "").trim();
    const documentType = String(body.documentType || "").trim();
    let storagePath = String(body.storagePath || "").trim();
    let originalFilename = String(body.originalFilename || "").trim();
    let sizeBytes = Number(body.sizeBytes);
    let mimeType = String(body.mimeType || "").trim();

    if (!eventId) { res.status(400).json({ error: "Missing eventId" }); return; }
    if (!signupId) { res.status(400).json({ error: "Missing signupId" }); return; }
    if (documentType !== "iep" && documentType !== "evaluation") {
      res.status(400).json({ error: "documentType must be 'iep' or 'evaluation'" }); return;
    }
    if (!storagePath) { res.status(400).json({ error: "Missing storagePath" }); return; }
    if (!originalFilename) { res.status(400).json({ error: "Missing originalFilename" }); return; }
    if (!CONNECT_GEN_UPLOAD_MIME_EXT[mimeType]) {
      res.status(400).json({ error: "File type not allowed." }); return;
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > CONNECT_GEN_UPLOAD_MAX_BYTES) {
      res.status(400).json({ error: "Invalid file size." }); return;
    }

    let staff;
    try {
      staff = await _verifyStaffIdToken(body.idToken);
    } catch (err) {
      res.status(err.statusCode || 401).json({ error: err.message }); return;
    }

    try {
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const found = await _findConnectGenSignupDoc(eventId, signupId, preferredCollection);
      if (!found) { res.status(404).json({ error: "Signup not found" }); return; }
      const { ref, snap } = found;
      const signup = snap.data() || {};

      // Path scoping — never let a confirm call attribute a file in someone
      // else's signup folder to this signup. The signed URL minted in step 2
      // also enforces this on the Storage side, but we re-check here so a
      // tampered confirm body can't write a bad path on the signup doc.
      const expectedPrefix = `connectGen/${eventId}/${signupId}/`;
      if (!storagePath.startsWith(expectedPrefix)) {
        res.status(400).json({ error: "Storage path does not belong to this signup." }); return;
      }

      const bucket = admin.storage().bucket("ldah-932d5.firebasestorage.app");
      const [exists] = await bucket.file(storagePath).exists();
      if (!exists) {
        res.status(400).json({ error: "Upload not found in storage. Please try again." }); return;
      }

      // Inline HEIC/HEIF -> JPG conversion (same as the parent flow). Failures
      // are non-fatal: keep the original HEIC and note it in the audit log.
      let convertedFromHeic = false;
      let conversionError = null;
      if (mimeType === "image/heic" || mimeType === "image/heif") {
        try {
          const [heicBuffer] = await bucket.file(storagePath).download();
          const jpgBuffer = await heicConvert({
            buffer: heicBuffer,
            format: "JPEG",
            quality: 0.85,
          });
          const newPath = storagePath.replace(/\.(heic|heif)$/i, ".jpg");
          await bucket.file(newPath).save(jpgBuffer, {
            metadata: { contentType: "image/jpeg" },
            resumable: false,
          });
          const originalPath = storagePath;
          await bucket.file(originalPath).delete().catch(() => {});
          storagePath = newPath;
          mimeType = "image/jpeg";
          originalFilename = originalFilename.replace(/\.(heic|heif)$/i, ".jpg");
          sizeBytes = jpgBuffer.length;
          convertedFromHeic = true;
        } catch (convErr) {
          console.error("HEIC conversion failed (keeping original):", convErr.message);
          conversionError = convErr.message;
        }
      }

      // Best-effort: if a prior version of this same documentType is on file,
      // delete its bytes from Storage now that the new one has landed.
      const existingDocs = (signup.connectGenDocuments && typeof signup.connectGenDocuments === "object")
        ? signup.connectGenDocuments : {};
      const prior = existingDocs[documentType];
      if (prior && prior.storagePath && prior.storagePath !== storagePath) {
        try { await bucket.file(prior.storagePath).delete(); }
        catch (e) { console.warn("Prior Connect-Gen doc cleanup failed (non-fatal):", e.message); }
      }

      const performedBy = staff.email || staff.name || staff.uid;
      const updatedDocs = Object.assign({}, existingDocs, {
        [documentType]: {
          storagePath,
          originalFilename,
          sizeBytes,
          mimeType,
          uploadedAt: FieldValue.serverTimestamp(),
          uploadedByStaff: performedBy,
        },
      });
      // Re-upload after a prior destroy: clear the stale destroy markers so
      // the documents show again in the review UI.
      await ref.update({
        connectGenDocuments: updatedDocs,
        connectGenDocumentsDestroyedAt: FieldValue.delete(),
        connectGenDocumentsDestroyedBy: FieldValue.delete(),
        connectGenDocumentsDestroyedReason: FieldValue.delete(),
      });

      // Audit log — staff identity, matches existing CG audit entries.
      try {
        let details = (signup.name || signup.firstName || "(unknown)") +
          " — signup " + signupId + " — " + documentType + ": " +
          originalFilename + " (" + sizeBytes + " bytes)";
        if (convertedFromHeic) {
          details += " (converted from HEIC)";
        } else if (conversionError) {
          details += " (HEIC conversion failed: " + conversionError + ")";
        }
        await db.collection("auditLog").add({
          action: "Connect-Gen document uploaded by staff",
          details,
          performedBy,
          performedByRole: staff.role,
          timestamp: FieldValue.serverTimestamp(),
          signupPath: ref.path,
        });
      } catch (e) { console.warn("auditLog write failed:", e.message); }

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("confirmStaffConnectGenUpload error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

// ───────────────────────────────────────────────────────────────────────
// Case-Advocacy Document Vault CFs
// ───────────────────────────────────────────────────────────────────────
// Documents attach to a CONTACT (not a Connect-Gen signup). All four CFs
// require a staff idToken (admin/superAdmin). Upload is gated: the contact
// must have a `caseAdvocacyAuthorization` field present UNLESS the
// documentType is "authorization" (the auth paper upload itself is exempt).
// Valid documentType values: iep | evaluation | other | authorization.
// ───────────────────────────────────────────────────────────────────────

// Step 1 (case advocacy): mint a resumable signed PUT URL for a staff upload.
exports.requestCaseAdvocacyUploadUrl = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const contactId = String(body.contactId || "").trim();
    const label = String(body.label || "").trim();
    const documentType = String(body.documentType || "").trim();
    const mimeType = String(body.mimeType || "").trim();
    const sizeBytes = Number(body.sizeBytes);
    const originalFilename = String(body.originalFilename || "").trim();

    if (!contactId) { res.status(400).json({ error: "Missing contactId" }); return; }
    if (!["iep", "evaluation", "other", "authorization"].includes(documentType)) {
      res.status(400).json({ error: "documentType must be iep, evaluation, other, or authorization" }); return;
    }
    const ext = CONNECT_GEN_UPLOAD_MIME_EXT[mimeType];
    if (!ext) {
      res.status(400).json({ error: "File type not allowed. Please use PDF, JPG, PNG, or HEIC." }); return;
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      res.status(400).json({ error: "Invalid file size." }); return;
    }
    if (sizeBytes > CONNECT_GEN_UPLOAD_MAX_BYTES) {
      res.status(400).json({ error: "File is larger than 25 MB. Please choose a smaller file." }); return;
    }
    if (!originalFilename) {
      res.status(400).json({ error: "Missing originalFilename" }); return;
    }

    let staff;
    try {
      staff = await _verifyStaffIdToken(body.idToken);
    } catch (err) {
      res.status(err.statusCode || 401).json({ error: err.message }); return;
    }

    try {
      const db = admin.firestore();
      const contactRef = db.collection("contacts").doc(contactId);
      const contactSnap = await contactRef.get();
      if (!contactSnap.exists) {
        res.status(404).json({ error: "Contact not found" }); return;
      }
      const contact = contactSnap.data() || {};

      // Authorization gate: only the "authorization" document type may be
      // uploaded without an existing caseAdvocacyAuthorization on the contact.
      if (documentType !== "authorization" && !contact.caseAdvocacyAuthorization) {
        res.status(403).json({ error: "Authorization required before uploading documents." }); return;
      }

      const ts = Date.now();
      const docId = db.collection("_").doc().id;
      const pathSegment = documentType === "authorization" ? "authorization" : docId;
      const storagePath = `caseAdvocacy/${contactId}/${pathSegment}-${ts}.${ext}`;

      const bucket = admin.storage().bucket("ldah-932d5.firebasestorage.app");
      console.log("requestCaseAdvocacyUploadUrl: bucket=", bucket.name, "path=", storagePath, "by=", staff.email || staff.uid);
      // Echo the caller's origin — dashboard runs from https://danpoahu.github.io,
      // NOT www.ldahawaii.org; fall back to known dashboard origin.
      const _staffOrigin = req.headers.origin || "https://danpoahu.github.io";
      const [uploadUrl] = await bucket.file(storagePath).createResumableUpload({
        origin: _staffOrigin,
        metadata: { contentType: mimeType },
      });

      res.status(200).json({ ok: true, uploadUrl, storagePath, docId });
    } catch (err) {
      console.error("requestCaseAdvocacyUploadUrl error:",
        "msg=", err.message,
        "code=", err.code,
        "stack=", (err.stack || "").split("\n").slice(0, 5).join(" | ")
      );
      res.status(500).json({ error: err.message });
    }
  });

// Step 2 (case advocacy): record the uploaded file on the contact doc.
exports.confirmCaseAdvocacyUpload = functions
  .runWith({ memory: "2GB", timeoutSeconds: 180, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const contactId = String(body.contactId || "").trim();
    const docId = String(body.docId || "").trim();
    const label = String(body.label || "").trim();
    let storagePath = String(body.storagePath || "").trim();
    let originalFilename = String(body.originalFilename || "").trim();
    let sizeBytes = Number(body.sizeBytes);
    let mimeType = String(body.mimeType || "").trim();

    if (!contactId) { res.status(400).json({ error: "Missing contactId" }); return; }
    if (!docId) { res.status(400).json({ error: "Missing docId" }); return; }
    if (!storagePath) { res.status(400).json({ error: "Missing storagePath" }); return; }
    if (!originalFilename) { res.status(400).json({ error: "Missing originalFilename" }); return; }
    if (!CONNECT_GEN_UPLOAD_MIME_EXT[mimeType]) {
      res.status(400).json({ error: "File type not allowed." }); return;
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > CONNECT_GEN_UPLOAD_MAX_BYTES) {
      res.status(400).json({ error: "Invalid file size." }); return;
    }

    let staff;
    try {
      staff = await _verifyStaffIdToken(body.idToken);
    } catch (err) {
      res.status(err.statusCode || 401).json({ error: err.message }); return;
    }

    try {
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;

      // Path scoping — storagePath must live under this contact's folder.
      const expectedPrefix = `caseAdvocacy/${contactId}/`;
      if (!storagePath.startsWith(expectedPrefix)) {
        res.status(400).json({ error: "Storage path does not belong to this contact." }); return;
      }

      const bucket = admin.storage().bucket("ldah-932d5.firebasestorage.app");
      const [exists] = await bucket.file(storagePath).exists();
      if (!exists) {
        res.status(400).json({ error: "Upload not found in storage. Please try again." }); return;
      }

      // Inline HEIC/HEIF -> JPG conversion (same as Connect-Gen flow).
      let convertedFromHeic = false;
      let conversionError = null;
      if (mimeType === "image/heic" || mimeType === "image/heif") {
        try {
          const [heicBuffer] = await bucket.file(storagePath).download();
          const jpgBuffer = await heicConvert({
            buffer: heicBuffer,
            format: "JPEG",
            quality: 0.85,
          });
          const newPath = storagePath.replace(/\.(heic|heif)$/i, ".jpg");
          await bucket.file(newPath).save(jpgBuffer, {
            metadata: { contentType: "image/jpeg" },
            resumable: false,
          });
          const originalPath = storagePath;
          await bucket.file(originalPath).delete().catch(() => {});
          storagePath = newPath;
          mimeType = "image/jpeg";
          originalFilename = originalFilename.replace(/\.(heic|heif)$/i, ".jpg");
          sizeBytes = jpgBuffer.length;
          convertedFromHeic = true;
        } catch (convErr) {
          console.error("HEIC conversion failed (keeping original):", convErr.message);
          conversionError = convErr.message;
        }
      }

      const performedBy = staff.email || staff.name || staff.uid;
      const contactRef = db.collection("contacts").doc(contactId);
      const contactSnap = await contactRef.get();
      if (!contactSnap.exists) {
        res.status(404).json({ error: "Contact not found" }); return;
      }
      const contact = contactSnap.data() || {};

      // Read-modify-write so serverTimestamp() sits in a map, not in an array
      // element (arrayUnion rejects serverTimestamp in nested maps).
      const existingDocs = Array.isArray(contact.caseAdvocacyDocuments)
        ? contact.caseAdvocacyDocuments : [];
      const newEntry = {
        docId,
        label: label || "Document",
        storagePath,
        originalFilename,
        sizeBytes,
        mimeType,
        uploadedAt: FieldValue.serverTimestamp(),
        uploadedByStaff: performedBy,
      };
      // Replace existing entry with same docId, or append.
      const idx = existingDocs.findIndex(function(d) { return d && d.docId === docId; });
      let updatedDocs;
      if (idx >= 0) {
        updatedDocs = existingDocs.slice();
        updatedDocs[idx] = newEntry;
      } else {
        updatedDocs = existingDocs.concat([newEntry]);
      }

      await contactRef.update({
        caseAdvocacyDocuments: updatedDocs,
        caseAdvocacyDocsDestroyedAt: FieldValue.delete(),
        caseAdvocacyDocsDestroyedBy: FieldValue.delete(),
        caseAdvocacyDocsDestroyedReason: FieldValue.delete(),
      });

      // Audit log.
      try {
        let details = (contact.name || contact.firstName || "(unknown)") +
          " — contact " + contactId + " — docId: " + docId + " — " +
          originalFilename + " (" + sizeBytes + " bytes)";
        if (convertedFromHeic) {
          details += " (converted from HEIC)";
        } else if (conversionError) {
          details += " (HEIC conversion failed: " + conversionError + ")";
        }
        await db.collection("auditLog").add({
          action: "Case-advocacy document uploaded by staff",
          details,
          performedBy,
          performedByRole: staff.role,
          timestamp: FieldValue.serverTimestamp(),
          contactId,
        });
      } catch (e) { console.warn("auditLog write failed:", e.message); }

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("confirmCaseAdvocacyUpload error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

// Returns a short-lived V4 signed READ URL for a case-advocacy document.
exports.getCaseAdvocacyDocumentDownloadUrl = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const contactId = String(body.contactId || "").trim();
    const docId = String(body.docId || "").trim();

    if (!contactId) { res.status(400).json({ error: "Missing contactId" }); return; }
    if (!docId) { res.status(400).json({ error: "Missing docId" }); return; }

    let staff;
    try {
      staff = await _verifyStaffIdToken(body.idToken);
    } catch (err) {
      res.status(err.statusCode || 401).json({ error: err.message }); return;
    }

    try {
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const contactRef = db.collection("contacts").doc(contactId);
      const contactSnap = await contactRef.get();
      if (!contactSnap.exists) {
        res.status(404).json({ error: "Contact not found" }); return;
      }
      const contact = contactSnap.data() || {};

      const docs = Array.isArray(contact.caseAdvocacyDocuments)
        ? contact.caseAdvocacyDocuments : [];
      const rec = docs.find(function(d) { return d && d.docId === docId; });
      if (!rec || !rec.storagePath) {
        res.status(404).json({ error: "Document not found on contact" }); return;
      }

      const storagePath = String(rec.storagePath || "");
      const expectedPrefix = "caseAdvocacy/" + contactId + "/";
      if (storagePath.indexOf(expectedPrefix) !== 0) {
        res.status(400).json({ error: "storagePath does not match contact folder" }); return;
      }

      const expiresAt = Date.now() + 10 * 60 * 1000;
      const bucket = admin.storage().bucket("ldah-932d5.firebasestorage.app");
      const [url] = await bucket.file(storagePath).getSignedUrl({
        version: "v4",
        action: "read",
        expires: expiresAt,
      });

      const performedBy = staff.email || staff.name || staff.uid;
      try {
        await db.collection("auditLog").add({
          action: "Case-advocacy document URL issued",
          details: (contact.name || contact.firstName || "(unknown)") +
            " — contact " + contactId + " — docId: " + docId + " — " + storagePath,
          performedBy,
          performedByRole: staff.role,
          timestamp: FieldValue.serverTimestamp(),
          contactId,
        });
      } catch (e) { console.warn("auditLog write failed:", e.message); }

      res.status(200).json({ ok: true, url, expiresAt });
    } catch (err) {
      console.error("getCaseAdvocacyDocumentDownloadUrl error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

// Destroys case-advocacy documents for a contact. If docId is supplied only
// that document is removed; otherwise ALL documents for the contact are
// deleted and destroy metadata is stamped.
exports.destroyCaseAdvocacyDocuments = functions
  .runWith({ timeoutSeconds: 60, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const contactId = String(body.contactId || "").trim();
    const reason = String(body.reason || "").trim();
    const docId = body.docId ? String(body.docId).trim() : null;

    if (!contactId) { res.status(400).json({ error: "Missing contactId" }); return; }
    if (!reason) { res.status(400).json({ error: "Missing reason" }); return; }

    let staff;
    try {
      staff = await _verifyStaffIdToken(body.idToken);
    } catch (err) {
      res.status(err.statusCode || 401).json({ error: err.message }); return;
    }

    try {
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const bucket = admin.storage().bucket("ldah-932d5.firebasestorage.app");
      const contactRef = db.collection("contacts").doc(contactId);
      const contactSnap = await contactRef.get();
      if (!contactSnap.exists) {
        res.status(404).json({ error: "Contact not found" }); return;
      }
      const contact = contactSnap.data() || {};
      const existingDocs = Array.isArray(contact.caseAdvocacyDocuments)
        ? contact.caseAdvocacyDocuments : [];

      const deleted = [];
      const errors = [];
      const performedBy = staff.email || staff.name || staff.uid;

      const expectedPrefix = "caseAdvocacy/" + contactId + "/";

      if (docId) {
        // Single-document delete.
        const rec = existingDocs.find(function(d) { return d && d.docId === docId; });
        if (!rec) {
          res.status(404).json({ error: "Document not found on contact" }); return;
        }
        if (rec.storagePath) {
          if (!rec.storagePath || rec.storagePath.indexOf(expectedPrefix) !== 0) {
            console.warn("destroyCaseAdvocacyDocuments: skipping out-of-scope path", rec.storagePath);
            res.status(400).json({ error: "storagePath is out of scope for this contact" }); return;
          }
          try {
            await bucket.file(rec.storagePath).delete();
            deleted.push(rec.storagePath);
          } catch (err) {
            if (err && (err.code === 404 || /no such object/i.test(err.message || ""))) {
              deleted.push(rec.storagePath + " (already gone)");
            } else {
              errors.push(rec.storagePath + ": " + (err.message || String(err)));
            }
          }
        }
        const updatedDocs = existingDocs.filter(function(d) { return d && d.docId !== docId; });
        await contactRef.update({ caseAdvocacyDocuments: updatedDocs });
      } else {
        // Bulk destroy — delete all Storage files and clear the array.
        for (const rec of existingDocs) {
          if (!rec || !rec.storagePath) continue;
          if (rec.storagePath.indexOf(expectedPrefix) !== 0) {
            console.warn("destroyCaseAdvocacyDocuments: skipping out-of-scope path", rec.storagePath);
            continue;
          }
          try {
            await bucket.file(rec.storagePath).delete();
            deleted.push(rec.storagePath);
          } catch (err) {
            if (err && (err.code === 404 || /no such object/i.test(err.message || ""))) {
              deleted.push(rec.storagePath + " (already gone)");
            } else {
              errors.push(rec.storagePath + ": " + (err.message || String(err)));
            }
          }
        }
        await contactRef.update({
          caseAdvocacyDocuments: [],
          caseAdvocacyDocsDestroyedAt: FieldValue.serverTimestamp(),
          caseAdvocacyDocsDestroyedBy: performedBy,
          caseAdvocacyDocsDestroyedReason: reason,
        });
      }

      // Audit log.
      try {
        await db.collection("auditLog").add({
          action: "Case-advocacy documents destroyed",
          details: (contact.name || contact.firstName || "(unknown)") +
            " — contact " + contactId +
            (docId ? " — docId: " + docId : " — ALL documents") +
            " — reason: " + reason +
            " — deleted: " + deleted.join(", "),
          performedBy,
          performedByRole: staff.role,
          timestamp: FieldValue.serverTimestamp(),
          contactId,
        });
      } catch (e) { console.warn("auditLog write failed:", e.message); }

      res.status(200).json({ ok: true, deleted });
    } catch (err) {
      console.error("destroyCaseAdvocacyDocuments error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

// ───────────────────────────────────────────────────────────────────────
// Case-Advocacy Authorization (e-sign + paper-release)
// Mirrors the Connect-Gen consent flow but attaches to a CONTACT, not a
// signup. Two paths:
//   1. E-sign  — staff sends a link; family signs via public form;
//      submitCaseAdvocacyAuthorization records { method:"esign" }.
//   2. Paper   — staff uploads a signed paper form via Task 2's
//      requestCaseAdvocacyUploadUrl (documentType:"authorization"),
//      then calls confirmCaseAdvocacyAuthorizationPaper to record it.
// ───────────────────────────────────────────────────────────────────────

// Reuse the verbatim consent text — same procedure as Connect-Gen.
const CASE_ADVOCACY_AUTH_TEXT = CONSENT_TEXT;
const CASE_ADVOCACY_AUTH_VERSION = CONSENT_TEXT_VERSION;

// (1) Staff-only: mint a 16-byte hex token and email the family a link to
//     the public authorization form.
exports.sendCaseAdvocacyAuthorizationLink = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10, secrets: EMAIL_SECRETS })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const contactId = String(body.contactId || "").trim();
    if (!contactId) { res.status(400).json({ error: "Missing contactId" }); return; }

    let staff;
    try {
      staff = await _verifyStaffIdToken(body.idToken);
    } catch (err) {
      res.status(err.statusCode || 401).json({ error: err.message }); return;
    }

    try {
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const contactRef = db.collection("contacts").doc(contactId);
      const contactSnap = await contactRef.get();
      if (!contactSnap.exists) { res.status(404).json({ error: "Contact not found" }); return; }
      const contact = contactSnap.data() || {};
      if (!contact.email) { res.status(400).json({ error: "Contact has no email address on file." }); return; }

      const token = crypto.randomBytes(16).toString("hex");
      const expiresAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
      await contactRef.update({
        caseAdvocacyAuthToken: token,
        caseAdvocacyAuthTokenExpiresAt: expiresAt,
      });

      const authUrl = "https://www.ldahawaii.org/case-advocacy-authorization.html?token=" + token;
      const displayName = contact.name || contact.firstName || "there";
      const signatureHtml = await buildSignatureBlock("resourceCoordinator");
      const donateHtml = await buildDonateBlock("universal");
      const html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
        '<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1f2937">' +
        '<div style="max-width:600px;margin:0 auto;background:#fff">' +
        '<div style="background-color:#1e40af;background:linear-gradient(135deg,#1e40af,#0891B2);padding:18px 24px 22px;text-align:center;color:#fff">' +
        '<img src="https://www.ldahawaii.org/logo_blue.png" alt="LDAH" width="120" style="display:block;margin:0 auto 10px;background:#fff;border-radius:10px;padding:8px 14px;">' +
        '<h1 style="margin:0;font-size:22px;font-weight:700">Action Required</h1></div>' +
        '<div style="padding:32px 24px">' +
        '<p style="margin:0 0 16px;font-size:16px">Aloha ' + lifecycleEsc(displayName) + ',</p>' +
        '<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.6">LDAH would like to begin case advocacy support for your family. Before we can proceed, we need a signed authorization on file giving LDAH permission to receive, view, and discuss your child\'s confidential documents.</p>' +
        '<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.6">Please read and sign the authorization by clicking the button below.</p>' +
        '<p style="text-align:center;margin:32px 0">' +
        _emailBtn(authUrl, "Read & Sign the Authorization", { bg: "#0891B2" }) +
        '</p>' +
        '<p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6">This link expires in 7 days. If you have questions, please reach out anytime.</p>' +
        '<p style="margin:24px 0 4px;font-size:15px;color:#333;line-height:1.5;">With gratitude,</p>' +
        (donateHtml || '') +
        (signatureHtml || '') +
        '</div></div></body></html>';

      const fromAddress = lifecycleFromAddress();
      await sendEmailViaResend({
        from: fromAddress,
        to: contact.email,
        subject: "Action required — Case Advocacy Authorization",
        html,
        type: "case-advocacy-auth-link",
        relatedContactId: contactId,
        recipientName: displayName,
      });

      const performedBy = staff.email || staff.name || staff.uid;
      try {
        const db2 = db;
        await db2.collection("auditLog").add({
          action: "Case-advocacy authorization link sent",
          details: (contact.name || contact.firstName || "(unknown)") +
            " — contact " + contactId + " — email: " + contact.email,
          performedBy,
          performedByRole: staff.role,
          timestamp: FieldValue.serverTimestamp(),
          contactId,
        });
      } catch (e) { console.warn("auditLog write failed:", e.message); }

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("sendCaseAdvocacyAuthorizationLink error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

// (2) Public GET — the authorization form fetches contact info to pre-render.
exports.getCaseAdvocacyAuthorization = functions
  .runWith({ timeoutSeconds: 20, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

    const token = (req.query.token || "").toString().trim();
    if (!token) { res.status(400).json({ error: "Missing token" }); return; }

    try {
      const db = admin.firestore();
      const snap = await db.collection("contacts").where("caseAdvocacyAuthToken", "==", token).limit(1).get();
      if (snap.empty) { res.status(404).json({ error: "Invalid or expired link" }); return; }
      const doc = snap.docs[0];
      const contact = doc.data() || {};

      if (contact.caseAdvocacyAuthorization) {
        res.status(410).json({ error: "This authorization has already been signed", alreadySigned: true }); return;
      }
      const expiresAt = contact.caseAdvocacyAuthTokenExpiresAt;
      if (!expiresAt || typeof expiresAt.toDate !== "function" || expiresAt.toDate().getTime() <= Date.now()) {
        res.status(410).json({ error: "This link has expired. Please contact LDAH for a new one.", expired: true }); return;
      }

      const displayName = contact.name || contact.firstName || "";
      res.status(200).json({
        ok: true,
        contactName: displayName,
        authorizationText: CASE_ADVOCACY_AUTH_TEXT,
        version: CASE_ADVOCACY_AUTH_VERSION,
      });
    } catch (err) {
      console.error("getCaseAdvocacyAuthorization error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

// (3) Public POST — family submits the e-signed authorization.
exports.submitCaseAdvocacyAuthorization = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 5 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const token = (body.token || "").toString().trim();
    const typedName = (body.typedName || "").toString().trim();
    const agree = body.agree === true;

    if (!token) { res.status(400).json({ error: "Missing token" }); return; }
    if (!typedName) { res.status(400).json({ error: "Please type your full name to sign." }); return; }
    if (typedName.length < 3 || typedName.indexOf(" ") === -1) {
      res.status(400).json({ error: "Please type your first AND last name to sign." }); return;
    }
    if (!agree) { res.status(400).json({ error: "You must agree to the authorization terms to submit." }); return; }

    try {
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const snap = await db.collection("contacts").where("caseAdvocacyAuthToken", "==", token).limit(1).get();
      if (snap.empty) { res.status(404).json({ error: "Invalid or expired link" }); return; }
      const doc = snap.docs[0];
      const contact = doc.data() || {};

      if (contact.caseAdvocacyAuthorization) {
        res.status(410).json({ error: "This authorization has already been signed" }); return;
      }
      const expiresAt = contact.caseAdvocacyAuthTokenExpiresAt;
      if (!expiresAt || typeof expiresAt.toDate !== "function" || expiresAt.toDate().getTime() <= Date.now()) {
        res.status(410).json({ error: "This link has expired. Please contact LDAH for a new one." }); return;
      }

      const ip = (req.headers["x-forwarded-for"] || req.ip || "").toString().split(",")[0].trim();
      await doc.ref.update({
        caseAdvocacyAuthorization: {
          method: "esign",
          signedName: typedName,
          signedAt: FieldValue.serverTimestamp(),
          signedIp: ip,
          version: CASE_ADVOCACY_AUTH_VERSION,
          consentText: CASE_ADVOCACY_AUTH_TEXT,
          recordedAt: FieldValue.serverTimestamp(),
        },
        caseAdvocacyAuthToken: FieldValue.delete(),
        caseAdvocacyAuthTokenExpiresAt: FieldValue.delete(),
      });

      try {
        await db.collection("auditLog").add({
          action: "Case-advocacy authorization e-signed",
          details: (contact.name || contact.firstName || "(unknown)") +
            " — contact " + doc.id + " — signed as: " + typedName + " — ip: " + ip,
          performedBy: contact.email || "(family)",
          timestamp: FieldValue.serverTimestamp(),
          contactId: doc.id,
        });
      } catch (e) { console.warn("auditLog write failed:", e.message); }

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("submitCaseAdvocacyAuthorization error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

// (4) Staff-only: record a paper-signed authorization that was already
//     uploaded via requestCaseAdvocacyUploadUrl (documentType:"authorization").
exports.confirmCaseAdvocacyAuthorizationPaper = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const body = req.body || {};
    const contactId = String(body.contactId || "").trim();
    const storagePath = String(body.storagePath || "").trim();
    const originalFilename = String(body.originalFilename || "").trim();
    const sizeBytes = Number(body.sizeBytes);
    const mimeType = String(body.mimeType || "").trim();

    if (!contactId) { res.status(400).json({ error: "Missing contactId" }); return; }
    if (!storagePath) { res.status(400).json({ error: "Missing storagePath" }); return; }
    if (!originalFilename) { res.status(400).json({ error: "Missing originalFilename" }); return; }

    let staff;
    try {
      staff = await _verifyStaffIdToken(body.idToken);
    } catch (err) {
      res.status(err.statusCode || 401).json({ error: err.message }); return;
    }

    // Path-scope: must start with caseAdvocacy/{contactId}/authorization-
    const expectedPrefix = "caseAdvocacy/" + contactId + "/authorization-";
    if (!storagePath.startsWith(expectedPrefix)) {
      res.status(400).json({ error: "storagePath does not match expected authorization path for this contact." }); return;
    }

    try {
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;
      const contactRef = db.collection("contacts").doc(contactId);
      const contactSnap = await contactRef.get();
      if (!contactSnap.exists) { res.status(404).json({ error: "Contact not found" }); return; }
      const contact = contactSnap.data() || {};

      // Verify the file actually landed in Storage before recording it.
      const bucket = admin.storage().bucket("ldah-932d5.firebasestorage.app");
      const [exists] = await bucket.file(storagePath).exists();
      if (!exists) {
        res.status(400).json({ error: "Authorization file not found in storage. Please upload first." }); return;
      }

      const performedBy = staff.email || staff.name || staff.uid;
      await contactRef.update({
        caseAdvocacyAuthorization: {
          method: "paper",
          storagePath,
          originalFilename,
          sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : null,
          mimeType: mimeType || null,
          recordedAt: FieldValue.serverTimestamp(),
          recordedBy: performedBy,
        },
      });

      try {
        await db.collection("auditLog").add({
          action: "Case-advocacy paper authorization recorded",
          details: (contact.name || contact.firstName || "(unknown)") +
            " — contact " + contactId + " — file: " + originalFilename + " — path: " + storagePath,
          performedBy,
          performedByRole: staff.role,
          timestamp: FieldValue.serverTimestamp(),
          contactId,
        });
      } catch (e) { console.warn("auditLog write failed:", e.message); }

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("confirmCaseAdvocacyAuthorizationPaper error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

// ───────────────────────────────────────────────────────────────────────
// scheduledConnectGenDocLifecycle (Phase E)
// ───────────────────────────────────────────────────────────────────────
// Hourly cron that enforces the 24-hour consent destruction promise:
//   • T+23h after session end (no disposition marked): email the record
//     owner + write an in-app notification so staff get one last chance
//     to flip the signup to Case Advocacy (which retains documents).
//   • T+24h after session end (still no disposition): hard-destroy both
//     Storage files, clear connectGenDocuments on the signup, stamp the
//     destruction metadata, audit log.
//
// Idempotency:
//   • Alert branch gated by connectGenDocDestructAlertSentAt timestamp.
//   • Destroy branch gated by connectGenDocumentsDestroyedAt timestamp
//     (already set on whichever path destroys documents — manual disposition
//     "No Additional Support", manual destroyConnectGenDocuments, or this CF).
//
// Scope (defensive):
//   • Collection-group query on `signups` filtered in-memory to docs that
//     have connectGenDocuments set, are not yet destroyed, do not yet have
//     a disposition marked, and belong to a Connect-Gen event (parent doc
//     id == known recurring event OR event title contains "Connect-Gen").
//   • Per-signup parse errors are logged and skipped — one bad signup
//     must never blow up the whole tick.
//
// Session end time:
//   • Re-uses the time-parsing approach from extractSessionStartHst but
//     takes the END portion of the range. If no time range can be parsed,
//     defaults to 5 PM HST on the session date (matches Connect-Gen's
//     usual late-afternoon scheduling).
// ───────────────────────────────────────────────────────────────────────

// Known Connect-Gen recurring event id — preferred match. Title regex is
// the permissive fallback so a future one-off Connect-Gen-style event in
// the `events` collection will also be in scope.
const CONNECT_GEN_RECURRING_EVENT_ID = "CmkPXEpPwfAQ5sR377K2";
const CONNECT_GEN_TITLE_REGEX = /connect-?gen/i;

// Parse the END moment of a Connect-Gen session in HST.
// Re-uses _parseTimeOfDayParts (defined earlier) and the same date-key
// extraction logic as extractSessionStartHst, but pulls the trailing time
// of the "start-end" range instead of the leading one. Returns a UTC Date
// object positioned at HST wall-clock end of session, or null if neither
// the date nor a usable fallback time can be parsed.
function _extractSessionEndHst(rawSession, event) {
  if (!rawSession) return null;
  const raw = String(rawSession);

  let dateKey = "";
  let timeStr = "";
  if (raw.indexOf("|") !== -1) {
    const parts = raw.split("|");
    dateKey = toHstDateKey((parts[0] || "").trim());
    timeStr = (parts[2] || "").trim();
  } else {
    dateKey = parseEventDateKey(raw);
    const tm = raw.match(/(\d{1,2}(?::\d{2})?\s*[AaPp]\.?[Mm]?\.?)\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*[AaPp]\.?[Mm]?\.?)/);
    if (tm) timeStr = tm[1] + " - " + tm[2];
  }

  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;

  // Take the END portion (after the dash) when present; fall back to the
  // single time if there is no range; finally fall back to event.endTime
  // then 5 PM HST.
  let endStr = "";
  if (timeStr) {
    const splitMatch = timeStr.split(/\s*[-–—]\s*/);
    if (splitMatch.length >= 2) endStr = (splitMatch[1] || "").trim();
    else endStr = (splitMatch[0] || "").trim();
  }
  let parts = endStr ? _parseTimeOfDayParts(endStr) : null;
  if (!parts && event) {
    parts = _parseTimeOfDayParts(event.endTime || "");
  }
  if (!parts) {
    // Conservative default: 5 PM HST. Connect-Gen sessions are typically
    // 3-5 PM or 5-7 PM. Picking 5 PM keeps us inside the consent window
    // for the common cases without being overly aggressive.
    parts = { hour: 17, minute: 0 };
  }

  const [y, m, d] = dateKey.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d, parts.hour + 10, parts.minute));
}

// Pretty date label for the alert email body. Uses HST date key parsed
// from session string — never new Date() on the full string.
function _formatSessionDateLabel(rawSession) {
  if (!rawSession) return "an upcoming session";
  const raw = String(rawSession);
  let dateKey = "";
  if (raw.indexOf("|") !== -1) {
    dateKey = toHstDateKey((raw.split("|")[0] || "").trim());
  } else {
    dateKey = parseEventDateKey(raw);
  }
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return String(raw);
  const [y, m, d] = dateKey.split("-").map((n) => parseInt(n, 10));
  const dt = new Date(y, m - 1, d);
  if (isNaN(dt.getTime())) return dateKey;
  return dt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

// Build the 23-hour destruction-alert email body. Matches LDAH styling —
// header band, body card, blue accent, no emojis. Includes copy/paste
// footer per feedback_email-link-pattern.
function _buildConnectGenDestructAlertHtml({ ownerFirstName, familyName, sessionDateLabel, signatureHtml }) {
  const safeOwner = lifecycleEsc(ownerFirstName || "team");
  const safeFamily = lifecycleEsc(familyName || "(unknown family)");
  const safeDate = lifecycleEsc(sessionDateLabel);
  const portalUrl = "https://danpoahu.github.io/LDAH-Int/";
  const btn = _emailBtn(portalUrl, "Open Staff Portal");
  const linkFooter = _emailLinkFooter([{ label: "Staff Portal", href: portalUrl }]);
  return [
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f7;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f4f7;padding:24px 0;">',
    '<tr><td align="center">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">',
    '<tr><td style="background:#1a3c6e;padding:18px 24px;">',
    '<p style="margin:0;font-size:18px;color:#ffffff;font-weight:700;">Action needed: Connect-Gen documents</p>',
    '</td></tr>',
    '<tr><td style="padding:24px;">',
    '<p style="margin:0 0 14px;font-size:15px;color:#222;line-height:1.55;">Aloha ' + safeOwner + ',</p>',
    '<p style="margin:0 0 14px;font-size:15px;color:#222;line-height:1.55;">',
    'The Connect-Gen documents for <strong>' + safeFamily + '</strong> (session on <strong>' + safeDate + '</strong>) ',
    'will be <strong>automatically destroyed in approximately 1 hour</strong> because no disposition has been marked yet.',
    '</p>',
    '<p style="margin:0 0 14px;font-size:15px;color:#222;line-height:1.55;">',
    'Per the consent terms the family signed, documents are destroyed within 24 hours of attendance unless we are providing additional support such as case advocacy.',
    '</p>',
    '<p style="margin:0 0 14px;font-size:15px;color:#222;line-height:1.55;">',
    'If LDAH will be providing case advocacy for this family, please open their record in the Staff Portal and mark <strong>Case Advocacy</strong> now to retain the documents.',
    '</p>',
    btn,
    '<p style="margin:18px 0 0;font-size:14px;color:#555;line-height:1.55;">If no action is taken, the documents will be destroyed automatically. Mahalo.</p>',
    (signatureHtml || ''),
    linkFooter,
    '</td></tr>',
    '</table>',
    '</td></tr></table></body></html>',
  ].join('');
}

// Resolve a record-owner-ish recipient for the alert. Connect-Gen signups
// don't have a guaranteed owner field yet (the interaction collection has
// ownerUid, but signups themselves don't), so we walk a small priority
// list and finally fall back to the eventCoordinator persona (Leilani).
// Returns { uid, email, firstName, name } — email always populated, uid
// may be empty (in which case the in-app notification step is skipped).
async function _resolveConnectGenRecordOwner(db, signup) {
  // 1. Explicit owner fields on the signup itself (future-proof).
  const candidateUid = String(signup && (signup.ownerUid || signup.assignedOwnerUid || signup.recordOwnerUid) || "").trim();
  if (candidateUid) {
    try {
      const roleSnap = await db.collection("userRoles").doc(candidateUid).get();
      if (roleSnap.exists) {
        const r = roleSnap.data() || {};
        const email = String(r.email || "").trim();
        const name = String(r.name || "").trim();
        if (email) {
          return { uid: candidateUid, email, firstName: (name.split(/\s+/)[0] || ""), name };
        }
      }
    } catch (e) {
      console.warn("ownerUid lookup failed:", e.message);
    }
  }
  // 2. linkedContact-side ownerUid (the interactions/contacts model).
  const linkedContactId = String(signup && signup.linkedContactId || "").trim();
  if (linkedContactId) {
    try {
      const cSnap = await db.collection("contacts").doc(linkedContactId).get();
      if (cSnap.exists) {
        const c = cSnap.data() || {};
        const cuid = String(c.ownerUid || "").trim();
        if (cuid) {
          const roleSnap = await db.collection("userRoles").doc(cuid).get();
          if (roleSnap.exists) {
            const r = roleSnap.data() || {};
            const email = String(r.email || "").trim();
            const name = String(r.name || "").trim();
            if (email) {
              return { uid: cuid, email, firstName: (name.split(/\s+/)[0] || ""), name };
            }
          }
        }
      }
    } catch (e) {
      console.warn("contact ownerUid lookup failed:", e.message);
    }
  }
  // 3. Fallback: Leilani via eventCoordinator persona. No uid available
  // (she may not have a userRoles doc keyed the same way) — the in-app
  // notification step will skip when uid is empty, but the email still
  // goes through.
  try {
    const persona = await getPersona('eventCoordinator');
    return {
      uid: "",
      email: String(persona.email || "lkailiawa@ldahawaii.org").trim(),
      firstName: String(persona.firstName || "Leilani").trim(),
      name: String(persona.fullName || "Leilani Kailiawa").trim(),
    };
  } catch (e) {
    return { uid: "", email: "lkailiawa@ldahawaii.org", firstName: "Leilani", name: "Leilani Kailiawa" };
  }
}

// Stage 3b-2 step 3 (2026-05-11): primary session-derivation now flows
// through getSignupSessions(signup, event) — the canonical accessor added
// in Stage 3b-1. Falls back to legacySessionsForSignup() on empty result
// so signups attached to events with non-standard shapes are never
// silently dropped. The 5 PM HST endTime default from _extractSessionEndHst
// is preserved inline below for sessions whose endTime is null (the
// accessor synthesizes null when no time range parses).
exports.scheduledConnectGenDocLifecycle = functions
  .runWith({ memory: "256MB", timeoutSeconds: 540, secrets: EMAIL_SECRETS })
  .pubsub.schedule("every 60 minutes")
  .timeZone("Pacific/Honolulu")
  .onRun(async () => {
    const db = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;

    let scanned = 0;
    let alertsSent = 0;
    let destroyed = 0;
    let retained = 0; // v144 — retained instead of destroyed (open case advocacy)
    let skipped = 0;
    let errors = 0;
    let viaAccessor = 0;
    let viaLegacy = 0;

    // Cache for parent event lookups so we don't refetch the same event
    // 20 times when scanning a busy recurringEvent's signups.
    const eventCache = new Map();
    async function loadParentEvent(ref) {
      const parentEventRef = ref.parent.parent;
      if (!parentEventRef) return { collection: "", id: "", data: null };
      const key = parentEventRef.parent.id + "/" + parentEventRef.id;
      if (eventCache.has(key)) return eventCache.get(key);
      let data = null;
      try {
        const snap = await parentEventRef.get();
        data = snap.exists ? (snap.data() || {}) : {};
      } catch (e) {
        console.warn("scheduledConnectGenDocLifecycle: parent event load failed for " + key + ":", e.message);
        data = {};
      }
      const out = { collection: parentEventRef.parent.id, id: parentEventRef.id, data };
      eventCache.set(key, out);
      return out;
    }

    let snap;
    try {
      // Collection-group query — `connectGenDocuments` is a map field on
      // signup docs. We use `orderBy` on it to filter to docs where the
      // field exists. (Firestore: orderBy implicitly filters out docs
      // missing the field.)
      snap = await db.collectionGroup("signups").orderBy("connectGenDocuments").get();
    } catch (err) {
      console.error("scheduledConnectGenDocLifecycle: collectionGroup query failed:", err.message);
      return null;
    }

    const fromAddress = lifecycleFromAddress();
    let signatureHtml = "";
    try { signatureHtml = await buildSignatureBlock('eventCoordinator'); }
    catch (e) { console.warn("signature build failed:", e.message); }

    const nowMs = Date.now();

    for (const sigDoc of snap.docs) {
      scanned++;
      try {
        const signup = sigDoc.data() || {};

        // Idempotency + status gates.
        if (signup.connectGenDocumentsDestroyedAt) { skipped++; continue; }
        if (signup.connectGenDisposition) { skipped++; continue; }
        if (signup.archived === true) { skipped++; continue; }
        if (signup.status === "cancelled" || signup.status === "canceled") { skipped++; continue; }
        if (!signup.connectGenDocuments || typeof signup.connectGenDocuments !== "object") { skipped++; continue; }

        // Scope: Connect-Gen only. Match by known recurring event id first,
        // then permissive title-contains fallback.
        const parent = await loadParentEvent(sigDoc.ref);
        const isKnownRecurring = parent.collection === "recurringEvents" && parent.id === CONNECT_GEN_RECURRING_EVENT_ID;
        const title = String(((parent.data || {}).title) || "");
        const titleMatch = CONNECT_GEN_TITLE_REGEX.test(title);
        if (!isKnownRecurring && !titleMatch) { skipped++; continue; }

        // Stage 3b-2 step 3: canonical accessor first, legacy fallback.
        let sessions = getSignupSessions(signup, parent.data || {});
        let usedLegacy = false;
        if (!sessions || sessions.length === 0) {
          sessions = legacySessionsForSignup(signup, parent.data || {});
          usedLegacy = sessions.length > 0;
        }
        if (!sessions || sessions.length === 0) {
          // Either no parseable date or no sessions for this signup — defensive skip.
          skipped++;
          continue;
        }
        if (usedLegacy) viaLegacy++; else viaAccessor++;

        // Compute most-recent past session end. Walk every canonical
        // session, keep the latest endpoint that is <= now. If none are
        // in the past yet, the clock hasn't started — skip until after
        // the session.
        //
        // 5 PM HST default preserved from _extractSessionEndHst: when
        // session.endTime is null (synthesized fallback OR schedule
        // without an explicit endTime), default to 17:00 HST.
        let mostRecentPastEnd = null;
        let mostRecentPastRaw = "";
        for (const sess of sessions) {
          if (!sess || !sess.dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(sess.dateKey)) continue;
          const [y, m, d] = sess.dateKey.split("-").map((n) => parseInt(n, 10));
          if (!y || !m || !d) continue;
          let hour = 17;
          let minute = 0;
          const et = sess.endTime ? String(sess.endTime) : "";
          const tm = et.match(/^(\d{1,2}):(\d{2})/);
          if (tm) {
            hour = parseInt(tm[1], 10);
            minute = parseInt(tm[2], 10);
          } else {
            // Try event.endTime as a secondary fallback (matches
            // _extractSessionEndHst's prior fallback chain) before 5 PM.
            const evEnd = String((parent.data || {}).endTime || "");
            const tm2 = evEnd.match(/^(\d{1,2}):(\d{2})/);
            if (tm2) {
              hour = parseInt(tm2[1], 10);
              minute = parseInt(tm2[2], 10);
            }
          }
          // HST = UTC-10, so wall-clock HST -> UTC by adding 10 hours.
          const end = new Date(Date.UTC(y, m - 1, d, hour + 10, minute));
          if (isNaN(end.getTime())) continue;
          if (end.getTime() > nowMs) continue; // future session, skip
          if (!mostRecentPastEnd || end.getTime() > mostRecentPastEnd.getTime()) {
            mostRecentPastEnd = end;
            mostRecentPastRaw = sess.rawString || sess.dateKey;
          }
        }
        if (!mostRecentPastEnd) {
          // Either no parseable date or no past session yet — defensive skip.
          skipped++;
          continue;
        }

        const hoursSince = (nowMs - mostRecentPastEnd.getTime()) / (1000 * 60 * 60);

        // ── Destroy branch ── (>= 24h)
        if (hoursSince >= 24) {
          // v144 — case-advocacy retention safety-net. If this family has an
          // OPEN "Case Advocacy" interaction, retain the documents instead of
          // destroying, and stamp the disposition so the flag sticks (and the
          // cron stops re-checking next run). Matches by linkedContactId, the
          // same contactId the advocacy interaction stores.
          const cid = signup.linkedContactId || "";
          if (cid) {
            let openAdvocacy = false;
            try {
              const advSnap = await db.collection("interactions").where("contactId", "==", cid).get();
              openAdvocacy = advSnap.docs.some((x) => {
                const a = x.data() || {};
                return a.interactionType === "Case Advocacy" && a.status === "Open";
              });
            } catch (e) { console.warn("advocacy retention check failed for " + sigDoc.ref.path + ":", e.message); }
            if (openAdvocacy) {
              await sigDoc.ref.update({
                connectGenDisposition: "caseAdvocacy",
                connectGenDispositionAt: FieldValue.serverTimestamp(),
                connectGenDispositionBy: "system (open case advocacy — retained)",
              });
              retained++;
              try {
                await db.collection("auditLog").add({
                  action: "Connect-Gen documents retained (open case advocacy)",
                  details: (signup.name || signup.firstName || "(unknown)") +
                    " -- signup " + sigDoc.id + " -- retained instead of 24h auto-destruct " +
                    "(open Case Advocacy interaction on the contact)",
                  performedBy: "system (auto)",
                  performedByRole: "system",
                  createdAt: FieldValue.serverTimestamp(),
                });
              } catch (e) { /* audit best-effort */ }
              continue;
            }
          }
          try {
            const result = await _destroyConnectGenStorageFiles(signup.connectGenDocuments);
            await sigDoc.ref.update({
              connectGenDocuments: FieldValue.delete(),
              connectGenDocumentsDestroyedAt: FieldValue.serverTimestamp(),
              connectGenDocumentsDestroyedBy: "system (24h auto-destruct)",
              connectGenDocumentsDestroyedReason: "No disposition marked within 24 hours of session attendance",
            });
            destroyed++;
            try {
              await db.collection("auditLog").add({
                action: "Connect-Gen documents auto-destroyed (24h, no disposition)",
                details: (signup.name || signup.firstName || "(unknown)") +
                  " -- signup " + sigDoc.id + " -- session " + mostRecentPastRaw +
                  " -- files deleted: " + (result.deleted.length || 0) +
                  (result.errors.length ? " (errors: " + result.errors.join("; ") + ")" : ""),
                performedBy: "system (auto)",
                performedByRole: "system",
                timestamp: FieldValue.serverTimestamp(),
                signupPath: sigDoc.ref.path,
              });
            } catch (e) { console.warn("auditLog write failed:", e.message); }
          } catch (e) {
            errors++;
            console.error("scheduledConnectGenDocLifecycle destroy failed for " + sigDoc.ref.path + ":", e.message);
          }
          continue;
        }

        // ── Alert branch ── (23 <= hoursSince < 24)
        if (hoursSince >= 23 && hoursSince < 24) {
          if (signup.connectGenDocDestructAlertSentAt) { skipped++; continue; }
          try {
            const owner = await _resolveConnectGenRecordOwner(db, signup);
            const familyName = String(signup.name || signup.firstName || "(unknown family)").trim();
            const sessionDateLabel = _formatSessionDateLabel(mostRecentPastRaw);
            const html = _buildConnectGenDestructAlertHtml({
              ownerFirstName: owner.firstName || "team",
              familyName,
              sessionDateLabel,
              signatureHtml,
            });
            const subject = "Action needed: Connect-Gen documents auto-destroy in 1 hour -- " + familyName;

            await sendEmailViaResend({
              from: fromAddress,
              to: owner.email,
              subject,
              html,
              type: "connect-gen-destruct-alert",
              relatedEventId: parent.id,
              relatedSignupId: sigDoc.id,
              recipientName: owner.name || owner.email,
            });

            // In-app notification (matches LDAH-Int notifications schema —
            // see createNotification in index.html). Skip when no uid;
            // email is already on the way to Leilani in that case.
            if (owner.uid) {
              try {
                await db.collection("notifications").add({
                  recipientUid: owner.uid,
                  recipientName: owner.name || "",
                  type: "connect-gen-destruct-alert",
                  title: "Connect-Gen documents auto-destroy in 1 hour",
                  message: "No disposition marked yet for " + familyName + ". Open the staff portal and mark Case Advocacy to retain documents.",
                  interactionId: "",
                  signupPath: sigDoc.ref.path,
                  read: false,
                  createdAt: FieldValue.serverTimestamp(),
                });
              } catch (e) { console.warn("notifications write failed:", e.message); }
            }

            await sigDoc.ref.update({
              connectGenDocDestructAlertSentAt: FieldValue.serverTimestamp(),
            });
            alertsSent++;

            try {
              await db.collection("auditLog").add({
                action: "Connect-Gen 23h destruction alert sent (no disposition marked)",
                details: familyName + " -- signup " + sigDoc.id + " -- session " + mostRecentPastRaw +
                  " -- notified " + owner.email + (owner.uid ? " (uid " + owner.uid + ")" : " (fallback persona)"),
                performedBy: "system (auto)",
                performedByRole: "system",
                timestamp: FieldValue.serverTimestamp(),
                signupPath: sigDoc.ref.path,
              });
            } catch (e) { console.warn("auditLog write failed:", e.message); }
          } catch (e) {
            errors++;
            console.error("scheduledConnectGenDocLifecycle alert failed for " + sigDoc.ref.path + ":", e.message);
          }
          continue;
        }

        // Outside both windows (too early, or somehow between if cron drift) — skip.
        skipped++;
      } catch (err) {
        errors++;
        console.error("scheduledConnectGenDocLifecycle per-signup error for " + sigDoc.ref.path + ":", err.message);
      }
    }

    console.log("scheduledConnectGenDocLifecycle: scanned=" + scanned +
      ", alertsSent=" + alertsSent + ", destroyed=" + destroyed +
      ", retained=" + retained +
      ", skipped=" + skipped + ", errors=" + errors +
      ", viaAccessor=" + viaAccessor + ", viaLegacy=" + viaLegacy);
    return { scanned, alertsSent, destroyed, retained, skipped, errors, viaAccessor, viaLegacy };
  });


// ============================================================
// Connect-Gen Monday-virtual document gate + reschedule flow
// ============================================================
//
// Pipeline:
//   1. Parent signs up for a Monday-virtual Connect-Gen session
//   2. maybeSendRegistrationConfirmation sends the consent invite (narrowed
//      to Monday-virtual only — see _cgMondayVirtual gate above)
//   3. Parent signs consent → submitConnectGenConsent emails an upload link
//   4. T-7 days: if docs still missing, enforceConnectGenDocDeadline sends
//      the reschedule-offer email with 4 future Monday buttons
//   5. T-4 days: if docs still missing AND >=3 days since offer, send firm
//      reminder. Parent can still reschedule.
//   6. Parent clicks a Monday button → acceptConnectGenReschedule HTTPS CF
//      validates the signed token, updates selectedSessions to the new
//      Monday, clears reschedule/reminder stamps, and fires a fresh
//      upload-later email pointing at the parent's existing upload token.
//
// Feature flag: settings/featureFlags.cgDeadlineEnforcementEnabled gates the
// daily cron. Daniel flips it on after testing.
// ============================================================

// HMAC helpers for reschedule tokens. The secret is supplied via env var
// (Firebase Functions secret CG_RESCHEDULE_HMAC_SECRET) so the cron CF and
// the HTTPS accept CF can validate independently — no Firestore round trip
// needed for token verification. Token payload is base64url-encoded JSON
// with a separate base64url signature.
const _CG_RESCHEDULE_TOKEN_VERSION = "v1";

function _cgRescheduleHmacSecret() {
  // The deploy command attaches this as a secret. If unset (local emulator
  // or first deploy before the secret is created), fall back to a stable
  // per-project value so tokens are still self-consistent — Daniel can
  // rotate by setting the real secret later.
  const fromSecret = process.env.CG_RESCHEDULE_HMAC_SECRET;
  if (fromSecret && fromSecret.length >= 16) return fromSecret;
  const proj = process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT || "ldah-932d5";
  return "cg-reschedule-fallback-" + proj + "-" + _CG_RESCHEDULE_TOKEN_VERSION;
}

function _b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function _b64urlDecode(str) {
  const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, "base64");
}

/**
 * Sign a reschedule token. Payload: { sid, eid, col, ndk, exp }
 *   sid = signupId, eid = eventId, col = collection name,
 *   ndk = new session dateKey (YYYY-MM-DD), exp = unix epoch seconds.
 * Returns a single base64url string "<payload>.<sig>".
 */
function _signRescheduleToken({ signupId, eventId, collection, newSessionDateKey, expSeconds }) {
  const payload = {
    v: _CG_RESCHEDULE_TOKEN_VERSION,
    sid: String(signupId || ""),
    eid: String(eventId || ""),
    col: String(collection || ""),
    ndk: String(newSessionDateKey || ""),
    exp: Number(expSeconds || 0),
  };
  const payloadStr = _b64urlEncode(Buffer.from(JSON.stringify(payload)));
  const sig = crypto.createHmac("sha256", _cgRescheduleHmacSecret())
    .update(payloadStr)
    .digest();
  return payloadStr + "." + _b64urlEncode(sig);
}

/**
 * Verify and decode a reschedule token. Returns the payload object or null
 * if the token is malformed, the signature doesn't match, or it's expired.
 */
function _verifyRescheduleToken(token) {
  try {
    const raw = String(token || "");
    const dot = raw.indexOf(".");
    if (dot <= 0) return null;
    const payloadStr = raw.substring(0, dot);
    const sigStr = raw.substring(dot + 1);
    const expected = crypto.createHmac("sha256", _cgRescheduleHmacSecret())
      .update(payloadStr).digest();
    const provided = _b64urlDecode(sigStr);
    if (provided.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(provided, expected)) return null;
    const payload = JSON.parse(_b64urlDecode(payloadStr).toString("utf8"));
    if (!payload || payload.v !== _CG_RESCHEDULE_TOKEN_VERSION) return null;
    if (!payload.sid || !payload.eid || !payload.ndk) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp < nowSec) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

// Resolve the public origin for reschedule links. Live site preferred; STAGE
// is supported on the GitHub Pages domain for testing. The brief specifies
// "https://www.ldahawaii.org/connect-gen-reschedule.html" for the live link;
// STAGE testing happens via the GH Pages mirror.
const CONNECT_GEN_RESCHEDULE_BASE_URL = "https://www.ldahawaii.org/connect-gen-reschedule.html";
const CONNECT_GEN_RESCHEDULE_BASE_URL_STAGE = "https://danpoahu.github.io/LDAH_W2/STAGE/connect-gen-reschedule.html";

// Pretty "Monday, May 19" for buttons.
function _formatMondayLabel(dateKey) {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  const d = new Date(dateKey + "T00:00:00-10:00");
  if (isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
    timeZone: "Pacific/Honolulu",
  });
}

// Pretty "Monday, May 19, 2026" for body copy.
function _formatSessionLongLabel(dateKey) {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  const d = new Date(dateKey + "T00:00:00-10:00");
  if (isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    timeZone: "Pacific/Honolulu",
  });
}

/**
 * Walk an event's sessions[] and return up to N future Monday + virtual
 * dateKeys that are at least 14 days from today HST. Skips the signup's
 * current session if it happens to match (avoids "move to the date you're
 * already on" buttons).
 */
function _findUpcomingMondaysForEvent(event, signup, opts) {
  const minDaysOut = (opts && Number.isFinite(opts.minDaysOut)) ? opts.minDaysOut : 14;
  const max = (opts && Number.isFinite(opts.max)) ? opts.max : 4;
  const currentKey = (opts && opts.currentKey) || "";

  const todayKey = toHstDateKey(new Date());
  const cutoffKey = addDaysHst(todayKey, minDaysOut);
  const seen = new Set();
  const out = [];

  let sessions = [];
  try { sessions = getEventSessions(event) || []; } catch (_) { sessions = []; }

  // Sort by dateKey ascending for deterministic "next 4" output.
  sessions.sort((a, b) => String(a.dateKey || "").localeCompare(String(b.dateKey || "")));

  for (const sess of sessions) {
    if (!sess || !sess.dateKey) continue;
    if (seen.has(sess.dateKey)) continue;
    if (sess.dateKey === currentKey) continue;
    if (sess.dateKey < cutoffKey) continue;
    // Monday check (HST weekday)
    const d = new Date(sess.dateKey + "T00:00:00-10:00");
    if (isNaN(d.getTime())) continue;
    const dayName = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "Pacific/Honolulu" });
    if (dayName !== "Monday") continue;
    // Virtual check — pass through isSessionVirtual with the signup so
    // per-signup overrides apply.
    if (!isSessionVirtual(event, sess.dateKey, signup)) continue;
    seen.add(sess.dateKey);
    out.push({
      dateKey: sess.dateKey,
      session: sess,
    });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Build the reschedule-offer or firm-reminder email HTML.
 * mode: "offer" | "reminder"
 */
function _buildCgRescheduleEmailHtml({
  mode, firstName, sessionDateLabel,
  uploadUrl, mondayOptions, signatureHtml,
}) {
  const safeFirst = lifecycleEsc(firstName || "there");
  const safeDate = lifecycleEsc(sessionDateLabel || "your Monday session");
  const uploadBtn = _emailBtn(uploadUrl, "Upload Documents Now", { bg: "#1a3c6e", align: "left" });

  const mondayBtns = (mondayOptions || []).map((opt) => {
    const label = "Monday, " + opt.label;
    return _emailBtn(opt.url, label, { bg: "#0891B2", align: "left" });
  }).join("");

  const intro = (mode === "reminder")
    ? '<p style="margin:0 0 14px;font-size:15px;color:#222;line-height:1.55;">' +
        'This is a friendly reminder that we still haven\'t received the IEP and evaluation documents for your Connect-Gen session on Monday, ' + safeDate + '. ' +
        'Without these documents, our advocates can\'t fully prepare, and we won\'t be able to send you the Zoom meeting link for that session.' +
      '</p>'
    : '<p style="margin:0 0 14px;font-size:15px;color:#222;line-height:1.55;">' +
        'I\'m reaching out about your Connect-Gen registration for Monday, ' + safeDate + '. ' +
        'We haven\'t received your child\'s IEP and evaluation documents yet, and we need those one week before the session so our advocates can prepare to best support your family.' +
      '</p>';

  const uploadLead = (mode === "reminder")
    ? '<p style="margin:0 0 8px;font-size:15px;color:#222;line-height:1.55;">' +
        'To stay on this Monday, please upload your documents as soon as possible:' +
      '</p>'
    : '<p style="margin:0 0 8px;font-size:15px;color:#222;line-height:1.55;">' +
        'If you can upload the documents in the next few days:' +
      '</p>';

  const mondayLead = (mode === "reminder")
    ? '<p style="margin:18px 0 8px;font-size:15px;color:#222;line-height:1.55;">' +
        'Or if this Monday no longer works, you can still move to one of these upcoming Mondays:' +
      '</p>'
    : '<p style="margin:18px 0 8px;font-size:15px;color:#222;line-height:1.55;">' +
        'If you need more time, you\'re welcome to move to one of these upcoming Mondays instead:' +
      '</p>';

  const closing = (mode === "reminder")
    ? ''
    : '<p style="margin:18px 0 8px;font-size:15px;color:#222;line-height:1.55;">' +
        'Once you pick a new Monday, we\'ll send a fresh upload link for the documents.' +
      '</p>';

  const linkFooter = _emailLinkFooter([{ label: "Upload documents", href: uploadUrl }]);
  const headerLabel = (mode === "reminder") ? "Connect-Gen Documents Reminder" : "Connect-Gen Monday";
  return [
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f7;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f4f7;padding:24px 0;">',
    '<tr><td align="center">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">',
    '<tr><td style="background:#1a3c6e;padding:18px 24px;">',
    '<p style="margin:0;font-size:18px;color:#ffffff;font-weight:700;">' + lifecycleEsc(headerLabel) + '</p>',
    '</td></tr>',
    '<tr><td style="padding:24px;">',
    '<p style="margin:0 0 14px;font-size:15px;color:#222;line-height:1.55;">Aloha ' + safeFirst + ',</p>',
    intro,
    uploadLead,
    uploadBtn,
    (mondayBtns ? (mondayLead + mondayBtns) : ''),
    closing,
    '<p style="margin:18px 0 14px;font-size:15px;color:#222;line-height:1.55;">If you have any questions or need help, please reply to this email — we\'re here to support you.</p>',
    '<p style="margin:18px 0 4px;font-size:15px;color:#333;line-height:1.55;">Mahalo,</p>',
    (signatureHtml || ''),
    linkFooter,
    '</td></tr>',
    '</table>',
    '</td></tr></table></body></html>',
  ].join('');
}

/**
 * Internal helper to send a fresh upload-later email. Mirrors
 * sendConnectGenUploadLaterEmail (HTTPS) but callable in-process so the
 * reschedule CF can fire it without an HTTP round trip.
 */
async function _sendConnectGenUploadLaterEmailFor({ db, signupRef, signupData, eventId }) {
  const recipientEmail = String(
    (signupData && signupData.email) ||
    (signupData && signupData.registration && signupData.registration.email) ||
    ""
  ).trim();
  if (!recipientEmail) throw new Error("Signup has no email on file");

  const familyName = String(
    (signupData && signupData.name) ||
    (signupData && signupData.firstName) ||
    ""
  ).trim();
  const firstName = lifecycleFirstName(familyName || recipientEmail);
  const uploadAuthToken = signupData && signupData.uploadAuthToken;
  if (!uploadAuthToken) throw new Error("Signup is missing uploadAuthToken");

  const uploadUrl = CONNECT_GEN_UPLOAD_BASE_URL + "?upload=" + encodeURIComponent(uploadAuthToken);
  let expiresFormatted = "";
  try {
    if (signupData.uploadAuthExpiresAt && typeof signupData.uploadAuthExpiresAt.toDate === "function") {
      expiresFormatted = _formatHstDateTime(signupData.uploadAuthExpiresAt.toDate());
    }
  } catch (_) {}

  const signatureHtml = await buildSignatureBlock("eventCoordinator");
  const html = _buildConnectGenUploadLaterEmailHtml({
    firstName, uploadUrl, expiresFormatted, signatureHtml,
  });

  const subject = "Upload your Connect-Gen documents -- " + (familyName || "LDAH");
  const fromAddress = lifecycleFromAddress();

  await sendEmailViaResend({
    from: fromAddress,
    to: recipientEmail,
    subject,
    html,
    type: "connect-gen-upload-later",
    relatedEventId: eventId,
    relatedSignupId: signupRef.id,
    recipientName: familyName || "",
  });

  try {
    await db.collection("auditLog").add({
      action: "Connect-Gen upload-later email sent (reschedule)",
      details: "email=" + recipientEmail + ", signupPath=" + signupRef.path,
      performedBy: recipientEmail,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      signupPath: signupRef.path,
    });
  } catch (e) { console.warn("auditLog write failed:", e.message); }
}

// ─── Part 2: enforceConnectGenDocDeadline (scheduled) ────────────────
// Runs daily at 8 AM HST. Scans Connect-Gen events for Monday-virtual
// signups missing docs and sends T-7 reschedule offers and T-4 firm
// reminders. Gated by settings/featureFlags.cgDeadlineEnforcementEnabled.
exports.enforceConnectGenDocDeadline = functions
  .runWith({
    timeoutSeconds: 540,
    maxInstances: 1,
    secrets: ["RESEND_API_KEY", "SMTP_FROM", "CG_RESCHEDULE_HMAC_SECRET"],
  })
  .pubsub.schedule("0 8 * * *")
  .timeZone("Pacific/Honolulu")
  .onRun(async () => {
    const db = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;

    // Feature flag — required gate per the brief. Daniel will flip it on
    // after testing the cron in isolation.
    let cutoff = null;
    try {
      const flagsSnap = await db.doc("settings/featureFlags").get();
      const flags = (flagsSnap.exists && flagsSnap.data()) || {};
      const enabled = !!flags.cgDeadlineEnforcementEnabled;
      if (!enabled) {
        console.log("[enforceConnectGenDocDeadline] disabled via flag — skipping");
        return null;
      }
      cutoff = flags.cgDeadlineEnforcementCutoff; // Firestore Timestamp

      // Safety: if flag is on but no cutoff set, log + abort (require explicit cutoff)
      if (!cutoff) {
        console.error("[enforceConnectGenDocDeadline] enabled but no cutoff timestamp set — aborting for safety");
        return null;
      }
    } catch (flagErr) {
      console.warn("[enforceConnectGenDocDeadline] flag read failed, treating as disabled:", flagErr.message);
      return null;
    }

    const todayKey = toHstDateKey(new Date());
    const offerKey = addDaysHst(todayKey, 7);
    const reminderKey = addDaysHst(todayKey, 4);

    let scanned = 0, offersSent = 0, remindersSent = 0, skipped = 0, errors = 0;

    async function processCollection(collection) {
      const evsSnap = await db.collection(collection)
        .where("zoomMode", "==", "program")
        .get();
      for (const evDoc of evsSnap.docs) {
        const event = evDoc.data() || {};
        const eventId = evDoc.id;
        let sigsSnap;
        try {
          sigsSnap = await db.collection(collection).doc(eventId).collection("signups")
            .where("status", "==", "pending")
            .get();
        } catch (e) {
          errors++;
          console.error("enforceConnectGenDocDeadline: signups query failed for " + collection + "/" + eventId, e.message);
          continue;
        }

        for (const sigDoc of sigsSnap.docs) {
          scanned++;
          try {
            const signup = sigDoc.data() || {};
            // Grandfather: signup pre-dates enforcement cutoff (e.g., snail-mail docs path).
            // Signup docs use `timestamp` (serverTimestamp at creation) across all W2/App
            // write paths (events.html L2902, L3229, L3712).
            if (!signup.timestamp || signup.timestamp.toMillis() < cutoff.toMillis()) {
              skipped++; continue;
            }
            if (signup.archived === true) { skipped++; continue; }
            if (!signup.email) { skipped++; continue; }
            if (!signup.consentSignedAt) { skipped++; continue; }

            // Docs already received → skip
            const docs = signup.connectGenDocuments;
            if (docs && docs.iep && docs.iep.storagePath && docs.evaluation && docs.evaluation.storagePath) {
              skipped++; continue;
            }

            // Single-date: pick the session
            const sSessions = getSignupSessions(signup, event) || [];
            const sessionKey = (sSessions[0] && sSessions[0].dateKey) || "";
            if (!sessionKey) { skipped++; continue; }
            // Monday + virtual gate
            const dObj = new Date(sessionKey + "T00:00:00-10:00");
            if (isNaN(dObj.getTime())) { skipped++; continue; }
            const dayName = dObj.toLocaleDateString("en-US", { weekday: "long", timeZone: "Pacific/Honolulu" });
            if (dayName !== "Monday") { skipped++; continue; }
            if (!isSessionVirtual(event, sessionKey, signup)) { skipped++; continue; }

            // Determine branch
            const isOfferDay = (sessionKey === offerKey);
            const isReminderDay = (sessionKey === reminderKey);
            if (!isOfferDay && !isReminderDay) { skipped++; continue; }

            // Compute the next 4 Mondays once — reused for both branches.
            const upcoming = _findUpcomingMondaysForEvent(event, signup, {
              currentKey: sessionKey, minDaysOut: 14, max: 4,
            });

            // Branch: T-7 reschedule offer
            if (isOfferDay) {
              if (signup.rescheduleOfferSentAt) { skipped++; continue; }
              // If fewer than 2 future Mondays, brief says skip the offer
              // entirely and let the firm reminder handle this signup.
              if (upcoming.length < 2) {
                console.log("enforceConnectGenDocDeadline: skipping offer for " + sigDoc.ref.path + " — fewer than 2 future Mondays available");
                skipped++; continue;
              }
              await _sendCgRescheduleEmail({
                db, mode: "offer", collection, eventId,
                signupRef: sigDoc.ref, signupData: signup,
                sessionKey, upcoming,
              });
              await sigDoc.ref.set({
                rescheduleOfferSentAt: FieldValue.serverTimestamp(),
              }, { merge: true });
              offersSent++;
              continue;
            }

            // Branch: T-4 firm reminder
            if (isReminderDay) {
              if (signup.firmReminderSentAt) { skipped++; continue; }
              // The brief requires the offer to be ≥3 days old. Compute on
              // rescheduleOfferSentAt if present; if missing, still allow
              // the firm reminder (edge case from <2 Mondays available).
              const offerStamp = signup.rescheduleOfferSentAt;
              if (offerStamp && typeof offerStamp.toDate === "function") {
                const ageMs = Date.now() - offerStamp.toDate().getTime();
                if (ageMs < 3 * 24 * 60 * 60 * 1000) {
                  skipped++; continue;
                }
              }
              await _sendCgRescheduleEmail({
                db, mode: "reminder", collection, eventId,
                signupRef: sigDoc.ref, signupData: signup,
                sessionKey, upcoming,
              });
              await sigDoc.ref.set({
                firmReminderSentAt: FieldValue.serverTimestamp(),
              }, { merge: true });
              remindersSent++;
              continue;
            }

            skipped++;
          } catch (e) {
            errors++;
            console.error("enforceConnectGenDocDeadline per-signup error for " + sigDoc.ref.path + ":", e.message);
          }
        }
      }
    }

    try {
      await processCollection("events");
      await processCollection("recurringEvents");
    } catch (err) {
      console.error("enforceConnectGenDocDeadline: scan failed:", err.message);
    }

    console.log("enforceConnectGenDocDeadline: scanned=" + scanned +
      ", offersSent=" + offersSent + ", remindersSent=" + remindersSent +
      ", skipped=" + skipped + ", errors=" + errors);
    return null;
  });

async function _sendCgRescheduleEmail({
  db, mode, collection, eventId, signupRef, signupData, sessionKey, upcoming,
}) {
  const recipientEmail = String(
    (signupData && signupData.email) ||
    (signupData && signupData.registration && signupData.registration.email) ||
    ""
  ).trim();
  if (!recipientEmail) throw new Error("Signup has no email on file");

  const familyName = String((signupData && signupData.name) || (signupData && signupData.firstName) || "").trim();
  const firstName = lifecycleFirstName(familyName || recipientEmail);

  const uploadAuthToken = signupData && signupData.uploadAuthToken;
  if (!uploadAuthToken) throw new Error("Signup is missing uploadAuthToken (expected from consent flow)");
  const uploadUrl = CONNECT_GEN_UPLOAD_BASE_URL + "?upload=" + encodeURIComponent(uploadAuthToken);

  // Build Monday options — sign one token per option, 14d expiry from now.
  const exp = Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60;
  const mondayOptions = (upcoming || []).map((opt) => {
    const token = _signRescheduleToken({
      signupId: signupRef.id,
      eventId,
      collection,
      newSessionDateKey: opt.dateKey,
      expSeconds: exp,
    });
    const url = CONNECT_GEN_RESCHEDULE_BASE_URL + "?token=" + encodeURIComponent(token);
    return { dateKey: opt.dateKey, label: _formatMondayLabel(opt.dateKey).replace(/^Monday,\s*/, ""), url };
  });

  const sessionDateLabel = (function () {
    const long = _formatSessionLongLabel(sessionKey);
    // strip leading "Monday, " so the body says "Monday, May 19, 2026"
    return long.replace(/^Monday,\s*/, "");
  })();

  const signatureHtml = await buildSignatureBlock("eventCoordinator");
  const html = _buildCgRescheduleEmailHtml({
    mode, firstName, sessionDateLabel,
    uploadUrl, mondayOptions, signatureHtml,
  });

  const subject = (mode === "reminder")
    ? "Connect-Gen Documents Reminder"
    : "Connect-Gen Monday -- IEP + Evaluation Needed";

  const fromAddress = lifecycleFromAddress();
  await sendEmailViaResend({
    from: fromAddress,
    to: recipientEmail,
    subject,
    html,
    type: mode === "reminder" ? "connect-gen-firm-reminder" : "connect-gen-reschedule-offer",
    relatedEventId: eventId,
    relatedSignupId: signupRef.id,
    recipientName: familyName || "",
  });

  try {
    await db.collection("auditLog").add({
      action: mode === "reminder"
        ? "Connect-Gen firm reminder sent"
        : "Connect-Gen reschedule offer sent",
      details: "email=" + recipientEmail + ", signupPath=" + signupRef.path + ", session=" + sessionKey,
      performedBy: "system",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      signupPath: signupRef.path,
    });
  } catch (e) { console.warn("auditLog write failed:", e.message); }
}

// ─── Part 3: acceptConnectGenReschedule (HTTPS) ──────────────────────
// Parent clicks a "Monday, May 19" button in the reschedule offer or firm
// reminder email. The button URL carries a signed token. This CF validates
// the token, updates the signup, and fires a fresh upload-later email.
exports.acceptConnectGenReschedule = functions
  .runWith({
    timeoutSeconds: 30,
    maxInstances: 10,
    secrets: ["RESEND_API_KEY", "SMTP_FROM", "CG_RESCHEDULE_HMAC_SECRET"],
  })
  .https.onRequest(async (req, res) => {
    // CORS — allow live + STAGE GH Pages mirror.
    const origin = req.headers.origin || "";
    const allowed = [
      "https://www.ldahawaii.org",
      "https://ldahawaii.org",
      "https://danpoahu.github.io",
    ];
    if (allowed.indexOf(origin) !== -1) {
      res.set("Access-Control-Allow-Origin", origin);
    } else {
      res.set("Access-Control-Allow-Origin", "https://www.ldahawaii.org");
    }
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "GET" && req.method !== "POST") {
      res.status(405).json({ success: false, error: "Method not allowed" });
      return;
    }

    const token = String(
      (req.query && req.query.token) ||
      (req.body && req.body.token) ||
      ""
    ).trim();
    if (!token) {
      res.status(400).json({ success: false, error: "Missing token." });
      return;
    }

    const payload = _verifyRescheduleToken(token);
    if (!payload) {
      res.status(401).json({ success: false, error: "This link is invalid or has expired. Please contact us at registration@ldahawaii.org." });
      return;
    }

    try {
      const db = admin.firestore();
      const FieldValue = admin.firestore.FieldValue;

      const collection = (payload.col === "recurringEvents") ? "recurringEvents" : "events";
      const eventId = payload.eid;
      const signupId = payload.sid;
      const newKey = payload.ndk;

      const signupRef = db.collection(collection).doc(eventId).collection("signups").doc(signupId);
      const signupSnap = await signupRef.get();
      if (!signupSnap.exists) {
        res.status(404).json({ success: false, error: "We couldn't find your signup. Please contact us at registration@ldahawaii.org." });
        return;
      }
      const signup = signupSnap.data() || {};

      const evSnap = await db.collection(collection).doc(eventId).get();
      const event = evSnap.exists ? (evSnap.data() || {}) : {};

      // Sanity checks
      if (signup.archived === true) {
        res.status(400).json({ success: false, error: "This signup has been archived. Please contact us at registration@ldahawaii.org." });
        return;
      }
      if (signup.status !== "pending") {
        res.status(400).json({ success: false, error: "This signup is no longer pending. Please contact us at registration@ldahawaii.org." });
        return;
      }
      if (event.zoomMode !== "program") {
        res.status(400).json({ success: false, error: "This link is not valid for this event." });
        return;
      }
      const existingDocs = signup.connectGenDocuments;
      if (existingDocs && existingDocs.iep && existingDocs.iep.storagePath
        && existingDocs.evaluation && existingDocs.evaluation.storagePath) {
        res.status(400).json({ success: false, error: "Your documents are already on file. No need to reschedule." });
        return;
      }

      // Idempotency: if already on newKey, return success (parent re-clicked).
      const currentKeys = extractSignupSessionKeys(signup);
      const recipientName = String(signup.name || signup.firstName || "").trim();
      const firstName = lifecycleFirstName(recipientName || signup.email || "");
      if (currentKeys.length === 1 && currentKeys[0] === newKey) {
        res.status(200).json({
          success: true,
          alreadyOnDate: true,
          newSessionDate: _formatSessionLongLabel(newKey),
          parentFirstName: firstName,
        });
        return;
      }

      // Look up the new session on the event so we can build a canonical
      // pipe-delimited selectedSessions[] entry (matches Connect-Gen shape).
      const evSessions = getEventSessions(event) || [];
      const newSession = evSessions.find((s) => s && s.dateKey === newKey);
      if (!newSession) {
        res.status(400).json({ success: false, error: "The selected Monday is no longer available. Please reply to our email and we'll help you pick another date." });
        return;
      }
      // Verify Monday + virtual on the chosen session
      const dObj = new Date(newKey + "T00:00:00-10:00");
      if (isNaN(dObj.getTime())) {
        res.status(400).json({ success: false, error: "Invalid session date." });
        return;
      }
      const dayName = dObj.toLocaleDateString("en-US", { weekday: "long", timeZone: "Pacific/Honolulu" });
      if (dayName !== "Monday") {
        res.status(400).json({ success: false, error: "Only Monday sessions can be selected here." });
        return;
      }
      if (!isSessionVirtual(event, newKey, signup)) {
        res.status(400).json({ success: false, error: "The selected session is no longer virtual. Please reply to our email." });
        return;
      }

      // Reconstruct a pipe-delimited "YYYY-MM-DD|location|HH:MM AM-HH:MM PM"
      // entry so the rest of the pipeline (reminders, daily report) still
      // recognises the session. Fall back to the rawString from the event's
      // canonical sessions[] when present.
      const pipeEntry = newSession.rawString && newSession.rawString.indexOf("|") !== -1
        ? newSession.rawString
        : (function () {
            const loc = String(newSession.location || event.location || "Virtual / Zoom").trim();
            // Convert HH:MM 24h back to "H:MM AM/PM-H:MM AM/PM" if we have them.
            const fmt12 = (hhmm) => {
              if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return "";
              const h = parseInt(hhmm.substring(0, 2), 10);
              const m = hhmm.substring(3);
              const ap = h >= 12 ? "PM" : "AM";
              const h12 = ((h + 11) % 12) + 1;
              return h12 + ":" + m + " " + ap;
            };
            const st = fmt12(newSession.startTime);
            const et = fmt12(newSession.endTime);
            const time = st && et ? (st + "-" + et) : (st || "");
            return newKey + "|" + loc + (time ? ("|" + time) : "");
          })();

      // Apply the update
      await signupRef.update({
        selectedSessions: [pipeEntry],
        selectedDates: [newKey],
        rescheduleOfferSentAt: FieldValue.delete(),
        firmReminderSentAt: FieldValue.delete(),
        // sessionReminders cleared so the new T-7/T-1 reminders fire fresh.
        sessionReminders: FieldValue.delete(),
        rescheduledAt: FieldValue.serverTimestamp(),
        rescheduledTo: newKey,
        rescheduledFrom: currentKeys[0] || null,
      });

      // Fresh upload-later email — use the existing uploadAuthToken (still
      // valid; consent flow already minted it). If the token has somehow
      // already expired, the upload page itself will surface that to the
      // parent.
      const updatedSnap = await signupRef.get();
      const updatedSignup = updatedSnap.data() || {};
      try {
        await _sendConnectGenUploadLaterEmailFor({
          db, signupRef, signupData: updatedSignup, eventId,
        });
      } catch (sendErr) {
        console.warn("acceptConnectGenReschedule: upload-later email failed (non-fatal):", sendErr.message);
      }

      try {
        await db.collection("auditLog").add({
          action: "Connect-Gen reschedule accepted",
          details: "from=" + (currentKeys[0] || "?") + " to=" + newKey + ", signupPath=" + signupRef.path,
          performedBy: signup.email || "parent",
          timestamp: FieldValue.serverTimestamp(),
          signupPath: signupRef.path,
        });
      } catch (e) { console.warn("auditLog write failed:", e.message); }

      res.status(200).json({
        success: true,
        newSessionDate: _formatSessionLongLabel(newKey),
        parentFirstName: firstName,
      });
    } catch (err) {
      console.error("acceptConnectGenReschedule error:", err.message);
      res.status(500).json({ success: false, error: "Something went wrong. Please reply to our email and we'll help." });
    }
  });

// ── Native Hawaiian Family Survey ──────────────────────────────────
// Public-facing anonymous survey on LDAH W2. No PII captured — just
// question answers + a timestamp + a SHA-256-hashed IP for rate
// limiting (3 submissions/IP/24h). Survey allows partial answers
// (all q-fields optional). Honeypot field silently swallows bots.
//
// Two CFs:
//   submitNativeHawaiianSurvey     — POST endpoint (HTTPS onRequest)
//   sendNativeHawaiianSurveyReport — daily 8 AM HST report to Rosie

const NH_SURVEY_ALLOWED_ORIGINS = [
  "https://www.ldahawaii.org",
  "https://danpoahu.github.io",
];

const NH_ENUMS = {
  q1: ["yes", "no", "unsure"],
  q2: ["oahu", "hawaii_island", "maui", "kauai", "molokai", "lanai", "other"],
  q3: ["english", "olelo_hawaii", "hawaiian_pidgin", "chuukese", "marshallese", "samoan", "ilocano_tagalog", "other"],
  q4: ["frequently", "sometimes", "rarely", "never"],
  q5: ["idea", "har_chapter_60", "evaluation_eligibility", "iep_meetings", "parent_rights", "dispute_resolution", "transition_planning", "sped_forms_notices"],
  q6: ["very_important", "important", "somewhat_important", "not_important"],
  q7: ["yes", "maybe", "no"],
  q8: ["printed_handouts", "videos", "online_workshops", "one_on_one", "visual_guides", "social_media", "audio_podcasts"],
  q9: ["yes", "somewhat", "no"],
  q10: ["referral", "assessment_results", "eligibility", "writing_iep", "services_supports", "transition_planning", "disagreements"],
  q11: ["yes", "sometimes", "no"],
  q12: ["yes", "maybe", "no"],
  q15: ["yes", "no", "maybe"],
};

// Human-readable labels for the report email.
const NH_LABELS = {
  q1: { yes: "Yes", no: "No", unsure: "Unsure" },
  q2: { oahu: "O'ahu", hawaii_island: "Hawai'i Island", maui: "Maui", kauai: "Kaua'i", molokai: "Moloka'i", lanai: "Lana'i", other: "Other" },
  q3: { english: "English", olelo_hawaii: "'Olelo Hawai'i (Hawaiian language)", hawaiian_pidgin: "Hawaiian Pidgin", chuukese: "Chuukese", marshallese: "Marshallese", samoan: "Samoan", ilocano_tagalog: "Ilocano/Tagalog", other: "Other" },
  q4: { frequently: "Frequently", sometimes: "Sometimes", rarely: "Rarely", never: "Never" },
  q5: { idea: "IDEA (Individuals with Disabilities Education Act)", har_chapter_60: "Hawai'i Administrative Rules (HAR Chapter 60)", evaluation_eligibility: "Evaluation and eligibility process", iep_meetings: "Individualized Education Program (IEP) meetings", parent_rights: "Parent rights and protections", dispute_resolution: "Dispute resolution options", transition_planning: "Transition planning after high school", sped_forms_notices: "Special education forms and notices" },
  q6: { very_important: "Very Important", important: "Important", somewhat_important: "Somewhat Important", not_important: "Not Important" },
  q7: { yes: "Yes", maybe: "Maybe", no: "No" },
  q8: { printed_handouts: "Printed handouts", videos: "Videos", online_workshops: "Online workshops/webinars", one_on_one: "One-on-one explanation/support", visual_guides: "Visual guides or flowcharts", social_media: "Social media posts", audio_podcasts: "Audio recordings/podcasts" },
  q9: { yes: "Yes", somewhat: "Somewhat", no: "No" },
  q10: { referral: "Referral for evaluation", assessment_results: "Understanding assessment results", eligibility: "Eligibility determination", writing_iep: "Writing the IEP", services_supports: "Understanding services/supports", transition_planning: "Transition planning", disagreements: "Resolving disagreements with the school" },
  q11: { yes: "Yes", sometimes: "Sometimes", no: "No" },
  q12: { yes: "Yes", maybe: "Maybe", no: "No" },
  q15: { yes: "Yes", no: "No", maybe: "Maybe" },
};

// Strip-tag guard. Reject if any HTML/script tag-looking sequence appears.
const NH_TAG_RE = /<[^>]+>/;

function _nhEscHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function _nhValidateEnum(val, allowed) {
  if (val === null || val === undefined || val === "") return { ok: true, value: null };
  if (typeof val !== "string") return { ok: false };
  if (NH_TAG_RE.test(val)) return { ok: false };
  if (allowed.indexOf(val) === -1) return { ok: false };
  return { ok: true, value: val };
}

function _nhValidateMultiSelect(arr, allowed, maxLen) {
  if (arr === null || arr === undefined) return { ok: true, value: [] };
  if (!Array.isArray(arr)) return { ok: false };
  const seen = new Set();
  for (const v of arr) {
    if (typeof v !== "string") return { ok: false };
    if (NH_TAG_RE.test(v)) return { ok: false };
    if (allowed.indexOf(v) === -1) return { ok: false };
    seen.add(v);
  }
  const out = Array.from(seen);
  if (typeof maxLen === "number" && out.length > maxLen) return { ok: false };
  return { ok: true, value: out };
}

function _nhValidateOtherWrap(raw, allowed, fieldName) {
  // For q2 (single) and q3 (multi) — both have shape { value/values, other }.
  if (raw === null || raw === undefined) {
    if (fieldName === "q2") return { ok: true, value: { value: null, other: null } };
    return { ok: true, value: { values: [], other: null } };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false };

  let other = raw.other;
  if (other === undefined || other === "") other = null;
  if (other !== null) {
    if (typeof other !== "string") return { ok: false };
    if (NH_TAG_RE.test(other)) return { ok: false };
    other = other.trim();
    if (other.length === 0) other = null;
    if (other && other.length > 200) return { ok: false };
  }

  if (fieldName === "q2") {
    const v = _nhValidateEnum(raw.value, allowed);
    if (!v.ok) return { ok: false };
    if (other && v.value !== "other") return { ok: false };
    return { ok: true, value: { value: v.value, other } };
  }
  // q3 — multi-select
  const v = _nhValidateMultiSelect(raw.values, allowed);
  if (!v.ok) return { ok: false };
  if (other && v.value.indexOf("other") === -1) return { ok: false };
  return { ok: true, value: { values: v.value, other } };
}

function _nhValidateOpenText(val) {
  if (val === null || val === undefined || val === "") return { ok: true, value: null };
  if (typeof val !== "string") return { ok: false };
  if (NH_TAG_RE.test(val)) return { ok: false };
  const trimmed = val.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > 1000) return { ok: false };
  return { ok: true, value: trimmed };
}

exports.submitNativeHawaiianSurvey = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 30, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    // ── CORS ──
    const origin = req.headers.origin || "";
    if (NH_SURVEY_ALLOWED_ORIGINS.indexOf(origin) !== -1) {
      res.set("Access-Control-Allow-Origin", origin);
    }
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "3600");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "Method not allowed" });
      return;
    }

    try {
      const body = req.body || {};

      // ── Honeypot: empty string for humans. If filled, silently swallow. ──
      if (typeof body.honeypot !== "string" || body.honeypot.length > 0) {
        // Per spec: silently return success, don't tip off the bot, don't write to Firestore.
        res.status(200).json({ success: true });
        return;
      }

      // ── Validate each field ──
      const v1 = _nhValidateEnum(body.q1, NH_ENUMS.q1);
      const v2 = _nhValidateOtherWrap(body.q2, NH_ENUMS.q2, "q2");
      const v3 = _nhValidateOtherWrap(body.q3, NH_ENUMS.q3, "q3");
      const v4 = _nhValidateEnum(body.q4, NH_ENUMS.q4);
      const v5 = _nhValidateMultiSelect(body.q5, NH_ENUMS.q5);
      const v6 = _nhValidateEnum(body.q6, NH_ENUMS.q6);
      const v7 = _nhValidateEnum(body.q7, NH_ENUMS.q7);
      const v8 = _nhValidateMultiSelect(body.q8, NH_ENUMS.q8, 3);
      const v9 = _nhValidateEnum(body.q9, NH_ENUMS.q9);
      const v10 = _nhValidateMultiSelect(body.q10, NH_ENUMS.q10);
      const v11 = _nhValidateEnum(body.q11, NH_ENUMS.q11);
      const v12 = _nhValidateEnum(body.q12, NH_ENUMS.q12);
      const v13 = _nhValidateOpenText(body.q13);
      const v14 = _nhValidateOpenText(body.q14);
      const v15 = _nhValidateEnum(body.q15, NH_ENUMS.q15);

      const allValid = [v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15].every((r) => r.ok);
      if (!allValid) {
        res.status(400).json({ success: false, error: "Invalid submission. Please check your answers and try again." });
        return;
      }

      // ── IP rate limit (3 per IP per 24h) ──
      const rawIp = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() || req.ip || "unknown";
      const ipHash = crypto.createHash("sha256").update(rawIp).digest("hex");

      const db = admin.firestore();
      const Timestamp = admin.firestore.Timestamp;
      const FieldValue = admin.firestore.FieldValue;
      const ipDocRef = db.collection("nhSurveyIpHistory").doc(ipHash);
      const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;

      const ipSnap = await ipDocRef.get();
      let submissions = [];
      if (ipSnap.exists) {
        const data = ipSnap.data() || {};
        const arr = Array.isArray(data.submissions) ? data.submissions : [];
        for (const ts of arr) {
          let ms = null;
          if (ts && typeof ts.toMillis === "function") ms = ts.toMillis();
          else if (ts && typeof ts.seconds === "number") ms = ts.seconds * 1000;
          if (ms !== null && ms >= cutoffMs) submissions.push(ts);
        }
      }

      if (submissions.length >= 3) {
        res.status(429).json({ success: false, error: "Rate limit exceeded. Please try again tomorrow." });
        return;
      }

      // Append current submission timestamp. Use Timestamp.now() — serverTimestamp()
      // is REJECTED inside array elements (see Firestore Array Timestamp memory).
      submissions.push(Timestamp.now());
      await ipDocRef.set({ submissions }, { merge: false });

      // ── Write the survey doc ──
      const surveyDocRef = await db.collection("nativeHawaiianSurveys").add({
        q1: v1.value,
        q2: v2.value,
        q3: v3.value,
        q4: v4.value,
        q5: v5.value,
        q6: v6.value,
        q7: v7.value,
        q8: v8.value,
        q9: v9.value,
        q10: v10.value,
        q11: v11.value,
        q12: v12.value,
        q13: v13.value,
        q14: v14.value,
        q15: v15.value,
        submittedAt: FieldValue.serverTimestamp(),
        ipHash, // for duplicate flagging in the report; do NOT store raw IP
      });

      res.status(200).json({ success: true, surveyDocId: surveyDocRef.id });
    } catch (err) {
      console.error("submitNativeHawaiianSurvey error:", err && err.message);
      res.status(500).json({ success: false, error: "Something went wrong. Please try again." });
    }
  });

// ── addNativeHawaiianSurveyContact ────────────────────────────────
// Optional follow-up: after submitNativeHawaiianSurvey returns a
// surveyDocId, the modal offers a contact-info screen. Any/all of
// fullName/email/phone can be supplied; at least one must be non-empty.
// Idempotent: rejects if contactAddedAt is already set on the doc.
// Shares the same per-IP 24h bucket as the submit CF (3/24h ceiling).

const NH_CONTACT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.addNativeHawaiianSurveyContact = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 30, maxInstances: 10 })
  .https.onRequest(async (req, res) => {
    // ── CORS ──
    const origin = req.headers.origin || "";
    if (NH_SURVEY_ALLOWED_ORIGINS.indexOf(origin) !== -1) {
      res.set("Access-Control-Allow-Origin", origin);
    }
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Max-Age", "3600");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "Method not allowed" });
      return;
    }

    try {
      const body = req.body || {};
      const surveyDocId = typeof body.surveyDocId === "string" ? body.surveyDocId.trim() : "";
      if (!surveyDocId || surveyDocId.length > 100 || /[^A-Za-z0-9_-]/.test(surveyDocId)) {
        res.status(400).json({ success: false, error: "Missing or invalid surveyDocId." });
        return;
      }

      function _sanitize(raw, maxLen) {
        if (raw === null || raw === undefined) return null;
        if (typeof raw !== "string") return null;
        if (NH_TAG_RE.test(raw)) return "__INVALID__";
        const trimmed = raw.trim();
        if (!trimmed.length) return null;
        if (trimmed.length > maxLen) return "__INVALID__";
        return trimmed;
      }

      const fullName = _sanitize(body.fullName, 120);
      const email = _sanitize(body.email, 120);
      const phone = _sanitize(body.phone, 30);

      if (fullName === "__INVALID__" || email === "__INVALID__" || phone === "__INVALID__") {
        res.status(400).json({ success: false, error: "Invalid contact info. Please check your entries and try again." });
        return;
      }

      if (!fullName && !email && !phone) {
        res.status(400).json({ success: false, error: "Please provide at least one contact field." });
        return;
      }

      if (email && !NH_CONTACT_EMAIL_RE.test(email)) {
        res.status(400).json({ success: false, error: "Email address doesn't look right. Please check and try again." });
        return;
      }

      const db = admin.firestore();
      const Timestamp = admin.firestore.Timestamp;
      const FieldValue = admin.firestore.FieldValue;

      // ── IP rate-limit (shared bucket with submit CF) ──
      const rawIp = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() || req.ip || "unknown";
      const ipHash = crypto.createHash("sha256").update(rawIp).digest("hex");
      const ipDocRef = db.collection("nhSurveyIpHistory").doc(ipHash);
      const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;

      const ipSnap = await ipDocRef.get();
      let submissions = [];
      if (ipSnap.exists) {
        const data = ipSnap.data() || {};
        const arr = Array.isArray(data.submissions) ? data.submissions : [];
        for (const ts of arr) {
          let ms = null;
          if (ts && typeof ts.toMillis === "function") ms = ts.toMillis();
          else if (ts && typeof ts.seconds === "number") ms = ts.seconds * 1000;
          if (ms !== null && ms >= cutoffMs) submissions.push(ts);
        }
      }

      if (submissions.length >= 3) {
        res.status(429).json({ success: false, error: "Rate limit exceeded. Please try again tomorrow." });
        return;
      }

      // ── Load survey doc + idempotency check ──
      const surveyRef = db.collection("nativeHawaiianSurveys").doc(surveyDocId);
      const surveySnap = await surveyRef.get();
      if (!surveySnap.exists) {
        res.status(400).json({ success: false, error: "Survey response not found." });
        return;
      }
      const surveyData = surveySnap.data() || {};
      if (surveyData.contactAddedAt) {
        res.status(400).json({ success: false, error: "Contact info has already been added to this response." });
        return;
      }

      // ── Build update payload (only included supplied fields) ──
      const updatePayload = { contactAddedAt: FieldValue.serverTimestamp() };
      if (fullName) updatePayload.contactFullName = fullName;
      if (email) updatePayload.contactEmail = email;
      if (phone) updatePayload.contactPhone = phone;

      await surveyRef.update(updatePayload);

      // Count this contact-add toward today's IP bucket.
      submissions.push(Timestamp.now());
      await ipDocRef.set({ submissions }, { merge: false });

      res.status(200).json({ success: true });
    } catch (err) {
      console.error("addNativeHawaiianSurveyContact error:", err && err.message);
      res.status(500).json({ success: false, error: "Something went wrong. Please try again." });
    }
  });

// ── sendNativeHawaiianSurveyReport ────────────────────────────────
// Scheduled daily at 8 AM HST. Emails Rosie a CUMULATIVE graphic
// digest of all responses to date (header tiles, per-question
// horizontal bars, 14-day sparkline, data-quality footer).
//
// Cumulative format approved 2026-05-14. Sends only if total
// responses > 0 (suppresses entirely-empty heartbeat). All Outlook-
// safety: nested <table> tile rows, inline styles, no external assets.

// Short labels for horizontal-bar rows. Kept short so bars don't wrap.
const NH_BAR_LABELS = {
  q1: { yes: "Yes", no: "No", unsure: "Unsure" },
  q2: { oahu: "O'ahu", hawaii_island: "Hawai'i Island", maui: "Maui", kauai: "Kaua'i", molokai: "Moloka'i", lanai: "Lana'i", other: "Other" },
  q3: { english: "English", olelo_hawaii: "'Olelo Hawai'i", hawaiian_pidgin: "Hawaiian Pidgin", chuukese: "Chuukese", marshallese: "Marshallese", samoan: "Samoan", ilocano_tagalog: "Ilocano/Tagalog", other: "Other" },
  q4: { frequently: "Frequently", sometimes: "Sometimes", rarely: "Rarely", never: "Never" },
  q5: { idea: "IDEA", har_chapter_60: "HAR Chapter 60", evaluation_eligibility: "Eval & eligibility", iep_meetings: "IEP meetings", parent_rights: "Parent rights", dispute_resolution: "Dispute resolution", transition_planning: "Transition planning", sped_forms_notices: "SPED forms & notices" },
  q6: { very_important: "Very Important", important: "Important", somewhat_important: "Somewhat Important", not_important: "Not Important" },
  q7: { yes: "Yes", maybe: "Maybe", no: "No" },
  q8: { printed_handouts: "Printed handouts", videos: "Videos", online_workshops: "Online workshops", one_on_one: "One-on-one support", visual_guides: "Visual guides / flowcharts", social_media: "Social media posts", audio_podcasts: "Audio / podcasts" },
  q9: { yes: "Yes", somewhat: "Somewhat", no: "No" },
  q10: { referral: "Referral for evaluation", assessment_results: "Understanding assessment results", eligibility: "Eligibility determination", writing_iep: "Writing the IEP", services_supports: "Understanding services / supports", transition_planning: "Transition planning", disagreements: "Resolving disagreements" },
  q11: { yes: "Yes", sometimes: "Sometimes", no: "No" },
  q12: { yes: "Yes", maybe: "Maybe", no: "No" },
  q15: { yes: "Yes", maybe: "Maybe", no: "No" },
};

// Color palette for bar fills, per-question. Indexed by option order.
const NH_BAR_COLORS = {
  q1: ["#10B981", "#DC2626", "#F59E0B"],
  q2: ["#0891B2", "#06B6D4", "#67e8f9", "#67e8f9", "#a5f3fc", "#a5f3fc", "#fde68a"],
  q3: ["#0891B2", "#06B6D4", "#06B6D4", "#67e8f9", "#67e8f9", "#a5f3fc", "#a5f3fc", "#fde68a"],
  q4: ["#0891B2", "#06B6D4", "#67e8f9", "#a5f3fc"],
  q5: ["#0891B2", "#0891B2", "#06B6D4", "#06B6D4", "#67e8f9", "#67e8f9", "#a5f3fc", "#a5f3fc"],
  q6: ["#0891B2", "#06B6D4", "#67e8f9", "#a5f3fc"],
  q7: ["#10B981", "#F59E0B", "#DC2626"],
  q8: ["#0891B2", "#06B6D4", "#06B6D4", "#67e8f9", "#67e8f9", "#a5f3fc", "#a5f3fc"],
  q9: ["#10B981", "#F59E0B", "#DC2626"],
  q10: ["#0891B2", "#0891B2", "#06B6D4", "#06B6D4", "#67e8f9", "#67e8f9", "#a5f3fc"],
  q11: ["#DC2626", "#F59E0B", "#10B981"],
  q12: ["#10B981", "#F59E0B", "#DC2626"],
  q15: ["#10B981", "#F59E0B", "#DC2626"],
};

// Display order for bars (some questions reordered from validation enum for readability).
const NH_BAR_ORDER = {
  q1: ["yes", "no", "unsure"],
  q2: ["oahu", "hawaii_island", "maui", "kauai", "molokai", "lanai", "other"],
  q3: ["english", "olelo_hawaii", "hawaiian_pidgin", "chuukese", "marshallese", "samoan", "ilocano_tagalog", "other"],
  q4: ["frequently", "sometimes", "rarely", "never"],
  q5: ["har_chapter_60", "idea", "evaluation_eligibility", "parent_rights", "iep_meetings", "sped_forms_notices", "dispute_resolution", "transition_planning"],
  q6: ["very_important", "important", "somewhat_important", "not_important"],
  q7: ["yes", "maybe", "no"],
  q8: ["printed_handouts", "online_workshops", "one_on_one", "videos", "visual_guides", "social_media", "audio_podcasts"],
  q9: ["yes", "somewhat", "no"],
  q10: ["services_supports", "assessment_results", "eligibility", "referral", "writing_iep", "disagreements", "transition_planning"],
  q11: ["yes", "sometimes", "no"],
  q12: ["yes", "maybe", "no"],
  q15: ["yes", "maybe", "no"],
};

// Build a "tile" cell (Outlook-safe via nested table).
function _nhTileCell(num, lbl, colorClass, isLast) {
  let color = "#0891B2";
  if (colorClass === "flag") color = "#DC2626";
  else if (colorClass === "ok") color = "#10B981";
  const borderRight = isLast ? "" : "border-right:1px solid #e5e7eb;";
  return `<td width="25%" align="center" valign="top" style="padding:16px 8px;${borderRight}">
    <div style="font-size:26px;font-weight:700;color:${color};line-height:1;margin-bottom:4px;">${num}</div>
    <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.4px;line-height:1.2;">${lbl}</div>
  </td>`;
}

// Build a horizontal bar row (uses a table so Outlook renders the 3 cells side-by-side).
function _nhBarRow(label, count, denominator, color, opts) {
  opts = opts || {};
  const pct = denominator > 0 ? Math.round((count / denominator) * 100) : 0;
  const fillWidth = Math.min(100, Math.max(0, pct));
  const isNa = !!opts.na;
  const rowOpacity = isNa ? "opacity:0.65;" : "";
  const valueText = opts.valueText || (isNa ? `${count} of ${denominator}` : `${count} (${pct}%)`);
  const fillColor = isNa ? "#9ca3af" : color;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-bottom:5px;${rowOpacity}">
    <tr>
      <td width="36%" style="padding-right:8px;font-size:12px;color:#374151;vertical-align:middle;">${_nhEscHtml(label)}</td>
      <td width="50%" style="vertical-align:middle;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#f3f4f6;border-radius:7px;">
          <tr>
            <td style="height:14px;line-height:14px;font-size:0;border-radius:7px;background:#f3f4f6;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${fillWidth}%" style="border-collapse:collapse;background:${fillColor};border-radius:7px;">
                <tr><td style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
      <td width="14%" align="right" style="padding-left:8px;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:middle;">${_nhEscHtml(valueText)}</td>
    </tr>
  </table>`;
}

exports.sendNativeHawaiianSurveyReport = functions
  .region("us-central1")
  .runWith({ timeoutSeconds: 120, maxInstances: 1, secrets: ["RESEND_API_KEY", "SMTP_FROM"] })
  .pubsub.schedule("0 8 * * *")
  .timeZone("Pacific/Honolulu")
  .onRun(async () => {
    // DISABLED 2026-05-31 per Rosie's request — stop daily aggregate emails.
    // To re-enable, remove this early return and restore the line below.
    console.log("sendNativeHawaiianSurveyReport: disabled, skipping run.");
    return null;
    // return await _nhBuildAndSendReport({ send: true });
  });

// Extracted builder so a preview script can call it without sending.
// Returns { html, subject, allDocs, skipped }.
async function _nhBuildAndSendReport(opts) {
  opts = opts || {};
  const db = admin.firestore();
  const now = new Date();

  // ── Query ALL surveys (cumulative). Dataset is small; full scan is fine. ──
  let allDocs = [];
  try {
    const snap = await db.collection("nativeHawaiianSurveys").orderBy("submittedAt", "asc").get();
    snap.forEach((doc) => { allDocs.push(doc.data()); });
  } catch (err) {
    console.error("sendNativeHawaiianSurveyReport: query failed:", err && err.message);
    return { skipped: true, reason: "query_failed" };
  }

  // Conservative guard: if literally zero responses exist, suppress send entirely.
  // (Daniel: "send only if total > 0" — picked as the safer option.)
  if (allDocs.length === 0) {
    console.log("sendNativeHawaiianSurveyReport: 0 total responses, skipping send.");
    if (opts.send) return { skipped: true, reason: "no_data" };
    // Preview still renders an empty-state shell so callers can inspect.
  }

  // ── Header date (HST) ──
  const hawaiiNow = new Date(now.toLocaleString("en-US", { timeZone: "Pacific/Honolulu" }));
  const todayLong = hawaiiNow.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Pacific/Honolulu",
  });
  const yyyy = hawaiiNow.getFullYear();
  const mm = String(hawaiiNow.getMonth() + 1).padStart(2, "0");
  const dd = String(hawaiiNow.getDate()).padStart(2, "0");
  const todayISO = `${yyyy}-${mm}-${dd}`;

  // ── Submission-time helpers ──
  function tsToMs(ts) {
    if (!ts) return null;
    if (typeof ts.toMillis === "function") return ts.toMillis();
    if (typeof ts.seconds === "number") return ts.seconds * 1000;
    return null;
  }
  function hstDateKey(ms) {
    // Returns YYYY-MM-DD in Pacific/Honolulu for grouping.
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Honolulu", year: "numeric", month: "2-digit", day: "numeric",
    }).formatToParts(new Date(ms));
    const y = parts.find((p) => p.type === "year").value;
    const mo = parts.find((p) => p.type === "month").value;
    const d = parts.find((p) => p.type === "day").value;
    return `${y}-${mo}-${d}`;
  }

  // ── KPIs ──
  const sevenDaysAgoMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  let last7Count = 0;
  let contactCount = 0;
  let lastSubmissionMs = null;
  for (const d of allDocs) {
    const ms = tsToMs(d.submittedAt);
    if (ms !== null && ms >= sevenDaysAgoMs) last7Count++;
    if (ms !== null && (lastSubmissionMs === null || ms > lastSubmissionMs)) lastSubmissionMs = ms;
    const hasContact =
      (typeof d.contactFullName === "string" && d.contactFullName.trim()) ||
      (typeof d.contactEmail === "string" && d.contactEmail.trim()) ||
      (typeof d.contactPhone === "string" && d.contactPhone.trim());
    if (hasContact) contactCount++;
  }

  // ── Duplicate-IP clusters (cumulative, all docs). Anonymity preserved — only the cluster count is surfaced. ──
  const ipCounts = {};
  for (const d of allDocs) {
    const h = d.ipHash || "";
    if (!h) continue;
    ipCounts[h] = (ipCounts[h] || 0) + 1;
  }
  let duplicateClusters = 0;
  for (const h of Object.keys(ipCounts)) if (ipCounts[h] > 1) duplicateClusters++;

  // ── Aggregate helpers ──
  function tallyEnum(field, options) {
    const counts = {};
    let nonNull = 0;
    for (const opt of options) counts[opt] = 0;
    for (const d of allDocs) {
      let v = d[field];
      if (v && typeof v === "object" && "value" in v) v = v.value; // q2 wrap
      if (v === null || v === undefined || v === "") continue;
      if (options.indexOf(v) === -1) continue;
      counts[v]++;
      nonNull++;
    }
    return { counts, nonNull };
  }
  function tallyMulti(field, options) {
    const counts = {};
    for (const opt of options) counts[opt] = 0;
    let respondents = 0;
    for (const d of allDocs) {
      let arr = d[field];
      if (arr && typeof arr === "object" && Array.isArray(arr.values)) arr = arr.values; // q3 wrap
      if (!Array.isArray(arr)) continue;
      let touched = false;
      for (const v of arr) {
        if (options.indexOf(v) !== -1) { counts[v]++; touched = true; }
      }
      if (touched) respondents++;
    }
    return { counts, respondents };
  }

  // Per-question card builder for single-select.
  function enumCard(qNum, field, qText) {
    const order = NH_BAR_ORDER[field];
    const colors = NH_BAR_COLORS[field];
    const labels = NH_BAR_LABELS[field];
    const { counts, nonNull } = tallyEnum(field, NH_ENUMS[field]);
    const total = allDocs.length;
    const naCount = total - nonNull;
    const pctAnswered = total > 0 ? Math.round((nonNull / total) * 100) : 0;
    const rowsHtml = order.map((opt, i) => _nhBarRow(labels[opt] || opt, counts[opt] || 0, nonNull, colors[i] || "#0891B2")).join("");
    const naRow = naCount > 0
      ? _nhBarRow("Not answered", naCount, total, "#9ca3af", { na: true })
      : "";
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:16px;">
      <tr><td style="padding:14px 20px 18px;">
        <div style="font-size:11px;color:#06B6D4;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:2px;">Q${qNum}</div>
        <h2 style="margin:0 0 4px;font-size:14px;font-weight:700;color:#0e7490;line-height:1.35;">${_nhEscHtml(qText)}</h2>
        <div style="font-size:11px;color:#6b7280;margin-bottom:10px;">n=${nonNull} of ${total} (${pctAnswered}% answered)</div>
        ${rowsHtml}
        ${naRow}
      </td></tr>
    </table>`;
  }

  // Per-question card builder for multi-select.
  function multiCard(qNum, field, qText, suffix) {
    const order = NH_BAR_ORDER[field];
    const colors = NH_BAR_COLORS[field];
    const labels = NH_BAR_LABELS[field];
    const { counts, respondents } = tallyMulti(field, NH_ENUMS[field]);
    const total = allDocs.length;
    const denom = respondents > 0 ? respondents : 1;
    const rowsHtml = order.map((opt, i) => _nhBarRow(labels[opt] || opt, counts[opt] || 0, denom, colors[i] || "#0891B2")).join("");
    const suffixText = suffix ? ` &middot; ${suffix}` : "";
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:16px;">
      <tr><td style="padding:14px 20px 18px;">
        <div style="font-size:11px;color:#06B6D4;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:2px;">Q${qNum}${suffixText}</div>
        <h2 style="margin:0 0 4px;font-size:14px;font-weight:700;color:#0e7490;line-height:1.35;">${_nhEscHtml(qText)}</h2>
        <div style="font-size:11px;color:#6b7280;margin-bottom:10px;">n=${respondents} respondents of ${total} (overlapping selections)</div>
        ${rowsHtml}
      </td></tr>
    </table>`;
  }

  // Open-text card builder.
  function openTextCard(qNum, field, qText) {
    const total = allDocs.length;
    const answers = allDocs
      .map((d) => d[field])
      .filter((s) => typeof s === "string" && s.trim());
    const pct = total > 0 ? Math.round((answers.length / total) * 100) : 0;
    const quotesHtml = answers.length
      ? answers.map((s) => `<div style="background:#f9fafb;border-left:3px solid #0891B2;padding:8px 12px;margin:8px 0;font-size:12px;color:#374151;font-style:italic;line-height:1.5;">${_nhEscHtml(s)}</div>`).join("")
      : `<p style="margin:8px 0 0;font-size:12px;color:#9ca3af;font-style:italic;">No written answers yet.</p>`;
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:16px;">
      <tr><td style="padding:14px 20px 18px;">
        <div style="font-size:11px;color:#06B6D4;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:2px;">Q${qNum} &middot; Open text</div>
        <h2 style="margin:0 0 4px;font-size:14px;font-weight:700;color:#0e7490;line-height:1.35;">${_nhEscHtml(qText)}</h2>
        <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">${answers.length} of ${total} respondents wrote an answer (${pct}%)</div>
        ${quotesHtml}
      </td></tr>
    </table>`;
  }

  // ── 14-day SVG sparkline ──
  // Buckets are HST calendar days. Today is the rightmost bucket.
  const dayBuckets = []; // [{ key, label, count }]
  for (let i = 13; i >= 0; i--) {
    const ms = now.getTime() - i * 24 * 60 * 60 * 1000;
    const key = hstDateKey(ms);
    const label = new Date(ms).toLocaleDateString("en-US", { timeZone: "Pacific/Honolulu", month: "numeric", day: "numeric" });
    dayBuckets.push({ key, label, count: 0 });
  }
  for (const d of allDocs) {
    const ms = tsToMs(d.submittedAt);
    if (ms === null) continue;
    const k = hstDateKey(ms);
    const bucket = dayBuckets.find((b) => b.key === k);
    if (bucket) bucket.count++;
  }
  const maxDay = Math.max(1, ...dayBuckets.map((b) => b.count));
  const svgWidth = 600, svgHeight = 60, axisBaseline = 55, axisTop = 10;
  const stepX = svgWidth / (dayBuckets.length - 1);
  const pointXY = dayBuckets.map((b, i) => {
    const x = i * stepX;
    const y = axisBaseline - (b.count / maxDay) * (axisBaseline - axisTop);
    return { x, y, count: b.count, label: b.label, key: b.key };
  });
  const polyPoints = pointXY.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const todayPoint = pointXY[pointXY.length - 1];
  const todayCount = todayPoint.count;
  const firstLabel = dayBuckets[0].label;
  const lastLabel = dayBuckets[dayBuckets.length - 1].label;
  const sparklineSvg = `<svg width="100%" viewBox="0 0 ${svgWidth} ${svgHeight}" preserveAspectRatio="none" style="display:block;border:1px solid #e5e7eb;background:#ffffff;border-radius:4px;" xmlns="http://www.w3.org/2000/svg" aria-label="Daily submissions sparkline">
    <line x1="0" y1="${axisBaseline}" x2="${svgWidth}" y2="${axisBaseline}" stroke="#e5e7eb" stroke-width="1"></line>
    <polyline points="${polyPoints}" fill="none" stroke="#0891B2" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
    <circle cx="${todayPoint.x.toFixed(2)}" cy="${todayPoint.y.toFixed(2)}" r="4" fill="#F59E0B" stroke="#ffffff" stroke-width="1.5"></circle>
    <text x="${(svgWidth - 5).toFixed(0)}" y="8" font-size="8" fill="#92400e" text-anchor="end" font-family="-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">Today: ${todayCount}</text>
    <text x="2" y="13" font-size="8" fill="#9ca3af" font-family="-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${maxDay}</text>
    <text x="2" y="53" font-size="8" fill="#9ca3af" font-family="-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">0</text>
    <text x="0" y="59" font-size="7" fill="#9ca3af" font-family="-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${firstLabel}</text>
    <text x="${svgWidth}" y="59" font-size="7" fill="#9ca3af" text-anchor="end" font-family="-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${lastLabel}</text>
  </svg>`;

  // ── Data-quality footer items ──
  const contactPct = allDocs.length > 0 ? Math.round((contactCount / allDocs.length) * 100) : 0;
  let lastSubText = "n/a";
  if (lastSubmissionMs !== null) {
    const diffMs = now.getTime() - lastSubmissionMs;
    const diffH = Math.floor(diffMs / (60 * 60 * 1000));
    const diffD = Math.floor(diffH / 24);
    let rel;
    if (diffH < 1) rel = "less than an hour ago";
    else if (diffH < 24) rel = `~${diffH} hour${diffH === 1 ? "" : "s"} ago`;
    else rel = `~${diffD} day${diffD === 1 ? "" : "s"} ago`;
    const stamp = new Date(lastSubmissionMs).toLocaleString("en-US", {
      timeZone: "Pacific/Honolulu", month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
    lastSubText = `${rel} (${stamp} HST)`;
  }
  const q13Answered = allDocs.filter((d) => typeof d.q13 === "string" && d.q13.trim()).length;
  const q14Answered = allDocs.filter((d) => typeof d.q14 === "string" && d.q14.trim()).length;
  const q13Pct = allDocs.length > 0 ? Math.round((q13Answered / allDocs.length) * 100) : 0;
  const q14Pct = allDocs.length > 0 ? Math.round((q14Answered / allDocs.length) * 100) : 0;

  // ── Build HTML ──
  // KPI tile row (Outlook-safe nested table).
  const tilesRow = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
    <tr>
      ${_nhTileCell(allDocs.length, "Total<br>Responses", "default", false)}
      ${_nhTileCell(last7Count, "Last 7<br>Days New", "ok", false)}
      ${_nhTileCell(contactCount, "Contact Info<br>Provided", "default", false)}
      ${_nhTileCell(duplicateClusters, "Duplicate IP<br>Clusters", duplicateClusters > 0 ? "flag" : "default", true)}
    </tr>
  </table>`;

  const headerCard = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:16px;overflow:hidden;">
    <tr><td style="background:#0891B2;color:#ffffff;padding:22px 24px;text-align:center;">
      <h1 style="margin:0;font-size:20px;font-weight:700;letter-spacing:0.3px;color:#ffffff;">Native Hawaiian Family Survey</h1>
      <div style="margin:6px 0 0;font-size:13px;color:#cffafe;">Cumulative Report &mdash; As of ${_nhEscHtml(todayLong)} (HST)</div>
    </td></tr>
    <tr><td>${tilesRow}</td></tr>
  </table>`;

  // Question cards in order.
  const cards = [];
  cards.push(enumCard(1, "q1", "Are you a parent, caregiver, or family member of a child receiving special education services?"));
  cards.push(enumCard(2, "q2", "Which island do you currently live on?"));
  cards.push(multiCard(3, "q3", "What language(s) are primarily spoken in your home?", "Multi-select"));
  cards.push(enumCard(4, "q4", "Have you ever received special education forms or documents from your child's school that were difficult to understand?"));
  cards.push(multiCard(5, "q5", "Would translated or simplified materials help you better understand:", "Multi-select"));
  cards.push(enumCard(6, "q6", "How important is it for schools to provide materials in culturally responsive language and examples relevant to Native Hawaiian families?"));
  cards.push(enumCard(7, "q7", "Would you feel more comfortable participating in IEP meetings if materials were translated or explained in more family-friendly language?"));
  cards.push(multiCard(8, "q8", "Which formats would be most helpful for learning about special education services?", "Multi-select (max 3)"));
  cards.push(enumCard(9, "q9", "Do you feel you fully understand the IEP process from beginning to end?"));
  cards.push(multiCard(10, "q10", "At what point in the process do families need the most support?", "Multi-select"));
  cards.push(enumCard(11, "q11", "Have you ever avoided asking questions during an IEP meeting because the information felt too confusing or overwhelming?"));
  cards.push(enumCard(12, "q12", "Would access to Native Hawaiian cultural values, practices, or examples within special education materials help your family feel more connected and supported?"));
  cards.push(openTextCard(13, "q13", "What type of translated or culturally responsive support would help your family the most?"));
  cards.push(openTextCard(14, "q14", "Is there anything schools could do differently to improve communication and understanding for Native Hawaiian families navigating special education?"));
  cards.push(enumCard(15, "q15", "Would you be interested in participating in future family discussions or trainings related to special education access and support?"));

  // Timeline card.
  const timelineCard = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:16px;">
    <tr><td style="padding:14px 20px 18px;">
      <h2 style="margin:0 0 6px;font-size:14px;font-weight:700;color:#0e7490;">Submission Timeline &mdash; Last 14 days</h2>
      ${sparklineSvg}
      <div style="font-size:12px;color:#6b7280;margin-top:6px;">Submissions today: <strong>${todayCount}</strong> &middot; Last 7 days: <strong>${last7Count}</strong> &middot; All-time: <strong>${allDocs.length}</strong></div>
    </td></tr>
  </table>`;

  // Data-quality footer card.
  const qualityCard = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#FFFBEB;border:1px solid #fde68a;border-radius:8px;margin-bottom:16px;">
    <tr><td style="padding:14px 20px;font-size:12px;color:#78350f;">
      <div style="margin-bottom:4px;"><strong style="color:#92400e;">${contactPct}%</strong> of respondents provided optional contact info (${contactCount} of ${allDocs.length})</div>
      <div style="margin-bottom:4px;"><strong style="color:#92400e;">${duplicateClusters}</strong> duplicate IP-hash cluster${duplicateClusters === 1 ? "" : "s"} flagged &mdash; anonymity preserved (IPs are hashed; we only flag clusters of repeat submissions, never identify them)</div>
      <div style="margin-bottom:4px;"><strong style="color:#92400e;">Last submission:</strong> ${_nhEscHtml(lastSubText)}</div>
      <div style="margin-bottom:0;"><strong style="color:#92400e;">Open-text response rate:</strong> Q13 = ${q13Pct}% (${q13Answered} of ${allDocs.length}), Q14 = ${q14Pct}% (${q14Answered} of ${allDocs.length})</div>
    </td></tr>
  </table>`;

  // Footer card.
  const footerCard = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:16px;">
    <tr><td style="padding:16px 20px 22px;text-align:center;font-size:11px;color:#6b7280;line-height:1.5;">
      Generated by <code>sendNativeHawaiianSurveyReport</code> &mdash; cumulative graphic format<br>
      Sent to: rrowe@ldahawaii.org &middot; Scheduled: daily at 8:00 AM HST
    </td></tr>
  </table>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#FFFBEB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;line-height:1.45;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFBEB;">
<tr><td align="center" style="padding:16px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;">
  <tr><td>${headerCard}</td></tr>
  ${cards.map((c) => `<tr><td>${c}</td></tr>`).join("")}
  <tr><td>${timelineCard}</td></tr>
  <tr><td>${qualityCard}</td></tr>
  <tr><td>${footerCard}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const subject = `Native Hawaiian Family Survey -- Cumulative Report (${todayISO} HST)`;

  if (!opts.send) {
    return { skipped: false, html, subject, allDocs };
  }

  const fromAddress = process.env.SMTP_FROM || "onboarding@resend.dev";
  try {
    await sendEmailViaResend({
      from: `LDAH <${fromAddress}>`,
      to: "rrowe@ldahawaii.org",
      subject,
      html,
      type: "nh-survey-cumulative-report",
      recipientName: "Rosie Rowe",
    });
    console.log(`sendNativeHawaiianSurveyReport: sent to rrowe@ldahawaii.org (cumulative; ${allDocs.length} total responses).`);
  } catch (err) {
    console.error("sendNativeHawaiianSurveyReport: send failed:", err && err.message);
  }
  return { skipped: false, sent: true, html, subject, allDocs };
}

// Exported for preview scripts (do not call as an HTTPS endpoint).
exports._nhBuildAndSendReport = _nhBuildAndSendReport;

// ============================================================================
// EVENT-LIFECYCLE INTERACTIONS
//   Spec: docs/superpowers/specs/2026-05-22-event-lifecycle-interactions-design.md
//   Plan: docs/superpowers/plans/2026-05-22-event-lifecycle-interactions.md
//
//   onCreate(events/{id})       -> seed setup interactions (Verify Display +
//                                  per-session Assign Presenter & Send
//                                  Announcements)
//   onUpdate(interactions/{id}) -> chain (presenter capture, takeAttendance
//                                  -> eventSummary, all-summaries -> complete)
//   pubsub daily 5am HST        -> day-of Take Attendance creation
//   onUpdate(events/{id})       -> archive cleanup + Event Summary auto-close
// ============================================================================

// La'a Salvani's userRoles document id — verified 2026-05-22 against live
// userRoles collection (displayName "La'a Salvani", LSalvani@LDAHawaii.org).
const LIFECYCLE_LAA_UID = "hj6YnfnZ66Yul9mtnULRW5FTWKH3";

const LIFECYCLE_CHANNELS = {
  assignPresenter:  { channel: "Event Setup",   type: "Assign Presenter" },
  verifyDisplay:    { channel: "Event Setup",   type: "Verify Display" },
  sendAnnouncement: { channel: "Event Setup",   type: "Send Announcements" },
  presenterPrep:    { channel: "Event Prep",    type: "Present Event" },
  takeAttendance:   { channel: "Event Day",     type: "Take Attendance" },
  eventSummary:     { channel: "Event Wrap-Up", type: "Event Summary" }
};

async function _lcResolveStaffName(db, uid) {
  if (!uid) return "";
  try {
    const s = await db.collection("userRoles").doc(uid).get();
    return (s.exists && s.data() && s.data().displayName) || "";
  } catch (e) { return ""; }
}

function _lcSessionKey(s) {
  if (!s) return "";
  return s.dateKey || s.rawString || "";
}

function _lcBuildInteractionDoc(opts) {
  // opts: { eventId, eventTitle, step, sessionKey, ownerUid, ownerName, dueDate,
  //         collection, sessionLabel, extra }
  const c = LIFECYCLE_CHANNELS[opts.step];
  // sessionLabel is a human-friendly session descriptor (e.g. "May 28 (Oahu)")
  // shown in the name/summary; sessionKey is the canonical key stored on
  // workflowSessionKey. For recurring programs sessionKey is the composite key
  // ("DATE|Loc – Venue|time") — accurate but ugly — so prefer the label for
  // display while keeping the composite key for matching.
  const display = opts.sessionLabel || opts.sessionKey || "";
  const suffix = display ? " (" + display + ")" : "";
  const doc = {
    channel: c.channel,
    interactionType: c.type,
    contactId: "",
    contactName: (opts.eventTitle || "(untitled event)") + (display ? " — " + display : ""),
    contactType: "",
    grantProgram: "",
    summary: c.type + " for: " + (opts.eventTitle || "") + suffix,
    followUpDate: opts.dueDate || "",
    status: "Open",
    notes: "",
    isDraft: false,
    owner: opts.ownerName || "",
    ownerUid: opts.ownerUid || "",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    workflowEventId: opts.eventId,
    workflowEventCollection: opts.collection || "events",
    workflowStep: opts.step,
    workflowSessionKey: opts.sessionKey || ""
  };
  if (opts.extra) Object.assign(doc, opts.extra);
  return doc;
}

async function _lcCreateIfMissing(db, opts) {
  const q = await db.collection("interactions")
    .where("workflowEventId", "==", opts.eventId)
    .where("workflowStep", "==", opts.step)
    .where("workflowSessionKey", "==", opts.sessionKey || "")
    .limit(1).get();
  if (!q.empty) return null;
  return await db.collection("interactions").add(_lcBuildInteractionDoc(opts));
}

// ===========================================================================
// Recurring-program lifecycle helpers
// ---------------------------------------------------------------------------
// Recurring programs (Connect-Gen, etc.) have no per-session "event created"
// hook like one-time events. Their sessions are computed from schedules and
// identified by a COMPOSITE key ("DATE|Loc – Venue|time"); signups, attendance,
// and summaries are all keyed by that composite. These helpers mirror the
// LDAH-Int client's gate (crGetAffectedSignups / crIsSessionCancelled) so the
// backend's notion of "this session has signups" matches the app exactly.
// ===========================================================================

// Active signup statuses that count toward "this session has signups".
const _LC_ACTIVE_SIGNUP_STATUSES = ["confirmed", "pending", "new", "confirmed-virtual", "confirmed-in-person"];
const _LC_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function _lcEscapeSessionKey(key) {
  return String(key == null ? "" : key).replace(/[.~/[\]#?*$ |]/g, "_");
}

// Program-level cancellation for a composite key. No location on the
// cancelledDates entry = legacy date-wide cancellation; else the location must
// appear in the key. Mirrors crIsSessionCancelled.
function _lcSessionCancelled(ev, candidateKey) {
  const cds = ev.cancelledDates;
  if (!Array.isArray(cds)) return false;
  const datePrefix = String(candidateKey).split("|")[0];
  for (const cd of cds) {
    if (!cd || !cd.date) continue;
    if (cd.date !== datePrefix) continue;
    if (!cd.location) return true;
    if (String(candidateKey).indexOf(cd.location) !== -1) return true;
  }
  return false;
}

// Does this signup actively count for the given composite session key?
// Mirrors the per-signup test inside crGetAffectedSignups.
function _lcSignupActiveForSession(s, sessionKey) {
  if (!s || _LC_ACTIVE_SIGNUP_STATUSES.indexOf(s.status) === -1) return false;
  if (s.archived === true) return false;
  const sessions = s.selectedSessions || s.selectedDates || [];
  if (!Array.isArray(sessions) || sessions.indexOf(sessionKey) === -1) return false;
  const ov = s.dateStatusOverrides && s.dateStatusOverrides[sessionKey];
  if (ov === "cancelled" || ov === "no-show") return false;
  if (s.cancelledFromSession && s.cancelledFromSession[_lcEscapeSessionKey(sessionKey)]) return false;
  return true;
}

// "DATE|Loc – Venue|time" -> "May 28 (Oahu)" for friendly task names.
function _lcSessionLabel(compositeKey) {
  const parts = String(compositeKey).split("|");
  const dateStr = parts[0] || "";
  const location = (parts[1] || "").split(" – ")[0].trim();
  let dateLabel = dateStr;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (m) dateLabel = _LC_MONTHS[parseInt(m[2], 10) - 1] + " " + parseInt(m[3], 10);
  return dateLabel + (location ? " (" + location + ")" : "");
}

// Whole days from todayKey (HST) to the session's date (composite key prefix).
function _lcDaysUntilSession(compositeKey, todayKey) {
  const dateStr = String(compositeKey).split("|")[0];
  const a = new Date(todayKey + "T12:00:00-10:00").getTime();
  const b = new Date(dateStr + "T12:00:00-10:00").getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

// Idempotent catch-up: ensure the right tasks exist for one recurring session,
// given how many days out it is. Shared by the daily cron and the new-signup
// trigger. Lead windows:
//   Assign Presenter : 0 <= D <= 5  -> La'a (due now, before prep)
//   Present Event    : 0 <= D <= 3  -> presenter (fallback La'a), follow-up day after
//   Take Attendance  : D == 0       -> presenter (fallback La'a)
// Event Summary is NOT created here — it chains from takeAttendance close.
// Returns the number of tasks created.
async function _lcEnsureRecurringSessionTasks(db, eventId, ev, compositeKey, todayKey, laaName) {
  const D = _lcDaysUntilSession(compositeKey, todayKey);
  // !(0<=D<=5) is NaN-safe: malformed keys (no valid YYYY-MM-DD prefix, e.g. a
  // legacy "Thursday|09:00-11:00") yield NaN and are skipped, never crashing on
  // a later Invalid-Date computation.
  if (!(D >= 0 && D <= 5)) return 0;
  if (_lcSessionCancelled(ev, compositeKey)) return 0;

  const title = ev.title || "Connect-Gen";
  const label = _lcSessionLabel(compositeKey);
  const presenterSrc = (ev.sessionSummaries && ev.sessionSummaries[compositeKey]) || {};
  const dateStr = String(compositeKey).split("|")[0];
  const baseMs = new Date(dateStr + "T12:00:00-10:00").getTime();
  const dayAfterKey = new Date(baseMs + 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const common = { eventId, eventTitle: title, sessionKey: compositeKey, sessionLabel: label, collection: "recurringEvents" };

  let created = 0;
  if (D <= 5) {
    const r = await _lcCreateIfMissing(db, Object.assign({}, common, {
      step: "assignPresenter", ownerUid: LIFECYCLE_LAA_UID, ownerName: laaName, dueDate: todayKey
    }));
    if (r) created++;
  }
  if (D <= 3) {
    const r = await _lcCreateIfMissing(db, Object.assign({}, common, {
      step: "presenterPrep",
      ownerUid: presenterSrc.presenterUid || LIFECYCLE_LAA_UID,
      ownerName: presenterSrc.presenter || laaName,
      dueDate: dayAfterKey
    }));
    if (r) created++;
  }
  if (D === 0) {
    const r = await _lcCreateIfMissing(db, Object.assign({}, common, {
      step: "takeAttendance",
      ownerUid: presenterSrc.presenterUid || LIFECYCLE_LAA_UID,
      ownerName: presenterSrc.presenter || laaName,
      dueDate: dateStr
    }));
    if (r) created++;
  }
  return created;
}

// Distinct composite session keys (today .. +5 days) that have >=1 active
// signup, for one recurring program.
async function _lcRecurringSessionsWithSignups(db, eventId, todayKey) {
  const sus = await db.collection("recurringEvents").doc(eventId).collection("signups").get();
  const keys = new Set();
  sus.forEach(doc => {
    const s = doc.data() || {};
    const sessions = s.selectedSessions || s.selectedDates || [];
    if (!Array.isArray(sessions)) return;
    sessions.forEach(k => {
      const D = _lcDaysUntilSession(k, todayKey);
      if (!(D >= 0 && D <= 5)) return; // NaN-safe: skips malformed/undated keys
      if (_lcSignupActiveForSession(s, k)) keys.add(k);
    });
  });
  return Array.from(keys);
}

exports.onEventCreatedLifecycle = functions
  .runWith({ timeoutSeconds: 60, maxInstances: 10 })
  .firestore.document("events/{eventId}")
  .onCreate(async (snap, context) => {
    const db = admin.firestore();
    const ev = snap.data() || {};
    const eventId = context.params.eventId;

    if (ev.archived === true) return null;
    if (!ev.createdByUid) {
      console.log("onEventCreatedLifecycle: skipping", eventId, "— no createdByUid (pre-workflow event)");
      return null;
    }

    const sessions = getEventSessions(ev) || [];
    if (sessions.length === 0) {
      console.warn("onEventCreatedLifecycle:", eventId, "has no sessions; skipping");
      return null;
    }

    const dueDate = ev.startDate || ev.eventDate || "";
    const title = ev.title || "(untitled event)";
    const laaName = await _lcResolveStaffName(db, LIFECYCLE_LAA_UID);
    const creatorUid = ev.createdByUid;
    const creatorName = ev.createdByName || (await _lcResolveStaffName(db, creatorUid));

    // 1 Verify Display (event-wide, one-time — never per session)
    await _lcCreateIfMissing(db, {
      eventId, eventTitle: title, step: "verifyDisplay", sessionKey: "",
      ownerUid: creatorUid, ownerName: creatorName, dueDate
    });

    // Seed setup tasks for the FIRST (earliest) date only: Assign Presenter
    // (La'a) + Send Announcements (creator). Later dates are DEFERRED — their
    // tasks are seeded by createDayOfAttendanceTasks on the prior date's event
    // day, so staff never see (and can't mis-close) a future date's tasks early.
    const firstSession = sessions.slice().sort(
      (a, b) => _lcSessionKey(a).localeCompare(_lcSessionKey(b))
    )[0];
    const firstKey = _lcSessionKey(firstSession);
    if (firstKey) {
      await _lcCreateIfMissing(db, {
        eventId, eventTitle: title, step: "assignPresenter", sessionKey: firstKey,
        ownerUid: LIFECYCLE_LAA_UID, ownerName: laaName, dueDate
      });
      // One-off gatherings (hand-keyed into the Event Attendance Report after
      // the fact) are past events — no public announcement should go out, so
      // skip the Send Announcements task for them.
      if (!ev.isOneOff) {
        await _lcCreateIfMissing(db, {
          eventId, eventTitle: title, step: "sendAnnouncement", sessionKey: firstKey,
          ownerUid: creatorUid, ownerName: creatorName, dueDate
        });
      }
    }

    await snap.ref.update({
      lifecycleStatus: "setup",
      lifecycleSetupAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return null;
  });

exports.onInteractionUpdatedLifecycle = functions
  .runWith({ timeoutSeconds: 60, maxInstances: 10 })
  .firestore.document("interactions/{interactionId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data() || {};
    const after  = change.after.data()  || {};
    if (!after.workflowStep) return null;
    if (before.status === after.status) return null;
    if (after.status !== "Closed") return null;

    const db = admin.firestore();
    const eventId = after.workflowEventId;
    if (!eventId) return null;
    const step = after.workflowStep;
    const sessionKey = after.workflowSessionKey || "";
    const collection = after.workflowEventCollection || "events";
    const isRecurring = collection === "recurringEvents";

    // --- resourceUpdateCall closed: La'akea called the partner, so mark their
    //     resource listing updated for the cycle (mirrors a form submission /
    //     staff approval). This also drops them out of the nudge "awaiting"
    //     bucket automatically. workflowEventId is the resources doc id.
    if (step === "resourceUpdateCall") {
      const ref = db.collection("resources").doc(eventId);
      const rsnap = await ref.get();
      if (!rsnap.exists) return null;
      await ref.update({
        lastUpdateAt: admin.firestore.FieldValue.serverTimestamp(),
        updateSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
        updateToken: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log("resourceUpdateCall closed -> marked resource", eventId, "updated for cycle");
      return null;
    }

    // --- assignPresenter closed: write presenter into Event Summary's
    //     storage (unified field, also feeds the Event Attendance Report).
    if (step === "assignPresenter") {
      const uid  = after.assignedPresenterUid  || "";
      const name = after.assignedPresenterName || "";
      if (!uid) {
        // Guardrail: client should have blocked this. Re-open.
        await change.after.ref.update({
          status: "Open",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          notes: ((after.notes || "") + "\n[auto] Re-opened: no presenter selected at close.").trim()
        });
        console.warn("assignPresenter closed without presenter; re-opened", change.after.id);
        return null;
      }
      const evSnap = await db.collection(collection).doc(eventId).get();
      if (!evSnap.exists) return null;
      const ev = evSnap.data() || {};

      if (isRecurring) {
        // Recurring: sessionSummaries is keyed by the composite session key,
        // which IS the workflow sessionKey. Read-modify-write to preserve the
        // session's other fields (and avoid dotted-path issues with the key).
        const summaryKey = sessionKey;
        const existing = ev.sessionSummaries || {};
        const entry = existing[summaryKey] || {};
        await evSnap.ref.update({
          sessionSummaries: Object.assign({}, existing, {
            [summaryKey]: Object.assign({}, entry, { presenter: name, presenterUid: uid })
          }),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return null;
      }

      const sessions = getEventSessions(ev) || [];
      const isSingleSession = sessions.length === 1;

      if (isSingleSession) {
        // event.summary is a single object on the event doc — dotted-path is safe.
        await evSnap.ref.update({
          "summary.presenter":    name,
          "summary.presenterUid": uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        // Multi-session: the existing Event Summary form keys sessionSummaries by
        // the RAW signupDate string (e.g. "May 25th, 2026 - 5 PM"), not the
        // workflow's normalized dateKey. Find the matching session's rawString,
        // then read-modify-write the whole sessionSummaries map so we preserve
        // any existing fields (and so spaces/punctuation in the key don't break
        // a dotted-path update — see feedback_firestore-attribute-gotchas).
        const matchingSession = sessions.find(s => _lcSessionKey(s) === sessionKey);
        const summaryKey = (matchingSession && matchingSession.rawString) || sessionKey;
        const existingSessionSummaries = ev.sessionSummaries || {};
        const existingEntry = existingSessionSummaries[summaryKey] || {};
        const mergedSessionSummaries = Object.assign({}, existingSessionSummaries, {
          [summaryKey]: Object.assign({}, existingEntry, {
            presenter:    name,
            presenterUid: uid
          })
        });
        await evSnap.ref.update({
          sessionSummaries: mergedSessionSummaries,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
      return null;
    }

    // --- takeAttendance closed: spawn Event Summary task for same event+session.
    if (step === "takeAttendance") {
      const existing = await db.collection("interactions")
        .where("workflowEventId", "==", eventId)
        .where("workflowStep", "==", "eventSummary")
        .where("workflowSessionKey", "==", sessionKey)
        .limit(1).get();
      if (!existing.empty) return null;

      const evSnap = await db.collection(collection).doc(eventId).get();
      if (!evSnap.exists) return null;
      const ev = evSnap.data() || {};

      // Resolve the session's presenter + a human label + the date the +5-day
      // follow-up is measured from. Recurring keys sessionSummaries by the
      // composite key (= sessionKey) and the date is its prefix; one-time events
      // use summary / rawString-keyed sessionSummaries and a YYYY-MM-DD key.
      let presenterSrc, sessionLabel = null, dueBaseDateStr;
      if (isRecurring) {
        presenterSrc = (ev.sessionSummaries && ev.sessionSummaries[sessionKey]) || {};
        sessionLabel = _lcSessionLabel(sessionKey);
        dueBaseDateStr = String(sessionKey).split("|")[0];
      } else {
        const sessions = getEventSessions(ev) || [];
        if (sessions.length === 1) {
          presenterSrc = ev.summary || {};
        } else {
          const matchingSession = sessions.find(s => _lcSessionKey(s) === sessionKey);
          const summaryKey = (matchingSession && matchingSession.rawString) || sessionKey;
          presenterSrc = (ev.sessionSummaries && ev.sessionSummaries[summaryKey]) || {};
        }
        dueBaseDateStr = sessionKey;
      }
      let ownerUid  = presenterSrc.presenterUid || "";
      let ownerName = presenterSrc.presenter    || "";
      if (!ownerUid) {
        if (isRecurring) { ownerUid = LIFECYCLE_LAA_UID; ownerName = await _lcResolveStaffName(db, LIFECYCLE_LAA_UID); }
        else { ownerUid = ev.createdByUid || ""; ownerName = ev.createdByName || ""; }
      }

      // Due = session date + 5 days, in HST. Five days keeps the Event Summary
      // follow-up open long enough for participant feedback to arrive.
      const sd = new Date(dueBaseDateStr + "T12:00:00-10:00");
      const due = new Date(sd.getTime() + 5 * 24 * 60 * 60 * 1000);
      const dueIso = due.toISOString().slice(0, 10);

      await db.collection("interactions").add(_lcBuildInteractionDoc({
        eventId, eventTitle: ev.title || "", step: "eventSummary",
        sessionKey, ownerUid, ownerName, dueDate: dueIso, collection, sessionLabel
      }));
      return null;
    }

    // --- eventSummary closed: flip event to complete if every session's
    //     eventSummary interaction is closed.
    if (step === "eventSummary") {
      if (isRecurring) return null; // recurring programs run indefinitely — no "complete" state
      const evSnap = await db.collection("events").doc(eventId).get();
      if (!evSnap.exists) return null;
      const ev = evSnap.data() || {};
      const sessions = getEventSessions(ev) || [];
      if (sessions.length === 0) return null;
      const wantKeys = sessions.map(_lcSessionKey).filter(Boolean);

      const all = await db.collection("interactions")
        .where("workflowEventId", "==", eventId)
        .where("workflowStep", "==", "eventSummary")
        .get();
      const closedKeys = new Set();
      all.forEach(d => {
        const x = d.data() || {};
        if (x.status === "Closed") closedKeys.add(x.workflowSessionKey || "");
      });
      const allDone = wantKeys.every(k => closedKeys.has(k));
      if (allDone) {
        await evSnap.ref.update({
          lifecycleStatus: "complete",
          lifecycleCompletedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
      return null;
    }

    // verifyDisplay / sendAnnouncement closes: no chaining action
    return null;
  });

async function _lcVerifyDisplayClosed(db, eventId) {
  const q = await db.collection("interactions")
    .where("workflowEventId", "==", eventId)
    .where("workflowStep", "==", "verifyDisplay")
    .limit(1).get();
  if (q.empty) return false;
  const x = q.docs[0].data() || {};
  return x.status === "Closed";
}

exports.createDayOfAttendanceTasks = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1 })
  .pubsub.schedule("0 5 * * *").timeZone("Pacific/Honolulu")
  .onRun(async () => {
    const db = admin.firestore();
    // Today's date in HST as YYYY-MM-DD.
    const nowHst = new Date(new Date().toLocaleString("en-US", { timeZone: "Pacific/Honolulu" }));
    const todayKey = nowHst.getFullYear()
      + "-" + String(nowHst.getMonth() + 1).padStart(2, "0")
      + "-" + String(nowHst.getDate()).padStart(2, "0");

    // Only events that went through the workflow (have lifecycleStatus set).
    // 'setup' is the only state with potentially-pending sessions; 'complete'
    // events have already wrapped all sessions.
    const snap = await db.collection("events")
      .where("lifecycleStatus", "==", "setup")
      .get();

    let created = 0;
    for (const doc of snap.docs) {
      const ev = doc.data() || {};
      if (ev.archived === true) continue;
      const sessions = getEventSessions(ev) || [];
      const todaySession = sessions.find(s => _lcSessionKey(s) === todayKey);
      if (!todaySession) continue;

      // Deferred multi-date seeding: today is one of this event's session dates,
      // so surface the NEXT date's setup tasks (Send Announcements + Select
      // Presenter) to the event creator now. This is how 2nd/3rd/Nth dates get
      // their tasks — kept hidden until the preceding session's day. Idempotent
      // via _lcCreateIfMissing, and only the immediate next date is seeded (so a
      // 3rd date waits for the 2nd date's day). Owner = event creator.
      const sortedSessions = sessions.slice().sort(
        (a, b) => _lcSessionKey(a).localeCompare(_lcSessionKey(b))
      );
      const nextSession = sortedSessions.find(s => _lcSessionKey(s) > todayKey);
      if (nextSession) {
        const nextKey = _lcSessionKey(nextSession);
        const creatorUid  = ev.createdByUid  || "";
        const creatorName = ev.createdByName || (await _lcResolveStaffName(db, ev.createdByUid));
        const baseMs = new Date(todayKey + "T12:00:00-10:00").getTime();
        const tomorrowKey = new Date(baseMs + 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const plus5Key    = new Date(baseMs + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        await _lcCreateIfMissing(db, {
          eventId: doc.id, eventTitle: ev.title || "", step: "sendAnnouncement",
          sessionKey: nextKey, ownerUid: creatorUid, ownerName: creatorName,
          dueDate: tomorrowKey,
          extra: { notes: "Send the announcement first thing tomorrow (" + tomorrowKey + ")." }
        });
        await _lcCreateIfMissing(db, {
          eventId: doc.id, eventTitle: ev.title || "", step: "assignPresenter",
          sessionKey: nextKey, ownerUid: creatorUid, ownerName: creatorName,
          dueDate: plus5Key
        });
      }

      const sessionKey = todayKey; // workflowSessionKey on the interaction = normalized dateKey

      // Idempotency
      const existing = await db.collection("interactions")
        .where("workflowEventId", "==", doc.id)
        .where("workflowStep", "==", "takeAttendance")
        .where("workflowSessionKey", "==", sessionKey)
        .limit(1).get();
      if (!existing.empty) continue;

      // Owner selection. Presenter is stored in the existing Event Summary
      // location: event.summary (single-session) or event.sessionSummaries
      // keyed by the session's RAW signupDate string (NOT the workflow dateKey).
      // See Phase 5 fix: feedback_firestore-attribute-gotchas + project_ll-
      // composite-key-migration — one-time events still use raw signupDate keys.
      const isSingleSession = sessions.length === 1;
      let presenterSrc;
      if (isSingleSession) {
        presenterSrc = ev.summary || {};
      } else {
        const summaryKey = todaySession.rawString || sessionKey;
        presenterSrc = (ev.sessionSummaries && ev.sessionSummaries[summaryKey]) || {};
      }

      const verifyDone = await _lcVerifyDisplayClosed(db, doc.id);
      let ownerUid, ownerName;
      if (presenterSrc.presenterUid && verifyDone) {
        ownerUid  = presenterSrc.presenterUid;
        ownerName = presenterSrc.presenter || "";
      } else {
        ownerUid  = ev.createdByUid  || "";
        ownerName = ev.createdByName || "";
        if (!ownerUid) {
          console.warn("createDayOfAttendanceTasks: no presenter or creator uid for event", doc.id, "— Take Attendance will be unassigned");
        }
      }

      await db.collection("interactions").add(_lcBuildInteractionDoc({
        eventId: doc.id, eventTitle: ev.title || "",
        step: "takeAttendance", sessionKey,
        ownerUid, ownerName, dueDate: todayKey
      }));
      created++;
    }
    console.log("createDayOfAttendanceTasks:", todayKey, "created", created, "tasks");
    return null;
  });

// ----------------------------------------------------------------------------
// createPresenterPrepTasks — daily 5 AM HST.
// Three days before each session, give the presenter a "Present Event" task so
// they prepare to present. Owner = the session's assigned presenter; if no
// presenter is recorded yet (the Assign Presenter task hasn't been closed),
// the task falls back to La'a (same owner who handles Assign Presenter), so the
// reminder still lands on someone accountable. Follow-up is the day AFTER the
// session. Per session — recurring series get one prep task before each date.
// Idempotent via _lcCreateIfMissing (event + step + sessionKey).
// ----------------------------------------------------------------------------
exports.createPresenterPrepTasks = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1 })
  .pubsub.schedule("0 5 * * *").timeZone("Pacific/Honolulu")
  .onRun(async () => {
    const db = admin.firestore();
    // Today in HST as YYYY-MM-DD, then the session date we target (today + 3)
    // and the follow-up date (the session date + 1). Anchor at noon HST so the
    // day arithmetic never drifts across a DST boundary.
    const nowHst = new Date(new Date().toLocaleString("en-US", { timeZone: "Pacific/Honolulu" }));
    const todayKey = nowHst.getFullYear()
      + "-" + String(nowHst.getMonth() + 1).padStart(2, "0")
      + "-" + String(nowHst.getDate()).padStart(2, "0");
    const baseMs = new Date(todayKey + "T12:00:00-10:00").getTime();
    const targetKey   = new Date(baseMs + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const followUpKey = new Date(baseMs + 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // session (+3) + 1

    const laaName = await _lcResolveStaffName(db, LIFECYCLE_LAA_UID);

    // Only workflow events still in 'setup' have sessions that haven't wrapped.
    const snap = await db.collection("events")
      .where("lifecycleStatus", "==", "setup")
      .get();

    let created = 0;
    for (const doc of snap.docs) {
      const ev = doc.data() || {};
      if (ev.archived === true) continue;
      const sessions = getEventSessions(ev) || [];
      const targetSession = sessions.find(s => _lcSessionKey(s) === targetKey);
      if (!targetSession) continue;

      // Presenter lives in the Event Summary storage: event.summary (single
      // session) or event.sessionSummaries keyed by the session's RAW signupDate
      // string (NOT the workflow dateKey) — see createDayOfAttendanceTasks.
      const isSingleSession = sessions.length === 1;
      let presenterSrc;
      if (isSingleSession) {
        presenterSrc = ev.summary || {};
      } else {
        const summaryKey = targetSession.rawString || targetKey;
        presenterSrc = (ev.sessionSummaries && ev.sessionSummaries[summaryKey]) || {};
      }

      let ownerUid, ownerName;
      if (presenterSrc.presenterUid) {
        ownerUid  = presenterSrc.presenterUid;
        ownerName = presenterSrc.presenter || "";
      } else {
        // No presenter assigned yet — fall back to La'a.
        ownerUid  = LIFECYCLE_LAA_UID;
        ownerName = laaName;
      }

      const res = await _lcCreateIfMissing(db, {
        eventId: doc.id, eventTitle: ev.title || "", step: "presenterPrep",
        sessionKey: targetKey, ownerUid, ownerName, dueDate: followUpKey
      });
      if (res) created++;
    }
    console.log("createPresenterPrepTasks: target", targetKey, "created", created, "tasks");
    return null;
  });

// ----------------------------------------------------------------------------
// createRecurringLifecycleTasks — daily 5 AM HST.
// Recurring programs (Connect-Gen) have no per-session "event created" hook, so
// this scans each active recurring program for upcoming sessions (today .. +5
// days) that have active signups and ensures the right lifecycle tasks exist
// for each — idempotent catch-up via _lcEnsureRecurringSessionTasks:
//   Assign Presenter (<=5d, La'a), Present Event prep (<=3d, presenter/La'a),
//   Take Attendance (day-of, presenter/La'a). Event Summary chains from the
//   takeAttendance close. Sessions are identified by composite keys taken
//   straight from the signups, so the gate + keys always match the app.
// ----------------------------------------------------------------------------
exports.createRecurringLifecycleTasks = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1 })
  .pubsub.schedule("0 5 * * *").timeZone("Pacific/Honolulu")
  .onRun(async () => {
    const db = admin.firestore();
    const nowHst = new Date(new Date().toLocaleString("en-US", { timeZone: "Pacific/Honolulu" }));
    const todayKey = nowHst.getFullYear()
      + "-" + String(nowHst.getMonth() + 1).padStart(2, "0")
      + "-" + String(nowHst.getDate()).padStart(2, "0");
    const laaName = await _lcResolveStaffName(db, LIFECYCLE_LAA_UID);

    const progs = await db.collection("recurringEvents").get();
    let created = 0, scanned = 0;
    for (const doc of progs.docs) {
      const ev = doc.data() || {};
      if (ev.archived === true || ev.active === false) continue;
      scanned++;
      const keys = await _lcRecurringSessionsWithSignups(db, doc.id, todayKey);
      for (const k of keys) {
        created += await _lcEnsureRecurringSessionTasks(db, doc.id, ev, k, todayKey, laaName);
      }
    }
    console.log("createRecurringLifecycleTasks:", todayKey, "scanned", scanned, "programs, created", created, "tasks");
    return null;
  });

// ----------------------------------------------------------------------------
// onRecurringSignupCreatedLifecycle — fires the instant a recurring-program
// signup is created. For each selected session that is imminent (today .. +5d)
// and active, ensure the lifecycle tasks exist now — closing the gap the
// once-a-day cron can't for true last-minute (day-before / same-day) signups.
// ----------------------------------------------------------------------------
exports.onRecurringSignupCreatedLifecycle = functions
  .runWith({ timeoutSeconds: 120, maxInstances: 10 })
  .firestore.document("recurringEvents/{eventId}/signups/{signupId}")
  .onCreate(async (snap, context) => {
    const db = admin.firestore();
    const s = snap.data() || {};
    const eventId = context.params.eventId;
    const sessions = s.selectedSessions || s.selectedDates || [];
    if (!Array.isArray(sessions) || sessions.length === 0) return null;

    const nowHst = new Date(new Date().toLocaleString("en-US", { timeZone: "Pacific/Honolulu" }));
    const todayKey = nowHst.getFullYear()
      + "-" + String(nowHst.getMonth() + 1).padStart(2, "0")
      + "-" + String(nowHst.getDate()).padStart(2, "0");

    const imminent = sessions.filter(k => {
      const D = _lcDaysUntilSession(k, todayKey);
      return D >= 0 && D <= 5 && _lcSignupActiveForSession(s, k);
    });
    if (imminent.length === 0) return null;

    const evSnap = await db.collection("recurringEvents").doc(eventId).get();
    if (!evSnap.exists) return null;
    const ev = evSnap.data() || {};
    if (ev.archived === true) return null;
    const laaName = await _lcResolveStaffName(db, LIFECYCLE_LAA_UID);

    let created = 0;
    for (const k of imminent) {
      created += await _lcEnsureRecurringSessionTasks(db, eventId, ev, k, todayKey, laaName);
    }
    if (created) console.log("onRecurringSignupCreatedLifecycle:", eventId, "signup", context.params.signupId, "created", created, "tasks");
    return null;
  });

// ----------------------------------------------------------------------------
// createResourceUpdateCallTasks — daily 5 AM HST.
// Gives La'akea a "call the partner for updates" task (deep-linked to the
// partner's resource edit card) for partners the email nudges can't close out.
// ONE task per partner per cycle — it persists until he completes it, and
// completing it marks the resource updated (see the resourceUpdateCall branch
// in onInteractionUpdatedLifecycle), which also stops further nudges.
//   - No email (can never self-update): created as soon as it's missing this
//     cycle — so an emailless partner gets it on cycle day 1 (or immediately).
//   - Has email but still hasn't updated: created on/after the cycle deadline
//     (from the system/resourceNudgeCycle config), once nudges are exhausted.
// "Updated this cycle?" uses the same grace-window test as the nudge cron.
// ----------------------------------------------------------------------------
exports.createResourceUpdateCallTasks = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1 })
  .pubsub.schedule("0 5 * * *").timeZone("Pacific/Honolulu")
  .onRun(async () => {
    const db = admin.firestore();
    const now = Date.now();
    const nowHst = new Date(new Date().toLocaleString("en-US", { timeZone: "Pacific/Honolulu" }));
    const todayKey = nowHst.getFullYear()
      + "-" + String(nowHst.getMonth() + 1).padStart(2, "0")
      + "-" + String(nowHst.getDate()).padStart(2, "0");

    const cycleConfig = await _loadNudgeCycleConfig(db);
    const cyc = _resourceCycleForNow(now, cycleConfig);
    const graceWindow = cyc.graceWindowMs;
    const cycleKey = cyc.cycleKey;                       // e.g. "2026-05-01"
    const atOrPastDeadline = (todayKey >= cyc.deadlineDateKey);
    const laaName = await _lcResolveStaffName(db, LIFECYCLE_LAA_UID);

    const snap = await db.collection("resources").get();
    let created = 0;
    for (const d of snap.docs) {
      const r = d.data() || {};
      if (r.archived === true) continue;
      const name = String(r.name || "").trim();
      if (!name) continue; // skip Downloads-metadata docs in the same collection
      const email = String(r.email || "").trim();

      // Already updated this cycle? (same test as the nudge eligibility)
      const lu = r.lastUpdateAt && r.lastUpdateAt.toMillis ? r.lastUpdateAt.toMillis() : 0;
      const subAt = r.updateSubmittedAt && r.updateSubmittedAt.toMillis ? r.updateSubmittedAt.toMillis() : 0;
      if (lu >= graceWindow || subAt >= graceWindow) continue;

      let shouldCreate = false;
      if (!email) {
        shouldCreate = true;                                  // emailless: always needs a call
      } else if (atOrPastDeadline && r.updateToken) {
        shouldCreate = true;                                  // emailed, no response by deadline
      }
      if (!shouldCreate) continue;

      // One per partner per cycle — persists until completed.
      const existing = await db.collection("interactions")
        .where("workflowEventId", "==", d.id)
        .where("workflowStep", "==", "resourceUpdateCall")
        .where("workflowSessionKey", "==", cycleKey)
        .limit(1).get();
      if (!existing.empty) continue;

      await db.collection("interactions").add({
        channel: "Partner Resources",
        interactionType: "Resource Update Call",
        contactId: "",
        contactName: name,
        contactType: "",
        grantProgram: "",
        summary: "Call " + name + " for resource-listing updates" + (email ? "" : " (no email on file)"),
        followUpDate: todayKey,
        status: "Open",
        notes: "Call " + name + (r.phone ? " at " + r.phone : "")
          + " to confirm or update their resource listing. Open the resource card (button), make any edits, then check this off — that marks the listing updated for this cycle.",
        isDraft: false,
        owner: laaName,
        ownerUid: LIFECYCLE_LAA_UID,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        workflowEventId: d.id,
        workflowEventCollection: "resources",
        workflowStep: "resourceUpdateCall",
        workflowSessionKey: cycleKey
      });
      created++;
    }
    console.log("createResourceUpdateCallTasks:", todayKey, "cycle", cycleKey, "atDeadline=" + atOrPastDeadline, "created", created, "tasks");
    return null;
  });

exports.onEventUpdatedLifecycle = functions
  .runWith({ timeoutSeconds: 120, maxInstances: 10 })
  .firestore.document("events/{eventId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data() || {};
    const after  = change.after.data()  || {};
    const eventId = context.params.eventId;
    if (!after.lifecycleStatus) return null; // not a workflow event
    const db = admin.firestore();

    // (a) Event newly archived -> auto-close open workflow interactions.
    const becameArchived = after.archived === true && before.archived !== true;
    if (becameArchived) {
      const open = await db.collection("interactions")
        .where("workflowEventId", "==", eventId)
        .where("status", "==", "Open")
        .get();
      if (!open.empty) {
        const batch = db.batch();
        open.forEach(d => {
          const update = {
            status: "Closed",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            notes: ((d.data().notes || "") + "\n[auto] Closed: event archived.").trim()
          };
          // assignPresenter has a chain-engine re-open guard if assignedPresenterUid is
          // missing — set a non-empty marker so the re-open is bypassed.
          if (d.data().workflowStep === "assignPresenter" && !d.data().assignedPresenterUid) {
            update.assignedPresenterUid  = "(archived)";
            update.assignedPresenterName = "(event archived)";
          }
          batch.update(d.ref, update);
        });
        await batch.commit();
      }
    }

    // Helper: extract per-session summary state (presenter + completedAt) keyed by
    // the sessionSummaries map key (rawString for multi-session). Single-session events
    // use a synthetic key "__summary__" because event.summary has no dynamic key.
    function snapshotSummaries(ev) {
      const out = {};
      if (ev.summary && typeof ev.summary === "object") {
        out["__summary__"] = {
          presenter:   ev.summary.presenter   || "",
          completedAt: ev.summary.completedAt || null
        };
      }
      if (ev.sessionSummaries && typeof ev.sessionSummaries === "object") {
        Object.keys(ev.sessionSummaries).forEach(k => {
          const s = ev.sessionSummaries[k] || {};
          out[k] = {
            presenter:   s.presenter   || "",
            completedAt: s.completedAt || null
          };
        });
      }
      return out;
    }
    const beforeSummaries = snapshotSummaries(before);
    const afterSummaries  = snapshotSummaries(after);

    // Build a map: summaryMapKey -> workflowSessionKey (dateKey)
    // For single-session: "__summary__" -> sessions[0].dateKey
    // For multi-session:  session.rawString -> session.dateKey
    const sessions = getEventSessions(after) || [];
    const summaryKeyToWorkflowKey = {};
    if (sessions.length === 1) {
      summaryKeyToWorkflowKey["__summary__"] = _lcSessionKey(sessions[0]);
    } else {
      sessions.forEach(s => {
        const dk = _lcSessionKey(s);
        const raw = s.rawString || dk;
        if (raw && dk) summaryKeyToWorkflowKey[raw] = dk;
      });
    }

    // (b) Event Summary form saved -> auto-close matching eventSummary interaction.
    for (const summaryMapKey of Object.keys(afterSummaries)) {
      const beforeCompleted = !!(beforeSummaries[summaryMapKey] && beforeSummaries[summaryMapKey].completedAt);
      const afterCompleted  = !!(afterSummaries[summaryMapKey]  && afterSummaries[summaryMapKey].completedAt);
      if (!afterCompleted || beforeCompleted) continue; // not newly completed
      const wfKey = summaryKeyToWorkflowKey[summaryMapKey];
      if (!wfKey) continue;
      const q = await db.collection("interactions")
        .where("workflowEventId", "==", eventId)
        .where("workflowStep", "==", "eventSummary")
        .where("workflowSessionKey", "==", wfKey)
        .where("status", "==", "Open")
        .limit(1).get();
      if (q.empty) continue;
      await q.docs[0].ref.update({
        status: "Closed",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        notes: ((q.docs[0].data().notes || "") + "\n[auto] Closed: Event Summary form saved.").trim()
      });
    }

    // (c) Reverse direction: presenter newly set via form save -> auto-close the
    //     matching open assignPresenter interaction, capturing the presenter.
    for (const summaryMapKey of Object.keys(afterSummaries)) {
      const beforeName = (beforeSummaries[summaryMapKey] && beforeSummaries[summaryMapKey].presenter) || "";
      const afterName  = (afterSummaries[summaryMapKey]  && afterSummaries[summaryMapKey].presenter)  || "";
      if (!afterName || afterName === beforeName) continue; // no change or cleared
      const wfKey = summaryKeyToWorkflowKey[summaryMapKey];
      if (!wfKey) continue;
      const q = await db.collection("interactions")
        .where("workflowEventId", "==", eventId)
        .where("workflowStep", "==", "assignPresenter")
        .where("workflowSessionKey", "==", wfKey)
        .where("status", "==", "Open")
        .limit(1).get();
      if (q.empty) continue;
      // Look up uid from userRoles by displayName (best-effort).
      let uid = "";
      try {
        const ur = await db.collection("userRoles").where("displayName", "==", afterName).limit(1).get();
        if (!ur.empty) uid = ur.docs[0].id;
      } catch (e) { /* tolerate */ }
      // If still empty (external presenter not in userRoles), use a non-empty marker so
      // the chain engine's re-open guard is bypassed.
      const persistedUid = uid || "(form-set)";
      await q.docs[0].ref.update({
        status: "Closed",
        assignedPresenterUid:  persistedUid,
        assignedPresenterName: afterName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        notes: ((q.docs[0].data().notes || "") + "\n[auto] Closed: presenter set via Event Summary form (" + afterName + ").").trim()
      });
    }

    return null;
  });

// ───────────────────────────────────────────────────────────────────────
// scheduledCaseAdvocacyDocLifecycle
// ───────────────────────────────────────────────────────────────────────
// Daily cron that enforces the 3-day post-close document destruction
// promise for Case Advocacy documents stored in contacts/{cid}/caseAdvocacyDocuments:
//
//   • If the contact has ANY open Case Advocacy interaction → retain (skip).
//   • Else if max(caseAdvocacyClosedAt) across the contact's Case Advocacy
//     interactions is >= 2 days ago and caseAdvocacyDocsAlertSentAt is unset
//     → courtesy alert: createNotification to the advocate, stamp alertSentAt.
//   • Else if max(caseAdvocacyClosedAt) >= 3 days ago
//     → destroy: delete Storage files under caseAdvocacy/{cid}/, set
//       caseAdvocacyDocuments:[], stamp destroyedAt/By/Reason, audit-log.
//
// caseAdvocacyClosedAt is stamped by the dashboard (changeInteractionStatus,
// Part A) whenever a Case Advocacy interaction is set to Closed. It is
// cleared (delete()) when the interaction is re-opened. This makes the 3-day
// window safe across multiple close/reopen cycles: the clock resets on reopen.
//
// HST math: HST = UTC-10. 3 days = 3 * 24 * 60 * 60 * 1000 ms.
// The cron fires daily at 08:00 Pacific/Honolulu, but the ms comparison is
// exact so early/late ticks only shift destruction by at most one day.
// ───────────────────────────────────────────────────────────────────────

// Best-effort delete of all Case Advocacy storage files referenced by a
// contact's caseAdvocacyDocuments array. Each entry is expected to be an
// object with a storagePath field. Path-scoped to caseAdvocacy/{cid}/ as
// a defense-in-depth check. Returns { deleted, errors }.
async function _destroyCaseAdvocacyStorageFiles(cid, caseAdvocacyDocuments) {
  const bucket = admin.storage().bucket("ldah-932d5.firebasestorage.app");
  const deleted = [];
  const errors = [];
  const docs = Array.isArray(caseAdvocacyDocuments) ? caseAdvocacyDocuments : [];
  const expectedPrefix = "caseAdvocacy/" + cid + "/";
  for (const rec of docs) {
    if (!rec || !rec.storagePath) continue;
    const storagePath = String(rec.storagePath);
    // Defense-in-depth: only delete paths scoped to this contact's folder.
    if (storagePath.indexOf(expectedPrefix) !== 0) {
      errors.push("path-scope violation, skipped: " + storagePath);
      continue;
    }
    try {
      await bucket.file(storagePath).delete();
      deleted.push(storagePath);
    } catch (err) {
      if (err && (err.code === 404 || /no such object/i.test(err.message || ""))) {
        deleted.push(storagePath + " (already gone)");
      } else {
        errors.push(storagePath + ": " + (err.message || String(err)));
      }
    }
  }
  return { deleted, errors };
}

exports.scheduledCaseAdvocacyDocLifecycle = functions
  .runWith({ memory: "256MB", timeoutSeconds: 540 })
  .pubsub.schedule("every 24 hours")
  .timeZone("Pacific/Honolulu")
  .onRun(async () => {
    const db = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;
    const nowMs = Date.now();
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    const TWO_DAYS_MS  = 2 * 24 * 60 * 60 * 1000;

    let scanned = 0;
    let retained = 0;
    let destroyed = 0;
    let alerted = 0;
    let skipped = 0;
    let errors = 0;

    // Query contacts that have at least one entry in caseAdvocacyDocuments.
    // Firestore: orderBy on an array field filters docs where the field exists
    // and is non-empty; the index must exist (compound if needed, but
    // a simple collectionGroup query on contacts with orderBy works for top-level arrays).
    let contactsSnap;
    try {
      contactsSnap = await db.collection("contacts")
        .orderBy("caseAdvocacyDocuments")
        .get();
    } catch (err) {
      console.error("scheduledCaseAdvocacyDocLifecycle: contacts query failed:", err.message);
      return null;
    }

    for (const contactDoc of contactsSnap.docs) {
      scanned++;
      try {
        const contact = contactDoc.data() || {};
        const cid = contactDoc.id;

        // Skip if documents already destroyed or array is empty.
        if (contact.caseAdvocacyDocsDestroyedAt) { skipped++; continue; }
        const docs = contact.caseAdvocacyDocuments;
        if (!Array.isArray(docs) || docs.length === 0) { skipped++; continue; }

        // Load all interactions for this contact.
        let ixSnap;
        try {
          ixSnap = await db.collection("interactions")
            .where("contactId", "==", cid)
            .get();
        } catch (e) {
          console.warn("scheduledCaseAdvocacyDocLifecycle: interactions query failed for " + cid + ":", e.message);
          errors++;
          continue;
        }

        const allIx = ixSnap.docs.map((d) => d.data() || {});
        const advIx = allIx.filter((x) => x.interactionType === "Case Advocacy");

        // If any Case Advocacy interaction is open → retain.
        const openAdv = advIx.some((x) => x.status === "Open");
        if (openAdv) { retained++; continue; }

        // Compute max caseAdvocacyClosedAt across closed Case Advocacy interactions.
        let lastClosedMs = null;
        let advocateUid = "";
        let advocateName = "";
        for (const ix of advIx) {
          if (!ix.caseAdvocacyClosedAt) continue;
          let ts = null;
          try {
            // Firestore Timestamp has .toMillis(); plain numbers work directly.
            if (ix.caseAdvocacyClosedAt && typeof ix.caseAdvocacyClosedAt.toMillis === "function") {
              ts = ix.caseAdvocacyClosedAt.toMillis();
            } else if (typeof ix.caseAdvocacyClosedAt === "number") {
              ts = ix.caseAdvocacyClosedAt;
            }
          } catch (e) { /* tolerate */ }
          if (ts === null) continue;
          if (lastClosedMs === null || ts > lastClosedMs) {
            lastClosedMs = ts;
            // Track the advocate uid/name from the most-recently-closed advocacy.
            advocateUid  = String(ix.ownerUid  || ix.advocateUid  || "").trim();
            advocateName = String(ix.owner     || ix.advocateName || "").trim();
          }
        }

        if (lastClosedMs === null) {
          // No closed Case Advocacy interaction with a closedAt stamp.
          // This means advocacy was closed before the v145.0.2 stamp was deployed
          // (or re-opened and never re-closed). Skip conservatively.
          skipped++;
          continue;
        }

        const ageDaysMs = nowMs - lastClosedMs;

        // ── Destroy branch ── (>= 3 days since last close)
        if (ageDaysMs >= THREE_DAYS_MS) {
          try {
            const result = await _destroyCaseAdvocacyStorageFiles(cid, docs);
            await contactDoc.ref.update({
              caseAdvocacyDocuments: [],
              caseAdvocacyDocsDestroyedAt: FieldValue.serverTimestamp(),
              caseAdvocacyDocsDestroyedBy: "system (3-day post-advocacy)",
              caseAdvocacyDocsDestroyedReason: "Auto-destroyed 3 days after last Case Advocacy interaction closed",
            });
            destroyed++;
            try {
              await db.collection("auditLog").add({
                action: "Case Advocacy documents auto-destroyed (3-day post-close)",
                details: (contact.name || contact.firstName || "(unknown)") +
                  " — contact " + cid +
                  " — files deleted: " + (result.deleted.length || 0) +
                  (result.errors.length ? " (errors: " + result.errors.join("; ") + ")" : ""),
                performedBy: "system (auto)",
                performedByRole: "system",
                timestamp: FieldValue.serverTimestamp(),
                contactId: cid,
              });
            } catch (e) { console.warn("auditLog write failed:", e.message); }
          } catch (e) {
            errors++;
            console.error("scheduledCaseAdvocacyDocLifecycle destroy failed for contact " + cid + ":", e.message);
          }
          continue;
        }

        // ── Courtesy-alert branch ── (>= 2 days, < 3 days, alert not yet sent)
        if (ageDaysMs >= TWO_DAYS_MS) {
          if (contact.caseAdvocacyDocsAlertSentAt) { skipped++; continue; }
          try {
            // Send in-app notification to the advocate (owner uid of most-recent
            // closed advocacy). Skip notification when no uid is known; the
            // stamp below still prevents re-alerting next tick.
            if (advocateUid) {
              await db.collection("notifications").add({
                recipientUid: advocateUid,
                recipientName: advocateName || "",
                type: "case-advocacy-docs-expiring",
                title: "Case Advocacy documents will be destroyed in ~1 day",
                message: "Documents for " +
                  (contact.name || contact.firstName || "this contact") +
                  " will be auto-destroyed ~1 day from now (3 days after Case Advocacy closed). " +
                  "Reopen the advocacy to retain them.",
                contactId: cid,
                read: false,
                createdAt: FieldValue.serverTimestamp(),
              });
            }
            await contactDoc.ref.update({
              caseAdvocacyDocsAlertSentAt: FieldValue.serverTimestamp(),
            });
            alerted++;
            try {
              await db.collection("auditLog").add({
                action: "Case Advocacy docs expiry alert sent (2-day mark)",
                details: (contact.name || contact.firstName || "(unknown)") +
                  " — contact " + cid +
                  (advocateUid ? " — notified uid " + advocateUid : " (no uid, skipped notification)"),
                performedBy: "system (auto)",
                performedByRole: "system",
                timestamp: FieldValue.serverTimestamp(),
                contactId: cid,
              });
            } catch (e) { console.warn("auditLog write failed:", e.message); }
          } catch (e) {
            errors++;
            console.error("scheduledCaseAdvocacyDocLifecycle alert failed for contact " + cid + ":", e.message);
          }
          continue;
        }

        // Before the 2-day window — too early, retain.
        retained++;
      } catch (err) {
        errors++;
        console.error("scheduledCaseAdvocacyDocLifecycle per-contact error for " + contactDoc.id + ":", err.message);
      }
    }

    console.log(
      "scheduledCaseAdvocacyDocLifecycle: scanned=" + scanned +
      ", retained=" + retained +
      ", destroyed=" + destroyed +
      ", alerted=" + alerted +
      ", skipped=" + skipped +
      ", errors=" + errors
    );
    return { scanned, retained, destroyed, alerted, skipped, errors };
  });

// ── Photo Release ─────────────────────────────────────────────────
exports.createPhotoReleaseRequest = require("./photoRelease").createPhotoReleaseRequest;
exports.getPhotoRelease = require("./photoRelease").getPhotoRelease;
exports.submitPhotoRelease = require("./photoRelease").submitPhotoRelease;
exports.photoReleaseReminders = require("./photoRelease").photoReleaseReminders;
exports.revertPhotoRelease = require("./photoRelease").revertPhotoRelease;
exports.cancelPhotoRelease = require("./photoRelease").cancelPhotoRelease;
exports.getDemoReleases = require("./photoRelease").getDemoReleases;
