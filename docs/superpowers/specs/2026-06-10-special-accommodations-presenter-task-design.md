# Special Accommodations → Presenter Task

**Date:** 2026-06-10
**Project:** LDAH (ldah-932d5 Cloud Functions)
**Status:** Approved design, pending implementation

## Problem

When someone submits a signup/registration and types something into the
"special accommodations" field, that note currently lands silently in the
signup document. No one is alerted to act on it. Presenters arrive at an
event unaware a participant needs an accommodation. (Triggering example:
Tara Mossman's recent signup.)

## Goal

On signup creation, if the special-accommodations note is non-empty,
auto-create an **Open follow-up task** in the existing `interactions`
system, routed to the person responsible for the event, due on the event
date, showing the note verbatim plus a short instruction on what to do.

## Scope

- Fires for **any event type** that carries an accommodations note (Learning
  Labs, Connect-Gen, Parent Talk Café, one-off events). Not restricted to
  LL/CG.
- No new collections, no schema changes. Reuses the lifecycle interaction
  helpers already in `functions/index.js`.

## Where it hooks in

A new helper (`createAccommodationsTask`) called from `handleSignupCreated()`
— the shared handler that both exported triggers funnel through:

- `onEventSignupCreated` → `events/{eventId}/signups/{signupId}`
- `onRecurringEventSignupCreated` → `recurringEvents/{eventId}/signups/{signupId}`

Called after the existing contact-linking step. Because it lives in
`handleSignupCreated()`, a single implementation covers every event type and
both collections.

## Behavior

### 1. Read the note (tolerant)

Field names drift in this codebase. Check in order, first non-empty wins:

1. `signup.registration.accommodations`
2. `signup.registration.accommodationsNeeded`
3. `signup.accommodations`
4. `signup.additionalComments`

Trim whitespace. **If empty after trim, return immediately** — this is the
common case for the vast majority of signups.

### 2. Resolve the assignee

Fetch the parent event doc (collection + `context.params.eventId`).

| Condition | Assignee (`ownerUid` / `owner`) |
|-----------|---------------------------------|
| Presenter assigned | `event.summary.presenterUid` / `event.summary.presenter` |
| No presenter yet | **Program creator**: `event.createdByUid` / `event.createdByName` |
| Neither present (legacy) | Fall back to `LIFECYCLE_LAA_UID` (La'akea); note in task body that it was auto-routed |

Routing is decided **at signup time**. If a note arrives before a presenter
is assigned, it goes to the creator and stays there even if a presenter is
named later. Reassign-on-presenter-change is intentionally out of scope (YAGNI).

### 3. Due date

`extractSignupSessionKeys(signup)[0]` → earliest selected date (`YYYY-MM-DD`).

- Learning Labs (multi-date `selectedDates`): picks the soonest date.
- Connect-Gen (single `selectedSessions`): that one date.

If no parseable date exists, leave `followUpDate` empty (task still created,
just without a due date) rather than dropping the task.

### 4. Build the task

Written to the `interactions` collection via `_lcBuildInteractionDoc(...)`:

| Field | Value |
|-------|-------|
| `interactionType` | `"Special Accommodations"` |
| `channel` | `"Event Prep"` |
| `contactName` | event title + earliest date |
| `summary` | `Special accommodations requested by <attendee name> — review before the event.` |
| `notes` | guidance line + verbatim note (see below) |
| `followUpDate` | earliest date (`YYYY-MM-DD`) |
| `status` | `"Open"` |
| `workflowEventId` | event id |
| `workflowEventCollection` | `"events"` or `"recurringEvents"` |
| `workflowStep` | `"accommodationsNote"` |
| `workflowSessionKey` | earliest date key |

**`notes` body:**

> A participant requested special accommodations for this event. Review the
> note below and arrange what's needed before the session. Contact the family
> if you need clarification.
>
> **From &lt;name&gt;:** "&lt;their note, exactly as typed&gt;"

(If auto-routed to La'akea via the legacy fallback, prepend a one-line note
that no presenter/creator was found.)

### 5. Notification

The task carries `followUpDate` and `status: "Open"`, so it surfaces
automatically in the assignee's My Day / follow-ups / bell — the existing
notification surface. No separate alert is created.

### 6. Idempotency

Keyed on this signup + step so a retriggered function won't duplicate. Use a
signup-scoped key (e.g. `workflowStep: "accommodationsNote"` combined with a
stored `linkedSignupId` / signup path, queried via `_lcCreateIfMissing` or an
equivalent existence check that includes the signup id). Different families'
notes for the same event/session each get their own task (keyed by signupId,
not by session alone).

## Failure handling

- Missing/blank note → no-op (return early).
- Event doc fetch fails → log and skip task creation; never throw out of
  `handleSignupCreated()` (must not break contact linking or other signup
  side effects).
- No assignee resolvable at all → La'akea fallback ensures it's never silently
  unassigned.

## Deployment notes

- The new logic ships inside `handleSignupCreated()`, which is invoked by the
  exported triggers `onEventSignupCreated` and `onRecurringEventSignupCreated`.
  Per the CF-helper-deploy rule, **redeploy both exported triggers** for the
  change to take effect.
- Firebase project: ldah-932d5.

## Out of scope (YAGNI)

- Reassigning the task when a presenter is named after signup.
- Editing/re-running on signup *update* (onCreate only).
- Surfacing accommodations in any UI beyond the standard interaction card.

## Test plan

- Note present, presenter assigned → task to presenter, correct due date.
- Note present, no presenter → task to creator.
- Note present, no presenter + no creator → task to La'akea with auto-route note.
- Note blank → no task.
- LL multi-date signup → due date = earliest.
- CG single-date signup → due date = that date.
- Retrigger same signup → no duplicate task.
- Two different signups, same event/session, both with notes → two tasks.
- Verbatim note with quotes/apostrophes → rendered intact in `notes`.
