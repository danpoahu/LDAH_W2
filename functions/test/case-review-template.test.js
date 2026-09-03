// Exercises functions/caseReviewTemplate.js — the Case Review & Summary the
// Parent Consultant hands a family. No Firestore, no model call, no deploy.
//   node functions/test/case-review-template.test.js
//
// Set CASE_REVIEW_OUT_DIR to also drop the two rendered samples somewhere for
// eyeballing:
//   CASE_REVIEW_OUT_DIR=/tmp node functions/test/case-review-template.test.js
//
// What this guards. Part 1 IS Rosie's paper form, and the client approved a
// specific grid: six boxes across the top, four assessment sub-rows in a fixed
// order, a numbered follow-up column. Those are not decoration — a consultant
// reads across the row. So the structural assertions are the point, alongside
// the two failure modes that would embarrass us in front of a family: a literal
// "undefined" printed in a box, and a redacted copy that still carries the
// clinical detail the family had destroyed.
//
// All fixture data below is invented. Nothing here is a real family.

const fs = require('fs');
const path = require('path');
const {
  CASE_REVIEW_SCHEMA, renderCaseReviewHtml, redactCaseReviewData,
} = require('../caseReviewTemplate.js');

let pass = 0, fail = 0;
function has(name, html, needle) {
  if (String(html).indexOf(needle) !== -1) { pass++; return; }
  fail++; console.error(`FAIL ${name}\n  expected to find: ${needle}`);
}
function lacks(name, html, needle) {
  if (String(html).indexOf(needle) === -1) { pass++; return; }
  fail++; console.error(`FAIL ${name}\n  expected NOT to find: ${needle}`);
}
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++; console.error(`FAIL ${name}${detail ? '\n  ' + detail : ''}`);
}
function count(html, needle) {
  return String(html).split(needle).length - 1;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const FULL = {
  header: {
    parentName: 'Jamie Sample',
    childName: 'Alex Sample',
    sessionDate: '01/15/2026',
    school: 'Example High School',
    dobAgeGrade: '01/01/2010 · 16 yrs · Grade 10',
    eligibilityCategory: 'Specific Learning Disability',
    eligibilityNote: '(since 2022 — see Follow Up 4)',
    diagnosis: 'Asthma, well controlled\nScoliosis, in physical therapy',
    diagnosisNote: 'Parent reports attention difficulties — no formal diagnosis in file',
    iepDates: 'Meeting 02/02/2026\nAnnual review due **11/30/2026**',
    gradeScores: 'Reading screener 10/01/2025:\nGrade equivalent 3.2',
  },
  parentConcerns: [
    { concern: 'Reading', detail: 'Decoding is slow and effortful; phonics does not stick.' },
    { concern: 'Progress reports', detail: 'We have not received one all year.', inFamilyWords: true },
    { concern: 'Wants:', detail: 'One-to-one reading time and regular samples of work.' },
  ],
  evaluations: {
    cognitive: {
      source: 'Cognitive battery · 09/04/2025 · S. Example, EdS',
      findings: [
        'Verbal **88** · Visual-spatial **101** (relative strength)',
        'Working memory **79** · Processing speed **74**',
      ],
      note: 'Administered over two sessions',
    },
    academic: {
      source: 'Achievement battery · 09/2025 · T. Example',
      findings: [
        'Reading composite **72** · Word reading **68**',
        'Math composite **85** ((relative strength))',
      ],
    },
    ptOt: { findings: ['**No OT or PT evaluation on file.**', 'Scoliosis — physical therapy outside school.'] },
    speechOther: { findings: ['**No speech/language evaluation on file.**', 'Oral expression **76**.'] },
  },
  fsIq: { value: '81', note: '(CI 77–87 · 10th %ile · low average)' },
  followUp: [
    {
      title: 'Get the reading data',
      detail: 'Request the progress data behind the verbal report and a current assessment.',
      severity: 'high', coveredByIep: false, relatesTo: 'Reading concern',
    },
    {
      title: 'Request all progress reports',
      detail: 'Goals exist in reading and writing; the family reports receiving none.',
      severity: 'high', coveredByIep: true, relatesTo: 'Progress reports concern',
    },
    {
      title: 'Name the reading programme',
      detail: 'Which structured programme, who is trained, how often, delivered by whom?',
      severity: 'high', coveredByIep: false, relatesTo: 'Word reading 68',
    },
    {
      title: 'OT/PT never evaluated',
      detail: 'Physical therapy appears in the medical history; nothing in the IEP.',
      severity: 'medium', coveredByIep: false, relatesTo: 'PT/OT — nothing on file',
    },
    {
      title: 'Assistive technology never evaluated',
      detail: 'Text-to-speech is listed as an aid but no evaluation appears in the file.',
      severity: 'medium', coveredByIep: false,
    },
    { title: 'Timing', detail: 'Annual review 11/30/2026 — the natural forum for items 1 and 2.', severity: 'low', coveredByIep: true },
  ],
  additionalComments: 'Strengths to build on: visual-spatial reasoning is the strongest score in the file.\n**Pattern across the file:** the documents disagree with each other about reading level.',
  commentsFootnote: 'Every point above should be verified against the source documents before it is raised. Not legal advice.',
  preparedNote: 'AI-prepared draft · Jan 20, 2026 · from 3 uploaded documents + 1 parent worksheet',
  documentsReviewed: [
    { label: 'Individualized Education Program (11 pp)', date: 'Meeting 02/02/2026', author: 'Example School District' },
    { label: 'Academic Assessment Report', date: 'Tested 09/2025', author: 'T. Example' },
    { label: 'Parent Report Worksheet (online)', date: 'Completed 01/08/2026', author: 'Jamie Sample' },
  ],
  summary: {
    byline: 'Prepared for the Parent Consultant · from 3 uploaded documents + the family’s Parent Report Worksheet · compiled Jan 20, 2026',
    snapshot: [
      { label: 'Student', value: 'Alex Sample' },
      { label: 'DOB / Age', value: '01/01/2010 · 16 yrs' },
      { label: 'School / Grade', value: 'Example High School · **Grade 10**' },
      { label: 'Eligibility', value: 'Specific Learning Disability', note: '(since 2022 — see flag 2)' },
    ],
    documentsNote: 'The evaluations are from September 2025, a year before the current IEP was written.',
    bigPicture: [
      'Alex is a tenth grader reading well below grade level with a documented **visual-spatial strength**.',
      'Two themes run through the file: the documents disagree with each other, and services described to the family were not delivered.',
    ],
    familyWords: {
      items: [
        { label: 'Reading', text: 'Alex has a hard time remembering phonics. Reading is slow and effortful.' },
        { text: 'We were told at a meeting that reading had improved, but **no data was ever shown to us**.', quote: true },
        { label: 'Writing', text: 'No evidence of any teaching or attempts.' },
      ],
      details: [
        { label: 'What they want', value: 'One-to-one reading, positive reinforcement, regular samples of growth.' },
        { label: 'Online worksheet', value: 'Related factors: attention and anxiety.' },
      ],
    },
    domains: [
      {
        title: 'Cognitive — assessed 09/04/2025',
        columns: [{ label: 'Index' }, { label: '2022', numeric: true }, { label: '2025', numeric: true }, { label: 'Range (2025)' }],
        rows: [
          { cells: [{ text: 'Full Scale' }, { text: '84', numeric: true }, { text: '**81**', numeric: true }, { text: 'Low average', emphasis: 'typical' }] },
          { cells: [{ text: 'Working memory' }, { text: '—', numeric: true }, { text: '79', numeric: true }, { text: 'Very low', emphasis: 'low' }] },
        ],
        source: 'S. Example, EdS. 2022 figures as reported inside the 2025 report.',
        commentary: ['Processing speed is the lowest score in the file and may understate the composite.'],
      },
      {
        title: 'Academic — assessed September 2025',
        columns: [{ label: 'Composite / subtest' }, { label: 'Standard score', numeric: true }, { label: 'Range' }],
        rows: [
          { cells: [{ text: '**Reading composite**' }, { text: '72', numeric: true, emphasis: 'low' }, { text: 'Very low', emphasis: 'low' }] },
          { cells: [{ text: 'Math composite' }, { text: '85', numeric: true, emphasis: 'typical' }, { text: 'Low average', emphasis: 'typical' }] },
        ],
        note: 'Written expression could not be scored.',
      },
    ],
    strengths: {
      items: [
        '**Visual-spatial reasoning** is the doorway — the strongest score in the file.',
        'Described in the IEP as motivated by praise and punctual.',
      ],
    },
    flags: [
      {
        title: 'The reading level the family was told does not match the document',
        priority: 'high',
        body: 'The family was told reading had improved, with no data provided. The IEP itself records a **grade equivalent of 3.2**.',
        why: 'Two asks: the progress data behind the verbal claim, and a current reading assessment.',
      },
      {
        title: 'No progress reports',
        priority: 'high',
        body: 'The family states plainly that no progress reports were given.',
        why: 'Periodic reporting on progress toward annual goals is a requirement, not a courtesy.',
      },
      {
        title: 'Scoliosis and physical therapy are absent from the IEP',
        priority: 'med',
        body: 'The medical history records physical therapy. The IEP contains no OT or PT service.',
        why: 'Worth asking whether an OT/PT evaluation has ever been done.',
      },
    ],
    notes: [
      { title: 'Also worth a quick check:', body: 'hearing and vision do not appear to have been screened in the 2025 reevaluation.' },
      { title: 'Timing.', body: 'The annual review is due 11/30/2026 — the natural forum for flags 1 and 2.' },
    ],
    footer: 'Prepared by LDAH from documents supplied by the family. This is a summary to support advocacy discussion — it is **not legal advice**.',
  },
  documentsDestroyedOn: 'Mar 1, 2026',
};

// Only the four required top-level fields, with the minimum inside each.
const SPARSE = {
  header: { parentName: 'Jamie Sample', childName: 'Alex Sample', sessionDate: '01/15/2026' },
  parentConcerns: [{ concern: 'Reading' }],
  evaluations: { cognitive: { findings: [] }, academic: { findings: [] }, ptOt: { findings: [] }, speechOther: { findings: [] } },
  followUp: [{ title: 'Ask for the reading data', severity: 'high', coveredByIep: false }],
};

const full = renderCaseReviewHtml(FULL);
const sparse = renderCaseReviewHtml(SPARSE);
const redactedData = redactCaseReviewData(FULL);
const redacted = renderCaseReviewHtml(redactedData);

// ── The exports are what the caller is promised ─────────────────────────────
{
  ok('the schema is an object schema', CASE_REVIEW_SCHEMA && CASE_REVIEW_SCHEMA.type === 'object');
  ok('it is closed at the top level', CASE_REVIEW_SCHEMA.additionalProperties === false);
  ok('it names its required fields', Array.isArray(CASE_REVIEW_SCHEMA.required) && CASE_REVIEW_SCHEMA.required.length > 0);
  // A schema that quietly accepts extra keys, or leaves a level open, lets the
  // model invent a field the renderer will silently drop.
  const open = [];
  (function walk(node, at) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object' && node.properties) {
      if (node.additionalProperties !== false) open.push(at + ' (additionalProperties)');
      if (!Array.isArray(node.required) || !node.required.length) open.push(at + ' (required)');
      Object.keys(node.properties).forEach((k) => walk(node.properties[k], at + '.' + k));
    }
    if (node.type === 'array' && node.items) walk(node.items, at + '[]');
  })(CASE_REVIEW_SCHEMA, 'root');
  ok('every object level is closed and has a required list', open.length === 0, open.join('\n  '));
  ok('the gap check is in the schema, not left to prose',
    !!CASE_REVIEW_SCHEMA.properties.followUp.items.properties.coveredByIep &&
    !!CASE_REVIEW_SCHEMA.properties.followUp.items.properties.relatesTo);
  ok('renderCaseReviewHtml returns a document', typeof full === 'string' && full.indexOf('<!doctype html>') === 0);
}

