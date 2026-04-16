#!/usr/bin/env node
/**
 * Upload 2026 Connect-Gen signups from Google Sheet CSV to Firestore.
 * Run from /Volumes/Xcode_Projects/React/LDAH_W2/functions/
 * Usage: node upload-connect-gen-signups.js
 */

const fs = require('fs');
const path = require('path');

// Use REST API directly — signups allow create: true (no auth needed)
const PROJECT_ID = 'ldah-932d5';
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';

async function firestoreGet(collectionPath) {
  const res = await fetch(FIRESTORE_BASE + '/' + collectionPath);
  if (!res.ok) throw new Error('GET ' + collectionPath + ': ' + (await res.text()));
  return res.json();
}

async function firestoreCreate(collectionPath, fields) {
  const body = { fields: {} };
  for (const [key, val] of Object.entries(fields)) {
    if (val === null || val === undefined) continue;
    if (Array.isArray(val)) {
      body.fields[key] = { arrayValue: { values: val.map(v => ({ stringValue: String(v) })) } };
    } else if (typeof val === 'boolean') {
      body.fields[key] = { booleanValue: val };
    } else if (val instanceof Date) {
      body.fields[key] = { timestampValue: val.toISOString() };
    } else {
      body.fields[key] = { stringValue: String(val) };
    }
  }
  const res = await fetch(FIRESTORE_BASE + '/' + collectionPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('POST ' + collectionPath + ': ' + (await res.text()));
  return res.json();
}

const CSV_PATH = '/Users/danielpellegrini/Downloads/Small Group Session Workshop Registration Form (Responses) - Form Responses 1.csv';

// Parse CSV (handles quoted fields with commas and newlines)
function parseCSV(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  let row = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      row.push(current.trim()); current = '';
    } else if (ch === '\n' && !inQuotes) {
      row.push(current.trim()); rows.push(row); row = []; current = '';
    } else if (ch === '\r' && !inQuotes) {
      // skip
    } else {
      current += ch;
    }
  }
  if (current || row.length) { row.push(current.trim()); rows.push(row); }
  return rows;
}

// Generate session keys in the format the app expects:
// "YYYY-MM-DD|Location – Venue|StartTime – EndTime"
// Generates all matching dates for the next 30 days
function mapSessionKeys(workshopStr) {
  const schedules = [];
  if (workshopStr.includes('Mondays 3pm to 5pm'))
    schedules.push({ dayOfWeek: 1, location: 'Oahu', venue: '245 N. Kakui Street, Suite 205', start: '3:00 PM', end: '5:00 PM' });
  if (workshopStr.includes('Thursdays 9am to 11am'))
    schedules.push({ dayOfWeek: 4, location: "Hawai\u2018i", venue: 'Easter Seals- Hilo', start: '9:00 AM', end: '11:00 AM' });
  if (workshopStr.includes('Thursdays 11am to 1pm'))
    schedules.push({ dayOfWeek: 4, location: 'Oahu', venue: '245 N. Kakui Street, Suite 205', start: '11:00 AM', end: '1:00 PM' });

  const keys = [];
  const now = new Date();
  for (let d = 0; d < 30; d++) {
    const date = new Date(now);
    date.setDate(now.getDate() + d);
    for (const sched of schedules) {
      if (date.getDay() === sched.dayOfWeek) {
        const iso = date.toISOString().slice(0, 10);
        const key = iso + '|' + sched.location + ' \u2013 ' + sched.venue + '|' + sched.start + ' \u2013 ' + sched.end;
        keys.push(key);
      }
    }
  }
  return keys;
}

