"use strict";

// Connect-Gen "Case Review & Summary" — schema + renderer.
//
// Rosie works from a paper form. Part 1 of this document IS that form, typed:
// parent concerns on the left, evaluation findings in the middle, and on the
// right the Follow Up column. That right column is NOT free notes. Left and
// middle are inputs; the right side is the cross-check that the IEP actually
// covers every parent concern and every evaluation finding — "so nothing is
// left behind that the child needs". The deliverable is GAP DETECTION, not
// narration, so the schema models that relationship explicitly (relatesTo /
// coveredByIep) rather than leaving it to prose.
//
// Part 2 is the full document summary underneath: what was reviewed, the big
// picture, the family's own words, the per-domain tables, and the points to
// raise or verify.
//
// A fixed template rather than asking the model for HTML: the first pilot came
// back as a free-form narrative instead of the form, and nothing structural
// stops that recurring. A template guarantees the grid every time, can be
// corrected without re-running the model, keeps the fields queryable, and
// turns redaction into a render mode rather than a rebuild.
//
// Self-contained on purpose: no Firestore, no network, no imports. It renders a
// string, which makes it testable with `node functions/test/case-review-template.test.js`.
//
// EVERYTHING that comes from `data` is escaped here. The content is
// model-generated and family-supplied; neither is trusted to emit markup. The
// only concessions are two inline conventions in prose fields — `**bold**` and
// `((small print))` — both converted AFTER escaping, so no raw HTML can pass
// through. The approved document leans on both, particularly inside the form's
// list items, where a bare sentence loses the emphasis a consultant reads by.

// ── The document's CSS, copied verbatim from the approved reference. ─────────
// Do not tidy it. The client has signed off on the rendered result, including
// the print rules (the Case Review prints landscape, the summary portrait).
const CASE_REVIEW_CSS = `
:root{--ink:#1e2a30;--ocean:#0e5f7a;--ocean2:#1490b4;--line:#d9e5e9;--muted:#5f7178;--soft:#f2f7f9;--warn:#9a3412;--warnbg:#fff7ed;--warnbd:#fed7aa;--good:#15803d;}
*{box-sizing:border-box}
body{margin:0;font:16px/1.55 -apple-system,'Segoe UI',Roboto,sans-serif;color:var(--ink);background:#fff;padding:32px 22px;}
.wrap{max-width:820px;margin:0 auto;}
body{padding:22px 14px;}
.conf{background:#fdecea;border:1px solid #f5c2bc;color:#8a1c12;border-radius:10px;padding:8px 14px;font-size:.82rem;font-weight:600;margin:0 0 18px;text-align:center;letter-spacing:.02em;}
h1{font-size:1.7rem;color:var(--ocean);margin:0 0 2px;}
.byline{color:var(--muted);margin:0 0 20px;font-size:.95rem;}
.snap{background:var(--soft);border:1px solid var(--line);border-radius:14px;padding:16px 20px;margin:0 0 22px;}
.snap dl{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;margin:0;font-size:.95rem;}
.snap dt{color:var(--muted);font-weight:600;}
.snap dd{margin:0;}
h2{font-size:1.15rem;color:var(--ocean);margin:30px 0 8px;border-bottom:2px solid var(--line);padding-bottom:6px;}
h3{font-size:1rem;margin:18px 0 6px;color:var(--ink);}
p{margin:8px 0;}
table{width:100%;border-collapse:collapse;margin:10px 0 6px;font-size:.9rem;}
th,td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top;}
th{background:var(--soft);color:var(--ocean);font-size:.82rem;text-transform:uppercase;letter-spacing:.03em;}
td.n{font-variant-numeric:tabular-nums;white-space:nowrap;}
.exlow{color:#b91c1c;font-weight:600;}
.avg{color:var(--good);font-weight:600;}
ul{margin:8px 0;padding-left:22px;}
li{margin:5px 0;}
.flag{background:var(--warnbg);border:1px solid var(--warnbd);border-radius:12px;padding:14px 18px;margin:12px 0;}
.flag h3{margin-top:0;color:var(--warn);}
.flag .why{font-size:.9rem;color:#7a4a26;margin-top:6px;}
.pri{display:inline-block;background:#b91c1c;color:#fff;font-size:.68rem;font-weight:700;border-radius:6px;padding:2px 7px;vertical-align:middle;margin-right:8px;letter-spacing:.04em;}
.pri.med{background:#b45309;}
.src{color:var(--muted);font-size:.82rem;font-style:italic;}
.small{font-size:.85rem;color:var(--muted);}
.note{background:#eef6f9;border:1px solid #cfe4ec;border-radius:10px;padding:12px 16px;font-size:.9rem;margin:14px 0;}
.strength{background:#f0fbf3;border:1px solid #bfe6cd;border-radius:12px;padding:14px 18px;margin:12px 0;}
.family{background:#f6f2fb;border:1px solid #ddd0ee;border-radius:12px;padding:16px 20px;margin:12px 0;}
.family h3{margin-top:0;color:#6d28d9;}
.family dl{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;margin:8px 0 0;font-size:.93rem;}
.family dt{color:#6d28d9;font-weight:600;}
.family dd{margin:0;}
blockquote{margin:8px 0 8px 0;padding:6px 0 6px 14px;border-left:3px solid #ddd0ee;color:#3f3552;font-style:italic;}

.topwrap{max-width:820px;margin:0 auto;}
#cr{max-width:1400px;margin:0 auto 26px;padding:0 6px;overflow-x:auto;}
#cr>table,#cr .hdrbox{min-width:900px;}
@media print{#cr{max-width:none;padding:0;}#cr>table,#cr .hdrbox{min-width:0;}}
@media print{#cr>table,#cr .hdrbox{min-width:0;}}
#cr table{font-size:.78rem;}
#cr td,#cr th{border:1px solid #9aa7ad;padding:5px 7px;}
#cr .title{font-size:1.3rem;border:none;text-align:center;font-style:italic;font-weight:700;}
#cr .hdrbox{border:2px solid #333;margin-bottom:5px;border-radius:4px;}
#cr .hdrline{padding:4px 8px 7px;font-size:.9rem;}
#cr .hdrline span{display:inline-block;min-width:31%;}
#cr .hdrline b{border-bottom:1px solid #333;padding:0 22px 0 3px;}
#cr .colhead{text-align:center;font-style:italic;font-weight:700;background:var(--soft);color:var(--ocean);font-size:.92rem;}
#cr .sub{font-weight:700;font-size:.8rem;white-space:nowrap;}
#cr .lbl{font-style:italic;font-weight:700;display:block;font-size:.76rem;margin-bottom:2px;text-align:center;}
#cr .val{display:block;font-size:.76rem;line-height:1.3;}
#cr .strip td{vertical-align:top;}
#cr ul{padding-left:15px;margin:2px 0;}
#cr li{margin:0 0 3px;}
#cr .mini{font-size:.72rem;color:#5f7178;}
#cr .q{font-style:italic;color:#41525a;}
#cr .fsiq{text-align:center;font-style:italic;font-weight:700;}
#cr .fsiq b{font-style:normal;font-size:1.05rem;}
#cr .hi{background:#fff8e6;}
#cr .tag{font-size:.62rem;font-weight:700;color:#fff;background:#b91c1c;border-radius:3px;padding:1px 5px;margin-right:4px;vertical-align:1px;}
#cr .tag.m{background:#b45309;}
#cr .sig{border-bottom:1px solid #333;display:inline-block;min-width:220px;}
#cr .rev{float:right;font-size:.7rem;font-style:italic;color:#5f7178;}
#cr .conf{margin-bottom:8px;}
@media screen and (max-width:820px){
  #cr .hdrline span{display:block;min-width:0;margin-bottom:5px;}
  #cr table.strip,#cr table.strip tr,#cr table.strip td{display:block;width:100%;}
  #cr .body td{display:block;width:100%!important;}
  #cr .body tr:first-child{display:none;}
  #cr .body td::before{display:block;font-weight:700;color:var(--ocean);margin-bottom:3px;}
}
/* Print: the Case Review is a landscape grid; everything else reads better portrait. */
@page { size: letter portrait; margin: 14mm; }
@page cr { size: letter landscape; margin: 10mm; }
#cr { page: cr; break-after: page; }
@media print {
  .jump { display:none; }
  body { padding:0; }
  /* The outer banner would otherwise claim a blank portrait page of its own
     ahead of the landscape section, because a named page forces a break. */
  .topwrap { display:none; }
  #cr .conf { display:block !important; margin-bottom:6px; }
  #cr { overflow-x: visible; }
  #cr table { font-size: 7.6pt; }
  #cr li { margin:0 0 2px; }
  .flag, .strength, .family, .note, table { break-inside: avoid; }
}
.jump{background:#f2f7f9;border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:0 0 18px;font-size:.88rem;}
.jump a{color:var(--ocean);font-weight:600;}
`;

