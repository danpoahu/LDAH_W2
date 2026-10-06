// Exercises resolvePledgeResources() / loadPledgeResources() — the pledge
// confirmation email follows PDFs uploaded through the Int editor
// (pageContent/community res<N>File). No Firestore, no deploy, no sending.
//   node functions/test/pledge-resources.test.js
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'ldah-932d5';
const fs = require('fs');
const path = require('path');
const { __test } = require('../index.js');
const { PLEDGE_RESOURCES, resolvePledgeResources, loadPledgeResources, buildPledgeConfirmationEmailHtml } = __test;

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; return; } fail++; console.error(`FAIL ${name}`); }

(async () => {
  // Defaults: every default href points at a file that exists in the repo.
  const wp = path.join(__dirname, '..', '..', 'assets', 'docs', 'wp');
  PLEDGE_RESOURCES.forEach((r) => {
    const f = r.href.replace('https://www.ldahawaii.org/assets/docs/wp/', '');
    ok(fs.existsSync(path.join(wp, f)), `default file exists: ${f}`);
  });
  ok(PLEDGE_RESOURCES.some((r) => r.href.endsWith('BP-101-mhschool-cyberbullying.pdf')), 'middle/high link fixed');

  // Card mapping matches community.html titles.
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'community.html'), 'utf8');
  PLEDGE_RESOURCES.forEach((r) => {
    const m = html.match(new RegExp(`<h3 id="community-res${r.card}Title">([^<]*)</h3>`));
    ok(m && m[1].trim() === r.label, `card res${r.card} title = ${r.label}`);
  });

  // No doc / empty doc -> defaults.
  ok(JSON.stringify(resolvePledgeResources(null).map((r) => r.href)) === JSON.stringify(PLEDGE_RESOURCES.map((r) => r.href)), 'null doc = defaults');
  ok(resolvePledgeResources({}).every((r, i) => r.label === PLEDGE_RESOURCES[i].label), 'empty doc keeps labels');

  // Uploaded file + CMS title swap in; bad values ignored.
  const url = 'https://firebasestorage.googleapis.com/v0/b/ldah-932d5.appspot.com/o/x.pdf?alt=media&token=abc';
  const out = resolvePledgeResources({
    res6File: url, res6Title: '<p>Bullying&nbsp;Checklist <b>2026</b></p>',
    res1File: 'http://insecure.example/x.pdf',
    res3File: 'javascript:alert(1)',
    res8File: '   ',
    res9File: 12345, res9Title: '',
    res2File: url, // card 2 is not in the email
  });
  const byCard = Object.fromEntries(out.map((r) => [r.card, r]));
  ok(byCard[6].href === url, 'res6 uses uploaded file');
  ok(byCard[6].label === 'Bullying Checklist 2026', 'res6 uses plain CMS title');
  ok(byCard[1].href === PLEDGE_RESOURCES.find((r) => r.card === 1).href, 'http rejected');
  ok(byCard[3].href === PLEDGE_RESOURCES.find((r) => r.card === 3).href, 'javascript: rejected');
  ok(byCard[8].href.endsWith('BP-101-elementary-cyberbullying.pdf'), 'blank rejected');
  ok(byCard[9].href.endsWith('BP-101-mhschool-cyberbullying.pdf') && byCard[9].label === 'Middle/High School Cyberbullying Prevention', 'non-string rejected, empty title ignored');
  ok(out.length === 10, 'all 10 kit items');

  // loadPledgeResources: doc read failure falls back silently.
  const failingDb = { collection: () => ({ doc: () => ({ get: async () => { throw new Error('boom'); } }) }) };
  const origWarn = console.warn; console.warn = () => {};
  const fb = await loadPledgeResources(failingDb);
  console.warn = origWarn;
  ok(fb === PLEDGE_RESOURCES, 'read failure -> defaults');
  const fakeDb = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ res9File: url }) }) }) }) };
  const loaded = await loadPledgeResources(fakeDb);
  ok(loaded.find((r) => r.card === 9).href === url, 'load uses doc');

  // Email HTML renders the resolved list; default param still works.
  const e1 = buildPledgeConfirmationEmailHtml({ name: 'Test', role: 'Parent', resources: out });
  ok(e1.includes(url.replace(/&/g, '&amp;')) && e1.includes('Bullying Checklist 2026'), 'email uses resolved list');
  const e2 = buildPledgeConfirmationEmailHtml({ name: 'Test', role: 'Parent' });
  ok(e2.includes('BP-101-mhschool-cyberbullying.pdf') && !e2.includes('middle-high'), 'email default list');

  console.log(`pledge-resources: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
