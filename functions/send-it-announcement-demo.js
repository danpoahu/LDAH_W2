#!/usr/bin/env node
// One-off: send the May Learning Labs announcement to Daniel's
// "Information Technology" contact using the production template
// (with real unsubscribeToken so the Sign Up link actually pre-fills
// when clicked). Logs to emailLog like every other production send so
// Daniel can resend / forward it to staff later.

const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');
const { execSync } = require('child_process');

const EVENT_ID = 'm3fOhXTTKYQ1AiXQoxOd'; // Learning Labs: Understanding Evaluations / Developing the IEP
const CONTACT_ID = 'jKw2MNvcQDfXPWFxnetF'; // Information Technology

admin.initializeApp({ credential: applicationDefault(), projectId: 'ldah-932d5' });
const db = admin.firestore();

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function formatEventDate(v) {
  if (!v) return '';
  const d = (v.toDate && typeof v.toDate === 'function') ? v.toDate()
          : (v.seconds ? new Date(v.seconds * 1000) : new Date(v));
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function buildHtml({ event, contact, eventId }) {
  const displayName = (contact.displayName || '').trim();
  const firstName = displayName ? displayName.split(/\s+/)[0] : 'Friend';
  const title = event.title || 'Upcoming LDAH Event';
  let dateStr = '';
  if (Array.isArray(event.signupDates) && event.signupDates[0]) dateStr = event.signupDates[0];
  else if (event.eventDate) dateStr = formatEventDate(event.eventDate);
  const location = event.location || '';
  const raw = event.description || event.details || '';
  const descTrim = raw.slice(0, 400);
  const descMore = raw.length > 400 ? '...' : '';
  const flyerUrl = event.flyerUrl || event.imageUrl || event.flyer || '';
  const signupUrl = 'https://www.ldahawaii.org/events.html'
    + '?eventId=' + encodeURIComponent(eventId)
    + '&prefill=' + encodeURIComponent(contact.unsubscribeToken || '')
    + '&autoOpen=1';
  const unsubscribeUrl = 'https://us-central1-ldah-932d5.cloudfunctions.net/handleUnsubscribe?token=' + encodeURIComponent(contact.unsubscribeToken || '');

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title></head>'
    + '<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1f2937">'
    + '<div style="max-width:600px;margin:0 auto;background:#fff">'
    + '<div style="background:linear-gradient(135deg,#004E7C,#0891B2);padding:24px;text-align:center;color:#fff">'
    + '<h1 style="margin:0;font-size:22px;font-weight:700">New LDAH Event</h1></div>'
    + (flyerUrl ? '<img src="' + esc(flyerUrl) + '" alt="' + esc(title) + '" style="width:100%;display:block">' : '')
    + '<div style="padding:32px 24px">'
    + '<p style="margin:0 0 16px;font-size:16px">Aloha ' + esc(firstName) + ',</p>'
    + '<h2 style="margin:0 0 12px;color:#004E7C;font-size:24px">' + esc(title) + '</h2>'
    + (dateStr ? '<p style="margin:0 0 8px;color:#475569"><strong>When:</strong> ' + esc(dateStr) + '</p>' : '')
    + (location ? '<p style="margin:0 0 16px;color:#475569"><strong>Where:</strong> ' + esc(location) + '</p>' : '')
    + (descTrim ? '<p style="margin:0 0 24px;color:#334155;line-height:1.6">' + esc(descTrim) + esc(descMore) + '</p>' : '')
    + '<p style="text-align:center;margin:32px 0">'
    + '<a href="' + signupUrl + '" style="background:linear-gradient(135deg,#0891B2,#0E7490);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">Sign Up</a>'
    + '</p></div>'
    + '<div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;font-size:12px;color:#94a3b8;text-align:center">'
    + '<p style="margin:0 0 8px">Leadership in Disabilities and Achievement of Hawai\'i</p>'
    + '<p style="margin:0">You received this because you are in our contact list. <a href="' + unsubscribeUrl + '" style="color:#0891B2">Unsubscribe</a> from future announcements.</p>'
    + '</div></div></body></html>';
}

(async () => {
  const evSnap = await db.collection('events').doc(EVENT_ID).get();
  if (!evSnap.exists) { console.error('Event not found'); process.exit(1); }
  const ctSnap = await db.collection('contacts').doc(CONTACT_ID).get();
  if (!ctSnap.exists) { console.error('Contact not found'); process.exit(1); }

  const event = evSnap.data();
  const contact = ctSnap.data();
  const html = buildHtml({ event, contact, eventId: EVENT_ID });
  const subject = 'New Event: ' + (event.title || 'Upcoming LDAH Event');

  console.log('To:        ', contact.email);
  console.log('Subject:   ', subject);
  console.log('Token:     ', contact.unsubscribeToken);

  const apiKey = execSync('firebase functions:secrets:access RESEND_API_KEY --project ldah-932d5', { encoding: 'utf8' }).trim();
  if (!apiKey) { console.error('Could not read RESEND_API_KEY'); process.exit(1); }
  const fromAddr = 'LDAH <registration@ldahawaii.org>';

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromAddr, to: [contact.email], subject, html }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error('Resend error:', resp.status, errText);
    await db.collection('emailLog').add({
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      from: fromAddr, to: contact.email, bcc: '', subject, html,
      type: 'event-announcement', relatedEventId: EVENT_ID, relatedSignupId: '',
      recipientName: contact.displayName || '', success: false, error: 'Resend ' + resp.status + ': ' + errText, resendId: null,
    });
    process.exit(1);
  }
  const result = await resp.json();
  console.log('Resend OK, id:', result.id);

  await db.collection('emailLog').add({
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    from: fromAddr, to: contact.email, bcc: '', subject, html,
    type: 'event-announcement', relatedEventId: EVENT_ID, relatedSignupId: '',
    recipientName: contact.displayName || '', success: true, error: null, resendId: result.id || null,
  });
  console.log('Logged to emailLog. Done.');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