// ── The six boxes across the top of the form ────────────────────────────────
// Rosie reads these left to right. Losing one loses a whole field of the paper
// form, so the count is asserted as well as the labels.
{
  const strip = full.split('<table class="strip">')[1].split('</table>')[0];
  ok('the strip holds exactly six boxes', count(strip, '<td>') === 6, 'found ' + count(strip, '<td>'));
  ['School', 'DOB/Age/Grade', 'Eligibility Category', 'DX ', 'IEP Date(s)', 'GRADE scores'].forEach((label) => {
    has('strip box: ' + label.trim(), strip, '<span class="lbl">' + label);
  });
  has('the DX box keeps its "(if available)" qualifier', strip, '(if available)');
  has('a multi-line strip value breaks rather than running on', strip, 'Asthma, well controlled<br>');
  has('the small print under a box renders as .mini', strip, '<span class="mini">(since 2022');
}

// ── The four assessment sub-rows, in the order of the paper form ────────────
{
  const labels = ['Cognitive', 'Academic', 'PT/OT', 'Speech/Other'];
  const idx = labels.map((l) => full.indexOf('<td class="sub"' + (l === 'Cognitive' ? ' style="width:8%;"' : '') + '>' + l + '</td>'));
  labels.forEach((l, i) => ok('sub-row present: ' + l, idx[i] > -1));
  ok('the four sub-rows run in the order of the paper form',
    idx[0] > -1 && idx[0] < idx[1] && idx[1] < idx[2] && idx[2] < idx[3],
    'offsets: ' + idx.join(', '));
  has('the left column spans all five rows', full, '<td rowspan="5">');
  has('the follow-up column spans them too, highlighted', full, '<td rowspan="5" class="hi">');
  has('FS-IQ sits across the bottom of the middle column', full, '<td colspan="2" class="fsiq">FS-IQ &nbsp; <b>81</b>');
  has('the evaluation source line renders', full, '<span class="mini">Cognitive battery · 09/04/2025 · S. Example, EdS</span>');
}

