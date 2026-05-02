#!/usr/bin/env node
/**
 * Backfill: Canonicalize demographic schema across contacts + signups.
 *
 * Background: see /Volumes/Xcode_Projects/Reports/signup-demographics-audit-2026-05-02.html
 * and feedback_demographic-schema-canonical.md for the canonical schema decisions.
 *
 * What this script does:
 *   1. Iterate every contacts/{id} doc:
 *      - For each child in contacts.children[], rename childAgeRange → ageRange
 *        and childGender → gender (only if canonical key not already set).
 *      - Canonicalize child.ageRange values (strip "yrs", map "Beyond H.S." → "Adult", etc.)
 *      - Normalize top-level militaryStatus ('none' → 'Not military', 'active' → 'Active Duty')
 *      - Normalize top-level militaryBranch ('Marines' → 'Marine Corps')
 *      - Stamp demographicsCanonicalizedAt: serverTimestamp() (idempotent — skip
 *        already-stamped docs unless --force is passed).
 *   2. Iterate events/{id}/signups/{sid} and recurringEvents/{id}/signups/{sid}:
 *      - Normalize registration.militaryStatus + registration.militaryBranch
 *      - Canonicalize registration.childAgeRange value
 *      - Stamp demographicsCanonicalizedAt
 *
 * Usage:
 *   node backfill-demographics-canonical.js                # DRY RUN (default)
 *   node backfill-demographics-canonical.js --apply        # actually write
 *   node backfill-demographics-canonical.js --apply --force # re-process already-stamped docs
 *
 * Run from /Volumes/Xcode_Projects/React/LDAH_W2/functions/
 */

const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');

admin.initializeApp({
  credential: applicationDefault(),
  projectId: 'ldah-932d5'
});
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');

// ── Canonicalization helpers ────────────────────────────────────────────────
function canonMilitaryStatus(v) {
  if (!v) return v;
  const s = String(v).trim();
  const lc = s.toLowerCase();
  if (lc === 'none' || lc === 'not military' || lc === 'not military affiliated') return 'Not military';
  if (lc === 'active' || lc === 'active duty' || lc === 'active duty/military family') return 'Active Duty';
  if (lc === 'veteran') return 'Veteran';
  if (lc === 'reserves') return 'Reserves';
  return s;
}

function canonMilitaryBranch(v) {
  if (!v) return v;
  const s = String(v).trim();
  if (s === 'Marines') return 'Marine Corps';
  return s;
}

function canonAgeRange(v) {
  if (!v) return v;
  const s = String(v).trim();
  const map = {
    'Birth-2 yrs': '0-2', 'Birth-2': '0-2',
    '3-5 yrs': '3-5',
    '6-11 yrs': '6-12', '6-11': '6-12',
    '12-14 yrs': '13-17', '12-14': '13-17',
    '15-18 yrs': '13-17', '15-18': '13-17',
    'Beyond H.S.': 'Adult', 'Beyond HS': 'Adult'
  };
  return map[s] || s;
}

// ── Per-doc transformer ─────────────────────────────────────────────────────
function buildContactUpdates(c) {
  const updates = {};
  let changed = false;

  // children[] — rename childAgeRange/childGender → ageRange/gender, canonicalize age value
  if (Array.isArray(c.children) && c.children.length) {
    let childrenChanged = false;
    const newChildren = c.children.map((ch) => {
      if (!ch || typeof ch !== 'object') return ch;
      const newCh = { ...ch };
      // ageRange rename + canonicalization
      if (newCh.childAgeRange != null && newCh.ageRange == null) {
        newCh.ageRange = canonAgeRange(newCh.childAgeRange);
        delete newCh.childAgeRange;
        childrenChanged = true;
      } else if (newCh.ageRange != null) {
        const canon = canonAgeRange(newCh.ageRange);
        if (canon !== newCh.ageRange) { newCh.ageRange = canon; childrenChanged = true; }
      }
      // gender rename
      if (newCh.childGender != null && newCh.gender == null) {
        newCh.gender = newCh.childGender;
        delete newCh.childGender;
        childrenChanged = true;
      }
      return newCh;
    });
    if (childrenChanged) {
      updates.children = newChildren;
      changed = true;
    }
  }

  // Top-level militaryStatus
  if (c.militaryStatus) {
    const canon = canonMilitaryStatus(c.militaryStatus);
    if (canon !== c.militaryStatus) {
      updates.militaryStatus = canon;
      changed = true;
    }
  }

  // Top-level militaryBranch
  if (c.militaryBranch) {
    const canon = canonMilitaryBranch(c.militaryBranch);
    if (canon !== c.militaryBranch) {
      updates.militaryBranch = canon;
      changed = true;
    }
  }

  // Top-level childAgeRange (legacy single-child storage)
  if (c.childAgeRange) {
    const canon = canonAgeRange(c.childAgeRange);
    if (canon !== c.childAgeRange) {
      updates.childAgeRange = canon;
      changed = true;
    }
  }

  return changed ? updates : null;
}

