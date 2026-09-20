// The nightly screening-deadline sweep: how loud a task gets as 21 days runs out.
//   node functions/test/screening-deadline-urgency.test.js
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const u = __test._screeningUrgency;
let pass = 0, fail = 0;
const check = (n, a, e) => { if (JSON.stringify(a) === JSON.stringify(e)) pass++; else { fail++; console.error(`FAIL ${n}\n  expected ${JSON.stringify(e)}\n  actual   ${JSON.stringify(a)}`); } };
check('21 days out: left alone', u(21), { touch: false, urgent: false });
check('8 days out: left alone', u(8), { touch: false, urgent: false });
check('7 days out: surfaces daily', u(7), { touch: true, urgent: false });
check('4 days out: surfaces daily', u(4), { touch: true, urgent: false });
check('3 days out: urgent', u(3), { touch: true, urgent: true });
check('due today: urgent', u(0), { touch: true, urgent: true });
check('overdue: urgent', u(-6), { touch: true, urgent: true });
check('no date: nothing', u(NaN), { touch: false, urgent: false });
console.log(`screening-deadline-urgency: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
