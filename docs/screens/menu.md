# Menu — sectioned catalog, availability, and item editor (vertical slice)

Covers QA_WORKFLOWS MENU-01 (sectioned projection + search/section filters), MENU-03 (§3.1 inline validation), MENU-04 (edit with stable address), MENU-05 (publisher ownership), and MENU-06 (availability/archive/restore through the same addressable mechanism, pending until ack). Media upload (MENU-08), section reorder/rename (MENU-07), item creation (MENU-02), and offline conflict (MENU-10) are later slices.

## Purpose

Prove that sellable food/drink definitions on the venue relay project as an ordered, sectioned catalog; that one deliberate availability toggle and one name edit each republish the **same** addressable `d` as the latest kind `30009` — verified independently on the relay, never from rendered text alone; and that an item published by a different trusted key stays visible but non-editable, with no write attempted against it.

## Persona and permission

Staff identity (QA admin key) with venue authority (`store` permission set) on an isolated venue relay provisioned for the run. Identity is installed only through the dev-only `craysboard://qa-seed` deep link.

## Starting truth

- Isolated relay `craysboardqa-venue-<run>` with the base fixture family (venue profile `30078`, one sellable product + award for the shared harness verifier) plus three menu definitions with deterministic `d` values:
  - `qa-menu-soup` — food, "QA Tomato soup", 6.50 EUR, section `Mains`, position 1, `available` (admin-signed; edited by the flow);
  - `qa-menu-espresso` — drink, "QA Espresso", 3.00 EUR, section `Drinks`, position 1, `available` (admin-signed; toggled by the flow);
  - `qa-menu-foreign` — drink, "QA Foreign lemonade", 4.20 EUR, section `Drinks`, position 2, `available` (**signed by the relay's badge-issuer key, not the admin**).
- App installed, state cleared, Metro on 8090, one Android device.

## User action

Open the seed deep link (lands on Orders), open `craysboard://menu`, wait for the catalog, tap the availability toggle on `QA Espresso`, wait for "Unavailable", then tap Edit on `QA Tomato soup`, replace the name with "QA Roasted tomato soup" in the editor, and Save. No other interaction.

## Visible result

- `menu-screen` appears with search (`menu-search`), section chips (`menu-chip-all`, `menu-chip-mains`, `menu-chip-drinks`), and rows `menu-item-qa-menu-soup`, `menu-item-qa-menu-espresso`, `menu-item-qa-menu-foreign` grouped under Mains/Drinks section headers.
- The foreign row shows `menu-foreign-note-qa-menu-foreign` ("Published by another trusted key…") and **no** edit/toggle controls.
- After the toggle, the espresso row shows "Unavailable" (pending state "Saving…" until relay ack; failure would revert to Retry).
- Tapping `menu-edit-qa-menu-soup` opens `menu-editor` (master-detail panel on tablet, full-screen on phone) with name/description/price/currency/section fields, an availability switch, Archive, and Cancel/Save actions at the end of the editor's scroll content (a pinned footer after the ScrollView intermittently failed to mount on cold sessions — caught by this gate); invalid name/price/currency show inline errors and Save publishes nothing.
- After Save, the editor closes and the row shows "QA Roasted tomato soup".

## Authoritative result

- The venue relay's latest kind `30009` for `d=qa-menu-espresso` carries `availability=unavailable`, is signed by the admin key, and there is exactly one admin event for that `d` (no duplicate `d`).
- The latest `30009` for `d=qa-menu-soup` carries `name="QA Roasted tomato soup"`, unchanged `price=6.50`/`currency=EUR`/`section=Mains`, same `d`, admin-signed, exactly one admin event for that `d`.
- For `d=qa-menu-foreign` there is **no** event signed by the admin key at all; the badge-issuer-signed original remains the only event for that `d`.
- Logcat `[crays-board-menu]` markers project every item (`d`, `address`, `name`, `availability`); `[crays-board-menu-definition]` markers carry the exact event ids that landed on the relay.

## Forbidden result

- No new `d` for an edit (a duplicate offer), no event carrying the old availability/name surviving as latest, no write signed by the admin key against the foreign `d`, no write before a user tap, no second publish from a double-tap while one intent is in flight, no nsec/private hex in logcat or QA state.

## Lifecycle boundary

A failed relay acknowledgement leaves the row in its prior confirmed availability with a Retry affordance; Retry republishes the same `d` (§3.1 update rule). Backgrounding closes the single `board_menu_<relay>` subscription; foregrounding reopens it and reconciles from relay truth.

## Cleanup

Scenario teardown deletes exactly the owned relay, its docker volume, the app package state, and the scenario state file.
