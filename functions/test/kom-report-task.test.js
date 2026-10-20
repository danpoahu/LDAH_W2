// The monthly "file the Ke Ola Mamo report" task for the program director.
//   node functions/test/kom-report-task.test.js
//
// A month's figures are only final once the month has closed, so the task lands on
// the 1st of the FOLLOWING month and names the month being reported. It goes urgent
// on the 5th, which is buffer ahead of a typical funder deadline -- KOM's actual
// deadline is not in the Scope of Work (it says "the reporting deadline established
// by KOM") so KOM_REPORT_URGENT_DAY is a single constant to change once we know it.
//
// The catch worth testing: the LAST reporting month is July 2027, and its report is
// due in AUGUST 2027 -- after the agreement term has ended. A naive "is today inside
// the term" guard would silently skip the final month's report.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const k = __test._komReportTaskState;
let pass = 0, fail = 0;
const check = (n, a, e) => { if (JSON.stringify(a) === JSON.stringify(e)) pass++; else { fail++; console.error(`FAIL ${n}\n  expected ${JSON.stringify(e)}\n  actual   ${JSON.stringify(a)}`); } };

const OFF = { due: false, month: null, urgent: false };

// Nothing to file before the first month has closed.
check('mid-September, first month still open', k('2026-09-20'), OFF);
check('last day of September', k('2026-09-30'), OFF);

// 1 October: September has closed, so September's report is now due.
check('1 Oct -> September is due', k('2026-10-01'), { due: true, month: '2026-09', urgent: false });
check('4 Oct -> still not urgent', k('2026-10-04'), { due: true, month: '2026-09', urgent: false });
check('5 Oct -> urgent', k('2026-10-05'), { due: true, month: '2026-09', urgent: true });
check('20 Oct -> still urgent, still September', k('2026-10-20'), { due: true, month: '2026-09', urgent: true });

// Each month reports the one before it.
check('1 Nov -> October', k('2026-11-01'), { due: true, month: '2026-10', urgent: false });
check('1 Jan -> December, across the year boundary', k('2027-01-01'), { due: true, month: '2026-12', urgent: false });
check('9 Jan -> December, urgent', k('2027-01-09'), { due: true, month: '2026-12', urgent: true });

// THE EDGE CASE: July 2027 is the last month of the term, and its report is filed in
// August 2027 -- outside the term. It must still be raised.
check('1 Aug 2027 -> July 2027, the final monthly report', k('2027-08-01'), { due: true, month: '2027-07', urgent: false });
check('5 Aug 2027 -> urgent', k('2027-08-05'), { due: true, month: '2027-07', urgent: true });

// ...but nothing after that. August 2027 is not a reporting month.
check('1 Sep 2027 -> nothing left to file', k('2027-09-01'), OFF);
check('well after the term', k('2028-01-01'), OFF);

// Nothing before the agreement starts either.
check('before the term', k('2026-08-15'), OFF);
check('1 Sep 2026 -> August is not a KOM month', k('2026-09-01'), OFF);

// Bad input never invents an obligation.
check('empty date', k(''), OFF);
check('nonsense date', k('not-a-date'), OFF);
check('null', k(null), OFF);

console.log(`kom-report-task: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