// ── The follow-up column: numbering and both priority variants ──────────────
// The numbers are how a consultant refers to an item out loud, so they must run
// 1..n across the high and medium items without a gap.
{
  const col = full.split('<td rowspan="5" class="hi">')[1].split('</td>')[0];
  has('the first high-priority item is numbered 1', col, '<span class="tag">1</span>');
  has('...and numbering continues', col, '<span class="tag">3</span>');
  has('the lower-priority variant renders', col, '<span class="tag m">4</span>');
  has('...and keeps counting from the high items', col, '<span class="tag m">5</span>');
  ok('three red tags and two amber ones',
    count(col, '<span class="tag">') === 3 && count(col, '<span class="tag m">') === 2,
    'red ' + count(col, '<span class="tag">') + ', amber ' + count(col, '<span class="tag m">'));
  has('a standing note carries no number at all', col, '<b>Timing.</b>');
  ok('...and no cross-reference either — it is a note, not an ask',
    col.split('<b>Timing.</b>')[1].indexOf('in the IEP') === -1);
  ok('the standing note really has no tag', col.split('<b>Timing.</b>')[0].lastIndexOf('<span class="tag') <
    col.split('<b>Timing.</b>')[0].lastIndexOf('<li>'));
  // The gap check itself, which is what the column is for.
  has('an item says what it relates to', col, 're: Reading concern');
  has('a gap is named as a gap', col, 'not covered by the IEP');
  has('an item already in the IEP is marked for verification', col, 'in the IEP — verify it is delivered');
}