// ── Schema ───────────────────────────────────────────────────────────────────
// Shaped for the Anthropic API's output_config.format. additionalProperties is
// false and every level carries a `required` list, so a model cannot invent a
// field the renderer will silently drop.

const cellSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: {
    text: { type: "string", description: "Cell text. '—' for a score that could not be obtained." },
    numeric: { type: "boolean", description: "true for score columns — renders tabular figures, no wrapping" },
    emphasis: {
      type: "string",
      enum: ["low", "typical"],
      description: "'low' = extremely/very low (red); 'typical' = average or a relative strength (green). Omit for neutral.",
    },
  },
};

// One middle-column box. Inlined into all four domains rather than referenced
// with $ref/$defs — the structured-output endpoint is happiest with a flat,
// self-contained schema.
const domainCellSchema = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    source: { type: "string", description: "Instrument · date · examiner, e.g. 'WISC-V · 09/04/2024 · S. Example, EdS'" },
    findings: {
      type: "array",
      description: "Bulleted findings. **bold** and ((small-print qualifiers)) supported. An empty list is meaningful: nothing was evaluated.",
      items: { type: "string" },
    },
    note: { type: "string", description: "Small-print footnote under the bullets." },
  },
};

const CASE_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["header", "parentConcerns", "evaluations", "followUp"],
  properties: {
    // ── Part 1: the form ────────────────────────────────────────────────────
    header: {
      type: "object",
      additionalProperties: false,
      required: ["parentName", "childName", "sessionDate"],
      description: "The header line and the six-box strip across the top of the form.",
      properties: {
        parentName: { type: "string" },
        childName: { type: "string" },
        sessionDate: { type: "string", description: "Date of the Connect-Gen session, MM/DD/YYYY" },
        school: { type: "string" },
        dobAgeGrade: { type: "string", description: "e.g. '03/27/2011 · 15 yrs · Grade 9'" },
        eligibilityCategory: { type: "string", description: "IDEA eligibility category as stated in the IEP" },
        eligibilityNote: { type: "string", description: "Small print under the category, e.g. '(since 2021 — see Follow Up 4)'" },
        diagnosis: { type: "string", description: "Medical/clinical diagnoses on file. Newlines render as line breaks." },
        diagnosisNote: { type: "string", description: "Small print, e.g. what the parent reports with no formal diagnosis in file" },
        iepDates: { type: "string", description: "Meeting / annual review / reevaluation dates. Newlines render as line breaks." },
        iepNote: { type: "string" },
        gradeScores: { type: "string", description: "Reading-level or GRADE-type scores with the date assessed" },
        gradeScoresNote: { type: "string" },
      },
    },

    // LEFT column. Sourced from the worksheet wherever possible — those are the
    // family's own words and must not be paraphrased into clinical language.
    parentConcerns: {
      type: "array",
      description: "One entry per distinct concern the family raised, in the family's order of emphasis.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["concern"],
        properties: {
          concern: { type: "string", description: "Short bold lead-in, e.g. 'Reading.' or 'Wants:'" },
          detail: { type: "string" },
          inFamilyWords: { type: "boolean", description: "true if `detail` is a verbatim quotation — it is then rendered in quotation marks" },
        },
      },
    },

    // MIDDLE column, by domain, mirroring the paper form's sub-rows. All four
    // are required: an empty PT/OT box is itself a finding, and the form is
    // meant to show that nothing was evaluated as loudly as it shows a score.
    evaluations: {
      type: "object",
      additionalProperties: false,
      required: ["cognitive", "academic", "ptOt", "speechOther"],
      properties: {
        cognitive: domainCellSchema,
        academic: domainCellSchema,
        ptOt: domainCellSchema,
        speechOther: domainCellSchema,
      },
    },
    fsIq: {
      type: "object",
      additionalProperties: false,
      required: ["value"],
      description: "The full-scale IQ banner across the bottom of the middle column.",
      properties: {
        value: { type: "string" },
        note: { type: "string", description: "e.g. '(CI 54–65 · 0.3 %ile · extremely low)'" },
      },
    },

    // RIGHT column — the gap check. severity orders the advocate's attention;
    // coveredByIep and relatesTo are the cross-reference itself.
    followUp: {
      type: "array",
      description:
        "One entry per gap. Each item should trace back to a parent concern or an evaluation finding via relatesTo, " +
        "and say whether the IEP covers it. Items are numbered in the order given; 'low' items carry no number and " +
        "read as standing notes (timing, quick checks).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "severity", "coveredByIep"],
        properties: {
          title: { type: "string", description: "The ask, as an imperative — 'Get the reading data.'" },
          detail: { type: "string", description: "Why, and what specifically to request. **bold** and ((small-print qualifiers)) are supported." },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          coveredByIep: { type: "boolean", description: "Does the IEP already cover this need? false is a gap." },
          relatesTo: { type: "string", description: "The parent concern or evaluation finding this answers." },
        },
      },
    },

    additionalComments: { type: "string", description: "Free text at the foot of the form. Newlines render as line breaks; **bold** and ((small-print qualifiers)) supported." },
    commentsFootnote: { type: "string", description: "Small print at the end of the comments — caveats, ages of the evaluations." },
    preparedNote: { type: "string", description: "The italic float-right provenance line, e.g. 'AI-prepared draft · Aug 26, 2026 · from 4 uploaded documents'" },

    // ── Part 2: the full document summary ───────────────────────────────────
    documentsReviewed: {
      type: "array",
      description: "The Documents reviewed table. Removed on redaction, with the documents themselves.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label"],
        properties: {
          label: { type: "string" },
          date: { type: "string" },
          author: { type: "string" },
        },
      },
    },
    summary: {
      type: "object",
      additionalProperties: false,
      required: ["byline", "bigPicture", "flags"],
      properties: {
        byline: { type: "string", description: "Who it is for, what it was built from, and when." },
        snapshot: {
          type: "array",
          description: "The at-a-glance box: label/value pairs.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value"],
            properties: {
              label: { type: "string" },
              value: { type: "string" },
              note: { type: "string", description: "Small print after the value, e.g. '(since 2022 — see flag 4)'" },
            },
          },
        },
        documentsNote: { type: "string", description: "Small print under the documents table — e.g. how old the evaluations are." },
        bigPicture: { type: "array", description: "Two to four paragraphs. **bold** and ((small-print qualifiers)) supported.", items: { type: "string" } },
        familyWords: {
          type: "object",
          additionalProperties: false,
          required: ["items"],
          description: "The family's own words from the Parent Report Worksheets. Verbatim — never paraphrased.",
          properties: {
            title: { type: "string" },
            items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["text"],
                properties: {
                  label: { type: "string", description: "Bold lead-in, e.g. 'Reading.'" },
                  text: { type: "string", description: "The family's exact wording. Quotation marks are added by the renderer." },
                  quote: { type: "boolean", description: "true renders the passage as a pulled blockquote rather than a paragraph." },
                },
              },
            },
            details: {
              type: "array",
              description: "Trailing label/value pairs — what the family wants, the online worksheet.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "value"],
                properties: { label: { type: "string" }, value: { type: "string" } },
              },
            },
          },
        },
        domains: {
          type: "array",
          description: "One section per assessment domain: a heading, a score table, and the reading of it. Removed on redaction.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title"],
            properties: {
              title: { type: "string", description: "e.g. 'Cognitive — WISC-V (09/04/2024)'" },
              columns: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label"],
                  properties: { label: { type: "string" }, numeric: { type: "boolean" } },
                },
              },
              rows: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["cells"],
                  properties: { cells: { type: "array", items: cellSchema } },
                },
              },
              source: { type: "string", description: "Attribution line under the table, italic." },
              note: { type: "string", description: "Small-print footnote under the table." },
              commentary: { type: "array", description: "Paragraphs reading the table. **bold** and ((small-print qualifiers)) supported.", items: { type: "string" } },
            },
          },
        },
        strengths: {
          type: "object",
          additionalProperties: false,
          required: ["items"],
          description: "The green box. Every file has something to build on and the family should see it.",
          properties: {
            title: { type: "string" },
            items: { type: "array", items: { type: "string" } },
          },
        },
        flags: {
          type: "array",
          description:
            "Points to raise or verify — the long form of the numbered follow-up items, in the same order, " +
            "so flag 4 and Follow Up 4 are the same question.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "priority", "body"],
            properties: {
              title: { type: "string" },
              priority: { type: "string", enum: ["high", "med"] },
              body: { type: "string", description: "What the documents actually say. **bold** and ((small-print qualifiers)) supported." },
              why: { type: "string", description: "Why it matters and what to ask for." },
            },
          },
        },
        notes: {
          type: "array",
          description: "Closing blue notes — a quick check worth doing, and the timing of the next meeting.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["body"],
            properties: { title: { type: "string" }, body: { type: "string" } },
          },
        },
        footer: { type: "string", description: "The 'prepared by LDAH / not legal advice' line." },
      },
    },
    documentsDestroyedOn: { type: "string", description: "Date the uploaded documents were destroyed. Shown in the redacted render." },
    redacted: { type: "boolean", description: "Set by redactCaseReviewData(). Selects the redacted render." },
  },
};

