// Lions send vision + hearing for ONE student and the consent sits on the
// vision page, covering the child (Daniel, 2026-09-19).
//   node functions/test/screening-pair-consent.test.js
const { contactability } = require('../screeningReferralExtraction.js');
let pass = 0, fail = 0;
const check = (n, a, e) => { if (a === e) pass++; else { fail++; console.error(`FAIL ${n}\n  expected ${e}\n  actual   ${a}`); } };
const vision = { formType: 'vision', parentEmail: 'p@x.org', parentPhone: '8085551234' };
const hearing = { formType: 'hearing', parentEmail: '', parentPhone: '' };
const paired = { visionConsentOnFile: true, email: 'p@x.org', phone: '8085551234' };
const alone = { visionConsentOnFile: false, email: '', phone: '' };

check('vision names LDAH', contactability(vision).namesLdah, true);
check('hearing alone names nobody', contactability(hearing, alone).namesLdah, false);
check('hearing alone is not reachable', contactability(hearing, alone).reachable, false);
check('hearing with its vision pair on file names LDAH', contactability(hearing, paired).namesLdah, true);
check('...and is reachable through the pair', contactability(hearing, paired).reachable, true);
check('...borrowing the email from the vision page', contactability(hearing, paired).email, 'p@x.org');
check('...and is flagged as coming via the pair', contactability(hearing, paired).viaPairedVision, true);
check('vision is not flagged as via-pair', contactability(vision, paired).viaPairedVision, false);
check('hearing WITH its own email is reachable even alone', contactability({ formType: 'hearing', parentEmail: 'h@x.org' }, alone).reachable, true);
check('...but still names nobody without the vision consent', contactability({ formType: 'hearing', parentEmail: 'h@x.org' }, alone).namesLdah, false);
console.log(`screening-pair-consent: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
