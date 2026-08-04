# Home — attention-first venue summary

Covers QA_WORKFLOWS HOME-01 (established venue attention summary), the checklist-absence half of HOME-02 (an established venue never shows the new-venue checklist), the admin-persona half of HOME-03 (all quick actions visible), and HOME-05 information parity (same cards, single-column priority order on phone). The checklist-variant proof for a genuinely new venue, non-admin personas, and stale/offline reconnect cycles are later slices.

## Purpose

Prove that Home projects live relay truth into the attention summary — open orders by stage with oldest wait, unavailable menu count, tonight's upcoming event, active/expiring members, venue live state — and that every number matches an independent projection of the same relay, never rendered text alone. Also prove the orders card opens the Orders destination.

## Persona and permission

Staff identity (QA admin key) with venue authority on an isolated venue relay provisioned for the run; the admin persona carries every permission, so all quick actions are visible. Identity is installed only through the dev-only `craysboard://qa-seed` deep link (which lands on Orders; the flow navigates to Home through the public shell navigation).

## Starting truth

- Isolated relay `craysboardqa-venue-<run>` with: venue hospitality profile `30078` (`d=nuts-community-profile`, named, admin-signed); sellable product definition `30009` (`d=qa-item-<run>`, available, admin-signed); a second product definition (`d=qa-item-unavailable-<run>`, `availability=unavailable`, admin-signed); three kind `8` awards of the available product to three fixture users, signed by the relay's badge issuer (implicit-pending orders); one kind `37237` `accepted`/`context=order` status on the third award (admin-signed); one NIP-52 kind `31923` timed event starting after the run (`d=qa-event-<run>`, admin-signed); one sellable membership definition (`d=qa-membership-<run>`, admin-signed); one kind `8` membership award to a fixture user with `expiration = run + 10 days` (issuer-signed).
- App installed, state cleared, Metro on 8090, one Android device.

## User action

Open the seed deep link, wait for the Orders screen, navigate to Home through the shell navigation (`nav-home` rail item or `tab-home` phone tab), read the summary, then tap the orders card.

## Visible result

- `home-screen` appears wrapped in the app shell with Home selected, the venue name from the relay profile, and a **Live** badge.
- `home-orders-card` shows "3 open orders", the stage line `New 2 · Accepted 1 · Preparing 0 · Ready 0`, and the oldest wait.
- `home-event-card` shows tonight's upcoming event with a **Check in** action.
- `home-menu-card` shows "1 item unavailable".
- `home-members-card` shows "1 active member" and "1 expiring soon".
- All four quick actions (`home-action-menu`, `home-action-event`, `home-action-invite`, `home-action-role`) are visible for the admin persona.
- `home-setup-checklist` is absent (established venue, HOME-02).
- Tapping `home-orders-card` opens `orders-screen`.

## Authoritative result

- An independent relay query (kinds 8, 30009, 37237, 31923, 5, 30078) plus the venue's NIP-11 document and `/community/info` badge issuer reproduces the exact same projection: 2 pending + 1 accepted open orders, 1 unavailable sellable product, the seeded `31923` as the next event, 1 active member expiring within 30 days, no checklist.
- Logcat `[crays-board-home]` carries one JSON payload whose `orders`, `unavailableMenu`, `nextEvent.id`, `members`, and `checklist` fields exactly match that independent projection; `oldestWaitSeconds` matches the oldest open award's age within tolerance; `venueName` matches the relay profile.
- The projection comes from one stable subscription `board_home_<sanitized relay>` (EOSE-as-loaded, unsubscribe on unmount/background), so the values are relay truth, not local memory.

## Forbidden result

- No checklist on an established venue, no zero-filled analytics presented as a new venue, no count that disagrees with relay truth, no second home subscription, no status/definition write of any kind (Home is read-only), no nsec/private hex in logcat or QA state.

## Lifecycle boundary

Backgrounding the app stops the home subscription; foregrounding reopens the same stable subscription id and reprojects from relay truth without duplicate counts (QUALITY-07). The venue-switch disposal proof is a later slice shared with SHELL-04.

## Cleanup

Scenario teardown deletes exactly the owned relay, its docker volume, the app package state, and the scenario state file.
