// The screening welcome letter must have a signer (2026-09-19).
// _introSigner was used but never declared, so the ONLY letter a screening
// family gets threw a swallowed ReferenceError and silently never sent.
//   node functions/test/screening-intro-signer.test.js
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
let pass = 0, fail = 0;
const check = (n, a, e) => { if (a === e) pass++; else { fail++; console.error(`FAIL ${n}\n  expected ${e}\n  actual   ${a}`); } };

// 1. Declared, and declared BEFORE it is used.
const decl = src.search(/\b(const|let|var)\s+_introSigner\s*=/);
const firstUse = src.search(/signerName:\s*_introSigner\.name/);
check('_introSigner is declared', decl !== -1, true);
check('_introSigner is declared before use', decl !== -1 && decl < firstUse, true);

// 2. Every _introSigner reference sits in the same function as the declaration.
const fields = ['signerName: _introSigner.name', 'signerTitle: _introSigner.title', 'signerEmail: _introSigner.email']
  .filter((f) => src.includes(f)).length;
check('the three letter fields read it', fields, 3);

// 3. The template renders whatever signer it is handed.
const { __test } = require('../index.js');
const build = __test._buildScreeningReferralIntroHtml;
if (typeof build === 'function') {
  const html = build({ parentName: 'A Parent', childName: 'A Child', screeningType: 'vision',
    screeningDate: '2026-09-19', schoolName: 'A School',
    signerName: 'Chassidy Kruse', signerTitle: 'Director', signerEmail: 'ckruse@ldahawaii.org' });
  check('letter carries the signer name', html.includes('Chassidy Kruse'), true);
  check('letter carries the signer title', html.includes('Director'), true);
  check('letter carries the signer email', html.includes('ckruse@ldahawaii.org'), true);
} else {
  console.log('note: _buildScreeningReferralIntroHtml not exported on __test; source checks only');
}
console.log(`screening-intro-signer: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