// Fields stripped when the source documents are destroyed. Everything here is
// clinical detail the family consented to have destroyed with the documents;
// what survives is LDAH's own work product.
const REDACTED_TOP_FIELDS = ["evaluations", "fsIq", "documentsReviewed"];
const REDACTED_HEADER_FIELDS = [
  "dobAgeGrade", "eligibilityCategory", "eligibilityNote",
  "diagnosis", "diagnosisNote", "gradeScores", "gradeScoresNote",
];
// Part 2 sections that are a restatement of the clinical detail.
const REDACTED_SUMMARY_FIELDS = ["snapshot", "documentsNote", "domains", "strengths"];

// ── Escaping and small text helpers ──────────────────────────────────────────
// Local by design: this module must not depend on anything else in functions/.

function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Escaped, then two safe inline conversions, applied AFTER escaping so no tag
// can be smuggled through them:
//   **bold**       -> <b>            the reference leans on bold inside prose
//   ((qualifier))  -> <span class="mini">   the small parenthetical after a score
// These two are the whole inline vocabulary. Anything else stays literal text.
function inline(v) {
  return esc(v)
    .replace(/\*\*([^*]+)\*\*/g, function (m, g) { return "<b>" + g + "</b>"; })
    .replace(/\(\(([^()]+)\)\)/g, function (m, g) { return '<span class="mini">' + g + "</span>"; });
}

