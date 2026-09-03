# Connect-Gen: one procedure for every family

**Date:** 2026-09-02
**Status:** Design approved, ready for implementation planning
**Source:** LDAH staff meeting, 2 September 2026

---

## 1. What we are building

Connect-Gen currently runs two different intake procedures depending on which session
a family picked:

| | Consent | Documents | Worksheet |
|---|---|---|---|
| Monday virtual | required | required | required |
| In person (Oahu Thursday, Hilo, Kona) | none — signed on arrival | none — brought on the day | required |

We are collapsing these into **one procedure**. Every Connect-Gen family, in person or
virtual, completes:

**registration → consent → documents → worksheet**

A family is **confirmed** as soon as all three requirements are in — confirmation is not
time-gated, and a family who finishes two hours before their session is confirmed too.
The 24-hour mark is when we stop waiting: a family still outstanding at T-1 is emailed
alternative dates. Confirmed means *prepared*, not *admitted* — nobody is turned away at
the door for being pending.

Two further changes fall out of the meeting:

- Families who are not ready are offered other dates by email and can move themselves.
- Sessions stop accepting registrations 24 hours before they start.

And one new capability:

- When the session presenter is one of three named parent consultants, the family's
  documents and worksheet are run through the Anthropic API to produce a filled-in
  Case Review form plus a document summary, attached to the signup for the presenter.

### Decisions taken (and by whom)

| Decision | Choice | Source |
|---|---|---|
| Scope of the unified flow | All in-person sessions, no per-location switch | Daniel, 2026-09-02 |
| Not-ready at T-24h | Email alternative dates; family moves themselves | Daniel, 2026-09-02 |
| AI disclosure vs. consent | Cleared with Rosie | Daniel, 2026-09-02 |
| Case Review trigger | Automatic, the moment the family is confirmed | Daniel, 2026-09-02 |
| Signup cut-off | Exactly 24 hours | Daniel, 2026-09-02 |
| Reschedule dates offered | Own location first, virtual as fallback | Daniel, 2026-09-02 |
| Case Review retention | Redacted on document-destruction day | Daniel, 2026-09-02 |
| Late signup enforcement | Flag server-side and offer other dates | Daniel, 2026-09-02 |
| Case Review notification | Session presenter only | Daniel, 2026-09-02 |

### Explicitly out of scope

- Any per-location or per-presenter switch for the intake flow. The meeting floated a
  three-person trial; the decision is a single procedure for everyone.
- Personalised "bring your IEP" wording in reminder emails. Decided against on 2 September.
- Changes to the case-advocacy document vault.

---

## 2. Architecture

### 2.1 The requirement rule

`_cgRequirements(signup, event)` (`functions/index.js:12318`) is the single definition of
"is this family ready". It stops consulting `_cgIsMondayVirtual` and returns
`["consent", "documents", "worksheet"]` for every Connect-Gen signup.

`_cgMaybeConfirm()` (`functions/index.js:12462`) is unchanged. It already re-reads the
signup, asks `_cgRequirements`, and flips `pending → confirmed` only when nothing is
outstanding, forward-only. It is the choke point every requirement path already calls.

`_cgIsMondayVirtual` survives **only** where the dashboard genuinely needs to describe a
session as virtual. It must not survive as a requirement input.

> **Trap.** The rule exists in three places, not one. `maybeSendRegistrationConfirmation`
> re-implements it inline at `functions/index.js:1522–1552` (`_cgMondayVirtual`), despite
> the comment at 12289 claiming it was extracted. `sessionRequiresConsent`
> (`functions/index.js:7091`) is a third variant testing virtual with no Monday check.
> Editing only the helper changes nothing about the consent email.

### 2.2 Intake

The in-person branch at `functions/index.js:1620` is deleted. In-person families fall into
the existing consent branch, which already works: consent email → family signs →
`submitConnectGenConsent` mints `uploadAuthToken` → upload link → worksheet.

