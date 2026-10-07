// A screening family's bad email becomes a phone-call task (2026-10-07).
// Malformed addresses and failed sends are caught at submit; bounces are
// caught later by checkScreeningIntroBounces asking Resend what happened.
//   node functions/test/family-email-fix.test.js
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
let pass = 0, fail = 0;
const check = (n, a, e) => { if (a === e) pass++; else { fail++; console.error(`FAIL ${n}\n  expected ${JSON.stringify(e)}\n  actual   ${JSON.stringify(a)}`); } };

const T = require('../index.js').__test;

// 1. Format check
const fmt = T._familyEmailFormatProblem;
check('good address', fmt('parent@example.com').noneValid, false);
check('good address has no bad parts', fmt('parent@example.com').badParts.length, 0);
check('no TLD is invalid', fmt('parent@gmail').noneValid, true);
check('no @ is invalid', fmt('parent.example.com').noneValid, true);
check('space inside is invalid', fmt('par ent@example.com').noneValid, true);
check('blank is not "supplied"', fmt('').supplied, false);
check('blank is not noneValid', fmt('   ').noneValid, false);
const half = fmt('a@example.com; garbage');
check('half-good: still sendable', half.noneValid, false);
check('half-good: one bad part', half.badParts.join('|'), 'garbage');
check('two good parts', fmt('a@example.com, b@example.org').badParts.length, 0);

// 2. Phone formatting
check('10 digits', T._formatFamilyPhone('8085551234'), '(808) 555-1234');
check('11 digits with 1', T._formatFamilyPhone('18085551234'), '(808) 555-1234');
check('7 digits', T._formatFamilyPhone('5551234'), '555-1234');
check('blank', T._formatFamilyPhone(''), '');
check('odd stays as typed', T._formatFamilyPhone('ext 12'), 'ext 12');

// 3. Delivery decision
const H = 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 7, 12);
const dec = T._introDeliveryDecision;
check('bounced -> fix', dec('bounced', now - H, now).fix, true);
check('bounced -> final', dec('bounced', now - H, now).final, true);
check('failed -> fix', dec('failed', now - H, now).fix, true);
check('suppressed -> fix', dec('suppressed', now - H, now).fix, true);
check('BOUNCED (case) -> fix', dec('BOUNCED', now - H, now).fix, true);
check('delivered at 1h is not final', dec('delivered', now - H, now).final, false);
check('delivered at 49h is final', dec('delivered', now - 49 * H, now).final, true);
check('delivered never fixes', dec('delivered', now - 49 * H, now).fix, false);
check('opened at 49h is final', dec('opened', now - 49 * H, now).final, true);
check('sent keeps checking', dec('sent', now - 49 * H, now).final, false);
check('delivery_delayed keeps checking', dec('delivery_delayed', now - 49 * H, now).final, false);
check('complained is final, no task', JSON.stringify(dec('complained', now - H, now)), '{"final":true,"fix":false}');
check('missing event keeps checking', dec('', now - 49 * H, now).final, false);

// 4. Task doc
const doc = T._buildFamilyEmailFixTaskDoc({
  contactId: 'c1', contactName: 'A Parent', badEmail: 'parent@gmail', phone: '8085551234',
  childName: 'A Child', screeningType: 'vision', reason: 'the email address is not valid',
  sourceDetail: 'test', ownerUid: 'u1', ownerName: 'Seat Owner', todayHst: '2026-10-07',
});
check('workflowStep', doc.workflowStep, 'fixFamilyEmail');
check('channel', doc.channel, 'Outbound Phone');
check('urgent', doc.urgent, true);
check('status Open', doc.status, 'Open');
check('not a draft', doc.isDraft, false);
check('due today', doc.followUpDate, '2026-10-07');
check('owner', doc.ownerUid + '/' + doc.owner, 'u1/Seat Owner');
check('contactType', doc.contactType, 'Parent/Guardian');
check('summary', doc.summary, 'ASAP: call family to fix email — A Parent (the email address is not valid)');
check('badEmail', doc.badEmail, 'parent@gmail');
check('familyPhone', doc.familyPhone, '8085551234');
check('emailFixReason', doc.emailFixReason, 'the email address is not valid');
check('source', doc.source, 'lions-screening');
check('notes: phone formatted', doc.notes.includes('(808) 555-1234'), true);
check('notes: correct on contact', /correct it on the contact/.test(doc.notes), true);
check('notes: child', doc.notes.includes('A Child (vision screening)'), true);
check('no phone -> look on the fax', /Look on the faxed screening form/.test(
  T._buildFamilyEmailFixTaskDoc({ contactId: 'c', contactName: 'X', reason: 'r' }).notes), true);
check('blank name falls back', T._buildFamilyEmailFixTaskDoc({ contactId: 'c' }).contactName, 'the family');
check('fix seat is the admin seat', T.SCREENING_EMAIL_FIX_UID, 'xxApwGPzZafLhmfrGll6gwylknJ3');

// 5. Wiring (source checks)
check('emailLog stores relatedContactId', /relatedContactId: entry\.relatedContactId \|\| null/.test(src), true);
check('sendEmailViaResend accepts relatedContactId',
  /async function sendEmailViaResend\(\{[^}]*relatedContactId/.test(src), true);
const sendFn = src.slice(src.indexOf('async function sendEmailViaResend('), src.indexOf('exhausted retries for'));
check('all 3 log calls pass relatedContactId', (sendFn.match(/recipientName, relatedContactId,\s+success:/g) || []).length, 3);
check('bounce checker exported', /exports\.checkScreeningIntroBounces = functions/.test(src), true);
check('bounce checker runs every 30 minutes HST',
  /checkScreeningIntroBounces[\s\S]{0,300}schedule\("every 30 minutes"\)\.timeZone\("Pacific\/Honolulu"\)/.test(src), true);
const submit = src.slice(src.indexOf('exports.submitScreeningReferral'), src.indexOf('const SCREENING_REFERRAL_INTRO_SUBJECT'));
check('submit creates the fix task', submit.includes('_createFamilyEmailFixTask('), true);
check('submit skips a malformed send', submit.includes('emailSkipped = "invalid-email-format"'), true);
check('submit only tasks a supplied address', submit.includes('_emailFixReason && _introFmt.supplied'), true);

console.log(`family-email-fix: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
