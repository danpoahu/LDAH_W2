const functions = require("firebase-functions");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");
const crypto = require("crypto");
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

// ── Android Beta: Auto-add tester to Google Group via Cloud Identity API ──
const { google } = require("googleapis");
const BETA_GROUP_EMAIL = "ldah-beta-testers@googlegroups.com";

async function addToGoogleGroup(email) {
  const keyJson = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT);
  const auth = new google.auth.GoogleAuth({
    credentials: keyJson,
    scopes: ["https://www.googleapis.com/auth/cloud-identity.groups"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const headers = { Authorization: "Bearer " + token.token, "Content-Type": "application/json" };

  // Step 1: Look up the group by email to get its Cloud Identity ID
  const lookupRes = await fetch(
    "https://cloudidentity.googleapis.com/v1/groups:lookup?groupKey.id=" + encodeURIComponent(BETA_GROUP_EMAIL),
    { headers }
  );
  const lookupData = await lookupRes.json();
  if (!lookupRes.ok) throw new Error("Group lookup failed: " + JSON.stringify(lookupData));
  const groupName = lookupData.name; // e.g. "groups/abc123"
  console.log("Group found:", groupName);

  // Step 2: Add the email as a member
  const addRes = await fetch(
    "https://cloudidentity.googleapis.com/v1/" + groupName + "/memberships",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        preferredMemberKey: { id: email },
        roles: [{ name: "MEMBER" }],
      }),
    }
  );
  const addData = await addRes.json();
  if (!addRes.ok) {
    // 409 = already a member
    if (addRes.status === 409) return { added: false, reason: "already_member" };
    throw new Error("Add member failed: " + JSON.stringify(addData));
  }
  console.log("Member added:", JSON.stringify(addData));
  return { added: true };
}