// ── The family's own words ──────────────────────────────────────────────────
// These are the only sentences in the document the family wrote themselves.
{
  has('the family box renders', full, '<div class="family">');
  has('the pulled quotation is a blockquote', full,
    '<blockquote>&ldquo;We were told at a meeting that reading had improved, but <b>no data was ever shown to us</b>.&rdquo;</blockquote>');
  has('a labelled passage keeps its lead-in', full, '<p><b>Reading.</b> &ldquo;Alex has a hard time');
  has('the trailing detail pairs render', full, '<dt>What they want</dt>');
  has('a verbatim concern is marked as quoted in the form', full,
    '<span class="q">&ldquo;We have not received one all year.&rdquo;</span>');
}

// ── Part 2 ──────────────────────────────────────────────────────────────────
{
  has('the two parts are separated by the divider heading', full, '<h2 id="full" style="margin-top:34px;">Full document summary</h2>');
  has('the summary is titled with the child and the subject', full, '<h1>Alex Sample &mdash; IEP &amp; Evaluation Summary</h1>');
  has('the documents reviewed table renders', full, '<th>Document</th><th>Date</th><th>Author</th>');
  has('a domain table renders its numeric column class', full, '<td class="n">79</td>');
  has('a low score is coloured', full, '<td class="exlow">Very low</td>');
  has('a typical score is coloured', full, '<td class="avg">Low average</td>');
  has('a numeric cell can be coloured too', full, '<td class="n exlow">72</td>');
  has('...in both directions', full, '<td class="n avg">85</td>');
  has('a snapshot value can carry small print', full, '<span class="small">(since 2022');
  has('HIGH priority flags render', full, '<h3><span class="pri">HIGH</span>1. ');
  has('MED priority flags render', full, '<h3><span class="pri med">MED</span>3. ');
  has('the why line renders', full, '<div class="why">');
  has('the closing notes render', full, '<div class="note">');
  has('the strengths box renders', full, '<div class="strength">');
  has('the footer renders', full, 'not legal advice');
  has('inline bold survives escaping', full, '<b>Reading composite</b>');
  has('...in a strip value', full, 'Annual review due <b>11/30/2026</b>');
  has('...in a numeric table cell', full, '<td class="n"><b>81</b></td>');
  has('...and in the pulled quotation', full, '<b>no data was ever shown to us</b>');
  has('a small-print qualifier renders inside a finding', full, '<span class="mini">relative strength</span>');
}

