# Connect-Gen Parent Report Worksheet — Design

**Date:** 2026-07-14
**Status:** Approved for phased build

## The problem

Connect-Gen families are asked to complete a paper worksheet — *Parent Report Worksheet: Concerns Affecting Education* — before their session. It is a PDF, attached to the confirmation email, and almost nobody fills it in. Staff arrive at a two-hour session without knowing what the family's actual concerns are.

Separately, a signup becomes **confirmed** the moment the consent is signed — before documents are uploaded, and before any preparation exists. So "confirmed" currently means "we have permission to look at their file", not "this family is ready and we can help them".

## What we're building

A web version of the worksheet, one per Connect-Gen registration, plus a real definition of *ready*: a signup stays **pending** until everything that applies to that family is done.

### The gate

| Session type | Consent | Documents uploaded | Worksheet |
|---|---|---|---|
| **Monday virtual** (`zoomMode: program`) | required | required | required |
| **Thursday Oahu / Hilo / Kona** (in person) | — | — (family brings them) | required |

`status: confirmed` only when every applicable requirement is met. Otherwise `pending`.

In-person families have no consent and no upload — they physically bring the IEP — so the worksheet is their only requirement.

## The worksheet

Five columns from the paper form, presented **vertically** — a wide five-column table is unusable on a phone, and parents fill this in on a phone.

| Col | Field | Filled by |
|---|---|---|
| A | Concerns | Parent |
| B | Evidence of the Problem | Parent |
| C | Factors That Relate to the Problem | Parent |
| D | Type of Test / Assessment Needed | Parent, **often staff** |
| E | Possible Interventions, Accommodations, Special Services | Parent, **often staff** |

**Rules**

- **All five fields are required per concern, but `n/a` is an acceptable answer.** Many parents genuinely will not know what assessment is needed — that is what the session is *for*. Requiring a response without requiring knowledge is the point.
- **Any number of concerns.** Complete one, then choose *Finish* or *Add another concern*.
- **The worked example is shown in the UI**, not buried in a PDF:
  *Annie reads slowly and confuses words when reading · Teacher's notes and report cards mention this concern · Annie wears glasses and may not be able to see the words well · Vision assessment · Extra time for reading, reading remediation*
- Complete = at least one concern with all five fields non-empty.

## Authentication: the prep token

The existing `uploadAuthToken` is minted **only when a consent is signed**, which only happens for Monday virtual families. In-person families have no token at all, so there is nothing to authenticate a worksheet link for them.

**Mint a `prepToken` on every Connect-Gen signup, at signup creation, for all session types.** 24 random bytes, same pattern as `uploadAuthToken`. It is the key for the worksheet link and is the only thing an in-person family ever needs.

`uploadAuthToken` is left exactly as it is. Document upload keeps working unchanged.

## Data model

On the signup document:

```js
parentWorksheet: {
  concerns: [
    { a: "...", b: "...", c: "...", d: "n/a", e: "n/a" },
    ...
  ],
  completedAt:     Timestamp,   // when the parent submitted
  lastEditedAt:    Timestamp,   // any save, parent or staff
  lastEditedBy:    "parent" | "<staff email>",
  staffEdits: [                 // append-only; the parent's words are never silently overwritten
    { at: Timestamp, by: "<staff email>", field: "1.d", from: "n/a", to: "Vision assessment" }
  ]
}
```

`prepToken` and `prepTokenExpiresAt` also live on the signup.

**Timestamps inside arrays use `Timestamp.now()`, never `serverTimestamp()`** — Firestore rejects sentinel values inside array elements.

## Email flow

Today: consent signed → status `confirmed` → **"You're Confirmed"** email, which is also the email that *asks* for documents. That cannot survive the new gate: the confirmation email would fire before the family has done anything.

New sequence:

1. **Signup (Monday virtual)** → *"Action needed — consent form"* — unchanged.
2. **Signup (in person)** → **NEW** *"Complete your Parent Report Worksheet"* — with a worksheet button. Their only requirement.
3. **Consent signed (Monday virtual)** → **NEW** *"Consent received — 2 steps left"* — buttons for **Upload Documents** and **Complete Worksheet**, showing exactly what is outstanding.
4. **All requirements met** → *"You're Confirmed"* — the existing email, with prep documents and Zoom details. Now it means what it says.

The button Daniel asked for goes on the emails that **ask** (2, 3, and the reminders) — not on the confirmation email, which by definition only fires once there is nothing left to ask for.

## Reminders and the deadline

A cron already exists: `enforceConnectGenDocDeadline`, running daily at 08:00, gated by `settings/featureFlags.cgDeadlineEnforcementEnabled` — **which is already `true`** (since 2026-05-12). It sends a **T-7 reschedule offer** and a **T-4 firm reminder** to families missing documents.

**Extend it rather than build a second reminder engine.** It becomes `enforceConnectGenPrepDeadline` in behaviour, checking *all* applicable requirements, not just documents.

- **T-7** — reschedule offer (existing behaviour, now also triggered by a missing worksheet).
- **T-4** — firm reminder listing what is still outstanding.
- **T-1** — **the hard deadline.** Everything must be complete at least one day before the session so staff have time to review.

**At T-1, if anything is incomplete: flag to staff. Do not auto-cancel.**
The signup stays `pending` and surfaces prominently — in the daily report and on the dashboard — as *"session tomorrow, prep incomplete"*. Staff decide whether to call the family, let them attend anyway, or reschedule.

Nothing is taken away from a family automatically. This is a disability parent-training centre; a parent struggling with a form is exactly the parent who most needs the session.

## Staff surfaces

The worksheet is viewable and **editable** from two places:

- the **Connect-Gen signup card** (signups modal), and
- the **contact card**.

Staff may edit **any** field — in practice D and E, filled in by the advocate after speaking with the family. Every save records **who** and **when** in `staffEdits`, so the parent's original words are always recoverable and never silently overwritten.

## Phases

Each phase is built, pushed to STAGE, and approved before the next begins. The status gate touches real families' registrations, so it does not ship in the same breath as everything else.

**Phase 1 — the worksheet exists**
`prepToken` on every Connect-Gen signup · the public worksheet form · save/load Cloud Functions · staff view + edit on the signup card and contact card.
*Nothing about status or emails changes. Safe to ship on its own.*

**Phase 2 — the gate**
Requirement helper (`_cgRequirements`) · status stays `pending` until all applicable requirements are met · the new email sequence.
*This is the risky phase. It changes what "confirmed" means.*

**Phase 3 — reminders and the deadline**
Extend the existing cron to check all requirements · T-1 hard deadline · staff flag in the daily report and dashboard.

## Risks

- **Phase 2 changes the meaning of `confirmed`.** Verified against live data: only two Connect-Gen signups currently have a future session, and only one is gated (Daniel's own test, already complete). Nobody is disrupted by tightening the rule now. This is the right moment.
- **`enforceConnectGenDocDeadline` is already live and sending mail.** Changes to it reach real families on the next 08:00 run. Test on STAGE against a copied signup, never by letting the cron fire.
- **In-person families have never received Connect-Gen prep email before.** Phase 2 introduces a new email to an audience that has never had one. Worth Rosie's eyes on the wording before it sends.