exports.notifyAndroidBetaRequest = functions
  .runWith({
    timeoutSeconds: 30,
    maxInstances: 5,
    secrets: ["GOOGLE_PLAY_SERVICE_ACCOUNT"],
  })
  .firestore.document("androidBetaRequests/{docId}")
  .onCreate(async (snap) => {
    const data = snap.data();
    const email = data.email || "unknown";
    console.log("Android beta request received:", email);

    try {
      const result = await addToGoogleGroup(email);
      console.log("Google Group result:", email, result);
      await snap.ref.update({
        addedToGroup: result.added,
        groupResult: result.added ? "added" : result.reason,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error("Google Group API error:", err.message);
      await snap.ref.update({
        addedToGroup: false,
        groupError: err.message,
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

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const msg = "Resend API error (" + response.status + "): " + errorBody;
      await logEmailSend({
        from, to, bcc: bccLogValue, subject, html,
        type, relatedEventId, relatedSignupId, recipientName,
        success: false, error: msg,
      });
      throw new Error(msg);
    }

    const result = await response.json();
    await logEmailSend({
      from, to, bcc: bccLogValue, subject, html,
      type, relatedEventId, relatedSignupId, recipientName,
      success: true, resendId: (result && result.id) || null,
    });
    return result;
  } catch (err) {
    // If we already logged the error above, this will just rethrow;
    // if the fetch itself threw, catch it here so we still log.
    if (!err.message || err.message.indexOf("Resend API error") !== 0) {
      await logEmailSend({
        from, to, bcc: bccLogValue, subject, html,
        type, relatedEventId, relatedSignupId, recipientName,
        success: false, error: err.message || String(err),
      });
    }
    throw err;
  }
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
        '<p style="margin:0 0 4px;font-size:12px;color:#999999;">Phone: (808) 536-2280</p>' +
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
 */
function buildConfirmationEmailHtml({ name, eventTitle, datesPhrase, modality }) {
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

      <p style="margin:0;font-size:16px;color:#333333;line-height:1.5;">
        We'll email you a reminder <strong>3 days before</strong> your session and again <strong>on the day of the session</strong>, ${reminderTail}.
      </p>
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
        Phone: (808) 536-2280
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
        Phone: (808) 536-2280
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
    const month = dt.toLocaleDateString("en-US", { month: "long" });
    const day = dt.getDate();
    const ord = (day >= 11 && day <= 13)
      ? "th"
      : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th");
    return `${month} ${day}${ord}`;
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

    let sessionKeys = extractSignupSessionKeys(after);
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
      return;
    }

    if (isConnectGen && !after.consentSignedAt) {
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
      return; // do NOT mark confirmationEmailSentAt — the prep email later does that
    }

    // Connect-Gen + consent already signed → send the prep-docs email
    // (in case status flipped from pending to confirmed AFTER consent was
    // already on file from a prior run).
    if (isConnectGen && after.consentSignedAt) {
      // submitConnectGenConsent already sent the prep email when the form
      // was submitted. Don't double-send. Just stamp confirmationEmailSentAt
      // so this branch doesn't keep re-firing.
      await change.after.ref.set({
        confirmationEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    // For non-Connect-Gen events: skip the standard confirmation if any
    // session is within the 5-day catch-up window — the catch-up reminder
    // (which fires from maybeSendCatchupReminder above this in the trigger
    // chain) carries the same info and is the more useful email at that
    // point. Connect-Gen returns above before reaching this so its consent
    // email always fires regardless of session proximity.
    const _todayKey = toHstDateKey(new Date());
    const _windowKeys = {};
    for (let _d = 0; _d <= 3; _d++) {
      const _k = addDaysHst(_todayKey, _d);
      if (_k) _windowKeys[_k] = true;
    }
    const _withinWindow = sessionKeys.some(k => !!_windowKeys[k]);
    if (_withinWindow) {
      console.log(`Confirmation skipped (within 3d window) for ${collection}/${eventId}/${signupId}`);
      return;
    }

    // Standard non-Connect-Gen path.
    const html = buildConfirmationEmailHtml({
      name: recipientName,
      eventTitle,
      datesPhrase,
      modality,
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
    await change.after.ref.set({
      confirmationEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`Confirmation email sent to ${after.email} for ${collection}/${eventId}/${signupId}`);
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
  } catch (contactErr) {
    console.error(`Contact auto-creation failed for signup ${signupId}:`, contactErr.message);
    // Non-blocking — continue to email logic
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
  return null;
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

          // Skip Connect-Gen pending signups — those have a separate consent flow,
          // and the consent-required email is sent by maybeSendRegistrationConfirmation
          // when the contact's still missing consent. Don't double-up with a
          // generic "Complete Your Registration" prompt.
          if (event.zoomMode === "program") { skipped++; continue; }

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

      try {
        const evSnap = await db.collection(collection).doc(eventId).get();
        if (evSnap.exists) eventTitle = (evSnap.data() || {}).title || eventTitle;
      } catch (_) {}

      const sessionLabel = data.sessionDate ? " (" + data.sessionDate + ")" : "";
      const summary = "Follow-up support requested after " + eventTitle + sessionLabel;
      const notes = (data.followUpDescription && String(data.followUpDescription).trim())
        || "(no detail provided in survey)";

      // +2 calendar days from today (HST) — gives staff a brief SLA window
      // before the interaction shows as overdue in the Follow-Ups KPI.
      const followUpDate = addDaysHst(toHstDateKey(new Date()), 2);

      // Match the canonical schema written by saveInteractionToFirestore.
      // owner blank so it shows as Unassigned and an admin can claim it.
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
        owner: "",
        ownerUid: "",
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

      // Triage alert to La'a (resourceCoordinator persona) — gives her an
      // immediate heads-up so she can claim the interaction and reach out.
      try {
        const triage = await getPersona("resourceCoordinator");
        if (triage && triage.email) {
          const alertHtml =
            "<p style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5;\">" +
            "Aloha " + (triage.firstName || "La'a") + ",</p>" +
            "<p style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5;\">" +
            "<strong>" + (contactName || "An attendee") + "</strong> requested follow-up support after " +
            "<em>" + eventTitle + sessionLabel + "</em>.</p>" +
            (notes && notes !== "(no detail provided in survey)"
              ? "<blockquote style=\"margin:0 0 14px;padding:10px 14px;border-left:4px solid #1a3c6e;background:#F8FAFC;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#333;\">" +
                String(notes).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>") +
                "</blockquote>"
              : "<p style=\"font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#666;font-style:italic;\">No additional detail was provided in the survey.</p>") +
            "<p style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5;\">" +
            "An interaction has been created on the LDAH-Int dashboard with status <strong>Open</strong> " +
            "and follow-up date <strong>" + followUpDate + "</strong>. Please claim it from the Interaction Detail panel.</p>" +
            _emailBtn("https://danpoahu.github.io/LDAH-Int/", "Open LDAH-Int Dashboard", { bg: "#1a3c6e", align: "center" }) +
            _emailLinkFooter([{ label: "LDAH-Int Dashboard", href: "https://danpoahu.github.io/LDAH-Int/" }]) +
            "<p style=\"font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#888;margin-top:18px;\">" +
            "This alert was sent automatically because the attendee answered Yes to \"Do you require follow-up support?\" on the post-event survey.</p>";

          await sendEmailViaResend({
            from: "LDAH <" + (process.env.SMTP_FROM || "registration@ldahawaii.org") + ">",
            to: triage.email,
            subject: "Follow-up support requested -- " + (contactName || "Unknown") + " (" + eventTitle + ")",
            html: alertHtml,
            type: "follow-up-triage-alert",
            relatedEventId: eventId,
            relatedSignupId: signupId,
            recipientName: triage.fullName || "La'a",
          });
        }
      } catch (e) { console.warn("triage alert send failed:", e.message); }

      console.log(
        `onEventFeedbackCreated: auto-interaction created for ${contactName || "unknown"} ` +
        `(contact ${contactId || "--"}) from feedback ${snap.id}`,
      );
    } catch (err) {
      console.error("onEventFeedbackCreated error:", err.message);
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
      if (registration.childName) childEntry.name = String(registration.childName).trim();
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
        // Don't duplicate if this signup already added a child
        const alreadyAdded = existingChildren.some(c => c.sourceSignupId === context.params.signupId);
        if (!alreadyAdded) {
          existingChildren.push(childEntry);
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
            if (sd < windowStart || sd > windowEnd) continue;
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

exports.sendDailySessionSheet = functions
  .runWith({ timeoutSeconds: 120, maxInstances: 1, secrets: ["RESEND_API_KEY", "SMTP_FROM"] })
  .pubsub.schedule("0 6 * * *")
  .timeZone("Pacific/Honolulu")
  .onRun(async (context) => {
    const db = admin.firestore();
    const now = new Date();

    // Convert to Hawaii time for display and date matching
    const hawaiiNow = new Date(now.toLocaleString("en-US", { timeZone: "Pacific/Honolulu" }));
    const todayStr = hawaiiNow.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "Pacific/Honolulu",
    });
    const todayFormatted = hawaiiNow.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "Pacific/Honolulu",
    });
    const todayDayOfWeek = hawaiiNow.toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "Pacific/Honolulu",
    });
    // YYYY-MM-DD for date field matching
    const yyyy = hawaiiNow.getFullYear();
    const mm = String(hawaiiNow.getMonth() + 1).padStart(2, "0");
    const dd = String(hawaiiNow.getDate()).padStart(2, "0");
    const todayISO = `${yyyy}-${mm}-${dd}`;

    // ── 1. Get active recipients ──
    let recipients = [];
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

    if (recipients.length === 0) {
      console.log("sendDailySessionSheet: no active recipients, skipping.");
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
            allSessions.push({
              title: (data.title || "Untitled Event") + " -- " + dateStr,
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
              title: (data.title || "Untitled Event") + " -- Unmatched signups",
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
            allSessions.push({
              title: data.title + " -- " + sg.dateLabel + (sg.timeLabel ? " -- " + sg.timeLabel : ""),
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
        + `<td style="font-size:14px;font-weight:800;color:white;">${esc(s.title)} --</td>`
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
    // SECTION 2: What Changed Since Yesterday (detailed)
    // ═══════════════════════════════════════════════════
    const changelog = [];

    // New signups with names + event titles
    try {
      const nsSnap = await db.collectionGroup("signups").where("timestamp", ">=", cutoffTimestamp).get();
      for (const doc of nsSnap.docs) {
        const nd = doc.data();
        const parentRef = doc.ref.parent.parent;
        const parentDoc = await parentRef.get();
        const evTitle = (parentDoc.data() || {}).title || "Unknown Event";
        changelog.push({
          icon: "&#128221;",
          text: `<strong>${esc(nd.name || "Someone")}</strong> signed up for <em>${esc(evTitle)}</em>`,
          time: fmtTs(nd.timestamp),
          sort: nd.timestamp ? (nd.timestamp.seconds || 0) : 0,
        });
      }
    } catch (err) { console.warn("Changelog signups:", err.message); }

    // Completed registrations with names
    try {
      const crSnap = await db.collectionGroup("signups").where("registrationCompletedAt", ">=", cutoffTimestamp).get();
      for (const doc of crSnap.docs) {
        const cd = doc.data();
        const parentRef = doc.ref.parent.parent;
        const parentDoc = await parentRef.get();
        const pTitle = (parentDoc.data() || {}).title || "Unknown Event";
        changelog.push({
          icon: "&#9989;",
          text: `<strong>${esc(cd.name || "Someone")}</strong> completed registration for <em>${esc(pTitle)}</em>`,
          time: fmtTs(cd.registrationCompletedAt),
          sort: cd.registrationCompletedAt ? (cd.registrationCompletedAt.seconds || 0) : 0,
        });
      }
    } catch (err) { console.warn("Changelog regs:", err.message); }

    // New feedback
    try {
      const fbSnap = await db.collection("eventFeedback").where("submittedAt", ">=", cutoffTimestamp).get();
      fbSnap.forEach((f) => {
        const fd = f.data();
        changelog.push({
          icon: "&#128172;",
          text: `Feedback received for <em>${esc(fd.eventTitle || fd.eventId || "an event")}</em>${fd.presenterRating ? " (Presenter: " + esc(fd.presenterRating) + ")" : ""}`,
          time: fmtTs(fd.submittedAt),
          sort: fd.submittedAt ? (fd.submittedAt.seconds || 0) : 0,
        });
      });
    } catch (err) { console.warn("Changelog feedback:", err.message); }

    // New contacts
    try {
      const ctSnap = await db.collection("contacts").where("createdAt", ">=", cutoffTimestamp).get();
      ctSnap.forEach((c) => {
        const cdata = c.data();
        changelog.push({
          icon: "&#128100;",
          text: `New contact created: <strong>${esc(cdata.displayName || cdata.firstName || "Unknown")}</strong>${cdata.source ? " (from " + esc(cdata.source) + ")" : ""}`,
          time: fmtTs(cdata.createdAt),
          sort: cdata.createdAt ? (cdata.createdAt.seconds || 0) : 0,
        });
      });
    } catch (err) { console.warn("Changelog contacts:", err.message); }

    // Admin actions from audit log (status changes, archives, reschedules, etc.)
    function formatAuditEntry(action, details) {
      if (!action || !details) return null;
      let m;
      if (action === "Updated signup status") {
        m = details.match(/^(.*?)\s+—\s+(.*?)\s+—\s+Status:\s+(.*)$/);
        if (m) {
          const verbs = {
            confirmed: "was <strong>confirmed</strong> for",
            cancelled: "was marked <strong>cancelled</strong> for",
            pending: "was set to <strong>pending</strong> for",
            new: "was reset to <strong>new</strong> for",
          };
          const verb = verbs[m[3]] || `was set to <strong>${esc(m[3])}</strong> for`;
          return { icon: "&#128260;", text: `<strong>${esc(m[1])}</strong> ${verb} <em>${esc(m[2])}</em>` };
        }
      }
      if (action === "Archived signup") {
        m = details.match(/^(.*?)\s+—\s+(.*)$/);
        if (m) return { icon: "&#128465;", text: `<strong>${esc(m[1])}</strong> was archived from <em>${esc(m[2])}</em>` };
      }
      if (action === "Restored signup") {
        m = details.match(/^(.*?)\s+—\s+(.*)$/);
        if (m) return { icon: "&#8617;", text: `<strong>${esc(m[1])}</strong> was restored to <em>${esc(m[2])}</em>` };
      }
      if (action === "Rescheduled signup") {
        m = details.match(/^(.*?)\s+—\s+from\s+(.*?)\s+to\s+(.*)$/);
        if (m) return { icon: "&#128197;", text: `<strong>${esc(m[1])}</strong> was rescheduled from ${esc(m[2])} to ${esc(m[3])}` };
      }
      if (action === "Saved attendance") return { icon: "&#9989;", text: `Attendance saved — <em>${esc(details)}</em>` };
      if (action === "Cancelled session") return { icon: "&#10060;", text: `Session cancelled — <em>${esc(details)}</em>` };
      if (action === "Restored session") return { icon: "&#9200;", text: `Session restored — <em>${esc(details)}</em>` };
      if (action === "Sent no-show re-invites") return { icon: "&#128231;", text: `No-show re-invites sent — <em>${esc(details)}</em>` };
      if (action === "Follow-up support requested") {
        m = details.match(/^(.*?)\s+--\s+(.*)$/);
        if (m) return { icon: "&#128205;", text: `<strong>${esc(m[1])}</strong> requested follow-up support after <em>${esc(m[2])}</em>` };
        return { icon: "&#128205;", text: `Follow-up support requested — <em>${esc(details)}</em>` };
      }
      if (action === "Saved event summary") return { icon: "&#128203;", text: `Event summary saved — <em>${esc(details)}</em>` };
      if (action === "Updated signup notes") {
        m = details.match(/^(.*?)\s+—\s+(.*)$/);
        if (m) return { icon: "&#9999;", text: `Admin notes updated for <strong>${esc(m[1])}</strong> on <em>${esc(m[2])}</em>` };
      }
      return null;
    }

    try {
      const alSnap = await db.collection("auditLog").where("timestamp", ">=", cutoffTimestamp).get();
      alSnap.forEach((a) => {
        const ad = a.data();
        const fmt = formatAuditEntry(ad.action, ad.details);
        if (!fmt) return;
        const by = ad.performedBy ? ` <span style="color:#999;">(by ${esc(ad.performedBy)})</span>` : "";
        changelog.push({
          icon: fmt.icon,
          text: fmt.text + by,
          time: fmtTs(ad.timestamp),
          sort: ad.timestamp ? (ad.timestamp.seconds || 0) : 0,
        });
      });
    } catch (err) { console.warn("Changelog audit:", err.message); }

    // Sort changelog by time (newest first)
    changelog.sort((a, b) => b.sort - a.sort);

    let changelogHtml = "";
    if (changelog.length === 0) {
      changelogHtml = `<p style="color:#666;font-style:italic;">No changes in the last 24 hours.</p>`;
    } else {
      changelogHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">`;
      changelog.forEach((c, idx) => {
        const bg = idx % 2 === 0 ? "#fafafa" : "#ffffff";
        changelogHtml += `<tr style="background:${bg};">`
          + `<td style="padding:8px 14px;font-size:16px;width:30px;text-align:center;">${c.icon}</td>`
          + `<td style="padding:8px 14px;font-size:13px;color:#333;">${c.text}</td>`
          + `<td style="padding:8px 14px;font-size:11px;color:#999;white-space:nowrap;text-align:right;">${c.time}</td></tr>`;
      });
      changelogHtml += `</table>`;
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

  <!-- Section 2: What Changed (Last 24 Hours) -->
  <tr>
    <td style="padding:24px 28px 8px;">
      <h2 style="margin:0;font-size:17px;color:#1a3c6e;border-bottom:2px solid #1a3c6e;padding-bottom:6px;">
        What Changed (Last 24 Hours)
      </h2>
      <p style="margin:4px 0 12px;font-size:12px;color:#666;">${changelog.length} change(s)</p>
    </td>
  </tr>
  <tr><td style="padding:0 28px 16px;">${changelogHtml}</td></tr>

  <!-- Section 3: Pending/New Public Submissions -->
  <tr>
    <td style="padding:24px 28px 8px;">
      <h2 style="margin:0;font-size:17px;color:#1a3c6e;border-bottom:2px solid #1a3c6e;padding-bottom:6px;">
        Pending Public Submissions
      </h2>
    </td>
  </tr>
  <tr><td style="padding:0 28px 16px;">${formsHtml}</td></tr>

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
  });

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
  const m = String(raw).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]?\.?/);
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
  collection, eventId, signupId, signup, event, sessionDateKey, mode, zoomDefault, skipBcc, cc,
}) {
  const type = collection === "recurringEvents" ? "recurring" : "event";
  const { dayName, formatted } = formatHstDateParts(sessionDateKey);
  const recipientName = resolveReminderRecipientName(signup);
  const eventTitle = (event && event.title) || "an LDAH Event";
  const startTime = (event && (event.startTime || event.time)) || "";
  const endTime = (event && event.endTime) || "";

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
  const surveyUrl =
    "https://ldahawaii.org/feedback.html?signupId=" + encodeURIComponent(signupId) +
    "&eventId=" + encodeURIComponent(eventId) +
    "&type=" + encodeURIComponent(type) +
    (sessionDateKey ? "&sessionDate=" + encodeURIComponent(sessionDateKey) : "");

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

    // Connect-Gen gate — skip the catch-up reminder if consent isn't signed
    // yet. The reminder would carry the Zoom link, which we don't want
    // until the parent has signed the consent. The consent-required email
    // (fired in maybeSendRegistrationConfirmation) handles their next step.
    if (event.zoomMode === "program" && !after.consentSignedAt) {
      console.log(`catch-up reminder skipped (Connect-Gen, consent unsigned) for ${collection}/${eventId}/${signupId}`);
      return;
    }

    // Parent Talk Cafe — Zoom reminders never apply; the PTC confirmation
    // email is the only touchpoint.
    if (event.zoomMode === "parent_talk_cafe") {
      return;
    }

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

    for (const sessionDateKey of candidateDates) {
      if (existing[sessionDateKey] && existing[sessionDateKey].threeDay) continue;
      try {
        await sendOneReminderEmail({
          collection, eventId, signupId,
          signup: after, event,
          sessionDateKey, mode: "3day", zoomDefault,
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

    let sent3d = 0;
    let skipped = 0;

    // Helper: process one signup doc. For each matching session date,
    // send (with dedupe) and update sessionReminders.
    async function processSignup({ collection, eventId, event, signupDoc }) {
      const signup = signupDoc.data() || {};
      const signupId = signupDoc.id;

      // Filter: confirmed, not archived, has email
      if (signup.status !== "confirmed") { skipped++; return; }
      if (signup.archived === true) { skipped++; return; }
      if (!signup.email) { skipped++; return; }

      // Connect-Gen gate — if the event uses Program Zoom (Connect-Gen and
      // any future programs flagged the same way) and the signed consent
      // has NOT been received, skip reminders. The consent flow handles
      // its own emails (consent-required + prep-docs after signing).
      if (event && event.zoomMode === "program" && !signup.consentSignedAt) {
        skipped++;
        return;
      }

      // Parent Talk Cafe — the confirmation email IS the only reminder.
      if (event && event.zoomMode === "parent_talk_cafe") {
        skipped++;
        return;
      }

      // Candidate session dates: per-signup selections take precedence
      // (covers Learning Labs multi-date + Connect-Gen selectedSessions).
      // Fall back to the event's own eventDate if the signup has none.
      let signupSessionKeys = extractSignupSessionKeys(signup);
      if (signupSessionKeys.length === 0) {
        const key = toHstDateKey((event && (event.eventDate || event.date)) || null);
        if (key) signupSessionKeys = [key];
      }
      const candidateDates = signupSessionKeys.filter((k) => !!targetSet[k]);

      if (candidateDates.length === 0) return; // nothing to do

      const existing = (signup.sessionReminders && typeof signup.sessionReminders === "object")
        ? signup.sessionReminders : {};

      for (const sessionDateKey of candidateDates) {
        const which = targetSet[sessionDateKey]; // "threeDay"
        const mode = which === "threeDay" ? "3day" : null;
        if (!mode) { skipped++; continue; }
        const already = existing[sessionDateKey] && existing[sessionDateKey][which];
        if (already) { skipped++; continue; }

        try {
          const zoomDefault = pickZoomForEvent(zoomDoc, event, collection);
          await sendOneReminderEmail({
            collection, eventId, signupId, signup, event,
            sessionDateKey, mode, zoomDefault,
          });
          // Dedupe write — merge so other session keys + the other flag survive.
          await signupDoc.ref.set({
            sessionReminders: {
              [sessionDateKey]: {
                [which]: admin.firestore.FieldValue.serverTimestamp(),
              },
            },
          }, { merge: true });
          sent3d++;
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

    console.log(`sendEventReminders: 3day sent=${sent3d}, skipped=${skipped}`);
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
        Phone: (808) 536-2280
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
  collection, eventId, signupId, signup, event, sessionDateKey, startHst, zoomDefault, skipBcc, cc,
}) {
  const type = collection === "recurringEvents" ? "recurring" : "event";
  const recipientName = resolveReminderRecipientName(signup);
  const eventTitle = (event && event.title) || "an LDAH Event";
  const startTime = (event && (event.startTime || event.time)) || "";
  const endTime = (event && event.endTime) || "";

  // CRITICAL: per-session virtual/in-person check. Connect-Gen has mixed
  // schedules (Thursdays in-person, other days Zoom) — without this gate,
  // every day-of email shipped a Zoom link including for in-person sessions.
  const isVirtual = isSessionVirtual(event, sessionDateKey, signup);
  const locationLabel = isVirtual ? "" : (getSessionLocationForDate(signup, sessionDateKey) || (event && event.location) || "");

  const zoomUrl = isVirtual && zoomDefault && zoomDefault.meetingUrl ? String(zoomDefault.meetingUrl).trim() : "";
  const meetingId = isVirtual && zoomDefault && zoomDefault.meetingId ? String(zoomDefault.meetingId).trim() : "";
  const passcode = isVirtual && zoomDefault && zoomDefault.passcode ? String(zoomDefault.passcode).trim() : "";

  // Survey URL — must include sessionDate for proper feedback grouping.
  const surveyUrl =
    "https://ldahawaii.org/feedback.html?signupId=" + encodeURIComponent(signupId) +
    "&eventId=" + encodeURIComponent(eventId) +
    "&type=" + encodeURIComponent(type) +
    (sessionDateKey ? "&sessionDate=" + encodeURIComponent(sessionDateKey) : "");

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

// Hourly day-of "just in case" reminder. Cron fires at :30, scans every
// confirmed signup, and emails any whose chosen session starts in the
// next 15-45 minutes (a 30-minute window centered ~30 min before start).
exports.sendDayOfReminders = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1, secrets: EMAIL_SECRETS })
  .pubsub.schedule("30 * * * *")
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

    let sent = 0;
    let skipped = 0;

    async function processSignup({ collection, eventId, event, signupDoc }) {
      const signup = signupDoc.data() || {};
      const signupId = signupDoc.id;

      if (signup.status !== "confirmed") { skipped++; return; }
      if (signup.archived === true) { skipped++; return; }
      if (!signup.email) { skipped++; return; }

      // Connect-Gen consent gate — same logic as sendEventReminders.
      if (event && event.zoomMode === "program" && !signup.consentSignedAt) {
        skipped++;
        return;
      }
      // Parent Talk Cafe — no Zoom reminders.
      if (event && event.zoomMode === "parent_talk_cafe") {
        skipped++;
        return;
      }

      // Map dateKey -> raw entry so we can extract the time per session.
      const sessionMap = buildSignupRawSessionMap(signup);
      let candidateKeys = Object.keys(sessionMap);
      if (candidateKeys.length === 0) {
        const key = toHstDateKey((event && (event.eventDate || event.date)) || null);
        if (key) {
          candidateKeys = [key];
          sessionMap[key] = ""; // forces fallback to event.startTime/event.time
        }
      }

      // Quick narrow: only consider sessions whose date is today HST. The
      // [+15, +45] minute window can never cross a date boundary at :30
      // cron firings except at midnight, where same-day still applies.
      candidateKeys = candidateKeys.filter((k) => k === todayKey);
      if (candidateKeys.length === 0) return;

      const existing = (signup.sessionReminders && typeof signup.sessionReminders === "object")
        ? signup.sessionReminders : {};

      for (const sessionDateKey of candidateKeys) {
        try {
          const startHst = extractSessionStartHst(sessionMap[sessionDateKey] || sessionDateKey, event);
          if (!startHst) { skipped++; continue; }
          const startMs = startHst.getTime();
          if (startMs < windowStartMs || startMs > windowEndMs) { skipped++; continue; }

          if (existing[sessionDateKey] && existing[sessionDateKey].dayOf) { skipped++; continue; }

          const zoomDefault = pickZoomForEvent(zoomDoc, event, collection);
          await sendOneDayOfReminderEmail({
            collection, eventId, signupId, signup, event,
            sessionDateKey, startHst, zoomDefault,
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

    console.log(`sendDayOfReminders: dayof sent=${sent}, skipped=${skipped}`);
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
          sessionDateKey, startHst, zoomDefault,
          skipBcc: skipBcc,
          cc: ccList,
        });
        res.status(200).json({ success: true, id: (result && result.id) || null, to: signup.email, sessionDateKey });
        return;
      }

      const result = await sendOneReminderEmail({
        collection, eventId, signupId, signup, event,
        sessionDateKey, mode, zoomDefault,
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

function buildAnnouncementEmailHtml({ event, contact, unsubscribeUrl, eventId }) {
  const displayName = (contact.displayName || '').trim();
  const firstName = displayName ? displayName.split(/\s+/)[0] : 'Friend';
  const title = event.title || 'Upcoming LDAH Event';
  let dateStr = '';
  if (Array.isArray(event.signupDates) && event.signupDates[0]) dateStr = event.signupDates[0];
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
    if (!token) { res.status(400).json({ error: "Missing token" }); return; }

    try {
      const db = admin.firestore();
      const snap = await db.collection("contacts").where("unsubscribeToken", "==", token).limit(1).get();
      if (snap.empty) { res.status(404).json({ error: "Not found" }); return; }
      const doc = snap.docs[0];
      const c = doc.data() || {};
      res.status(200).json({
        contactId: doc.id,
        firstName: c.firstName || "",
        lastName: c.lastName || "",
        displayName: c.displayName || "",
        email: c.email || "",
        phone: c.phone || "",
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

    const { eventId, collection, testMode, testEmail, dryRun } = req.body || {};
    if (!eventId || !collection) { res.status(400).json({ error: 'Missing eventId or collection' }); return; }
    if (collection !== 'events' && collection !== 'recurringEvents') {
      res.status(400).json({ error: 'Invalid collection' });
      return;
    }

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
          const displayName = (c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ')).trim() || 'Friend';
          recipients.push({ id: d.id, displayName, email, unsubscribeToken: c.unsubscribeToken });
        });
      }

      const recipientColl = eventRef.collection('announcementRecipients');
      const priorSnap = await recipientColl.get();
      const alreadySent = new Set();
      priorSnap.forEach(d => alreadySent.add(d.id));

      // Skip anyone with an active signup for this event — they already
      // know about it. Match by lowercase email; a cancelled or archived
      // signup doesn't count (those folks are fair game to re-engage).
      // Test sends bypass the filter so admins can preview their template.
      const signupEmailSkip = new Set();
      if (!testMode) {
        const signupsSnap = await eventRef.collection('signups').get();
        signupsSnap.forEach(d => {
          const s = d.data() || {};
          if (s.status === 'cancelled' || s.archived === true) return;
          const e = String(s.email || '').trim().toLowerCase();
          if (e) signupEmailSkip.add(e);
        });
      }

      const newRecipients = recipients.filter(r => {
        if (alreadySent.has(r.id)) return false;
        if (signupEmailSkip.has(String(r.email || '').trim().toLowerCase())) return false;
        return true;
      });
      const alreadySignedUp = recipients.filter(r =>
        !alreadySent.has(r.id) &&
        signupEmailSkip.has(String(r.email || '').trim().toLowerCase())
      ).length;

      if (dryRun) {
        res.status(200).json({
          dryRun: true,
          eventTitle: event.title || '(untitled)',
          totalEligible: recipients.length,
          alreadySent: alreadySent.size,
          alreadySignedUp,
          willSendTo: newRecipients.length,
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

      const batch = testMode ? newRecipients : newRecipients.slice(0, remaining);
      const fromAddress = process.env.SMTP_FROM || 'onboarding@resend.dev';
      const unsubscribeBaseUrl = 'https://us-central1-ldah-932d5.cloudfunctions.net/handleUnsubscribe';

      let sent = 0, failed = 0;
      const failures = [];

      for (const r of batch) {
        try {
          const unsubscribeUrl = unsubscribeBaseUrl + '?token=' + encodeURIComponent(r.unsubscribeToken);
          const html = buildAnnouncementEmailHtml({ event, contact: r, unsubscribeUrl, eventId });
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
            await recipientColl.doc(r.id).set({
              email: r.email,
              name: r.displayName,
              sentAt: admin.firestore.FieldValue.serverTimestamp(),
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
        if (!event.announcementSent) {
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
        queued: newRecipients.length - batch.length,
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
    const beforeSet = new Set(beforeCancelled.map(String));
    const newlyCancelledDates = afterCancelled
      .map(String)
      .filter((d) => d && !beforeSet.has(d));

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
      recipients.push({ id: d.id, data: sd, email });
    });

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
      // For each newly cancelled date, email recipients whose selectedDates include it.
      for (const dateStr of newlyCancelledDates) {
        for (const r of recipients) {
          const selected = Array.isArray(r.data.selectedDates) ? r.data.selectedDates.map(String) : [];
          if (selected.indexOf(String(dateStr)) === -1) continue;

          const markerId = r.id + "-session-cancelled-" + String(dateStr).replace(/[^0-9A-Za-z-]/g, "_");
          try {
            const markerSnap = await markerColl.doc(markerId).get();
            if (markerSnap.exists) continue;
          } catch (_) { /* proceed */ }

          const html = buildSessionCancelledEmailHtml({
            name: r.data.name || r.data.displayName || "",
            eventTitle,
            sessionDate: dateStr,
            reason,
          });
          const subject = "Session cancelled on " + dateStr + " — " + eventTitle;

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
              sessionDate: dateStr,
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
  signatureHtml, donateHtml, orgFooterHtml,
}) {
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

  const slidesBlock = slidesDownloadUrl
    ? `<div style="margin:16px 0;padding:16px 18px;background-color:#fff8e8;border-left:4px solid #c79400;border-radius:4px;">
         <p style="margin:0 0 4px;font-size:15px;color:#8a6600;font-weight:bold;">Slides (PDF)</p>
         <p style="margin:0 0 8px;font-size:14px;color:#333333;line-height:1.5;">The slides are attached to this email. You can also download them below:</p>
         ${_emailBtn(slidesDownloadUrl, "Download Slides", { bg: "#c79400", align: "left" })}
         ${slidesFileName ? `<p style="margin:8px 0 0;font-size:12px;color:#6b7280;">File: ${_emailEsc(slidesFileName)}</p>` : ""}
         <p style="margin:6px 0 0;font-size:12px;color:#8a6600;font-style:italic;">Available for two weeks.</p>
       </div>`
    : "";

  const linkFooter = _emailLinkFooter([
    recordingUrl ? { label: "Watch Recording", href: recordingUrl } : null,
    slidesDownloadUrl ? { label: "Download Slides (PDF)", href: slidesDownloadUrl } : null,
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

      // Fetch PDF once and reuse for all recipients
      let pdfBase64 = null;
      if (pdfStoragePath) {
        try { pdfBase64 = await fetchStorageAsBase64(pdfStoragePath); }
        catch (e) { console.warn("Could not fetch PDF for attachment:", e.message); }
      }

      const fromAddress = process.env.SMTP_FROM || "onboarding@resend.dev";
      const from = `LDAH <${fromAddress}>`;
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) { res.status(500).json({ error: "RESEND_API_KEY missing" }); return; }

      let sentAttended = 0, sentNoShow = 0, failed = 0;
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
            slidesDownloadUrl: pdfDownloadUrl || "", slidesFileName: pdfFileName || "",
            signatureHtml, donateHtml, orgFooterHtml,
          });
        } else if (attendeeBodyTemplate) {
          const merged = applyRecipientNameMerge(attendeeBodyTemplate, r.name || "");
          recipHtml = buildRecordingEmailHtml({
            bodyText: merged, eventTitle: eventTitle || "",
            recordingUrl: recordingUrl || "", passcode: passcode || "",
            slidesDownloadUrl: pdfDownloadUrl || "", slidesFileName: pdfFileName || "",
            signatureHtml, donateHtml, orgFooterHtml,
          });
        }
        const recipType = isNoShow ? "event-recording-noshow" : "event-recording";
        if (!recipHtml) { failed++; errors.push(r.email + ": missing html for audience " + audience); continue; }

        const resendBody = { from, to: [r.email], subject: recipSubject, html: recipHtml };
        if (pdfBase64 && pdfFileName) {
          resendBody.attachments = [{ filename: pdfFileName, content: pdfBase64 }];
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
          // Attach extra metadata so Email Log can detect the attachment+expiry
          try {
            const lastSnap = await admin.firestore().collection("emailLog")
              .where("relatedEventId", "==", eventId)
              .where("to", "==", r.email)
              .where("type", "==", recipType)
              .orderBy("sentAt", "desc").limit(1).get();
            if (!lastSnap.empty) {
              await lastSnap.docs[0].ref.update({
                recordingStoragePath: pdfStoragePath || "",
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
          storagePath: pdfStoragePath || "",
          recordingUrl: recordingUrl || "",
        });
        const updates = {};
        if (sentAttended > 0) updates[`recordingEmailSent.${key}.attended`] = stamp(sentAttended);
        if (sentNoShow > 0) updates[`recordingEmailSent.${key}.noShow`] = stamp(sentNoShow);
        if (failed > 0) updates[`recordingEmailSent.${key}.lastFailedCount`] = failed;
        if (Object.keys(updates).length) {
          await evRef.update(updates);
        }
      } catch (e) { console.warn("Failed to stamp event doc recordingEmailSent:", e.message); }

      // Schedule auto-deletion of the PDF 15 days from now
      if (pdfStoragePath) {
        try {
          const expiresAt = new Date(Date.now() + RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1000);
          await admin.firestore().collection("scheduledDeletions").add({
            storagePath: pdfStoragePath,
            expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
            eventId, sessionKey: sessionKey || "_single", eventTitle: eventTitle || "",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            reason: "event-recording-attachment",
          });
        } catch (e) { console.warn("scheduledDeletions write failed:", e.message); }
      }

      res.status(200).json({ success: true, sent, sentAttended, sentNoShow, failed, errors });
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
    '<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.6">Mahalo for signing up for <strong>' + safeTitle + '</strong>' + (safeDates ? ' on <strong>' + safeDates + '</strong>' : '') + '. Before we can confirm your appointment, we need a signed consent form on file.</p>' +
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

function buildConnectGenPrepEmailHtml({ name, eventTitle, datesPhrase, prepDocs, signatureHtml, donateHtml }) {
  const safeName = lifecycleEsc(name || "there");
  const safeTitle = lifecycleEsc(eventTitle || "Connect-Gen");
  const safeDates = lifecycleEsc(datesPhrase || "");

  // Zoom link is intentionally NOT included here — the prep email goes out
  // as soon as consent is signed, which can be weeks before the session.
  // The Zoom link reaches the parent in the 3-day + day-of reminder emails
  // (sendEventReminders + sendDayOfReminders), matching every other event flow.
  const zoomNoteBlock =
    '<div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:14px 18px;margin:16px 0;font-size:.92rem;color:#0C4A6E;line-height:1.5;">' +
      '<strong>Zoom details:</strong> we\'ll send you the Zoom link in our reminder emails — once 3 days before the session and again on the day of the session, so it\'s easy to find when you need it.' +
    '</div>';

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
    '<p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.6">Mahalo for returning your signed consent. Your appointment for <strong>' + safeTitle + '</strong>' + (safeDates ? ' on <strong>' + safeDates + '</strong>' : '') + ' is confirmed.</p>' +
    '<div style="background:#FFFBEB;border:2px solid #F59E0B;border-radius:10px;padding:14px 18px;margin:18px 0;">' +
      '<div style="font-weight:700;color:#92400E;font-size:1rem;margin-bottom:4px;">Important — please bring to the session</div>' +
      '<div style="font-size:.95rem;color:#78350F;line-height:1.5;">Your child\'s most current <strong>IEP</strong> and the <strong>Evaluation that created the IEP</strong>. We won\'t be able to do a meaningful review without both of these on hand.</div>' +
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

        const sessionKeys = extractSignupSessionKeys(s);
        const datesPhrase = formatDatesPhrase(sessionKeys);
        const signatureHtml = await buildSignatureBlock('eventCoordinator');
        const donateHtml = await buildDonateBlock('universal');
        const html = buildConnectGenPrepEmailHtml({
          name: s.name || typedName,
          eventTitle: event.title || "Connect-Gen",
          datesPhrase,
          prepDocs,
          signatureHtml,
          donateHtml,
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
    const storagePath = (body.storagePath || "").toString().trim();
    const originalFilename = (body.originalFilename || "").toString().trim();
    const sizeBytes = Number(body.sizeBytes);
    const mimeType = (body.mimeType || "").toString().trim();

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
        await db.collection("auditLog").add({
          action: "Connect-Gen document uploaded",
          details: documentType + ": " + originalFilename + " (" + sizeBytes + " bytes)",
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
      const application = {
        name,
        type: String(fields.type || "").trim(),
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

exports.sendResourceUpdateNudges = functions
  .runWith({ timeoutSeconds: 540, maxInstances: 1, secrets: EMAIL_SECRETS })
  .pubsub.schedule("0 9 * * *")
  .timeZone("Pacific/Honolulu")
  .onRun(async () => {
    const db = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;
    const fromAddress = lifecycleFromAddress();
    const signatureHtml = await buildSignatureBlock('resourceCoordinator');
    const donateHtml = await buildDonateBlock('universal');
    const resCoord = await getPersona('resourceCoordinator');
    const resourceCoordinatorEmail = resCoord.email;
    const now = Date.now();

    // 7-day gap between touches: initial → nudge1 (day 7) → nudge2 (day 14).
    // 30-day cycle ceiling stops further nudges if the partner never responds.
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const cycleCutoffMs = now - (RESOURCE_UPDATE_RESEND_DAYS * 24 * 60 * 60 * 1000);

    let sent = 0;
    let failed = 0;
    let scanned = 0;

    try {
      const snap = await db.collection("resources").get();
      for (const d of snap.docs) {
        scanned++;
        const r = d.data() || {};
        if (r.archived === true) continue;
        if (!r.updateToken) continue;
        if (r.updateSubmittedAt) continue;
        const email = String(r.email || "").trim();
        if (!email) continue;

        const reqAt = r.updateRequestedAt && r.updateRequestedAt.toMillis ? r.updateRequestedAt.toMillis() : 0;
        if (!reqAt || reqAt <= cycleCutoffMs) continue;

        const nudgeCount = Number(r.updateNudgeCount || 0);
        if (nudgeCount >= 2) continue;

        const lastNudgeAt = r.lastUpdateNudgeAt && r.lastUpdateNudgeAt.toMillis ? r.lastUpdateNudgeAt.toMillis() : 0;
        if (nudgeCount === 0) {
          if ((now - reqAt) < sevenDaysMs) continue;
        } else {
          if (!lastNudgeAt || (now - lastNudgeAt) < sevenDaysMs) continue;
        }

        try {
          const html = buildResourceUpdateEmailHtml({ resource: r, token: r.updateToken, isNudge: true, signatureHtml, donateHtml, resourceCoordinatorEmail });
          await sendEmailViaResend({
            from: fromAddress,
            to: email,
            subject: "Reminder: Update your LDAH Resource Card",
            html,
            type: "resource-update-nudge",
            recipientName: r.name || "",
          });
          await d.ref.update({
            updateNudgeCount: FieldValue.increment(1),
            lastUpdateNudgeAt: FieldValue.serverTimestamp(),
          });
          sent++;
        } catch (err) {
          failed++;
          console.error("sendResourceUpdateNudges failed for " + email + ":", err.message);
        }
      }
    } catch (err) {
      console.error("sendResourceUpdateNudges scan failed:", err.message);
    }

    console.log("sendResourceUpdateNudges: scanned=" + scanned + " sent=" + sent + " failed=" + failed);
    return null;
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

