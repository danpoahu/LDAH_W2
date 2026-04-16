#!/usr/bin/env node
/**
 * Migration: Extract structured demographics from connect-gen signup
 * additionalComments text and save as proper fields.
 *
 * Usage:
 *   node migrate-connect-gen-demographics.js          # dry run (read-only)
 *   node migrate-connect-gen-demographics.js --apply   # apply changes
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

const DRY_RUN = !process.argv.includes('--apply');

/**
 * Parse the additionalComments text blob into structured fields.
 * Format:
 *   Reason: [text]
 *   Child age: [text]
 *   Child gender: [text]
 *   Ethnicity: [text]
 *   Disability: [text]
 *   Attended LDAH before: Yes (last: [date])
 *   Active military: [branch or Yes]
 *   Heard about us: [source] — [specify]
 */
function parseComments(text) {
  if (!text) return {};

  const result = {};
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('Reason:')) {
      result.reasonForAttending = trimmed.slice('Reason:'.length).trim();
    } else if (trimmed.startsWith('Child age:')) {
      result.childAgeRange = trimmed.slice('Child age:'.length).trim();
    } else if (trimmed.startsWith('Child gender:')) {
      result.childGender = trimmed.slice('Child gender:'.length).trim();
    } else if (trimmed.startsWith('Ethnicity:')) {
      result.ethnicity = trimmed.slice('Ethnicity:'.length).trim();
    } else if (trimmed.startsWith('Disability:')) {
      const val = trimmed.slice('Disability:'.length).trim();
      if (val) result.disabilityCategories = val.split(',').map(s => s.trim()).filter(Boolean);
    } else if (trimmed.startsWith('Attended LDAH before:')) {
      result.priorTraining = 'Yes';
      const lastMatch = trimmed.match(/\(last:\s*(.+?)\)/);
      if (lastMatch) result.priorTrainingDate = lastMatch[1].trim();
    } else if (trimmed.startsWith('Active military:')) {
      const val = trimmed.slice('Active military:'.length).trim();
      result.militaryStatus = 'Yes';
      if (val && val !== 'Yes') result.militaryBranch = val;
    } else if (trimmed.startsWith('Heard about us:')) {
      result.howHeard = trimmed.slice('Heard about us:'.length).trim();
    }
  }

  return result;
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN (read-only) ===' : '=== APPLYING CHANGES ===');
  console.log('');

  // Step 1: Find Connect-Gen program
  console.log('Step 1: Finding Connect-Gen program...');
  const recSnap = await db.collection('recurringEvents').get();
  let connectGenId = null;
  let connectGenTitle = null;

  recSnap.forEach(doc => {
    const title = doc.data().title || '';
    if (title.toLowerCase().includes('connect') || title.toLowerCase().includes('small group')) {
      connectGenId = doc.id;
      connectGenTitle = title;
    }
  });

  if (!connectGenId) {
    console.error('Could not find Connect-Gen program. Available:');
    recSnap.forEach(doc => console.error('  - ' + (doc.data().title || '(no title)') + ' (' + doc.id + ')'));
    process.exit(1);
  }
  console.log('  Found: "' + connectGenTitle + '" (ID: ' + connectGenId + ')');

  // Step 2: Read all signups
  console.log('\nStep 2: Reading signups...');
  const signupsSnap = await db.collection('recurringEvents').doc(connectGenId).collection('signups').get();
  console.log('  Total signups: ' + signupsSnap.size);

  // Step 3: Filter to google-form-import with additionalComments
  const candidates = [];
  signupsSnap.forEach(doc => {
    const data = doc.data();
    if (data.source !== 'google-form-import') return;

    // Skip if already has structured fields (already migrated)
    if (data.childAgeRange || data.childGender || data.ethnicity) {
      console.log('  SKIP (already has demographics): ' + (data.name || doc.id));
      return;
    }

    if (!data.additionalComments || !data.additionalComments.includes(':')) {
      console.log('  SKIP (no parseable comments): ' + (data.name || doc.id));
      return;
    }

    candidates.push({ id: doc.id, data });
  });

  console.log('  Candidates needing migration: ' + candidates.length);
  if (candidates.length === 0) {
    console.log('\nNothing to migrate.');
    process.exit(0);
  }

  // Step 4: Parse and show what will be updated
  console.log('\nStep 3: Parsing demographics from additionalComments...\n');

  const updates = [];
  for (const { id, data } of candidates) {
    const parsed = parseComments(data.additionalComments);

    console.log('  ' + data.name + ' (' + (data.email || 'no email') + ') — doc: ' + id);
    console.log('    Raw comments: "' + data.additionalComments.replace(/\n/g, ' | ') + '"');

    if (Object.keys(parsed).length === 0) {
      console.log('    -> No demographics found in comments, skipping');
      continue;
    }

    // Build the fields to update
    const fields = {};
    if (parsed.childAgeRange) fields.childAgeRange = parsed.childAgeRange;
    if (parsed.childGender) fields.childGender = parsed.childGender;
    if (parsed.ethnicity) fields.ethnicity = parsed.ethnicity;
    if (parsed.disabilityCategories) fields.disabilityCategories = parsed.disabilityCategories;
    if (parsed.priorTraining) fields.priorTraining = parsed.priorTraining;
    if (parsed.priorTrainingDate) fields.priorTrainingDate = parsed.priorTrainingDate;
    if (parsed.militaryStatus) fields.militaryStatus = parsed.militaryStatus;
    if (parsed.militaryBranch) fields.militaryBranch = parsed.militaryBranch;
    if (parsed.howHeard) fields.howHeard = parsed.howHeard;

    // Replace the text blob with just the reason (if any)
    fields.additionalComments = parsed.reasonForAttending || '';

    console.log('    -> Will set: ' + Object.keys(fields).filter(k => fields[k]).join(', '));
    for (const [k, v] of Object.entries(fields)) {
      if (v) console.log('       ' + k + ': ' + JSON.stringify(v));
    }

    updates.push({ docId: id, name: data.name, fields });
  }

  console.log('\n--- SUMMARY ---');
  console.log('Total to update: ' + updates.length);

  if (DRY_RUN) {
    console.log('\nThis was a DRY RUN. No changes were made.');
    console.log('Run with --apply to write changes to Firestore.');
    process.exit(0);
  }

  // Step 5: Apply updates
  console.log('\nStep 4: Applying updates...');
  let success = 0;
  let failed = 0;

  for (const update of updates) {
    try {
      const docRef = db.collection('recurringEvents').doc(connectGenId).collection('signups').doc(update.docId);
      await docRef.update(update.fields);
      console.log('  OK: ' + update.name);
      success++;
    } catch (err) {
      console.error('  FAIL: ' + update.name + ' — ' + err.message);
      failed++;
    }
  }

  console.log('\n--- RESULTS ---');
  console.log('Success: ' + success);
  console.log('Failed: ' + failed);

  if (failed > 0) {
    console.log('\nSome updates failed. Review errors above.');
    process.exit(1);
  }

  console.log('\nMigration complete! Demographics are now in structured fields.');
  console.log('The Cloud Function enrichment will pick up these fields when');
  console.log('contacts are next updated, or you can trigger it manually.');
  process.exit(0);
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