function buildSignupUpdates(s) {
  if (!s.registration) return null;
  const reg = s.registration;
  // Read-modify-write the whole registration map to avoid Firestore dotted-path
  // gotchas (see feedback_firestore-attribute-gotchas.md). Cheaper to be safe.
  const newReg = { ...reg };
  let changed = false;

  if (reg.militaryStatus) {
    const canon = canonMilitaryStatus(reg.militaryStatus);
    if (canon !== reg.militaryStatus) { newReg.militaryStatus = canon; changed = true; }
  }
  if (reg.militaryBranch) {
    const canon = canonMilitaryBranch(reg.militaryBranch);
    if (canon !== reg.militaryBranch) { newReg.militaryBranch = canon; changed = true; }
  }
  if (reg.childAgeRange) {
    const canon = canonAgeRange(reg.childAgeRange);
    if (canon !== reg.childAgeRange) { newReg.childAgeRange = canon; changed = true; }
  }

  return changed ? { registration: newReg } : null;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`=== Demographics Canonicalization Backfill ===`);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}${FORCE ? ' (FORCE)' : ''}`);
  console.log('');

  let contactsScanned = 0;
  let contactsToChange = 0;
  let contactsSkippedAlreadyStamped = 0;
  let signupsScanned = 0;
  let signupsToChange = 0;
  let signupsSkippedAlreadyStamped = 0;

  const sampleChanges = [];
  const SAMPLE_LIMIT = 30;

  // ── Contacts ──
  console.log('--- Scanning contacts ---');
  const contactsSnap = await db.collection('contacts').get();
  for (const doc of contactsSnap.docs) {
    contactsScanned++;
    const c = doc.data();
    if (!FORCE && c.demographicsCanonicalizedAt) {
      contactsSkippedAlreadyStamped++;
      continue;
    }
    const updates = buildContactUpdates(c);
    if (!updates) continue;

    contactsToChange++;
    if (sampleChanges.length < SAMPLE_LIMIT) {
      sampleChanges.push({
        kind: 'contact',
        id: doc.id,
        name: c.displayName || `${c.firstName || ''} ${c.lastName || ''}`.trim(),
        updates
      });
    }

    if (APPLY) {
      updates.demographicsCanonicalizedAt = admin.firestore.FieldValue.serverTimestamp();
      await doc.ref.update(updates);
    }
  }

  // ── Signups (both event collections) ──
  for (const collection of ['events', 'recurringEvents']) {
    console.log(`--- Scanning ${collection} signups ---`);
    const parentSnap = await db.collection(collection).get();
    for (const parentDoc of parentSnap.docs) {
      const sigSnap = await parentDoc.ref.collection('signups').get();
      for (const sigDoc of sigSnap.docs) {
        signupsScanned++;
        const s = sigDoc.data();
        if (!FORCE && s.demographicsCanonicalizedAt) {
          signupsSkippedAlreadyStamped++;
          continue;
        }
        const updates = buildSignupUpdates(s);
        if (!updates) continue;

        signupsToChange++;
        if (sampleChanges.length < SAMPLE_LIMIT) {
          sampleChanges.push({
            kind: 'signup',
            collection,
            parent: parentDoc.id,
            id: sigDoc.id,
            name: s.name || s.email || sigDoc.id,
            updates
          });
        }

        if (APPLY) {
          updates.demographicsCanonicalizedAt = admin.firestore.FieldValue.serverTimestamp();
          await sigDoc.ref.update(updates);
        }
      }
    }
  }

  // ── Report ──
  console.log('');
  console.log('=== SAMPLE CHANGES ===');
  if (sampleChanges.length === 0) {
    console.log('(none — nothing to canonicalize)');
  } else {
    sampleChanges.forEach((ch) => {
      const path = ch.kind === 'contact'
        ? `contacts/${ch.id}`
        : `${ch.collection}/${ch.parent}/signups/${ch.id}`;
      console.log(`\n${path} — ${ch.name}`);
      Object.entries(ch.updates).forEach(([k, v]) => {
        console.log(`  ${k} → ${JSON.stringify(v)}`);
      });
    });
    if ((contactsToChange + signupsToChange) > sampleChanges.length) {
      console.log(`\n... and ${(contactsToChange + signupsToChange) - sampleChanges.length} more.`);
    }
  }

  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`Contacts scanned:                ${contactsScanned}`);
  console.log(`  - need canonicalization:       ${contactsToChange}`);
  console.log(`  - skipped (already stamped):   ${contactsSkippedAlreadyStamped}`);
  console.log(`Signups scanned:                 ${signupsScanned}`);
  console.log(`  - need canonicalization:       ${signupsToChange}`);
  console.log(`  - skipped (already stamped):   ${signupsSkippedAlreadyStamped}`);
  console.log('');

  if (!APPLY) {
    console.log('DRY RUN — no changes made. Re-run with --apply to write.');
  } else {
    console.log(`APPLIED — updated ${contactsToChange + signupsToChange} document(s).`);
  }
  process.exit(0);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
