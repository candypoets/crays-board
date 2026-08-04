# Orders ladder — full §6.2 status ladder (advance, decline, cancel)

Covers QA_WORKFLOWS ORDER-03 (complete ladder), ORDER-04 (invalid transitions impossible), ORDER-05 (pending-ack and repeat tap), ORDER-07 (cancellation with confirmation), and ORDER-12 (decline). Extends the vertical slice in `docs/screens/orders.md`; same venue-commerce-nip §5/§6 event contract.

## Purpose

Prove that a store staff member drives one order exactly one stage at a time through accepted → processing → ready → fulfilled, declines a pending order without confirmation, and cancels an accepted order only through a confirmation dialog naming the order and venue — with every mutation publishing exactly one valid `37237` status, verified independently against the relay.

## Persona and permission

Staff identity (QA admin key) with venue authority and the `store` permission on an isolated venue relay provisioned for the run. Identity is installed only through the dev-only `craysboard://qa-seed` deep link.

## Starting truth

- Isolated relay `craysboardqa-venue-<run>` with: venue profile `30078` (`d=nuts-community-profile`, admin-signed), one sellable product definition `30009` (`type=food`, `t=sellable`, `max_uses=1`, admin-signed), and **three** kind `8` awards for that product signed by the relay's badge issuer — advance, decline, cancel — each an implicit-pending order, with `created_at` spaced one second apart so the oldest-first queue order is deterministic.
- App installed, state cleared, Metro on 8090, one Android device.

## User action

Open the seed deep link and wait for the Orders screen. On the first (advance) card tap the single primary action four times in sequence — **Accept**, **Start preparing**, **Mark ready**, **Serve** — waiting for the new stage badge each time. On the second (decline) card double-tap **Decline** (no confirmation). On the third (cancel) card tap **Accept**, then **Cancel order**, dismiss the dialog with **Keep order**, tap **Cancel order** again, and confirm with **Yes, cancel order**.

## Visible result

- Each non-terminal card shows exactly one valid next action: Accept on New, Start preparing on Accepted, Mark ready on Preparing, Serve on Ready; pending cards additionally show a secondary **Decline**, accepted/processing cards a secondary **Cancel order**; fulfilled and cancelled cards show no actions.
- Each stage badge appears once acknowledged (Accepted, Preparing, Ready, Served); a publishing action shows its busy label and both buttons are disabled; a failed acknowledgement shows Retry and never a confirmed stage change.
- Decline publishes without a dialog and the card shows "Declined" (cancelled from pending, §6.4). The cancel dialog names the item and the venue; dismissing it changes nothing, confirming it moves the card to "Cancelled".
- After all three orders are terminal, no `order-action-button`, `order-decline-button`, or `order-cancel-button` remains on screen.

## Authoritative result

- Advance award: exactly four kind `37237` statuses — accepted, processing, ready, fulfilled in order — each with `e` = award id (the stable order context), `d` = `<awardId>:<status>` (stage-scoped per the §6.7 resolution: kind 37237 is addressable-range, so a constant `d` would let the relay retain only the latest transition), exact `a`/`p` tags, `context=order`, signed by the staff key, valid signatures, strictly increasing `created_at` (the client floors each status at one second above the previous).
- Decline award: exactly one `37237` with `status=cancelled` — the double-tap idempotency proof.
- Cancel award: exactly two `37237` statuses — accepted then cancelled, monotonic; the dismissed dialog published nothing.
- The relay contains exactly seven `37237` events in total; no status references any other order context.
- Logcat `[crays-board-order]` projects all three award ids with the exact definition address; `[crays-board-order-status]` contains the same seven status event ids that landed on the relay.

## Forbidden result

- No stage skip, backward move, or action on a terminal order (the UI offers none; forced repeats are blocked by the synchronous in-flight guard).
- No second status from a double-tap or from a tap while a publish is in flight; no confirmed stage shown before relay acknowledgement; no write from dismissing the cancel dialog; no write to any other relay; no nsec/private hex in logcat or QA state.

## Lifecycle boundary

The screen remounts its single stable subscription (`board_orders_<relay>`, kinds 8/30009/37237, no cache) on foreground; the confirmed-stage override only ever bridges the gap between relay acknowledgement and subscription echo, so projection always converges to relay truth.

## Cleanup

Scenario teardown deletes exactly the owned relay, its docker volume, the app package state, and the scenario state file `/tmp/qa-crays-board-orders-ladder.json`.
