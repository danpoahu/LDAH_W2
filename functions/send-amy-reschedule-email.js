#!/usr/bin/env node
/**
 * One-off: fire the F-1 reschedule email for Amy Shimabukuro retroactively.
 * She was moved 2026-04-27 → 2026-05-04 in Connect-Gen before the
 * trigger-fix went live, so the email was never sent.
 *
 * Usage:
 *   node send-amy-reschedule-email.js          # dry run, prints what would send
 *   node send-amy-reschedule-email.js --send   # actually POST to Resend + write marker
 */

const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');
const { execSync } = require('child_process');

const SEND = process.argv.includes('--send');
const COLLECTION = 'recurringEvents';
const EVENT_ID = 'CmkPXEpPwfAQ5sR377K2';
const SIGNUP_ID = 'LjR7djH3zdDDQS6Hxt4O';

admin.initializeApp({ credential: applicationDefault(), projectId: 'ldah-932d5' });
const db = admin.firestore();

// ── helpers copied from functions/index.js (kept in sync manually) ──
function lifecycleEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function lifecycleFirstName(nameLike) {
  const s = String(nameLike || '').trim();
  if (!s) return 'Friend';
  return s.split(/\s+/)[0];
}

function lifecycleFormatSessionEntry(s) {
  const str = String(s == null ? '' : s).trim();
  if (!str || str.indexOf('|') === -1) return str;
  const parts = str.split('|').map((p) => p.trim());
  const datePart = parts[0] || '';
  const locPart = parts[1] || '';
  const timePart = parts[2] || '';
  let nice = datePart;
  const m = datePart.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    if (!isNaN(d.getTime())) nice = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  let out = nice;
  if (timePart) out += ' — ' + timePart;
  if (locPart) out += ' @ ' + locPart;
  return out;
}

function lifecycleFormatDateList(dates) {
  if (!dates) return '';
  if (Array.isArray(dates)) return dates.filter(Boolean).map(lifecycleFormatSessionEntry).join(', ');
  return lifecycleFormatSessionEntry(dates);
}

function buildRescheduleHtml({ name, eventTitle, oldDates, newDates }) {
  const firstName = lifecycleFirstName(name);
  const title = lifecycleEsc(eventTitle || 'your LDAH event');
  const oldStr = lifecycleEsc(lifecycleFormatDateList(oldDates));
  const newStr = lifecycleEsc(lifecycleFormatDateList(newDates));
  const heading = 'Your session dates have changed';
  const headerLabel = 'Schedule Update';
  const headerGradient = 'linear-gradient(135deg,#1e40af,#0891B2)';
  const bodyHtml =
    '<p style="margin:0 0 12px;font-size:16px;color:#334155;line-height:1.6">' +
      'A heads up about <strong>' + title + '</strong>:' +
    '</p>' +
    (oldStr ? '<p style="margin:0 0 8px;font-size:15px;color:#475569"><strong>Previously scheduled:</strong> ' + oldStr + '</p>' : '') +
    (newStr ? '<p style="margin:0 0 16px;font-size:15px;color:#475569"><strong>Now scheduled:</strong> ' + newStr + '</p>' : '') +
    '<p style="margin:0 0 16px;font-size:15px;color:#475569;line-height:1.6">' +
      'No action needed on your end — we just wanted to keep you in the loop. Mahalo.' +
    '</p>';
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + lifecycleEsc(heading) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1f2937">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff">' +
    '<div style="background:' + headerGradient + ';padding:24px;text-align:center;color:#fff">' +
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

(async () => {
  const ref = db.collection(COLLECTION).doc(EVENT_ID).collection('signups').doc(SIGNUP_ID);
  const snap = await ref.get();
  if (!snap.exists) { console.error('Signup not found.'); process.exit(1); }
  const s = snap.data();
  const evSnap = await db.collection(COLLECTION).doc(EVENT_ID).get();
  const eventTitle = (evSnap.exists && evSnap.data().title) || 'Connect-Gen';

  const notes = String(s.adminNotes || '');
  const m = notes.match(/Rescheduled from (.+?) to (.+?) \(/);
  if (!m) { console.error('Could not parse old/new dates from adminNotes.'); console.error('adminNotes:', notes); process.exit(1); }
  const oldKey = m[1];
  const newKey = m[2];
  const toEmail = String(s.email || '').trim();
  if (!toEmail) { console.error('Signup has no email.'); process.exit(1); }

  const subject = 'Your session dates have changed — ' + eventTitle;
  const html = buildRescheduleHtml({
    name: s.name || s.displayName || '',
    eventTitle,
    oldDates: [oldKey],
    newDates: [newKey],
  });

  console.log('To:        ', toEmail);
  console.log('Name:      ', s.name);
  console.log('Subject:   ', subject);
  console.log('Old:       ', lifecycleFormatSessionEntry(oldKey));
  console.log('New:       ', lifecycleFormatSessionEntry(newKey));
  console.log('Marker now:', s.lifecycleEmail_reschedule_lastKey || '(none)');
  const afterKey = JSON.stringify((s.selectedSessions || []).slice().sort());
  console.log('afterKey:  ', afterKey);

  if (!SEND) {
    console.log('\n(dry run — re-run with --send to actually send and write marker)');
    process.exit(0);
  }

  const apiKey = execSync('firebase functions:secrets:access RESEND_API_KEY --project ldah-932d5', { encoding: 'utf8' }).trim();
  if (!apiKey) { console.error('Could not read RESEND_API_KEY.'); process.exit(1); }

  const fromAddr = 'LDAH <registration@ldahawaii.org>';
  const body = { from: fromAddr, to: [toEmail], subject, html };

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errBody = await resp.text();
    console.error('Resend error:', resp.status, errBody);
    await db.collection('emailLog').add({
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      from: fromAddr, to: toEmail, bcc: '', subject, html,
      type: 'signup-reschedule', relatedEventId: EVENT_ID, relatedSignupId: SIGNUP_ID,
      recipientName: s.name || '', success: false, error: 'Resend ' + resp.status + ': ' + errBody, resendId: null,
    });
    process.exit(1);
  }
  const result = await resp.json();
  console.log('Resend OK, id:', result.id);

  await db.collection('emailLog').add({
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    from: fromAddr, to: toEmail, bcc: '', subject, html,
    type: 'signup-reschedule', relatedEventId: EVENT_ID, relatedSignupId: SIGNUP_ID,
    recipientName: s.name || '', success: true, error: null, resendId: result.id || null,
  });

  await ref.set({
    lifecycleEmail_reschedule_lastKey: afterKey,
    lifecycleEmail_reschedule_sentAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log('Marker written. Done.');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
