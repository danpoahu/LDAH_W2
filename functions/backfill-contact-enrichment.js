#!/usr/bin/env node
// Retroactive contact enrichment — replays the handleSignupUpdated logic
// for every confirmed signup whose linkedContactId points to a contact
// that's missing demographics. Needed because before commit (today
// 2026-05-02 fix), the enrichment was silently failing on every signup
// that built a child entry, due to FieldValue.serverTimestamp() being
// rejected inside an array element.
//
// Default: --dry-run. Pass --apply to write.
const admin = require('firebase-admin');
const { applicationDefault } = require('firebase-admin/app');
admin.initializeApp({ credential: applicationDefault(), projectId: 'ldah-932d5' });
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');

function _canonMilStatus(v) {
  if (!v) return ''; const s = String(v).trim(); const lc = s.toLowerCase();
  if (lc === 'none' || lc === 'not military' || lc === 'not military affiliated') return 'Not military';
  if (lc === 'active' || lc === 'active duty' || lc === 'active duty/military family') return 'Active Duty';
  if (lc === 'veteran') return 'Veteran';
  if (lc === 'reserves') return 'Reserves';
  return s;
}
function _canonMilBranch(v) {
  if (!v) return ''; const s = String(v).trim();
  if (s === 'Marines') return 'Marine Corps';
  return s;
}
function _canonAgeRange(v) {
  if (!v) return ''; const s = String(v).trim();
  const map = {
    'Birth-2 yrs': '0-2', 'Birth-2': '0-2', '0-2': '0-2',
    '3-5 yrs': '3-5', '3-5': '3-5',
    '6-11 yrs': '6-12', '6-11': '6-12', '6-12': '6-12',
    '12-14 yrs': '13-17', '12-14': '13-17', '15-18 yrs': '13-17', '15-18': '13-17', '13-17': '13-17',
    'Beyond H.S.': 'Adult', 'Beyond HS': 'Adult', 'Adult': 'Adult',
    'High School': 'High School',
  };
  return map[s] || s;
}

async function enrichOne(signupRef, signup, signupId) {
  const linkedContactId = signup.linkedContactId;
  const registration = signup.registration;
  if (signup.status !== 'confirmed') return { skipped: 'not confirmed' };
  if (!linkedContactId) return { skipped: 'no linkedContactId' };
  if (!registration) return { skipped: 'no registration' };

  const contactRef = db.collection('contacts').doc(linkedContactId);
  const contactSnap = await contactRef.get();
  if (!contactSnap.exists) return { skipped: 'contact missing' };
  const contactData = contactSnap.data() || {};
  const updates = {};

  if (!contactData.location || !contactData.location.trim()) {
    const city = (registration.city || '').trim();
    const zip = (registration.zipCode || '').trim();
    if (city || zip) updates.location = city && zip ? city + ', ' + zip : city || zip;
  }
  if (!contactData.type || !contactData.type.trim()) {
    const role = (registration.role || '').trim();
    if (['Parent/Guardian', 'Professional', 'Student', 'Community Member'].includes(role)) {
      updates.type = role;
    }
  }
  const stringFields = [
    'streetAddress', 'city', 'zipCode',
    'militaryStatus', 'militaryBranch',
    'childAgeRange', 'childGender',
    'ethnicity',
    'priorTraining', 'priorTrainingDate',
    'howHeard', 'accommodations',
  ];
  stringFields.forEach((f) => {
    let regVal = (registration[f] || '').trim();
    const cVal = (contactData[f] || '').trim();
    if (f === 'militaryStatus') regVal = _canonMilStatus(regVal);
    if (f === 'militaryBranch') regVal = _canonMilBranch(regVal);
    if (regVal && !cVal) updates[f] = regVal;
  });
  if (Array.isArray(registration.disabilityCategories) && registration.disabilityCategories.length > 0 &&
      (!Array.isArray(contactData.disabilityCategories) || contactData.disabilityCategories.length === 0)) {
    updates.disabilityCategories = registration.disabilityCategories;
  }

  // Build child entry — Timestamp.now() (NOT serverTimestamp, which throws inside arrays)
  const childEntry = {};
  if (registration.childAgeRange) childEntry.ageRange = _canonAgeRange(registration.childAgeRange);
  if (registration.childGender) childEntry.gender = registration.childGender;
  if (registration.ethnicity) childEntry.ethnicity = registration.ethnicity;
  if (Array.isArray(registration.disabilityCategories) && registration.disabilityCategories.length) {
    childEntry.disabilityCategories = registration.disabilityCategories;
  }
  if (Object.keys(childEntry).length > 0) {
    childEntry.addedAt = admin.firestore.Timestamp.now();
    childEntry.sourceSignupId = signupId;
    const existingChildren = contactData.children || [];
    const alreadyAdded = existingChildren.some(c => c.sourceSignupId === signupId);
    if (!alreadyAdded) {
      existingChildren.push(childEntry);
      updates.children = existingChildren;
    }
  }

  if (Object.keys(updates).length === 0) return { skipped: 'nothing to enrich' };

  if (APPLY) {
    updates.enrichedAt = admin.firestore.FieldValue.serverTimestamp();
    updates.enrichedFrom = 'registration-backfill';
    await contactRef.update(updates);
    return { applied: Object.keys(updates) };
  }
  return { wouldApply: Object.keys(updates) };
}

(async () => {
  const cols = ['events', 'recurringEvents'];
  let total = 0, enriched = 0, skipped = 0;
  for (const col of cols) {
    const evs = await db.collection(col).get();
    for (const ev of evs.docs) {
      const sigs = await db.collection(col).doc(ev.id).collection('signups').get();
      for (const s of sigs.docs) {
        total++;
        const r = await enrichOne(s.ref, s.data() || {}, s.id);
        if (r.applied || r.wouldApply) {
          enriched++;
          const x = (s.data() || {});
          console.log((APPLY ? 'APPLIED' : 'WOULD APPLY'), col + '/' + ev.id + '/' + s.id,
            '|', x.name || x.email || '(no name)',
            '| keys:', (r.applied || r.wouldApply).join(', '));
        } else {
          skipped++;
        }
      }
    }
  }
  console.log('\nTotal signups scanned:', total);
  console.log('Would enrich / enriched:', enriched);
  console.log('Skipped:', skipped);
  if (!APPLY) console.log('\nRe-run with --apply to write.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