// ── Nothing from the data may become markup ─────────────────────────────────
{
  const hostile = JSON.parse(JSON.stringify(SPARSE));
  hostile.header.childName = '<script>alert(1)</script>';
  hostile.parentConcerns = [{ concern: 'Reading & writing', detail: 'a "quoted" <b>tag</b>' }];
  const html = renderCaseReviewHtml(hostile);
  lacks('a script tag in the data never reaches the page', html, '<script>');
  has('...it is escaped instead', html, '&lt;script&gt;');
  has('an ampersand in a concern is escaped', html, 'Reading &amp; writing.');
  lacks('a bold tag in the data does not become bold', html, 'a &quot;quoted&quot; <b>tag</b>');
}

// ── A populated document never shows the plumbing ───────────────────────────
{
  lacks('no literal undefined anywhere in the full render', full, 'undefined');
  lacks('no literal null anywhere in the full render', full, 'null');
  lacks('no empty bold tag', full, '<b></b>');
  lacks('no empty mini span', full, '<span class="mini"></span>');
}

// ── The sparse case: only the required fields ───────────────────────────────
// A consultant may print the form before the summary exists. It must still be
// the form, not a wreck of half-rendered sections.
{
  lacks('no literal undefined in the sparse render', sparse, 'undefined');
  lacks('no literal null in the sparse render', sparse, 'null');
  lacks('no empty bold tag in the sparse render', sparse, '<b></b>');
  has('the form still renders', sparse, '<div id="cr">');
  has('the header line still renders', sparse, 'Name of Parent: <b>Jamie Sample</b>');
  has('the strip still renders all six boxes', sparse, '<span class="lbl">GRADE scores</span>');
  ok('the strip still holds six boxes',
    count(sparse.split('<table class="strip">')[1].split('</table>')[0], '<td>') === 6);
  ['Cognitive', 'Academic', 'PT/OT', 'Speech/Other'].forEach((l) => {
    has('sparse keeps sub-row: ' + l, sparse, '>' + l + '</td>');
  });
  has('the FS-IQ row survives without a value', sparse, 'class="fsiq">FS-IQ</td>');
  has('the signature line always prints', sparse, 'Parent Consultant: <span class="sig">');
  lacks('no documents table with no documents', sparse, '<h2>Documents reviewed</h2>');
  lacks('no empty big picture heading', sparse, '<h2>The big picture</h2>');
  lacks('no empty family box', sparse, '<div class="family">');
  has('the document still closes', sparse, '</body></html>');
  // Balanced markup, since a stray unclosed div silently swallows the summary.
  ok('divs balance in the sparse render',
    count(sparse, '<div') === count(sparse, '</div>'),
    count(sparse, '<div') + ' open, ' + count(sparse, '</div>') + ' closed');
  ok('divs balance in the full render',
    count(full, '<div') === count(full, '</div>'),
    count(full, '<div') + ' open, ' + count(full, '</div>') + ' closed');
}