// Same, with newlines becoming line breaks.
function lines(v) {
  return inline(v).replace(/\r?\n/g, "<br>");
}

function str(v) {
  return (v === null || v === undefined) ? "" : String(v).trim();
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

// "Reading" -> "Reading." but "Wants:" is left alone.
function leadIn(v) {
  const s = str(v);
  if (!s) return "";
  return /[.:!?;,]$/.test(s) ? s : s + ".";
}

// Wrap verbatim family text in typographic quotes without doubling any the
// family (or the model) already typed.
function quoted(v) {
  let s = str(v);
  if (!s) return "";
  s = s.replace(/^["'“‘]+/, "").replace(/["'”’]+$/, "");
  if (!s) return "";
  return "&ldquo;" + inline(s) + "&rdquo;";
}

// A domain cell may arrive as the full object or, from an older caller, as a
// bare array of finding strings. Both render.
function normalizeDomain(v) {
  if (Array.isArray(v)) return { source: "", findings: v, note: "" };
  if (v && typeof v === "object") {
    return { source: str(v.source), findings: arr(v.findings), note: str(v.note) };
  }
  return { source: "", findings: [], note: "" };
}

function normalizeFsIq(v) {
  if (typeof v === "string") return { value: v.trim(), note: "" };
  if (v && typeof v === "object") return { value: str(v.value), note: str(v.note) };
  return { value: "", note: "" };
}

function cellAttrs(cell) {
  const c = (cell && typeof cell === "object") ? cell : { text: cell };
  const cls = [];
  if (c.numeric) cls.push("n");
  if (c.emphasis === "low") cls.push("exlow");
  else if (c.emphasis === "typical") cls.push("avg");
  return { cls: cls.join(" "), text: str(c.text) };
}

// ── Part 1: the Case Review form ─────────────────────────────────────────────

function stripBox(label, value, note, labelSuffix) {
  const v = lines(value);
  const n = str(note) ? '<span class="mini">' + inline(note) + "</span>" : "";
  const lbl = esc(label) + (labelSuffix || "");
  return '  <td><span class="lbl">' + lbl + '</span><span class="val">' +
    v + (v && n ? "<br>" : "") + n + "</span></td>";
}

function renderStrip(h) {
  const boxes = [
    stripBox("School", h.school),
    stripBox("DOB/Age/Grade", h.dobAgeGrade),
    stripBox("Eligibility Category", h.eligibilityCategory, h.eligibilityNote),
    stripBox("DX ", h.diagnosis, h.diagnosisNote, '<span style="font-weight:400">(if available)</span>'),
    stripBox("IEP Date(s)", h.iepDates, h.iepNote),
    stripBox("GRADE scores", h.gradeScores, h.gradeScoresNote),
  ];
  return '<table class="strip">\n<tr>\n' + boxes.join("\n") + "\n</tr>\n</table>";
}

function renderConcerns(concerns) {
  const items = arr(concerns).map(function (c) {
    const o = (c && typeof c === "object") ? c : { concern: c };
    const head = leadIn(o.concern);
    const detail = str(o.detail);
    let li = "";
    if (head) li += "<b>" + inline(head) + "</b>";
    if (detail) {
      li += (li ? " " : "");
      li += o.inFamilyWords ? '<span class="q">' + quoted(detail) + "</span>" : inline(detail);
    }
    return li ? "      <li>" + li + "</li>" : "";
  }).filter(Boolean);
  if (!items.length) return "";
  return "    <ul>\n" + items.join("\n") + "\n    </ul>";
}

function renderDomainCell(domain) {
  const d = normalizeDomain(domain);
  const out = [];
  if (d.source) out.push('    <span class="mini">' + inline(d.source) + "</span>");
  const bullets = d.findings.map(function (f) {
    const t = str(f);
    return t ? "      <li>" + inline(t) + "</li>" : "";
  }).filter(Boolean);
  if (bullets.length) out.push("    <ul>\n" + bullets.join("\n") + "\n    </ul>");
  if (d.note) out.push('    <span class="mini">' + inline(d.note) + "</span>");
  return out.join("\n");
}

// The numbered gap list. high -> red tag, medium -> amber tag, low -> no tag:
// a standing note rather than an ask, which is how the reference reads its
// "Quick check" and "Timing" lines.
function renderFollowUp(followUp) {
  let n = 0;
  const items = arr(followUp).map(function (f) {
    const o = (f && typeof f === "object") ? f : { title: f };
    const sev = str(o.severity) || "high";
    let tag = "";
    if (sev === "high" || sev === "medium") {
      n += 1;
      tag = '<span class="tag' + (sev === "medium" ? " m" : "") + '">' + n + "</span>";
    }
    const head = leadIn(o.title);
    const detail = str(o.detail);
    // The gap check itself, rendered only when it says something: what this
    // answers, and whether the IEP already covers it.
    // 'low' items are standing notes — timing, a quick check to rule something
    // out — not asks, so they carry no cross-reference and no number.
    const gap = [];
    if (sev !== "low") {
      if (str(o.relatesTo)) gap.push("re: " + str(o.relatesTo));
      if (o.coveredByIep === false) gap.push("not covered by the IEP");
      else if (o.coveredByIep === true) gap.push("in the IEP — verify it is delivered");
    }
    let li = tag;
    if (head) li += "<b>" + inline(head) + "</b>";
    if (detail) li += (li && head ? " " : "") + inline(detail);
    if (gap.length) li += ' <span class="mini">(' + inline(gap.join(" · ")) + ")</span>";
    return li ? "      <li>" + li + "</li>" : "";
  }).filter(Boolean);
  if (!items.length) return "";
  return "    <ul>\n" + items.join("\n") + "\n    </ul>";
}

function renderCommentsTable(data) {
  const rev = str(data.preparedNote)
    ? '\n  <span class="rev">' + inline(data.preparedNote) + "</span>" : "";
  const body = [];
  if (str(data.additionalComments)) body.push(lines(data.additionalComments));
  if (str(data.commentsFootnote)) body.push('<span class="mini">' + inline(data.commentsFootnote) + "</span>");
  const inner = body.length
    ? '\n  <div style="margin-top:2px;">\n  ' + body.join("<br>") + "\n  </div>" : "";
  return '<table style="margin-top:4px;">\n<tr><td>\n' +
    '  <b style="font-style:italic;">Additional Comments:</b>' + rev + inner + "\n" +
    '  <div style="margin-top:8px;">Parent Consultant: <span class="sig">&nbsp;</span></div>\n' +
    "</td></tr>\n</table>";
}

function renderForm(data, destroyedNote) {
  const h = (data.header && typeof data.header === "object") ? data.header : {};
  const parts = [];

  parts.push('<div class="conf" style="display:none">CONFIDENTIAL &mdash; Student education &amp; health records &middot; LDAH advocacy use only &middot; AI-prepared draft, pending Parent Consultant review</div>');
  parts.push(
    '<div class="hdrbox">\n' +
    '  <div class="title">Case Review</div>\n' +
    '  <div class="hdrline">\n' +
    "    <span>Name of Parent: <b>" + inline(h.parentName) + "</b></span>\n" +
    "    <span>Name of Child: <b>" + inline(h.childName) + "</b></span>\n" +
    "    <span>Date of Session: <b>" + inline(h.sessionDate) + "</b></span>\n" +
    "  </div>\n" +
    "</div>"
  );

  if (destroyedNote) {
    parts.push(destroyedNote);
    parts.push(renderRedactedStrip(h));
    parts.push(renderRedactedBody(data));
  } else {
    parts.push(renderStrip(h));

    const ev = (data.evaluations && typeof data.evaluations === "object") ? data.evaluations : {};
    const fs = normalizeFsIq(data.fsIq);
    const fsCell = fs.value
      ? "FS-IQ &nbsp; <b>" + inline(fs.value) + "</b>" +
        (fs.note ? ' &nbsp;<span class="mini">' + inline(fs.note) + "</span>" : "")
      : "FS-IQ";

    parts.push(
      '<table class="body" style="margin-top:4px;">\n' +
      "<tr>\n" +
      '  <td class="colhead" style="width:28%;">Parent Concerns</td>\n' +
      '  <td class="colhead" style="width:36%;" colspan="2">Evaluation/Assessments</td>\n' +
      '  <td class="colhead" style="width:36%;">Follow Up</td>\n' +
      "</tr>\n" +
      "<tr>\n" +
      "  <!-- LEFT -->\n" +
      '  <td rowspan="5">\n' + renderConcerns(data.parentConcerns) + "\n  </td>\n" +
      "  <!-- MIDDLE -->\n" +
      '  <td class="sub" style="width:8%;">Cognitive</td>\n' +
      "  <td>\n" + renderDomainCell(ev.cognitive) + "\n  </td>\n" +
      "  <!-- RIGHT -->\n" +
      '  <td rowspan="5" class="hi">\n' + renderFollowUp(data.followUp) + "\n  </td>\n" +
      "</tr>\n" +
      "<tr>\n" +
      '  <td class="sub">Academic</td>\n' +
      "  <td>\n" + renderDomainCell(ev.academic) + "\n  </td>\n" +
      "</tr>\n" +
      "<tr>\n" +
      '  <td class="sub">PT/OT</td>\n' +
      "  <td>\n" + renderDomainCell(ev.ptOt) + "\n  </td>\n" +
      "</tr>\n" +
      "<tr>\n" +
      '  <td class="sub">Speech/Other</td>\n' +
      "  <td>\n" + renderDomainCell(ev.speechOther) + "\n  </td>\n" +
      "</tr>\n" +
      "<tr>\n" +
      '  <td colspan="2" class="fsiq">' + fsCell + "</td>\n" +
      "</tr>\n" +
      "</table>"
    );
  }

  parts.push(renderCommentsTable(data));
  return parts.join("\n\n");
}

// ── Redacted variants of the form ────────────────────────────────────────────
// The point of these is that the state is visible. A form with six empty boxes
// looks like a job half done; this looks like what it is.

function renderRedactedStrip(h) {
  const boxes = [stripBox("School", h.school)];
  if (str(h.iepDates)) boxes.push(stripBox("IEP Date(s)", h.iepDates, h.iepNote));
  boxes.push(
    '  <td><span class="lbl">Assessment detail</span><span class="val">Removed with the source documents' +
    '<br><span class="mini">Scores, diagnoses, eligibility category, date of birth and reading levels are no longer held.</span></span></td>'
  );
  return '<table class="strip">\n<tr>\n' + boxes.join("\n") + "\n</tr>\n</table>";
}

function renderRedactedBody(data) {
  return '<table class="body" style="margin-top:4px;">\n' +
    "<tr>\n" +
    '  <td class="colhead" style="width:32%;">Parent Concerns</td>\n' +
    '  <td class="colhead" style="width:26%;">Evaluation/Assessments</td>\n' +
    '  <td class="colhead" style="width:42%;">Follow Up</td>\n' +
    "</tr>\n" +
    "<tr>\n" +
    "  <td>\n" + renderConcerns(data.parentConcerns) + "\n  </td>\n" +
    '  <td class="q">Assessment findings removed.<br><span class="mini">This column held the evaluation results read out of the family&rsquo;s uploaded documents. It went when they did.</span></td>\n' +
    '  <td class="hi">\n' + renderFollowUp(data.followUp) + "\n  </td>\n" +
    "</tr>\n" +
    "</table>";
}

function destroyedNoticeHtml(data) {
  const on = str(data.documentsDestroyedOn);
  return '<div class="note"><b>Source documents destroyed' + (on ? " " + inline(on) : "") + ".</b> " +
    "The IEP and evaluation reports this review was prepared from have been deleted on schedule, and the clinical " +
    "detail has been removed with them &mdash; test scores, FS-IQ, diagnoses, date of birth, eligibility category " +
    "and reading levels no longer appear here, and neither do the assessment findings or the list of documents " +
    "reviewed. What remains is LDAH&rsquo;s own work product: the family&rsquo;s concerns, the follow-up list and " +
    "the consultant&rsquo;s comments.</div>";
}

// ── Part 2: the full document summary ────────────────────────────────────────

function renderSnapshot(items) {
  const rows = arr(items).map(function (it) {
    const o = (it && typeof it === "object") ? it : {};
    if (!str(o.label) && !str(o.value)) return "";
    const note = str(o.note) ? ' <span class="small">' + inline(o.note) + "</span>" : "";
    return "<dt>" + inline(o.label) + "</dt><dd>" + lines(o.value) + note + "</dd>";
  }).filter(Boolean);
  if (!rows.length) return "";
  return '<div class="snap">\n<dl>\n' + rows.join("\n") + "\n</dl>\n</div>";
}

function renderDocumentsReviewed(docs, note) {
  const rows = arr(docs).map(function (d) {
    const o = (d && typeof d === "object") ? d : { label: d };
    if (!str(o.label)) return "";
    return "<tr><td>" + inline(o.label) + '</td><td class="n">' + inline(o.date) +
      "</td><td>" + inline(o.author) + "</td></tr>";
  }).filter(Boolean);
  if (!rows.length) return "";
  let out = "<h2>Documents reviewed</h2>\n<table>\n" +
    "<tr><th>Document</th><th>Date</th><th>Author</th></tr>\n" + rows.join("\n") + "\n</table>";
  if (str(note)) out += '\n<p class="small">' + inline(note) + "</p>";
  return out;
}

function renderFamilyWords(fw) {
  if (!fw || typeof fw !== "object") return "";
  const body = arr(fw.items).map(function (it) {
    const o = (it && typeof it === "object") ? it : { text: it };
    const text = quoted(o.text);
    if (!text) return "";
    if (o.quote) return "<blockquote>" + text + "</blockquote>";
    const label = str(o.label) ? "<b>" + inline(leadIn(o.label)) + "</b> " : "";
    return "<p>" + label + text + "</p>";
  }).filter(Boolean);
  const details = arr(fw.details).map(function (d) {
    const o = (d && typeof d === "object") ? d : {};
    if (!str(o.label) && !str(o.value)) return "";
    return "<dt>" + inline(o.label) + "</dt><dd>" + inline(o.value) + "</dd>";
  }).filter(Boolean);
  if (!body.length && !details.length) return "";
  let out = '<div class="family">\n<h3>' +
    (str(fw.title) ? inline(fw.title) : "In the family&rsquo;s own words &mdash; Parent Report Worksheets") +
    "</h3>\n";
  if (body.length) out += body.join("\n") + "\n";
  if (details.length) out += "<dl>\n" + details.join("\n") + "\n</dl>\n";
  return out + "</div>";
}

function renderDomainSection(d) {
  if (!d || typeof d !== "object" || !str(d.title)) return "";
  const out = ["<h2>" + inline(d.title) + "</h2>"];
  const cols = arr(d.columns).map(function (c) {
    const o = (c && typeof c === "object") ? c : { label: c };
    return "<th" + (o.numeric ? ' class="n"' : "") + ">" + inline(o.label) + "</th>";
  });
  const rows = arr(d.rows).map(function (r) {
    const cells = Array.isArray(r) ? r : arr(r && r.cells);
    const tds = cells.map(function (cell) {
      const a = cellAttrs(cell);
      return "<td" + (a.cls ? ' class="' + a.cls + '"' : "") + ">" + inline(a.text) + "</td>";
    });
    return tds.length ? "<tr>" + tds.join("") + "</tr>" : "";
  }).filter(Boolean);
  if (cols.length || rows.length) {
    out.push("<table>\n" + (cols.length ? "<tr>" + cols.join("") + "</tr>\n" : "") +
      rows.join("\n") + "\n</table>");
  }
  if (str(d.source)) out.push('<p class="src">' + inline(d.source) + "</p>");
  if (str(d.note)) out.push('<p class="small">' + inline(d.note) + "</p>");
  arr(d.commentary).forEach(function (p) {
    if (str(p)) out.push("<p>" + inline(p) + "</p>");
  });
  return out.join("\n");
}

function renderStrengths(s) {
  if (!s || typeof s !== "object") return "";
  const items = arr(s.items).map(function (i) {
    return str(i) ? "<li>" + inline(i) + "</li>" : "";
  }).filter(Boolean);
  if (!items.length) return "";
  return '<div class="strength">\n<h3 style="margin-top:0;color:#15803d;">' +
    (str(s.title) ? inline(s.title) : "Strengths to build on") + "</h3>\n<ul>\n" +
    items.join("\n") + "\n</ul>\n</div>";
}

function renderFlags(flags) {
  const blocks = [];
  let n = 0;
  arr(flags).forEach(function (f) {
    const o = (f && typeof f === "object") ? f : {};
    if (!str(o.title) && !str(o.body)) return;
    n += 1;
    const med = str(o.priority) === "med";
    let out = '<div class="flag">\n<h3><span class="pri' + (med ? " med" : "") + '">' +
      (med ? "MED" : "HIGH") + "</span>" + n + ". " + inline(o.title) + "</h3>\n";
    if (str(o.body)) out += inline(o.body) + "\n";
    if (str(o.why)) out += '<div class="why">' + inline(o.why) + "</div>\n";
    blocks.push(out + "</div>");
  });
  if (!blocks.length) return "";
  return "<h2>Points to raise or verify</h2>\n\n" + blocks.join("\n\n");
}

function renderNotes(notes) {
  return arr(notes).map(function (nt) {
    const o = (nt && typeof nt === "object") ? nt : { body: nt };
    if (!str(o.body) && !str(o.title)) return "";
    const title = str(o.title) ? "<b>" + inline(o.title) + "</b> " : "";
    return '<div class="note">\n' + title + inline(o.body) + "\n</div>";
  }).filter(Boolean).join("\n\n");
}

function renderSummary(data, redacted) {
  const s = (data.summary && typeof data.summary === "object") ? data.summary : {};
  const h = (data.header && typeof data.header === "object") ? data.header : {};
  const parts = ['<h2 id="full" style="margin-top:34px;">Full document summary</h2>'];

  const child = str(h.childName);
  parts.push("<h1>" + (child ? inline(child) + " &mdash; " : "") + "IEP &amp; Evaluation Summary</h1>");
  if (str(s.byline)) parts.push('<p class="byline">' + inline(s.byline) + "</p>");
  if (redacted) parts.push(destroyedNoticeHtml(data));

  if (!redacted) {
    const snap = renderSnapshot(s.snapshot);
    if (snap) parts.push(snap);
    const docs = renderDocumentsReviewed(data.documentsReviewed, s.documentsNote);
    if (docs) parts.push(docs);
  }

  const big = arr(s.bigPicture).map(function (p) {
    return str(p) ? "<p>" + inline(p) + "</p>" : "";
  }).filter(Boolean);
  if (big.length) parts.push("<h2>The big picture</h2>\n" + big.join("\n"));

  const fam = renderFamilyWords(s.familyWords);
  if (fam) parts.push(fam);

  if (!redacted) {
    arr(s.domains).forEach(function (d) {
      const sec = renderDomainSection(d);
      if (sec) parts.push(sec);
    });
    const st = renderStrengths(s.strengths);
    if (st) parts.push(st);
  }

  const flags = renderFlags(s.flags);
  if (flags) parts.push(flags);
  const notes = renderNotes(s.notes);
  if (notes) parts.push(notes);
  if (str(s.footer)) {
    parts.push('<p class="small" style="margin-top:26px;">' + inline(s.footer) + "</p>");
  }
  return parts.join("\n\n");
}

// ── Public renderer ──────────────────────────────────────────────────────────

/**
 * Render the complete Case Review & Summary document.
 *
 * @param {object} data  Conforming to CASE_REVIEW_SCHEMA. Missing optional
 *                       fields degrade to an empty cell or a dropped section —
 *                       never to the string "undefined".
 * @param {object} [opts]
 * @param {boolean} [opts.redacted]  Force the redacted render. Also triggered
 *                                   by data.redacted, which redactCaseReviewData sets.
 * @param {string}  [opts.title]     Override the <title>.
 * @param {boolean} [opts.showJump]  Show the two-part navigation box (default true).
 * @returns {string} A complete HTML document.
 */
function renderCaseReviewHtml(data, opts) {
  const d = (data && typeof data === "object") ? data : {};
  const o = (opts && typeof opts === "object") ? opts : {};
  const redacted = !!(o.redacted || d.redacted);
  const h = (d.header && typeof d.header === "object") ? d.header : {};

  const title = str(o.title) ||
    ((str(h.childName) ? str(h.childName) + " — " : "") + "Case Review & Summary");
  const showJump = o.showJump === undefined ? true : !!o.showJump;

  const top = [
    '<div class="conf">CONFIDENTIAL &mdash; Student education &amp; health records. For LDAH advocacy review only.</div>',
  ];
  if (showJump) {
    top.push('<div class="jump"><b>This page has two parts:</b> the <a href="#cr">Case Review</a> ' +
      '(Rosie&rsquo;s form, typed) and the <a href="#full">full document summary</a> beneath it.</div>');
  }

  return "<!doctype html>\n" +
    '<html lang="en"><head><meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    "<title>" + esc(title) + "</title>\n" +
    "<style>\n" + CASE_REVIEW_CSS + "</style></head><body>" +
    '<div class="topwrap">\n' + top.join("\n") + "\n</div>\n" +
    '<div id="cr">\n\n' +
    renderForm(d, redacted ? destroyedNoticeHtml(d) : "") +
    "\n\n</div>\n" +
    '<div class="wrap">\n' +
    renderSummary(d, redacted) +
    "\n\n</div>\n" +
    "</body></html>";
}

/**
 * Drop the clinical detail, keep LDAH's own work product.
 *
 * Called on the same run that destroys a family's uploaded documents: the
 * summary must not outlive them as a copy of their contents. Kept: parent and
 * child names, session date, school, IEP dates, the parent concerns, the
 * follow-up TITLES with their coverage flags, and the comments. Removed:
 * scores, FS-IQ, diagnoses, DOB, eligibility category, reading levels, the
 * assessment-findings column, the documents-reviewed table, and the per-domain
 * summary sections.
 *
 * ALSO removed, and this is the part that is easy to get wrong: the free PROSE
 * that discusses the evaluations. Stripping the structured score fields is not
 * enough — a flag body reading "WISC-V PSI of 49 is below the 1st percentile"
 * carries the score just as plainly as the field it came from. So
 * followUp[].detail, summary.flags[].body/.why and summary.bigPicture all go.
 * What survives is the LIST of things to check and whether the IEP covers them,
 * which is LDAH's own work product rather than a copy of the child's records.
 *
 * The family's own concerns are deliberately KEPT even though a parent may
 * quote a number in them ("we were told 3.0, it measured 1.8"). Those are the
 * family's own words about their own child, given to us by them; they are not a
 * clinical record we extracted from documents we promised to destroy.
 *
 * The result still renders — as a form that says plainly what happened to it.
 *
 * @param {object} data
 * @returns {object} a copy; the input is not mutated.
 */
function redactCaseReviewData(data) {
  const src = (data && typeof data === "object") ? data : {};
  const out = {};
  Object.keys(src).forEach(function (k) {
    if (REDACTED_TOP_FIELDS.indexOf(k) > -1) return;
    out[k] = src[k];
  });
  if (src.header && typeof src.header === "object") {
    const h = {};
    Object.keys(src.header).forEach(function (k) {
      if (REDACTED_HEADER_FIELDS.indexOf(k) > -1) return;
      h[k] = src.header[k];
    });
    out.header = h;
  }
  if (src.summary && typeof src.summary === "object") {
    const s = {};
    Object.keys(src.summary).forEach(function (k) {
      if (REDACTED_SUMMARY_FIELDS.indexOf(k) > -1) return;
      s[k] = src.summary[k];
    });
    out.summary = s;
  }
  // Free prose about the evaluations carries scores as surely as the score
  // fields do. Strip the narrative, keep the checklist.
  if (Array.isArray(out.followUp)) {
    out.followUp = out.followUp.map(function (f) {
      const item = {};
      Object.keys(f || {}).forEach(function (k) {
        if (k === "detail") return;
        item[k] = f[k];
      });
      return item;
    });
  }
  if (out.summary && typeof out.summary === "object") {
    const s2 = {};
    Object.keys(out.summary).forEach(function (k) {
      if (k === "bigPicture") return;
      s2[k] = out.summary[k];
    });
    if (Array.isArray(s2.flags)) {
      s2.flags = s2.flags.map(function (f) {
        const item = {};
        Object.keys(f || {}).forEach(function (k) {
          if (k === "body" || k === "why") return;
          item[k] = f[k];
        });
        return item;
      });
    }
    out.summary = s2;
  }

  out.redacted = true;
  return out;
}

module.exports = { CASE_REVIEW_SCHEMA, renderCaseReviewHtml, redactCaseReviewData };
