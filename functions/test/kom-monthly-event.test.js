// The Ke Ola Mamo monthly-event floor: when a month with no tagged event
// becomes something staff have to be told about.
//   node functions/test/kom-monthly-event.test.js
//
// The agreement (1 Sep 2026 - 31 Jul 2027) requires at least one collaborative
// community event with Ke Ola Mamo EVERY month, and the monthly report gates the
// invoice. A month cannot be fixed once it closes, so the warning has to land
// while there is still time to hold an event.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const { __test } = require('../index.js');
const k = __test._komMonthState;
let pass = 0, fail = 0;
const check = (n, a, e) => { if (JSON.stringify(a) === JSON.stringify(e)) pass++; else { fail++; console.error(`FAIL ${n}\n  expected ${JSON.stringify(e)}\n  actual   ${JSON.stringify(a)}`); } };

// An event on the books: nothing to say, whatever the date.
check('event tagged, early in month', k('2026-09-03', 1), { warn: false, urgent: false });
check('event tagged, last day', k('2026-09-30', 2), { warn: false, urgent: false });

// No event yet. Early in the month there is still plenty of runway, so staying
// quiet is right - a task raised on the 2nd is noise by the 20th.
check('no event, day 1', k('2026-09-01', 0), { warn: false, urgent: false });
check('no event, day 19', k('2026-09-19', 0), { warn: false, urgent: false });

// From the 20th the month is at risk: two-thirds gone, an event still takes
// scheduling with a partner.
check('no event, day 20 - warn', k('2026-09-20', 0), { warn: true, urgent: false });
check('no event, day 24 - warn', k('2026-09-24', 0), { warn: true, urgent: false });

// Last week of the month: urgent, because after this there is no fixing it.
check('no event, day 25 - urgent', k('2026-09-25', 0), { warn: true, urgent: true });
check('no event, day 30 - urgent', k('2026-09-30', 0), { warn: true, urgent: true });

// February is short: the thresholds are proportional to the month, not a fixed
// day number, or a 28-day month would get a shorter warning than a 31-day one.
check('Feb: no event, day 18 - warn', k('2027-02-18', 0), { warn: true, urgent: false });
check('Feb: no event, day 23 - urgent', k('2027-02-23', 0), { warn: true, urgent: true });

// Outside the agreement term nothing is owed.
check('before the term starts', k('2026-08-25', 0), { warn: false, urgent: false });
check('after the term ends', k('2027-08-25', 0), { warn: false, urgent: false });
check('first month of the term', k('2026-09-26', 0), { warn: true, urgent: true });
check('last month of the term', k('2027-07-26', 0), { warn: true, urgent: true });

// Garbage in, silence out - never invent an obligation from a bad date.
check('unparseable date', k('', 0), { warn: false, urgent: false });
check('nonsense date', k('not-a-date', 0), { warn: false, urgent: false });

console.log(`kom-monthly-event: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