`uploadAuthToken` is minted **only** in `submitConnectGenConsent`
(`functions/index.js:11361`). Every existing in-person signup has none, and the entire
parent upload surface is keyed on it. `ensureConnectGenPrepToken` — already wired to the
signup create *and* update triggers — is the right place to also mint `uploadAuthToken`
for every Connect-Gen signup, so the token exists before consent rather than because of it.

**Paper consent.** Some families will still arrive with paper. Staff need a way to record
it, or the family sits at pending forever while the ladder chases someone standing in the
room. Mirror `confirmCaseAdvocacyAuthorizationPaper` from the case-advocacy vault:
a staff-gated function that stamps `consentSignedAt` with `consentMethod: "paper"`.

**Upload link expiry.** `uploadAuthExpiresAt` is currently set seven days from consent.
A family who signs promptly and then takes a fortnight to find the IEP cannot upload at
all, and nothing tells them why. Change the expiry to **the day after their session**,
computed from the session date rather than the signature date.

### 2.3 The deadline ladder

`enforceConnectGenDocDeadline` (`functions/index.js:16756`, daily 08:00 HST) gains a rung
and stops being documents-only.

| Rung | Stamp | Behaviour |
|---|---|---|
| T-7 | `rescheduleOfferSentAt` | Reschedule offer with date buttons. Exists. |
| T-4 | `firmReminderSentAt` | Firmer reminder, dates still live. Exists. |
| T-1 | `finalReminderSentAt` (new) | Last call, dates live, plus a plain note that they are welcome to attend regardless. |

Changes:

1. The cron asks `_cgRequirements` instead of checking documents. The email names what is
   actually missing via the existing `_cgOutstandingPhrase()` (`functions/index.js:12356`).
2. `if (!signup.consentSignedAt) continue` (`functions/index.js:16827`) is removed. Absent
   consent is now *outstanding*, not *out of scope* — leaving this guard in place would
   silently exclude the entire newly-in-scope cohort.
3. The Monday and virtual filters (`functions/index.js:16845–16846`) are removed.
4. **Minimum signup age.** No rung fires until the signup is at least 48 hours old. Without
   this, a family registering 25 hours out matches the T-1 rung on the next 08:00 run,
   possibly minutes after registering.
5. **Existing bug, fixed while here.** The T-4 rung proceeds when `rescheduleOfferSentAt`
   is absent (`functions/index.js:16883–16891`), so a family who registers four days out
   receives *"we still haven't received…"* on their first day in the system.

### 2.4 Offering the right dates

`_findUpcomingMondaysForEvent` (`functions/index.js:16577`) hard-filters to Monday and to
virtual. It becomes location-aware:

- Gather candidates at the family's **own location** first.
- If fewer than two, top up with **virtual** sessions. This is what makes the flow work at
  all for Hilo and Kona, which run monthly — a same-location offer is four weeks out.

> **Trap.** Judge each candidate from the session object's own `location` / `modality`.
> `isSessionVirtual(event, dateKey, signup)` resolves location from the *signup's* session
> strings, so for a candidate date the family is not yet on it silently falls back to the
> event-level location and answers about the wrong thing.

### 2.5 The reschedule token needs a version 2

Payload today is `{v, sid, eid, col, ndk, exp}` — the destination is identified by date key
alone. That is unique only because offers are always Mondays. **Connect-Gen runs two
sessions on the same date** (Kona 09:00–11:00 and Oahu 11:00–13:00 both ran on 2026-08-20),
so as soon as buttons mix locations, `ndk` stops identifying a session.

