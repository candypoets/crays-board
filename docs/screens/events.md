# Events — list, detail, and open/free create (vertical slice)

Covers QA_WORKFLOWS EVENT-01 (list/detail projection for the seeded fixture), EVENT-02/EVENT-03 (details/schedule draft validation, unit-tested), EVENT-04 (open/free publish with repeat-tap idempotency), and EVENT-08 (RSVP projection, latest-per-attendee) for the seeded fixture. The check-in desk itself (EVENT-09–12) is covered by docs/screens/check-in.md and reachable from the detail panel header. Later slices extend this contract to restricted/paid admission (EVENT-05/06/07) and illustration upload.

## Purpose

Prove that a signed venue calendar event and its RSVPs appear through the public UI with truthful accepted/tentative/declined counts, and that one deliberate Publish of a valid open/free event creates exactly one correct kind `31923` on the venue relay — verified independently, never from rendered text alone. A double-tap on Publish still produces exactly one event.

## Persona and permission

Staff identity (QA admin key) with venue authority on an isolated venue relay provisioned for the run (`events` permission; the seed identity is the full-permission admin). Identity is installed only through the dev-only `craysboard://qa-seed` deep link.

## Starting truth

- Isolated relay `craysboardqa-venue-<run>` with the base venue family (profile `30078`, product `30009`, issuer award `8`) plus:
  - one upcoming kind `31923` (`d=qa-event-<run>`, title "QA Seed Event", `start`/`end` in the future, `summary`, `location=QA Hall`, `capacity=48`), signed by the venue admin authority;
  - a non-sellable members badge definition (`30009`, `d=members`, issuer-signed) and three membership badge grants (kind `8`, issuer-signed) — the relay write gate only accepts guest writes from current members;
  - four kind `31925` RSVPs referencing the event address: users[0] declined (older `created_at`, distinct `d` so both copies stay stored) then accepted (superseding copy), users[1] accepted, users[2] tentative — each signed by its own attendee key. Relay fold truth: accepted=2, tentative=1, declined=0.
- App installed, state cleared, Metro on 8090, one Android device.

## User action

Open the seed deep link, navigate to Events (`craysboard://events`), open the seeded event's detail panel, close it, then tap **Create** and complete the wizard: details (title "QA Event `<awardIdPrefix>`", summary, category Gathering), schedule (2027-01-15, 18:00–20:00, capacity 40), admission (Open & free, preselected), and **double-tap** Publish.

## Visible result

- `events-screen` appears with Upcoming/Past/All tabs and search; the seeded card shows the title, schedule, "2 going", and capacity.
- The detail panel (`event-detail-panel`) shows schedule, device timezone, location, capacity 48, Accepted 2 / Tentative 1 / Declined 0, Open & free admission, and an **Open check-in** action in the panel header that routes to the check-in desk (`/check-in`, see docs/screens/check-in.md). Detail rows scroll when they overflow the viewport.
- Wizard step validation blocks blank/short titles, malformed dates/times, end-before-start, past starts, and invalid capacity with inline errors and no publish.
- Publish stays pending until relay acknowledgement; only then does the app return to the list, where the created event appears from the live subscription.

## Authoritative result

- The venue relay contains exactly one kind `31923` with the created title: signed by the staff (admin) key, valid signature, tag names exactly `d`, `title`, `start`, `end`, `summary` (open/free contract for this slice), `end > start`, non-empty `d`. The admin authored exactly two `31923` total (seeded + created). This exact-one assertion is the double-tap idempotency proof.
- The independent RSVP fold over kind `31925` (latest per attendee) for the seeded address is exactly accepted=2, tentative=1, declined=0; the logcat `[crays-board-event]` marker for the seeded address reports the same counts, and a marker for the created title exists with zero RSVPs.
- `[crays-board-event-published]` carries the same event id that landed on the relay.

## Forbidden result

- No second created `31923` (including from a double-tap or a tap while publishing), no calendar event before the user publishes, no write to any other relay, no RSVP from one event counted on another, no untrusted-author event in the projection, no nsec/private hex in logcat or QA state.

## Lifecycle boundary

The create wizard keeps one draft across step navigation; the draft's `d` identifier is generated once, so a retry after an acknowledgement timeout republishes the same addressable event instead of multiplying events. Subscription teardown on unmount/background follows the shared useOrders pattern.

## Cleanup

Scenario teardown deletes exactly the owned relay, its docker volume, the app package state, and the scenario state file.

## Deferred to later slices

- Category/location/capacity are captured and validated in the draft but not serialized onto the published `31923` in this slice (exact open/free tag set); `t`/`location`/`capacity` writer tags ship with the restricted/paid admission work (EVENT-05/06).
- Illustration upload, restricted and paid admission, sats prerequisite, camera-scanner check-in (the check-in desk ships without the scanner, see check-in.md), event editing/cancellation.
