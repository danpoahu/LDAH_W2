const functions = require("firebase-functions");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");
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
 * Build the registration email HTML.
 */
function buildRegistrationEmailHtml({ name, eventTitle, eventDate, signupId, eventId, type }) {
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

      <!-- CTA Button -->
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
        <tr>
          <td align="center" style="background-color:#1a73e8;border-radius:6px;">
            <a href="${registrationUrl}"
               target="_blank"
               style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;">
              Complete Registration
            </a>
          </td>
        </tr>
      </table>

      <p style="margin:0 0 16px;font-size:15px;color:#555555;line-height:1.5;">
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
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background-color:#f0f0f0;padding:24px 32px;text-align:center;border-top:1px solid #dddddd;">
      <p style="margin:0 0 4px;font-size:13px;color:#777777;font-weight:bold;">
        Leadership in Disabilities &amp; Achievement of Hawai'i
      </p>
      <p style="margin:0 0 4px;font-size:12px;color:#999999;">
        245 N. Kukui St., Suite 205, Honolulu, HI 96817
      </p>
      <p style="margin:0 0 4px;font-size:12px;color:#999999;">
        Phone: (808) 536-2280
      </p>
      <p style="margin:0;font-size:12px;color:#999999;">
        Email: <a href="mailto:rrowe@ldahawaii.org" style="color:#999999;">rrowe@ldahawaii.org</a>
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

  // Only send email for pending signups
  if (signupData.status !== "pending") {
    console.log(`Signup ${signupId} status is "${signupData.status}", skipping email.`);
    return null;
  }

  // Must have an email address
  const recipientEmail = signupData.email;
  if (!recipientEmail) {
    console.log(`Signup ${signupId} has no email, skipping.`);
    return null;
  }

  const signupName = signupData.name || signupData.firstName || "there";

  // Fetch the parent event for title and date
  let eventTitle = "an LDAH Event";
  let eventDate = "";
  try {
    const eventDoc = await admin.firestore()
      .collection(collectionName)
      .doc(eventId)
      .get();
    if (eventDoc.exists) {
      const eventData = eventDoc.data();
      eventTitle = eventData.title || eventTitle;
      const picked = Array.isArray(signupData.selectedDates) && signupData.selectedDates[0];
      eventDate = picked || formatEventDate(eventData.eventDate || eventData.date);
    }
  } catch (err) {
    console.error(`Error reading ${collectionName}/${eventId}:`, err.message);
  }

  // Derive the type string for register.html ("event" or "recurring")
  const type = collectionName === "recurringEvents" ? "recurring" : "event";

  // Build and send the email
  const htmlBody = buildRegistrationEmailHtml({
    name: signupName,
    eventTitle,
    eventDate,
    signupId,
    eventId,
    type,
  });

  const fromAddress = process.env.SMTP_FROM || "onboarding@resend.dev";

  try {
    await sendEmailViaResend({
      from: `LDAH <${fromAddress}>`,
      to: recipientEmail,
      subject: `Complete Your Registration -- ${eventTitle}`,
      html: htmlBody,
      type: "registration",
      relatedEventId: eventId,
      relatedSignupId: signupId,
      recipientName: signupName,
    });
    console.log(`Registration email sent to ${recipientEmail} for signup ${signupId}`);
    await snap.ref.update({
      registrationEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error(`Failed to send registration email to ${recipientEmail}:`, err.message);
    await snap.ref.update({
      registrationEmailError: err.message,
    });
  }

  return null;
}

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

      const htmlBody = buildRegistrationEmailHtml({
        name: signupName, eventTitle, eventDate, signupId, eventId, type,
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
      const regVal = (registration[field] || "").trim();
      const contactVal = (contactData[field] || "").trim();
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
    try {
      const childEntry = {};
      if (registration.childAgeRange) childEntry.ageRange = registration.childAgeRange;
      if (registration.childGender) childEntry.gender = registration.childGender;
      if (registration.ethnicity) childEntry.ethnicity = registration.ethnicity;
      if (Array.isArray(registration.disabilityCategories) && registration.disabilityCategories.length) {
        childEntry.disabilityCategories = registration.disabilityCategories;
      }

      if (Object.keys(childEntry).length > 0) {
        childEntry.addedAt = admin.firestore.FieldValue.serverTimestamp();
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
      maybeSendFeedbackEmailOnAttendance(change, context, "events"),
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
      maybeSendFeedbackEmailOnAttendance(change, context, "recurringEvents"),
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
function buildNoShowEmailHtml({ name, eventTitle, nextEventTitle, nextEventDate, nextEventUrl }) {
  const nextEventSection = nextEventTitle
    ? `<p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">
        We'd love to see you at our next workshop: <strong>${nextEventTitle}</strong> on ${nextEventDate}.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
        <tr>
          <td align="center" style="background-color:#1a73e8;border-radius:6px;">
            <a href="${nextEventUrl}"
               target="_blank"
               style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;">
              Sign Up
            </a>
          </td>
        </tr>
      </table>`
    : `<p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">
        Check out our upcoming events at
        <a href="https://ldahawaii.org/events.html" style="color:#1a73e8;text-decoration:underline;">ldahawaii.org/events.html</a>
      </p>`;

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
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background-color:#f0f0f0;padding:24px 32px;text-align:center;border-top:1px solid #dddddd;">
      <p style="margin:0 0 4px;font-size:13px;color:#777777;font-weight:bold;">
        Leadership in Disabilities &amp; Achievement of Hawai'i
      </p>
      <p style="margin:0 0 4px;font-size:12px;color:#999999;">
        245 N. Kukui St., Suite 205, Honolulu, HI 96817
      </p>
      <p style="margin:0 0 4px;font-size:12px;color:#999999;">
        Phone: (808) 536-2280
      </p>
      <p style="margin:0;font-size:12px;color:#999999;">
        Email: <a href="mailto:rrowe@ldahawaii.org" style="color:#999999;">rrowe@ldahawaii.org</a>
      </p>
    </td>
  </tr>

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

      for (const signup of noShows) {
        const name = signup.name || signup.firstName || "there";
        const htmlBody = buildNoShowEmailHtml({
          name,
          eventTitle,
          nextEventTitle: nextEventTitle || "",
          nextEventDate: nextEventDate || "",
          nextEventUrl,
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
function buildFeedbackEmailHtml({ name, eventTitle, feedbackUrl, mode }) {
  const isReminder = mode === "reminder";
  const intro = isReminder
    ? `Just a quick reminder — we would still love your feedback on <strong>${eventTitle}</strong> if you have a moment. Your input helps us continue to improve our programs.`
    : `Mahalo for attending <strong>${eventTitle}</strong>! We would love to hear your thoughts so we can continue to improve our programs.`;
  return _buildFeedbackEmailHtmlInner({ name, eventTitle, feedbackUrl, intro });
}
function _buildFeedbackEmailHtmlInner({ name, eventTitle, feedbackUrl, intro }) {
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

      <!-- CTA Button -->
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
        <tr>
          <td align="center" style="background-color:#004E7C;border-radius:6px;">
            <a href="${feedbackUrl}"
               target="_blank"
               style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;">
              Share Your Feedback
            </a>
          </td>
        </tr>
      </table>

      <p style="margin:0 0 0;font-size:15px;color:#555555;line-height:1.5;">
        Your feedback helps us improve our services and better support families
        and children with disabilities throughout Hawai'i.
      </p>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background-color:#f0f0f0;padding:24px 32px;text-align:center;border-top:1px solid #dddddd;">
      <p style="margin:0 0 4px;font-size:13px;color:#777777;font-weight:bold;">
        Leadership in Disabilities &amp; Achievement of Hawai'i
      </p>
      <p style="margin:0 0 4px;font-size:12px;color:#999999;">
        245 N. Kukui St., Suite 205, Honolulu, HI 96817
      </p>
      <p style="margin:0 0 4px;font-size:12px;color:#999999;">
        Phone: (808) 536-2280
      </p>
      <p style="margin:0;font-size:12px;color:#999999;">
        Email: <a href="mailto:rrowe@ldahawaii.org" style="color:#999999;">rrowe@ldahawaii.org</a>
      </p>
    </td>
  </tr>

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

        const htmlBody = buildFeedbackEmailHtml({ name, eventTitle, feedbackUrl });

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
  const html = buildFeedbackEmailHtml({ name, eventTitle, feedbackUrl, mode });
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
          const matchedIds = new Set();
          for (const dateStr of sigDates) {
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
            });
          }
          // Surface any signups that don't match a current signupDates entry
          // (legacy/orphaned) so they're still visible in the daily report.
          // Skip cancelled/archived — they'd show as "0 active" and just clutter.
          const orphans = signups.filter((su) => !matchedIds.has(su.id) && su.status !== "cancelled" && su.archived !== true);
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
        rows += `<tr style="border-bottom:1px solid #eee;">`
          + `<td style="padding:5px 8px;font-size:12px;font-weight:600;">${esc(su.name || "Unknown")}</td>`
          + `<td style="padding:5px 8px;font-size:12px;">${esc(su.email || "--")}</td>`
          + `<td style="padding:5px 8px;font-size:12px;">${esc(su.phone || "--")}</td>`
          + `<td style="padding:5px 8px;font-size:12px;"><span style="color:${stColor};font-weight:700;">${stLabel}</span></td>`
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
    // BUILD FULL HTML EMAIL
    // ═══════════════════════════════════════════════════
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
  <tr>
    <td style="background-color:#f0f0f0;padding:20px 28px;text-align:center;border-top:1px solid #dddddd;">
      <p style="margin:0 0 3px;font-size:12px;color:#777777;font-weight:bold;">
        Leadership in Disabilities &amp; Achievement of Hawai'i
      </p>
      <p style="margin:0 0 3px;font-size:11px;color:#999999;">
        245 N. Kukui St., Suite 205, Honolulu, HI 96817 | (808) 536-2280
      </p>
      <p style="margin:0;font-size:11px;color:#999999;">
        Email: <a href="mailto:rrowe@ldahawaii.org" style="color:#999999;">rrowe@ldahawaii.org</a>
      </p>
    </td>
  </tr>

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

const REMINDER_BCC = "LKailiawa@ldahawaii.org";

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
    ? `<div style="margin:16px 0;padding:16px;background-color:#f4f8fc;border-left:4px solid #1a3c6e;border-radius:4px;">
         <p style="margin:0 0 6px;font-size:15px;color:#1a3c6e;font-weight:bold;">Join Zoom Meeting</p>
         <p style="margin:0 0 10px;font-size:15px;color:#333333;word-break:break-all;">
           <a href="${zoomUrl}" target="_blank" style="color:#1a73e8;text-decoration:none;">${zoomUrl}</a>
         </p>
         ${meetingId ? `<p style="margin:0;font-size:14px;color:#333333;">Meeting ID: <strong>${meetingId}</strong></p>` : ""}
         ${passcode ? `<p style="margin:4px 0 0;font-size:14px;color:#333333;">Passcode: <strong>${passcode}</strong></p>` : ""}
       </div>`
    : "";

  const locationBlock = (!virt && locLbl)
    ? `<div style="margin:16px 0;padding:16px;background-color:#f4f8fc;border-left:4px solid #1a3c6e;border-radius:4px;">
         <p style="margin:0 0 6px;font-size:15px;color:#1a3c6e;font-weight:bold;">In-Person Location</p>
         <p style="margin:0;font-size:15px;color:#333333;">${locLbl}</p>
       </div>`
    : "";

  const surveyBlock = `<div style="margin:16px 0;padding:16px;background-color:#fff8e8;border-left:4px solid #c79400;border-radius:4px;">
      <p style="margin:0 0 6px;font-size:15px;color:#8a6600;font-weight:bold;">Evaluation Survey Link</p>
      <p style="margin:0;font-size:15px;color:#333333;word-break:break-all;">
        <a href="${surveyUrl}" target="_blank" style="color:#1a73e8;text-decoration:none;">${surveyUrl}</a>
      </p>
    </div>`;

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

      <p style="margin:16px 0 2px;font-size:14px;color:#555555;line-height:1.5;">
        <strong>Leilani Kailiawa</strong><br>
        Parent Consultant<br>
        Leadership in Disabilities &amp; Achievement of Hawai'i<br>
        245 N. Kukui St. Ste. 205, Honolulu, HI 96817<br>
        Phone: (808) 536-9684 ext 112<br>
        <a href="https://www.ldahawaii.org" style="color:#1a73e8;text-decoration:none;">LDAHawaii.org</a>
      </p>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background-color:#f0f0f0;padding:24px 32px;text-align:center;border-top:1px solid #dddddd;">
      <p style="margin:0 0 4px;font-size:13px;color:#777777;font-weight:bold;">
        Leadership in Disabilities &amp; Achievement of Hawai'i
      </p>
      <p style="margin:0 0 4px;font-size:12px;color:#999999;">
        245 N. Kukui St., Suite 205, Honolulu, HI 96817
      </p>
      <p style="margin:0 0 4px;font-size:12px;color:#999999;">
        Phone: (808) 536-2280
      </p>
      <p style="margin:0;font-size:12px;color:#999999;">
        Email: <a href="mailto:rrowe@ldahawaii.org" style="color:#999999;">rrowe@ldahawaii.org</a>
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
  const isVirtual = isSessionVirtual(event, sessionDateKey, signup);
  const zoomUrl = isVirtual && zoomDefault && zoomDefault.meetingUrl ? String(zoomDefault.meetingUrl).trim() : "";
  const meetingId = isVirtual && zoomDefault && zoomDefault.meetingId ? String(zoomDefault.meetingId).trim() : "";
  const passcode = isVirtual && zoomDefault && zoomDefault.passcode ? String(zoomDefault.passcode).trim() : "";
  const locationLabel = isVirtual ? "" : getSessionLocationForDate(signup, sessionDateKey);

  const surveyUrl =
    "https://ldahawaii.org/feedback.html?signupId=" + encodeURIComponent(signupId) +
    "&eventId=" + encodeURIComponent(eventId) +
    "&type=" + encodeURIComponent(type);

  const html = buildEventReminderEmailHtml({
    recipientName, eventTitle, dayName, dateFormatted: formatted,
    startTime, endTime, isVirtual, zoomUrl, meetingId, passcode,
    locationLabel, surveyUrl, mode,
  });

  const subject = mode === "1day"
    ? `Tomorrow: ${eventTitle} -- ${formatted}`
    : `Reminder: ${eventTitle} -- ${dayName}, ${formatted}`;

  const fromAddress = process.env.SMTP_FROM || "onboarding@resend.dev";
  const emailType = mode === "1day" ? "event-reminder-1day" : "event-reminder-5day";

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
 * next 5 days. For each one that does and hasn't already received a
 * 5-day reminder, send one immediately. This handles late registrants
 * who would otherwise miss the 5-day window entirely.
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
    const zoomDefault = zoomSnap.exists ? (zoomSnap.data() || null) : null;

    // Determine candidate session dates within [today, today+5] HST.
    const todayKey = toHstDateKey(new Date());
    const windowKeys = {};
    for (let d = 0; d <= 5; d++) {
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
      if (existing[sessionDateKey] && existing[sessionDateKey].fiveDay) continue;
      try {
        await sendOneReminderEmail({
          collection, eventId, signupId,
          signup: after, event,
          sessionDateKey, mode: "5day", zoomDefault,
        });
        await change.after.ref.set({
          sessionReminders: {
            [sessionDateKey]: {
              fiveDay: admin.firestore.FieldValue.serverTimestamp(),
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

    // 1. Load zoom defaults (gracefully handle missing doc)
    let zoomDefault = null;
    try {
      const zSnap = await db.collection("settings").doc("zoomDefault").get();
      if (zSnap.exists) zoomDefault = zSnap.data() || null;
    } catch (err) {
      console.warn("sendEventReminders: failed to read settings/zoomDefault:", err.message);
    }

    // 2. Compute target dates in HST
    const now = new Date();
    const todayKey = toHstDateKey(now);
    const target5d = addDaysHst(todayKey, 5);
    const target1d = addDaysHst(todayKey, 1);
    const targetSet = {};
    targetSet[target5d] = "fiveDay";
    targetSet[target1d] = "oneDay";

    console.log(`sendEventReminders: today=${todayKey} target5d=${target5d} target1d=${target1d}`);

    let sent5d = 0;
    let sent1d = 0;
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
        const which = targetSet[sessionDateKey]; // "fiveDay" | "oneDay"
        const mode = which === "oneDay" ? "1day" : "5day";
        const already = existing[sessionDateKey] && existing[sessionDateKey][which];
        if (already) { skipped++; continue; }

        try {
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
          if (mode === "1day") sent1d++; else sent5d++;
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
        // the primary eventDate isn't in the 5/1-day target window.
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

    console.log(`sendEventReminders: 5day sent=${sent5d}, 1day sent=${sent1d}, skipped=${skipped}`);
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
    if (mode !== "5day" && mode !== "1day") {
      res.status(400).json({ error: "mode must be '5day' or '1day'" });
      return;
    }

    try {
      const db = admin.firestore();

      // Load zoom defaults
      let zoomDefault = null;
      try {
        const zSnap = await db.collection("settings").doc("zoomDefault").get();
        if (zSnap.exists) zoomDefault = zSnap.data() || null;
      } catch (_) { /* swallow */ }

      // Load event + signup
      const eventDoc = await db.collection(collection).doc(eventId).get();
      if (!eventDoc.exists) { res.status(404).json({ error: "Event not found" }); return; }
      const event = eventDoc.data() || {};

      const signupDoc = await db.collection(collection).doc(eventId).collection("signups").doc(signupId).get();
      if (!signupDoc.exists) { res.status(404).json({ error: "Signup not found" }); return; }
      const signup = signupDoc.data() || {};
      if (!signup.email) { res.status(400).json({ error: "Signup has no email" }); return; }

      // Pick a session date for the subject/body.
      let sessionDateKey = "";
      if (collection === "recurringEvents") {
        const dates = Array.isArray(signup.selectedDates) ? signup.selectedDates : [];
        if (dates.length > 0) sessionDateKey = toHstDateKey(dates[0]);
      } else {
        sessionDateKey = toHstDateKey(event.eventDate || event.date);
      }
      if (!sessionDateKey) {
        // Fallback: use today+1 or today+5 in HST so the email still renders sensibly
        const todayKey = toHstDateKey(new Date());
        sessionDateKey = addDaysHst(todayKey, mode === "1day" ? 1 : 5);
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