// ── Redaction ───────────────────────────────────────────────────────────────
// This runs on the day a family's uploaded documents are destroyed. The summary
// must not outlive them as a copy of their contents.
{
  ok('redaction does not mutate the original', !!FULL.evaluations && !!FULL.fsIq && !!FULL.header.dobAgeGrade);
  ok('the copy is marked redacted', redactedData.redacted === true);
  ok('the clinical branches are gone from the data',
    redactedData.evaluations === undefined && redactedData.fsIq === undefined &&
    redactedData.documentsReviewed === undefined);
  ok('the header keeps only what survives',
    redactedData.header.dobAgeGrade === undefined &&
    redactedData.header.eligibilityCategory === undefined &&
    redactedData.header.diagnosis === undefined &&
    redactedData.header.gradeScores === undefined &&
    redactedData.header.school === 'Example High School');

  // Every score, diagnosis and clinical field from the fixture, gone.
  ['81', '79', '101', '72', '68', '85', '88', '74', '76', '84'].forEach((score) => {
    lacks('score removed: ' + score, redacted, '>' + score + '<');
  });
  // The notice itself names FS-IQ as one of the things removed, so this looks
  // for the row, not the string.
  lacks('the FS-IQ row is gone', redacted, 'class="fsiq"');
  lacks('the diagnosis is gone', redacted, 'Asthma');
  lacks('...and the second one', redacted, 'Scoliosis, in physical therapy');
  lacks('the date of birth is gone', redacted, '01/01/2010');
  lacks('the eligibility category is gone', redacted, 'Specific Learning Disability');
  lacks('the GRADE score is gone', redacted, 'Grade equivalent 3.2');
  lacks('the assessment findings column is gone', redacted, 'Cognitive battery ·');
  lacks('the documents reviewed table is gone', redacted, '<h2>Documents reviewed</h2>');
  lacks('the per-domain summary sections are gone', redacted, 'Cognitive — assessed 09/04/2025');
  lacks('...both of them', redacted, 'Academic — assessed September 2025');
  lacks('the snapshot box is gone', redacted, '<div class="snap">');
  lacks('the strengths box, which quotes scores, is gone', redacted, '<div class="strength">');
  lacks('no orphaned sub-row labels', redacted, '<td class="sub">');

  // What LDAH did stays.
  has('the parent name stays', redacted, 'Name of Parent: <b>Jamie Sample</b>');
  has('the child name stays', redacted, 'Name of Child: <b>Alex Sample</b>');
  has('the session date stays', redacted, 'Date of Session: <b>01/15/2026</b>');
  has('the school stays', redacted, 'Example High School');
  has('the parent concerns stay', redacted, 'Decoding is slow and effortful');
  has('the follow-up list stays', redacted, 'Get the reading data.');
  has('...still numbered', redacted, '<span class="tag">1</span>');
  has('...and still marked as a gap', redacted, 'not covered by the IEP');
  has('the additional comments stay', redacted, 'Strengths to build on');
  has('the signature line stays', redacted, 'Parent Consultant: <span class="sig">');

  // And the state is obvious rather than looking like a half-filled form.
  has('the page says the documents were destroyed', redacted, 'Source documents destroyed');
  has('...and when', redacted, 'Mar 1, 2026');
  has('...and that the clinical detail went with them', redacted, 'no longer appear here');
  has('the middle column says why it is empty', redacted, 'Assessment findings removed.');
  has('the strip says the assessment detail was removed', redacted, 'Removed with the source documents');
  lacks('no literal undefined in the redacted render', redacted, 'undefined');
  lacks('no literal null in the redacted render', redacted, 'null');
  ok('divs balance in the redacted render', count(redacted, '<div') === count(redacted, '</div>'));

  // opts.redacted reaches the same render without the data being marked.
  const viaOpts = renderCaseReviewHtml(FULL, { redacted: true });
  has('opts.redacted selects the redacted form', viaOpts, 'Assessment findings removed.');
  lacks('...and drops the scores too', viaOpts, 'class="fsiq"');

  // Redacting a redacted copy, or an empty object, must not throw.
  const twice = renderCaseReviewHtml(redactCaseReviewData(redactedData));
  has('redaction is idempotent', twice, 'Source documents destroyed');
  const empty = renderCaseReviewHtml(redactCaseReviewData({}));
  ok('an empty document still renders', typeof empty === 'string' && empty.indexOf('</html>') > -1);
}