async function main() {
  // Step 1: Find Connect-Gen program ID
  console.log('Looking for Connect-Gen program in recurringEvents...');
  const recData = await firestoreGet('recurringEvents');
  let connectGenId = null;
  let connectGenTitle = null;
  const docs = recData.documents || [];
  for (const doc of docs) {
    const title = doc.fields?.title?.stringValue || '';
    const docId = doc.name.split('/').pop();
    if (title.toLowerCase().includes('connect') || title.toLowerCase().includes('small group')) {
      connectGenId = docId;
      connectGenTitle = title;
      console.log(`  Found: "${title}" (ID: ${docId})`);
    }
  }

  if (!connectGenId) {
    console.log('Available programs:');
    for (const doc of docs) {
      const title = doc.fields?.title?.stringValue || '(no title)';
      const docId = doc.name.split('/').pop();
      console.log(`  - "${title}" (${docId})`);
    }
    console.error('\nCould not find Connect-Gen. Please update the script with the correct ID.');
    process.exit(1);
  }

  // Step 2: Parse CSV
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(raw);
  const headers = rows[0];
  const dataRows = rows.slice(1);

  console.log(`\nCSV: ${dataRows.length} total rows, headers: ${headers.length} columns`);

  // Step 3: Filter to 2026 only
  const rows2026 = dataRows.filter(r => {
    const ts = r[0] || '';
    return ts.includes('/2026');
  });
  console.log(`2026 entries: ${rows2026.length}`);

  // Step 4: Duplicate check skipped (Firestore read requires auth)
  const existingEmails = new Set();

  // Step 5: Build signup documents
  // CSV columns:
  // 0: Timestamp
  // 1: Which workshop are you attending?
  // 2: Name
  // 3: Complete Mailing Address
  // 4: Phone
  // 5: Email
  // 6: I am registering as a:
  // 7: Reason for Attending
  // 8: Child age
  // 9: Child gender
  // 10: Child ethnicity
  // 11: Child disability category
  // 12: Attended LDAH training past 12 months?
  // 13: Date of last training
  // 14: Active duty military?
  // 15: Branch of service
  // 16: How did you hear about this training?
  // 17: Please specify

  const signups = [];
  const skipped = [];

  for (const row of rows2026) {
    const email = (row[5] || '').trim().toLowerCase();
    const name = (row[2] || '').trim();

    if (!email || !name) { skipped.push(`Empty name/email: ${row[0]}`); continue; }
    if (existingEmails.has(email)) { skipped.push(`Duplicate: ${name} (${email})`); continue; }

    const workshops = row[1] || '';
    const selectedSessions = mapSessionKeys(workshops);
    const registrantType = (row[6] || '').trim() || 'Parent/Guardian';
    const reasonForAttending = (row[7] || '').trim();
    const childAge = (row[8] || '').trim();
    const childGender = (row[9] || '').trim();
    const childEthnicity = (row[10] || '').trim();
    const disabilityCategory = (row[11] || '').trim();
    const attendedBefore = (row[12] || '').trim();
    const lastTrainingDate = (row[13] || '').trim();
    const activeMilitary = (row[14] || '').trim();
    const militaryBranch = (row[15] || '').trim();
    const hearAbout = (row[16] || '').trim();
    const hearAboutSpecify = (row[17] || '').trim();

    const doc = {
      name: name,
      email: email,
      phone: (row[4] || '').trim(),
      preferredContact: 'Email',
      selectedSessions: selectedSessions,
      participationType: 'Individual',
      registrantType: registrantType.includes('Student') ? 'Student' : 'Parent/Guardian',
      additionalComments: reasonForAttending || '',
      childAgeRange: childAge,
      childGender: childGender,
      ethnicity: childEthnicity,
      disabilityCategories: disabilityCategory ? [disabilityCategory] : [],
      priorTraining: attendedBefore || '',
      priorTrainingDate: lastTrainingDate,
      militaryStatus: activeMilitary || '',
      militaryBranch: militaryBranch,
      howHeard: hearAbout + (hearAboutSpecify ? ' — ' + hearAboutSpecify : ''),
      status: 'confirmed',
      archived: false,
      timestamp: new Date(row[0]),
      eventTitle: connectGenTitle,
      source: 'google-form-import'
    };

    signups.push(doc);
    existingEmails.add(email); // prevent intra-batch duplicates
  }

  console.log(`\nReady to upload: ${signups.length} signups`);
  if (skipped.length) {
    console.log(`Skipped: ${skipped.length}`);
    skipped.forEach(s => console.log(`  - ${s}`));
  }

  // Step 6: Upload
  if (signups.length === 0) {
    console.log('Nothing to upload.');
    process.exit(0);
  }

  console.log('\nUploading to recurringEvents/' + connectGenId + '/signups...');
  for (const signup of signups) {
    const result = await firestoreCreate('recurringEvents/' + connectGenId + '/signups', signup);
    const docId = result.name.split('/').pop();
    console.log(`  Created: ${signup.name} (${docId})`);
  }
  console.log(`Done! ${signups.length} signups uploaded successfully.`);

  // Summary
  console.log('\n--- SUMMARY ---');
  signups.forEach(s => {
    console.log(`  ${s.name} | ${s.email} | ${s.selectedSessions.join(', ')}`);
  });

  process.exit(0);
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
