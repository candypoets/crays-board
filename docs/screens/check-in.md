# Check-in — event entry validation and fulfillment

Covers QA_WORKFLOWS EVENT-09 (camera-permission gate, honest fallback), EVENT-10 (valid check-in), EVENT-11 (rejection matrix), and EVENT-12 (duplicate check-in) for the seeded fixture, per venue-commerce-nip §8. Scanner hardware, concurrent scanners, and the attendee list surface are later slices.

## Purpose

Prove that a staff member can check a guest into the seeded event through the public UI: a valid kind `27236` presentation yields exactly one `37237` `status=fulfilled` `context=event` status on the venue relay — verified independently — while an already-fulfilled presentation and a wrong-event presentation each produce a specific rejection and zero writes. The camera path is gated behind a button and honestly reports that this build ships no scanner.

## Persona and permission

Staff identity (QA admin key) with venue authority on an isolated venue relay provisioned for the run (`events` permission domain). Identity is installed only through the dev-only `craysboard://qa-seed` deep link; the screen is reached through the `craysboard://check-in` deep link.

## Starting truth

- Isolated relay `craysboardqa-venue-<run>` with, each signed by its proper authority and round-tripped until queryable:
  - venue profile `30078` (`d=nuts-community-profile`, `type=hospitality`, admin-signed);
  - event-access definition `30009` (`type=event_access`, `t=event_access`, `t=sellable`, `max_uses=1`, expiring, admin-signed);
  - timed calendar event `31923` referencing the definition as its entrance badge via its `a` tag (admin-signed);
  - two kind `8` awards for that definition (badge-issuer-signed): `award_id` to `users[0]` (untouched) and `award2_id` to `users[1]` (pre-fulfilled — one admin-signed `37237` fulfilled/event status already stored);
  - three signed kind `27236` presentations in the scenario state file: a valid one (holder `users[0]`, bound to the event, `award_id`, and definition, expiring in one hour), an already-fulfilled one (holder `users[1]`, referencing `award2_id`), and a wrong-event one (valid except its `event` tag references an unknown event id).
- Presentation payload shape (validated, never written by Board — venue-commerce-nip §2): signed by the holder key; tags `p` = holder (must equal the signer), `e` = award event id, `a` = event-access definition address, `event` = the `31923` event id, `expiration` = NIP-40 unix expiry (required).
- App installed, state cleared, Metro on 8090, one Android device.

## User action

Open the seed deep link, then the `craysboard://check-in` deep link. For each of the three seeded presentations (read from the scenario state file by the flow): tap `check-in-code-input`, type the presentation JSON, tap `check-in-submit` — valid first, then the already-fulfilled one, then the wrong-event one. Finally tap `check-in-scan-button`.

## Visible result

- `check-in-screen` appears with the event title (`check-in-event-title`), the summary panel (`check-in-expected-count` = 2, `check-in-checked-in-count` = 1, `check-in-progress` = "1 of 2 checked in" — the pre-fulfilled award counts from relay truth), the manual entry panel, and the scanner panel.
- After the valid submission, `check-in-result-success` shows **Entry accepted** and the progress line advances to "2 of 2 checked in" from the relay echo — never before relay acknowledgement.
- After the already-fulfilled submission, `check-in-result-error` shows **Already checked in**. After the wrong-event submission, it shows **This pass is for a different event.**
- Tapping `check-in-scan-button` reveals `check-in-camera-unavailable` with **Camera not available in this build** and guidance to use manual entry; no permission prompt, no fake preview.
- The input clears after every submission so the device is ready for the next guest.

## Authoritative result

- The venue relay contains exactly one kind `37237` for `e=<award_id>`: `status=fulfilled`, `context=event`, `d=<award_id>`, `a=<event-access definition address>`, `p=<users[0] pubkey>`, signed by the staff key, valid signature, `created_at >= award.created_at`. This is also the idempotency proof: validation plus the synchronous in-flight guard plus the locally-fulfilled set stop repeat submissions (§8.4).
- The relay still contains exactly one `37237` for `e=<award2_id>` — the pre-seeded one — and exactly two `37237` events total: both rejection attempts wrote nothing.
- Logcat `[crays-board-check-in]` carries the event id, definition address, and expected/checked-in counts; `[crays-board-check-in-status]` carries the same fulfilled status event id that landed on the relay.

## Forbidden result

- No `37237` write from any rejection path (wrong event, already checked in, or any other rejection class), no second fulfilled status for the same award (including resubmission before the relay echo), no write to any other relay, no status write before relay acknowledgement is presented as success, no camera permission request on screen open, no nsec/private hex in logcat or QA state.

## Lifecycle boundary

A resubmission of the just-fulfilled presentation before the relay echo arrives still yields **Already checked in** and no write (locally-fulfilled guard). Subscription cleanup on unmount/background follows the shared `board_checkin_<relay>` pattern; returning to the screen re-derives counts from relay truth.

## Cleanup

Scenario teardown deletes exactly the owned relay, its docker volume, the app package state, and the scenario state file (which holds the synthetic, one-hour-expiry fixture presentations — never logged).

## Harness note

`runRelayScreenScenario` passes a fixed env set to Maestro, so the flow reads the three presentation payloads from the scenario state file (`$CRAYS_BOARD_QA_STATE`) via a `runScript` helper (`maestro/flows/read-check-in-presentations.js`) instead of an env placeholder. The payloads are typed into the input and never printed to logs.