// ── Degenerate input must not throw ─────────────────────────────────────────
{
  [undefined, null, {}, { header: null, parentConcerns: 'nope', evaluations: 5, followUp: null }].forEach((bad, i) => {
    let out = null;
    try { out = renderCaseReviewHtml(bad); } catch (e) { out = null; }
    ok('degenerate input ' + i + ' still returns a document',
      typeof out === 'string' && out.indexOf('</html>') > -1);
    if (typeof out === 'string') lacks('degenerate input ' + i + ' prints no undefined', out, 'undefined');
  });
  // The older array-of-strings shape for a domain cell still renders.
  const legacy = renderCaseReviewHtml(Object.assign({}, SPARSE, {
    evaluations: { cognitive: ['A finding'], academic: [], ptOt: [], speechOther: [] },
    fsIq: '81',
  }));
  has('a bare array of findings still renders', legacy, '<li>A finding</li>');
  has('a bare FS-IQ string still renders', legacy, '<b>81</b>');
}

// ── Optional: drop the samples somewhere for eyeballing ─────────────────────
if (process.env.CASE_REVIEW_OUT_DIR) {
  const dir = process.env.CASE_REVIEW_OUT_DIR;
  fs.writeFileSync(path.join(dir, 'rendered-sample.html'), full);
  fs.writeFileSync(path.join(dir, 'rendered-redacted.html'), redacted);
  console.log('wrote rendered-sample.html and rendered-redacted.html to ' + dir);
}

// ── redaction must strip evaluation PROSE, not just the score fields ───────
// The subtle failure: a flag body reading "WISC-V PSI of 49 is below the 1st
// percentile" carries the score exactly as plainly as the field it came from.
// Stripping only the structured fields would look clean and leak anyway.
{
  const loaded = {
    header: { parentName: 'P', childName: 'C', sessionDate: '01/01/2026', school: 'S',
              dobAgeGrade: '03/27/2011 · 15 yrs', eligibilityCategory: 'Intellectual Disability',
              diagnosis: 'scoliosis', gradeScores: 'level 1.8' },
    parentConcerns: [{ concern: 'Reading', detail: 'told 3.0, measured 1.8' }],
    evaluations: { cognitive: { findings: ['FSIQ 58'] }, academic: { findings: ['WIAT 62'] },
                   ptOt: { findings: [] }, speechOther: { findings: [] } },
    fsIq: { value: '58' },
    followUp: [{ title: 'Get the reading data', severity: 'high', coveredByIep: false,
                 relatesTo: 'Reading concern',
                 detail: 'IEP states level 1.8, assessed 10/29/2025' }],
    additionalComments: 'ok',
    documentsReviewed: [{ label: 'IEP' }],
    summary: { byline: 'b', bigPicture: ['FSIQ fell from 67 to 58'],
               flags: [{ title: 'F1', priority: 'HIGH',
                         body: 'WISC-V PSI of 49 is below the 1st percentile' }],
               strengths: { items: ['VSI 84'] } },
  };
  const red = redactCaseReviewData(loaded);
  const blob = JSON.stringify(red);
  ['58', '62', '84', '49', 'FSIQ', 'WIAT', 'WISC', '10/29/2025',
   'Intellectual Disability', 'scoliosis', '03/27/2011'].forEach(function (probe) {
    ok('redaction removes ' + probe, blob.indexOf(probe) === -1);
  });

  // What must SURVIVE: LDAH's own checklist.
  ok('the follow-up item survives', blob.indexOf('Get the reading data') > -1);
  ok('so does its coverage flag', blob.indexOf('coveredByIep') > -1);
  ok('so does what it relates to', blob.indexOf('Reading concern') > -1);
  ok('and the flag title', blob.indexOf('F1') > -1);

  // The family's own words stay, even quoting a number: those are the family's
  // statement about their own child, not a record extracted from documents we
  // promised to destroy.
  ok("the family's own words are kept by design", blob.indexOf('told 3.0') > -1);

  // And it must still render.
  const html = renderCaseReviewHtml(red, { redacted: true });
  ok('the redacted form still renders', html.length > 500);
  // Probe the BODY, not the stylesheet: colour hexes like #15803d contain
  // digit pairs and would give a false positive on a bare score search.
  const body = html.replace(/<style>[\s\S]*?<\/style>/g, '');
  ['58', 'WISC', '10/29/2025', 'Intellectual Disability'].forEach(function (probe) {
    ok('the rendered redacted HTML omits ' + probe, body.indexOf(probe) === -1);
  });
  ok('no literal undefined in the redacted render', html.indexOf('undefined') === -1);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
