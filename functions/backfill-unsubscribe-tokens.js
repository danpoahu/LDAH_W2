#!/usr/bin/env node
/**
 * Backfill unsubscribeToken + marketingOptOut:false on every contact.
 * Dry-run by default. Pass --write to actually commit.
 *
 * Idempotent: skips contacts that already have a token.
 */
const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');
const crypto = require('crypto');
const fs = require('fs');

const WRITE = process.argv.includes('--write');

admin.initializeApp({ credential: applicationDefault(), projectId: 'ldah-932d5' });
const db = admin.firestore();

(async () => {
  console.log('=== Unsubscribe Token Backfill ===');
  console.log('Mode:', WRITE ? 'WRITE (real)' : 'DRY-RUN (no writes)');

  const snap = await db.collection('contacts').get();

  const plan = [];
  snap.forEach(d => {
    const c = d.data();
    const hasToken = typeof c.unsubscribeToken === 'string' && c.unsubscribeToken.length > 10;
    const hasFlag = c.marketingOptOut === true || c.marketingOptOut === false;
    const needsToken = !hasToken;
    const needsFlag = !hasFlag;

    plan.push({
      id: d.id,
      name: c.displayName || ((c.firstName || '') + ' ' + (c.lastName || '')).trim() || '(no name)',
      email: c.email || '(no email)',
      hasToken, hasFlag, needsToken, needsFlag,
    });
  });

  const wouldUpdate = plan.filter(p => p.needsToken || p.needsFlag);
  console.log('Total contacts:', plan.length);
  console.log('Already have token:', plan.filter(p => p.hasToken).length);
  console.log('Already have marketingOptOut flag:', plan.filter(p => p.hasFlag).length);
  console.log('Would update:', wouldUpdate.length);
  console.log('');

  wouldUpdate.slice(0, 50).forEach(p => {
    console.log(`  ${p.id}  ${p.name.padEnd(30)}  ${p.email}  ${p.needsToken ? '+token' : ''} ${p.needsFlag ? '+flag' : ''}`);
  });
  if (wouldUpdate.length > 50) console.log(`  ... and ${wouldUpdate.length - 50} more`);

  // Write a report
  const reportPath = '/Volumes/Xcode_Projects/Reports/unsubscribe-token-backfill-' + (WRITE ? 'applied' : 'dry-run') + '.html';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribe Token Backfill</title>
<style>body{font-family:-apple-system,sans-serif;padding:24px;max-width:1200px;margin:0 auto}
h1{border-bottom:3px solid #0891B2;padding-bottom:8px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;font-size:.88rem}
th{background:#f3f4f6}.yes{color:#15803d}.no{color:#94a3b8}
.summary{background:#f0f9ff;border:1px solid #bae6fd;padding:16px;border-radius:8px;margin:16px 0}
</style></head><body>
<h1>Unsubscribe Token Backfill — ${WRITE ? 'APPLIED' : 'DRY-RUN'}</h1>
<p>Generated ${new Date().toISOString()}</p>
<div class="summary">
  <strong>${plan.length}</strong> contacts total · <strong>${wouldUpdate.length}</strong> would be updated ·
  <strong>${plan.length - wouldUpdate.length}</strong> already have tokens + flags
</div>
<table><thead><tr><th>Contact ID</th><th>Name</th><th>Email</th><th>Has Token</th><th>Has Flag</th><th>Action</th></tr></thead><tbody>
${plan.map(p => `<tr>
<td><code>${p.id}</code></td><td>${p.name}</td><td>${p.email}</td>
<td class="${p.hasToken?'yes':'no'}">${p.hasToken ? 'yes' : 'no'}</td>
<td class="${p.hasFlag?'yes':'no'}">${p.hasFlag ? 'yes' : 'no'}</td>
<td>${p.needsToken || p.needsFlag ? 'UPDATE' : 'skip'}</td>
</tr>`).join('')}
</tbody></table></body></html>`;
  fs.writeFileSync(reportPath, html);
  console.log('\nReport written to:', reportPath);

  if (!WRITE) {
    console.log('\nDry-run only — no DB changes. Re-run with --write to apply.');
    process.exit(0);
  }

  // Real write
  console.log('\nApplying updates...');
  let done = 0, failed = 0;
  for (const p of wouldUpdate) {
    try {
      const updates = {};
      if (p.needsToken) updates.unsubscribeToken = crypto.randomBytes(16).toString('hex');
      if (p.needsFlag) updates.marketingOptOut = false;
      await db.collection('contacts').doc(p.id).update(updates);
      done++;
    } catch (err) {
      console.error(`  Failed ${p.id}:`, err.message);
      failed++;
    }
  }
  console.log(`\nDone. Updated: ${done}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
