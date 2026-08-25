# Settings — venue profile, memberships, payments, room (vertical slice)

Covers QA_WORKFLOWS PROFILE-01 (load and save), MEMBER-01 (list) and MEMBER-02 (availability flip with stable `d`), PAYMENT-01 (status truth), ROOM-01 (manifest and relay health) and ROOM-02 (gateway truth separation), and SETTINGS-01 (sub-navigation) for the seeded fixture. Later slices extend this contract to membership creation, profile media, the Stripe onboarding handoff, and room-manifest publishing.

## Purpose

Prove that Settings loads relay truth for the selected venue and that two deliberate mutations — a profile description save and a membership availability flip — each publish exactly one correctly shaped event at their stable `d` to the venue relay, verified independently. Payments and Room stay read-only and honest: an unconfigured payment service renders **Not configured**, and gateway hardware renders exactly **Status unavailable**, never inferred from relay records.

## Persona and permission

Staff identity (QA admin key) with venue authority and the `settings` permission on an isolated venue relay provisioned for the run. Identity is installed only through the dev-only `craysboard://qa-seed` deep link; Settings is reached through the app UI from the Board shell.

## Starting truth

- Isolated relay `craysboardqa-venue-<run>` with its NIP-11 root,
  root-signed `31727` community anchor, and root-authored invite-membership;
  venue profile `30078` (`d=nuts-community-profile`, `type=hospitality`,
  admin-signed); a monthly sellable membership definition `30009`
  (`d=qa-membership-<run>`, `t=membership`, recurring
  `price=["12.00","EUR","month"]`, `availability=available`, admin-signed,
  no legacy `type`/`sellable`/`period` tags); and a signed room manifest
  `30078` (`d=life.crays/room/v1/qa-room-<run>`, versioned schema, operator,
  capabilities, open state, expiry, and advertised award issuer). The shared
  orders fixture family (kind `30402` product + issuer-signed award) is present
  but untouched by this flow.
- The venue payment service has no Stripe account configured for this venue.
- App installed, state cleared, Metro on 8090, one Android device.

## User action

Open the seed deep link, wait for the Board shell, open Settings. On **Profile**, replace the description with the QA text and tap Save once. On **Memberships**, flip the availability switch of the monthly plan once. On **Payments** and **Room**, only observe.

## Visible result

- `settings-screen` appears with sub-navigation `settings-nav-profile|memberships|payments|room`.
- Profile loads the seeded hospitality type and description into the editor; after Save, `settings-profile-saved` appears (only after the relay acknowledgement — never before).
- The membership card shows the plan as Available; after the flip and relay echo it shows Unavailable (with `Updating…` while the publish is in flight).
- Payments shows **Not configured** from the service answer.
- Room shows the manifest (name, Open, capabilities, advertised issuer, freshness) and the gateway hardware panel with exactly **Status unavailable** plus the QR fallback placeholder.

## Authoritative result

- The venue relay retains exactly one `30078` at `d=nuts-community-profile`: the QA description in `about`, `type=hospitality`, signed by the admin, newer than the seeded profile, signature valid (strfry keeps only the latest addressable event, so exact-one is the republish proof).
- The venue relay retains exactly one `30009` at the membership `d`:
  `availability=unavailable`, `t=membership`, and the recurring NIP-99 price
  tuple retained, signed by the admin — a new event id at the same stable `d`.
- Read-only proof: the room manifest is byte-identical to the seeded event;
  the relay holds exactly two `30078` (profile + manifest), one staff-authored
  `30009` membership plus the root-authored invite-membership, one untouched
  `30402` product listing, and zero `37237`.
- Logcat `[crays-board-profile]` carries the same profile event id that landed on the relay; `[crays-board-membership]` carries the same membership event id with `availability=unavailable`.

## Forbidden result

- No profile or membership event at a new `d`, no second publish from a single tap, no write before the user acts, no write to any other relay, no event written for payments or room, no connected/configured payments state without a service answer, no hardware-health claim derived from relay records, no nsec/private hex in logcat or QA state.

## Lifecycle boundary

Addressable replacement means the seeded profile and membership events are evicted by their republished successors; the bootstrap leaves a detached watcher that rewrites `venue_profile_id` in the scenario state to the live event id so the shared relay-verify step resolves the current profile. No app relaunch is part of this slice.

## Cleanup

Scenario teardown deletes exactly the owned relay, its docker volume, the app package state, and the scenario state file (which also stops the profile watcher).