`v2` adds a session discriminator (the session's `rawString`, or location + start time).
`_verifyRescheduleToken` (`functions/index.js:16519`) already rejects on version mismatch,
so `v1` links in flight keep working until they expire.

`acceptConnectGenReschedule` (`functions/index.js:17002`) drops its Monday check (17106),
its virtual check (17117) and its documents-complete check (17079), and gains a **proximity
check** — a family must not be able to move onto a session starting in two hours.

### 2.6 The AI Case Review

**New Cloud Function `generateConnectGenCaseReview`.**

*Trigger.* Called from `_cgMaybeConfirm` at the moment a family becomes ready, plus a daily
sweep that catches presenters assigned or swapped after confirmation. Generation is
strictly non-fatal — a failed API call must never stop a family being confirmed.

*Gate.* The session presenter, resolved from `sessionSummaries[<session key>].presenterUid`
on the recurring event, must be one of three parent consultants. **Their uids live in
`settings/featureFlags.cgCaseReviewPresenterUids`**, not in source — configurable without a
deploy, and no staff names in a public repository.

*Inputs.* IEP and evaluation from Storage `connectGen/{eventId}/{signupId}/` as native
`document` blocks (phone photos as `image` blocks), plus `parentWorksheet.concerns[]`,
which is already structured and supplies the entire Parent Concerns column.

*The call.* `claude-opus-5`, `thinking: {type: "adaptive"}`, streamed. Uses the existing
`@anthropic-ai/sdk` dependency; a dedicated secret alongside `ANTHROPIC_API_KEY_FLYER`.

*Output is structured JSON, not HTML.* `output_config.format` constrains the response to a
schema — the six header boxes, parent concerns, evaluation findings by domain, and follow-up
items carrying a severity. A fixed template in the function renders the landscape Case
Review grid from that JSON.

This is the central design choice. The two pilot summaries on file were produced by hand;
the first came back as a narrative rather than Rosie's form. A template guarantees the
layout every time, can be corrected without re-running the model, makes the fields
queryable for later reporting, and — see retention below — makes redaction a render mode
rather than a rebuild.

*The form is a gap check.* The right-hand Follow Up column is not free notes. Left and
middle are inputs; the right side is the cross-check that the IEP actually covers every
parent concern and every evaluation finding. The deliverable is gap detection, not
narration. The schema must model that relationship explicitly rather than leaving it to
prose.

*Storage.* Written to `signup.caseSummary` as
`{ html, data, generatedAt, model, docsFingerprint, redactedAt }`.

*Viewing.* No new UI. The Int viewer renders `caseSummary.html` untouched, and the purple
pill, the isolated iframe modal and the `?caseSummary=<collection>__<eventId>__<signupId>`
deep link all already exist. The confidential banner and the "AI-prepared draft, pending
Parent Consultant review" header are retained verbatim.

*Notification.* The session presenter alone receives an email carrying the deep link.

*Regeneration.* `docsFingerprint` hashes the document list plus the worksheet's last edit.
A later upload triggers regeneration on the next sweep. Staff also get a Regenerate button.

*Retention.* The source documents self-destruct four days after attendance
(`scheduledConnectGenDocLifecycle`). On the same run, the Case Review is **redacted**: the
scoring fields are dropped from `caseSummary.data` — test scores, FS-IQ, diagnoses, dates
of birth — and the HTML is re-rendered from the template in redacted mode, leaving the
follow-up items and identified gaps. `redactedAt` is stamped. As with the documents, a
family in open case advocacy is exempt and retains the full version.

> Noted for the record: the follow-up column will still imply some of what was removed —
> a follow-up item reading "test the eligibility classification" carries information about
> the classification. Redaction reduces the surface; it does not eliminate it.

### 2.7 The signup cut-off

*On the page.* `getOccurrencesInNext30Days` (`events.html:4342`) drops sessions inside the
window. The instant must be built as ``new Date(`${dateKey}T${startTime}:00-10:00`)`` — the
public site does all its date maths in the visitor's local timezone with no HST anchoring,
so without this a mainland family gets a different deadline. `openRecurringSignupModal`
already computes a per-row disabled state for FULL sessions; the closed state sits beside
it. Same edit in `STAGE/events.html`, and on the homepage "next session" label
(`index.html:699`) so it stops advertising a session nobody can join.

*On the server.* Registration is an unauthenticated direct Firestore write
(`events.html:4956`; `firestore.rules:69` reads `allow create: if true`), so the page
filter is advisory. Rather than tighten that rule — which governs every signup on the site,
not just Connect-Gen — `handleSignupCreated` gets a Connect-Gen-scoped check: a signup
landing inside the cut-off is flagged and the family is immediately sent the reschedule
offer with the next available dates. This reuses §2.3 rather than adding a second
mechanism, and turns a dead end into a booking.

*Configuration.* `settings/featureFlags.cgSignupCutoffHours`, default 24. Deliberately not
reusing `cgDeadlineEnforcementEnabled`, which despite its name gates the document chaser.

---

## 3. Data model

### New fields on a Connect-Gen signup

| Field | Type | Written by |
|---|---|---|
| `finalReminderSentAt` | Timestamp | T-1 rung of `enforceConnectGenDocDeadline` |
| `consentMethod` | `"online"` \| `"paper"` | consent submit / staff paper record |
| `caseSummary.data` | map | `generateConnectGenCaseReview` |
| `caseSummary.generatedAt` | Timestamp | `generateConnectGenCaseReview` |
| `caseSummary.model` | string | `generateConnectGenCaseReview` |
| `caseSummary.docsFingerprint` | string | `generateConnectGenCaseReview` |
| `caseSummary.redactedAt` | Timestamp | `scheduledConnectGenDocLifecycle` |
| `lateSignupFlaggedAt` | Timestamp | `handleSignupCreated` |

`caseSummary.html` already exists (carrying the two hand-made pilot summaries) and keeps
its meaning.

### New settings

`settings/featureFlags`:

| Key | Type | Default |
|---|---|---|
| `cgSignupCutoffHours` | number | 24 |
| `cgCaseReviewEnabled` | boolean | false; flipped on by Daniel |
| `cgCaseReviewPresenterUids` | string[] | the three parent consultants |

### Changed semantics

`uploadAuthExpiresAt` moves from *seven days after consent* to *the day after the session*.

---

## 4. Traps found during design

These were located by sweeping the codebase and are listed so the implementation plan can
address each explicitly.

1. **The Monday rule exists three times** — `_cgIsMondayVirtual` (12293), an inline copy in
   `maybeSendRegistrationConfirmation` (1522–1552), and `sessionRequiresConsent` (7091).
2. **Deleting the in-person branch silently kills all worksheet chasing.**
   `sendCgWorksheetReminders` selects on `cgWorksheetRequestEmailSentAt`, and that stamp is
   written in exactly one place — the branch being removed (`functions/index.js:1650`). The
   cron keeps running against an empty population with no error and no log. It must be
   re-pointed in the same change.
3. **`sessionRequiresConsent` must not simply be widened.** Its three callers
   (`maybeSendCatchupReminder` 7975, `sendEventReminders` 8097, `sendDayOfReminders` 8558)
   *suppress* reminders for unsigned families. Widening it would silence the 3-day and
   day-of reminders for precisely the in-person families most in need of a nudge.
4. **`flagDayOfPendingSignups`** will start raising "cancel or confirm N pending signups"
   tasks every morning for in-person families who are simply mid-intake.
5. **The dead force-confirm path** at `functions/index.js:1705–1717` would confirm a family
   who owes consent and documents. It goes with the `_cgMondayVirtual` block.
6. **`_sendCgRescheduleEmail` and `_sendConnectGenUploadLaterEmailFor` throw** when
   `uploadAuthToken` is absent — true for every existing in-person signup until §2.2 lands.
7. **The reschedule email contradicts the consent request.** `functions/index.js:8967`
   hardcodes *"No action needed on your end — we just wanted to keep you in the loop."* and
   checks nothing. It must become state-aware.
8. **All reschedule email copy hardcodes "Monday"** — `_buildCgRescheduleEmailHtml` (16620),
   the subject line (16971), and `_formatMondayLabel` (16549).
9. **Int mirrors the rule in five places**, including two easily missed: `cmsCgConfirmBlockedKey`
   (a gate that today lets staff confirm an in-person family with no documents on file) and
   an independent regex test in `cmsConnectGenSummaryHtml` matching
   `/virtual|zoom|all islands/` against the joined session string, which draws the amber
   "In-person" badge and the line "Consent: signed on arrival (in-person)".
10. **`cmsCgUploadReqBtn` returns empty without `uploadAuthToken`**, so the "Email upload
    request" button has never been visible for an in-person family.
11. **`rescheduledFrom` has a type collision** — written here as a string, read elsewhere by
    `crApplyDispositions` as a map. Do not make it worse.

---

## 5. Open items — blocking go-live

1. **The consent text says "virtual".** `CONSENT_TEXT` (`functions/index.js:11191`) reads
   *"…within 48 hours from the date of the CG virtual attendance"* and *"I am sending the
   most current IEP and most current Evaluation(s) via fax, email, or postal service."*
   Asking a Kona family to sign that means asking them to sign a description of an event
   they are not attending. **Rosie must approve revised wording before in-person families
   are asked to sign.** `CONSENT_TEXT_VERSION` is still "02/2021; RR" and did not bump on
   the last wording change; decide whether it tracks this one.
   The text is served from four places — W2 `CONSENT_TEXT`, `connect-gen-consent.html`, and
   both LDAH-Internal copies — and `CASE_ADVOCACY_AUTH_TEXT` reuses it.

2. **Backfill.** Existing pending in-person signups have no `uploadAuthToken`, no consent
   request, and in most cases a complete worksheet. Decide whether they are grandfathered
   at the old rule or migrated onto the new one, and stage any migration behind the existing
   `cgDeadlineEnforcementCutoff` pattern so nobody is mailed retrospectively.

---

## 6. Testing

- `_cgRequirements` returns three requirements for every combination of day and modality.
- `_cgMaybeConfirm` does not confirm an in-person family holding only a worksheet.
- `sendCgWorksheetReminders` still selects a population after the branch removal.
- Date offers for a Kona family fall back to virtual; for an Oahu family they do not.
- A `v2` token round-trips and correctly distinguishes the two sessions sharing 2026-08-20.
- `acceptConnectGenReschedule` refuses a destination inside the cut-off.
- No rung fires for a signup less than 48 hours old.
- A signup created inside the cut-off is flagged and offered dates.
- Case Review renders the grid, not a narrative, from a fixed JSON fixture.
- Redaction removes every scoring field and re-renders without them.
- A failed API call leaves the family confirmed.

---

## 7. Rollout

Per house practice: STAGE first, live by surgical patch, never a wholesale copy.

The Connect-Gen readiness code is currently **byte-identical** between
`LDAH-Internal/index.html` and `LDAH-Internal/STAGE/index.html`, so the dashboard change is
authored once and applied twice at an offset. Do **not** promote by copying regions — three
unrelated things diverge within a few hundred lines of it, in both directions: STAGE holds
the contact-card case-summary functions and the Participation report, live holds the IT Help
report and the partner-user report filtering.

Order:

1. Token minting and upload-expiry fix (§2.2) — safe on its own, no behaviour change.
2. Worksheet-reminder re-point (§4 item 2) — must land with or before step 3.
3. The requirement collapse, server and dashboard (§2.1, §2.2).
4. The ladder and the `v2` token (§2.3–2.5).
5. The signup cut-off (§2.7).
6. The Case Review, shipped behind `cgCaseReviewEnabled` (§2.6).

**Step 3 does not go live until the revised in-person consent wording is agreed** (§5.1) —
that is the wording that currently describes "virtual attendance", and it is a separate
question from the AI disclosure, which Rosie has already cleared. Step 6 is not blocked by
it: virtual families can be summarised on the existing consent, and in-person families
simply have no documents to summarise until step 3 lands.
