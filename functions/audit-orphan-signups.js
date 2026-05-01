#!/usr/bin/env node
/**
 * READ-ONLY — audit every event's signups for the Roxanne pattern:
 *   - status === 'pending'
 *   - selectedDates empty or doesn't match the event's current signupDates
 *   - same event has a CONFIRMED sibling for the same email/contactId
 *   - pending was created AFTER the confirmed (indicating accidental duplicate)
 *
 * Output: HTML report at /Volumes/Xcode_Projects/Reports/orphan-signups-audit.html
 */
const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');
const fs = require('fs');
admin.initializeApp({ credential: applicationDefault(), projectId: 'ldah-932d5' });
const db = admin.firestore();

function fmt(ts) {
  if (!ts) return '';
  if (ts._seconds !== undefined) return new Date(ts._seconds * 1000).toISOString();
  if (ts.toDate) return ts.toDate().toISOString();
  return String(ts);
}
function ms(ts) {
  if (!ts) return 0;
  if (ts._seconds !== undefined) return ts._seconds * 1000;
  if (ts.toDate) return ts.toDate().getTime();
  return 0;
}
function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

(async () => {
  const allOrphans = [];   // pending with empty/mismatched dates
  const siblingDuplicates = []; // orphans that have a confirmed sibling
  const uiOrphans = [];    // matches the UI's orphan banner (mismatched dates)
  const emptyDates = [];   // pending with truly empty selectedDates

  let totalEvents = 0, totalSignups = 0, totalPending = 0;

  for (const col of ['events', 'recurringEvents']) {
    const evts = await db.collection(col).get();
    for (const e of evts.docs) {
      totalEvents++;
      const eData = e.data();
      const eventSignupDates = eData.signupDates || [];
      const eventDateSet = new Set(eventSignupDates.map(d => String(d).trim()));

      const signupsSnap = await e.ref.collection('signups').get();
      const signups = signupsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      totalSignups += signups.length;

      // Group by email (lowercased) to find siblings within this event
      const byEmail = {};
      signups.forEach(s => {
        const key = (s.email || '').trim().toLowerCase();
        if (!key) return;
        (byEmail[key] = byEmail[key] || []).push(s);
      });

      for (const s of signups) {
        if (s.status !== 'pending') continue;
        // Include archived so we can see historical occurrences
        totalPending++;

        const sel = Array.isArray(s.selectedDates) ? s.selectedDates : [];
        const hasEmpty = sel.length === 0;
        const hasMismatch = sel.length > 0 && sel.every(d => !eventDateSet.has(String(d).trim()));

        if (!hasEmpty && !hasMismatch) continue; // not orphan-shaped

        const orphan = {
          collection: col,
          eventId: e.id,
          eventTitle: eData.title,
          eventDates: eventSignupDates,
          signupId: s.id,
          name: s.name || '',
          email: s.email || '',
          status: s.status,
          archived: s.archived === true,
          selectedDates: sel,
          linkedContactId: s.linkedContactId || '',
          timestamp: fmt(s.timestamp),
          _timestampMs: ms(s.timestamp),
          shape: hasEmpty ? 'empty-dates' : 'mismatched-dates',
          siblingConfirmedId: '',
          siblingConfirmedAt: '',
          secondsAfterSibling: '',
        };

        if (hasEmpty) emptyDates.push(orphan);
        if (hasMismatch) uiOrphans.push(orphan);
        allOrphans.push(orphan);

        // Check for sibling confirmed in same event (same email)
        const emailKey = (s.email || '').trim().toLowerCase();
        if (emailKey && byEmail[emailKey]) {
          const sibs = byEmail[emailKey].filter(x => x.id !== s.id && x.status === 'confirmed');
          if (sibs.length > 0) {
            // Find the closest-in-time confirmed sibling
            let closest = null;
            let closestDelta = Infinity;
            sibs.forEach(sib => {
              const sibMs = ms(sib.registrationCompletedAt || sib.timestamp);
              const delta = ms(s.timestamp) - sibMs;
              if (delta > 0 && delta < closestDelta) {
                closestDelta = delta;
                closest = sib;
              }
            });
            if (closest) {
              orphan.siblingConfirmedId = closest.id;
              orphan.siblingConfirmedAt = fmt(closest.registrationCompletedAt || closest.timestamp);
              orphan.secondsAfterSibling = Math.round(closestDelta / 1000);
              siblingDuplicates.push(orphan);
            }
          }
        }
      }
    }
  }

  console.log('=== AUDIT SUMMARY ===');
  console.log('Events scanned:', totalEvents);
  console.log('Total signups:', totalSignups);
  console.log('Pending signups:', totalPending);
  console.log('Total orphan-shaped pending signups:', allOrphans.length);
  console.log('  - empty selectedDates:', emptyDates.length);
  console.log('  - mismatched selectedDates (UI banner):', uiOrphans.length);
  console.log('Orphans with a CONFIRMED sibling in same event (the bug pattern):', siblingDuplicates.length);
  console.log('');
  console.log('=== SIBLING DUPLICATES (strongest bug signal) ===');
  siblingDuplicates
    .sort((a, b) => a.secondsAfterSibling - b.secondsAfterSibling)
    .slice(0, 50)
    .forEach(o => {
      console.log(`[${o.secondsAfterSibling}s after sibling]  ${o.name}  <${o.email}>  event="${o.eventTitle}"  signupId=${o.signupId}  shape=${o.shape}`);
    });

  // Generate HTML report
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Orphan Signups Audit — 2026-04-22</title>
<style>
  body { font-family: -apple-system, sans-serif; padding: 24px; max-width: 1400px; margin: 0 auto; color: #1f2937; }
  h1 { border-bottom: 3px solid #0891B2; padding-bottom: 8px; }
  h2 { margin-top: 32px; color: #0891B2; }
  .summary { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; margin: 16px 0; }
  .summary-num { font-size: 2rem; font-weight: 800; color: #0891B2; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; font-size: 0.88rem; }
  th { background: #f3f4f6; font-weight: 700; }
  .bug-signal { background: #fef3c7; }
  .empty-dates { color: #b91c1c; font-weight: 700; }
  code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 0.82rem; }
  .narrow { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style></head>
<body>
  <h1>Orphan Signups Audit</h1>
  <p>Generated ${new Date().toISOString()} — scanned <strong>${totalEvents}</strong> events with <strong>${totalSignups}</strong> signups.</p>

  <div class="summary">
    <div><span class="summary-num">${allOrphans.length}</span> orphan-shaped pending signups total</div>
    <div style="margin-top:6px;color:#64748b;font-size:.9rem;">
      ${emptyDates.length} with empty selectedDates · ${uiOrphans.length} with mismatched selectedDates
    </div>
    <div style="margin-top:12px;">
      <span class="summary-num" style="color:#b91c1c;">${siblingDuplicates.length}</span>
      of those also have a <strong>CONFIRMED sibling for the same email in the same event</strong> — these are the strongest "accidental duplicate" signal.
    </div>
  </div>

  <h2>Sibling Duplicates (bug signal — ${siblingDuplicates.length})</h2>
  <p>Pending orphan created AFTER a confirmed sibling completed — these are the ones that look like a registration flow bug.</p>
  <table>
    <thead><tr>
      <th>Seconds after</th><th>Name</th><th>Email</th><th>Event</th><th>Shape</th>
      <th>Orphan timestamp</th><th>Sibling completed</th><th>Orphan ID</th><th>Sibling ID</th>
    </tr></thead>
    <tbody>
      ${siblingDuplicates.sort((a,b) => a.secondsAfterSibling - b.secondsAfterSibling).map(o => `
        <tr class="bug-signal">
          <td>${o.secondsAfterSibling}s</td>
          <td>${esc(o.name)}</td>
          <td>${esc(o.email)}</td>
          <td class="narrow" title="${esc(o.eventTitle)}">${esc(o.eventTitle)}</td>
          <td class="${o.shape === 'empty-dates' ? 'empty-dates' : ''}">${o.shape}</td>
          <td>${o.timestamp}</td>
          <td>${o.siblingConfirmedAt}</td>
          <td><code>${o.signupId}</code></td>
          <td><code>${o.siblingConfirmedId}</code></td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <h2>All Orphan-Shaped Pending Signups (${allOrphans.length})</h2>
  <table>
    <thead><tr>
      <th>Name</th><th>Email</th><th>Event</th><th>Shape</th><th>Selected</th><th>Event's Dates</th><th>Timestamp</th><th>Signup ID</th><th>Sibling?</th>
    </tr></thead>
    <tbody>
      ${allOrphans.sort((a,b) => (b._timestampMs || 0) - (a._timestampMs || 0)).map(o => `
        <tr ${o.siblingConfirmedId ? 'class="bug-signal"' : ''}>
          <td>${esc(o.name)}</td>
          <td>${esc(o.email)}</td>
          <td class="narrow" title="${esc(o.eventTitle)}">${esc(o.eventTitle)}</td>
          <td class="${o.shape === 'empty-dates' ? 'empty-dates' : ''}">${o.shape}</td>
          <td>${esc(JSON.stringify(o.selectedDates))}</td>
          <td class="narrow">${esc(JSON.stringify(o.eventDates))}</td>
          <td>${o.timestamp}</td>
          <td><code>${o.signupId}</code></td>
          <td>${o.siblingConfirmedId ? '⚠ ' + o.secondsAfterSibling + 's' : ''}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
</body></html>`;

  const reportPath = '/Volumes/Xcode_Projects/Reports/orphan-signups-audit.html';
  fs.writeFileSync(reportPath, html);
  console.log('\nHTML report written to:', reportPath);

  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
