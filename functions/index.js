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
 * Send an email via Resend HTTP API.
 */
async function sendEmailViaResend({ from, to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY secret is not set");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error("Resend API error (" + response.status + "): " + errorBody);
  }

  return response.json();
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
    <td style="background-color:#1a3c6e;padding:24px 32px;text-align:center;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:0.5px;">
        Leadership in Disabilities &amp; Achievement of Hawai'i
      </h1>
      <p style="margin:4px 0 0;color:#b0c4de;font-size:13px;">LDAH</p>
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
        Email: <a href="mailto:info@ldahawaii.org" style="color:#999999;">info@ldahawaii.org</a>
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
      eventDate = formatEventDate(eventData.date || eventData.startDate || eventData.eventDate);
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
          eventDate = formatEventDate(eventData.date || eventData.startDate || eventData.eventDate);
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

    // Only act when status transitions to "confirmed"
    if (before.status === "confirmed" || after.status !== "confirmed") return null;

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
  .runWith({ timeoutSeconds: 30, maxInstances: 10 })
  .firestore.document("events/{eventId}/signups/{signupId}")
  .onUpdate(async (change, context) => {
    return handleSignupUpdated(change, context);
  });

exports.onRecurringEventSignupUpdated = functions
  .runWith({ timeoutSeconds: 30, maxInstances: 10 })
  .firestore.document("recurringEvents/{eventId}/signups/{signupId}")
  .onUpdate(async (change, context) => {
    return handleSignupUpdated(change, context);
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
    <td style="background-color:#1a3c6e;padding:24px 32px;text-align:center;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:0.5px;">
        Leadership in Disabilities &amp; Achievement of Hawai'i
      </h1>
      <p style="margin:4px 0 0;color:#b0c4de;font-size:13px;">LDAH</p>
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
        Email: <a href="mailto:info@ldahawaii.org" style="color:#999999;">info@ldahawaii.org</a>
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
function buildFeedbackEmailHtml({ name, eventTitle, feedbackUrl }) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">

  <!-- Header -->
  <tr>
    <td style="background-color:#1a3c6e;padding:24px 32px;text-align:center;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:0.5px;">
        Leadership in Disabilities &amp; Achievement of Hawai'i
      </h1>
      <p style="margin:4px 0 0;color:#b0c4de;font-size:13px;">LDAH</p>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="padding:32px;">
      <p style="margin:0 0 16px;font-size:16px;color:#333333;">Aloha ${name},</p>

      <p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.5;">
        Mahalo for attending <strong>${eventTitle}</strong>!
        We would love to hear your thoughts so we can continue to improve our programs.
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
        Email: <a href="mailto:info@ldahawaii.org" style="color:#999999;">info@ldahawaii.org</a>
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

        // Only send to attendees who attended
        if (data.attendanceStatus !== "attended") {
          skipped++;
          continue;
        }

        // Must have email
        if (!data.email) {
          skipped++;
          continue;
        }

        // Skip if already sent
        if (data.feedbackEmailSentAt) {
          skipped++;
          continue;
        }

        // If sessionDate filter provided, check signup has that date
        if (sessionDate && data.selectedDates && Array.isArray(data.selectedDates)) {
          if (!data.selectedDates.includes(sessionDate)) {
            skipped++;
            continue;
          }
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
          });

          await doc.ref.update({
            feedbackEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
          });
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
