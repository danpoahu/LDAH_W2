#!/usr/bin/env node
/**
 * Backfill: Enrich contacts with demographics from signup registration data.
 * Finds all signups with registration + linkedContactId where the contact
 * is missing demographics, and copies them over.
 *
 * Usage:
 *   node backfill-contact-demographics.js          # dry run
 *   node backfill-contact-demographics.js --apply   # apply changes
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

const DEMO_FIELDS = [
  'streetAddress', 'city', 'zipCode',
  'militaryStatus', 'militaryBranch',
  'childAgeRange', 'childGender',
  'ethnicity',
  'priorTraining', 'priorTrainingDate',
  'howHeard', 'accommodations'
];

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== APPLYING ===');
  console.log('');

  // Gather all signups with registration data across both collections
  const sources = [
    { collection: 'events', label: 'One-Time Events' },
    { collection: 'recurringEvents', label: 'Ongoing Programs' }
  ];

  let totalEnriched = 0;
  let totalSkipped = 0;

  for (const src of sources) {
    console.log(`--- ${src.label} (${src.collection}) ---`);
    const parentSnap = await db.collection(src.collection).get();

    for (const parentDoc of parentSnap.docs) {
      const signupsSnap = await db.collection(src.collection).doc(parentDoc.id)
        .collection('signups').get();

      for (const signupDoc of signupsSnap.docs) {
        const s = signupDoc.data();
        if (!s.registration || !s.linkedContactId) continue;

        const reg = s.registration;
        const contactRef = db.collection('contacts').doc(s.linkedContactId);
        const contactSnap = await contactRef.get();

        if (!contactSnap.exists) {
          console.log(`  SKIP: ${s.name || signupDoc.id} — contact ${s.linkedContactId} not found`);
          totalSkipped++;
          continue;
        }

        const contact = contactSnap.data();
        const updates = {};

        // Copy demographics that are missing on the contact
        for (const field of DEMO_FIELDS) {
          const regVal = (reg[field] || '').toString().trim();
          const contactVal = (contact[field] || '').toString().trim();
          if (regVal && !contactVal) {
            updates[field] = reg[field];
          }
        }

        // Handle disabilityCategories array
        if (Array.isArray(reg.disabilityCategories) && reg.disabilityCategories.length > 0 &&
            (!Array.isArray(contact.disabilityCategories) || contact.disabilityCategories.length === 0)) {
          updates.disabilityCategories = reg.disabilityCategories;
        }

        // Handle type/role enrichment
        if (reg.role && !contact.type) {
          const validRoles = ['Parent/Guardian', 'Professional', 'Student', 'Community Member'];
          if (validRoles.includes(reg.role)) {
            updates.type = reg.role;
          }
        }

        // Handle location
        if (reg.location && !contact.location) {
          updates.location = reg.location;
        }

        if (Object.keys(updates).length === 0) {
          totalSkipped++;
          continue;
        }

        const parentTitle = parentDoc.data().title || parentDoc.data().name || parentDoc.id;
        console.log(`  ${s.name || signupDoc.id} (${parentTitle})`);
        console.log(`    Contact: ${contact.displayName} (${s.linkedContactId})`);
        for (const [k, v] of Object.entries(updates)) {
          console.log(`    + ${k}: ${JSON.stringify(v)}`);
        }

        if (!DRY_RUN) {
          await contactRef.update(updates);
          console.log(`    UPDATED`);
        }
        totalEnriched++;
      }
    }
  }

  console.log(`\n--- SUMMARY ---`);
  console.log(`Enriched: ${totalEnriched}`);
  console.log(`Skipped (no updates needed): ${totalSkipped}`);

  if (DRY_RUN && totalEnriched > 0) {
    console.log(`\nDRY RUN — no changes made. Run with --apply to write.`);
  }

  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
