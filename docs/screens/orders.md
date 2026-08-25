# Orders — live kitchen queue (vertical slice)

Covers QA_WORKFLOWS ORDER-01, ORDER-03 (first step), ORDER-05 (repeat tap and relaunch persistence), and the relay-truth projection of ORDER-08 for the seeded fixture. Later slices extend this contract to the full ladder, decline/cancel, retry, and venue switching.

## Purpose

Prove that a trusted guest purchase appears as a New order through the public UI and that one deliberate Accept publishes exactly one valid `37237` status to the venue relay — verified independently, never from rendered text alone. A double-tap on Accept still produces exactly one status event, and a relaunch restores the Accepted state from relay truth.

## Persona and permission

Staff identity (QA admin key) with venue authority on an isolated venue relay provisioned for the run. Identity is installed only through the dev-only `craysboard://qa-seed` deep link.

## Starting truth

- Isolated relay `craysboardqa-venue-<run>` with its NIP-11 root key,
  root-signed `31727` community anchor, root-authored invite-membership
  definition, venue profile `30078` (`d=nuts-community-profile`,
  `type=hospitality`, anchor-admin-signed), one sellable kind `30402` NIP-99
  product listing (`title` and `price` tuple, no event link, defaults to one
  use), and one kind `8` award for that listing signed by the anchor's
  delegated badge issuer (the implicit-pending order).
- App installed, state cleared, Metro on 8090, one Android device.

## User action

Open the seed deep link, wait for the Orders screen, **double-tap** Accept on the pending order card. After the card shows "Accepted", stop the app and re-open the same seed deep link (identity and venue restore from SecureStore; the qa-seed route reinstalls) — without tapping anything on the restored screen.

## Visible result

- `orders-screen` appears; a card `order-card-<awardIdPrefix>` shows the seeded item name and "New".
- After the double-tap, the card shows "Accepted" once; the button does not offer a second Accept and no second publish is attempted while the first is in flight.
- After relaunch, the card shows "Accepted" again (never "New") without any user action on the restored screen.

## Authoritative result

- The venue relay contains exactly one current kind `37237` for the order:
  `status=accepted`, `a=<30402 listing address>`, `e=<awardId>`,
  `p=<holder>`, `order=<awardId>`, and `d=order:<awardId>`, signed by the
  staff key with a valid signature and `created_at >= award.created_at`.
  Kind `37237` is addressable by that context, so a retry replaces the same
  current status instead of creating append-only transition history. This
  exact-one assertion is the repeat-tap idempotency proof.
- Logcat `[crays-board-order]` contains the award id and definition address; `[crays-board-order-status]` contains the same status event id that landed on the relay.
- The restored projection comes from the venue relay subscription (kinds
  `5`/`8`/`30009`/`30402`/`31727`/`37237`, no cache); role definitions,
  awards, and revocations authorize delegated `37237/write` staff. The
  relaunched "Accepted" is relay truth, not local memory.

## Forbidden result

- No second `37237` for the same context (including from a double-tap or a tap while the first publish is in flight), no write to any other relay, no status event before the user tap, no nsec/private hex in logcat or QA state.

## Lifecycle boundary

Relaunch after Accept: the app is stopped, the seed deep link is re-opened, and the card still shows Accepted (relay truth), not New — with no tap on the restored screen.

## Cleanup

Scenario teardown deletes exactly the owned relay, its docker volume, the app package state, and the scenario state file.
