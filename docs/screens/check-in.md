# Check-in — event entry validation and fulfillment

Covers QA_WORKFLOWS EVENT-09 (camera-permission gate, honest fallback), EVENT-10 (valid check-in), EVENT-11 (rejection matrix), and EVENT-12 (duplicate check-in) for the seeded fixture, per the NIP-97 fulfillment contract in `venue-commerce-nip.md` §6. Scanner hardware, concurrent scanners, and the attendee list surface are later slices.

## Purpose

Prove that a staff member can check a guest into the seeded event through the public UI: a valid kind `27236` presentation yields exactly one `37237` `status=fulfilled` status with `d=event:<event coordinate>` on the venue relay — verified independently — while an already-fulfilled presentation and a wrong-event presentation each produce a specific rejection and zero writes. The camera path is gated behind a button and honestly reports that this build ships no scanner.

## Persona and permission

Staff identity (QA admin key) with venue authority on an isolated venue relay provisioned for the run (`events` permission domain). Identity is installed only through the dev-only `craysboard://qa-seed` deep link; the screen is reached through the `craysboard://check-in` deep link.

## Starting truth

- Isolated relay `craysboardqa-venue-<run>`; the relay node bootstraps the NIP-11 root key and the root-signed community anchor `31727` (`d=community`; admin `p` tags + `badge_issuer` tag) from which every authority below derives (venue-commerce-nip §1). Seeded, each signed by its proper authority and round-tripped until queryable:
  - venue profile `30078` (`d=nuts-community-profile`, `type=hospitality`, admin-signed);
  - ticket definition `30402` (`d=qa-event-access-<run>`, `title`,
    `["price", amount, currency]` so the badge issuer may award it, `a` = the
    seeded event's coordinate, explicit `max_uses=1`, admin-signed);
  - timed calendar event `31923` (`d=qa-event-<run>`, admin-signed) — the ticket points at the event; the event carries no `a` reference back;
  - two kind `8` awards of that ticket definition (badge-issuer-signed, each
    with the query hints `["t","30402"]` and `["t","event_access"]`; the
    definition's `a` link is authoritative): `award_id` to `users[0]`
    (untouched) and `award2_id` to `users[1]` (pre-fulfilled — one
    delegated-issuer-signed `37237` `status=fulfilled` with
    `d=event:<event coordinate>` and matching `event` tag already stored);
  - three signed kind `27236` presentations in the scenario state file, each
    with `expiration = created_at + 90`; fixture timestamps stay within the
    validator's bounded clock-skew allowance so the native flow can complete:
    a valid one (holder `users[0]`, bound to the event coordinate, `award_id`,
    and the ticket definition), an already-fulfilled one (holder `users[1]`,
    referencing `award2_id`), and a wrong-event one (valid except its `event`
    tag carries an unknown event coordinate).
- Presentation payload shape (validated, never written by Board): signed by
  the holder key; content empty; tags
  `["type","nuts_entitlement_presentation"]`, `["nonce", r]`,
  `["expiration", created_at + 90]`, `["e", awardId]`,
  `["a", ticket definition address]`, `["r", device-reachable selected relay
  URL]`, and exactly one of `["order", ref]` / `["event", coordinate]`;
  entered in the app as `nuts:present:<base64url(JSON)>` (unpadded base64url).
- App installed, state cleared, Metro on 8090, one Android device.

## User action

Open the seed deep link, then the `craysboard://check-in` deep link. For each of the three seeded presentations (read from the scenario state file by the flow): tap `check-in-code-input`, type the `nuts:present:` wire payload, tap `check-in-submit` — valid first, then the already-fulfilled one, then the wrong-event one. Finally tap `check-in-scan-button`.

## Visible result

- `check-in-screen` appears with the event title (`check-in-event-title`), the summary panel (`check-in-expected-count` = 2, `check-in-checked-in-count` = 1, `check-in-progress` = "1 of 2 checked in" — the pre-fulfilled award counts from relay truth), the manual entry panel, and the scanner panel.
- After the valid submission, `check-in-result-success` shows **Entry accepted** and the progress line advances to "2 of 2 checked in" from the relay echo — never before relay acknowledgement.
- After the already-fulfilled submission, `check-in-result-error` shows **Already checked in**. After the wrong-event submission, it shows **This pass is for a different event.**
- Tapping `check-in-scan-button` reveals `check-in-camera-unavailable` with **Camera not available in this build** and guidance to use manual entry; no permission prompt, no fake preview.
- The input clears after every submission so the device is ready for the next guest.

## Authoritative result

- The venue relay contains exactly one kind `37237` for `e=<award_id>` with the exact NIP-97 tag set: `["status","fulfilled"]`, `["a",<ticket definition address>]`, `["e",<award_id>]`, `["p",<users[0] pubkey>]`, `["event",<event coordinate>]`, `["d","event:<event coordinate>"]` (`d` MUST equal the `event` tag value prefixed by `event:`), signed by the staff key, valid signature, `created_at >= award.created_at`. This is also the idempotency proof: validation plus the synchronous in-flight guard plus the locally-fulfilled set stop repeat submissions, and any retry would reuse the same `d` and replace itself — exactly one event per author and context (venue-commerce-nip §5).
- The relay still contains exactly one `37237` for `e=<award2_id>` — the pre-seeded one — and exactly two `37237` events total: both rejection attempts wrote nothing.
- Logcat `[crays-board-check-in]` carries the event id, definition address, and expected/checked-in counts; `[crays-board-check-in-status]` carries the same fulfilled status event id that landed on the relay.

## Forbidden result

- No `37237` write from any rejection path (wrong event, already checked in,
  or any other rejection class), no second fulfilled status for the same award
  (including resubmission before the relay echo), no write to any other relay,
  no status write before relay acknowledgement is presented as success, no
  camera permission request on screen open, and no nsec/private hex in logcat
  or QA state. Synthetic presentations remain confined to the mode-`0600`
  scenario state and are never logged.

## Lifecycle boundary

A resubmission of the just-fulfilled presentation before the relay echo arrives still yields **Already checked in** and no write (locally-fulfilled guard). Subscription cleanup on unmount/background follows the shared `board_checkin_<relay>` pattern; returning to the screen re-derives counts from relay truth.

## Cleanup

Scenario teardown deletes exactly the owned relay, its docker volume, the app
package state, and the scenario state file (which holds the synthetic,
short-lived fixture presentations — never logged). The node-bootstrapped root
key material lives and dies with the relay container.

## Harness note

`runRelayScreenScenario` JSON-encodes the three synthetic presentations from
the mode-`0600` scenario state into scoped Agent Device environment values. The
flow types them into the public input; runner failures sanitize subprocess
arguments, and the payloads are never printed to logs.
