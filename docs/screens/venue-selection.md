# Venue selection — discovery, access check, and switching (ENTRY-03/04)

Covers QA_WORKFLOWS ENTRY-03 (identity has no venues) and ENTRY-04 (venue discovery and selection) for the single-venue seeded slice. Later slices extend this contract to multi-venue discovery and stale-access revalidation.

## Purpose

Prove that after seeding, the venue chip opens a venue-selection surface that lists the selected venue, shows relay reachability honestly (a real WebSocket probe with a short timeout, never a fabricated green state), and offers deliberate next actions: Open the venue, create another venue, refresh the access check, or switch account. With no selected venue the surface shows the ENTRY-03 empty state and never fabricates a venue.

## Persona and permission

Staff identity (QA admin key) with venue authority on an isolated venue relay provisioned for the run. Identity is installed only through the dev-only `craysboard://qa-seed` deep link.

## Starting truth

- Isolated relay `craysboardqa-venue-<run>` provisioned by `.qa/relay-bootstrap.mjs`, reachable from the device.
- App installed, state cleared, Metro on 8085, one Android device; the qa-seed deep link installs the signer and selects the venue, landing on Orders.

## User action

From the Orders screen, tap the venue chip (`venue-chip`) in the app shell. On the venue-selection screen, tap Refresh in the Access check panel.

## Visible result

- `venue-selection-screen` appears after the venue-chip tap.
- `venue-card` lists the selected venue's relay host with an enabled `venue-open-button`; `create-another-venue` is present.
- `access-check` shows "Identity ready — Verified" and the venue relay as "Connected" (the probe reaches the provisioned relay); after Refresh it re-probes and returns to "Connected".
- `switch-account` is present and enabled.

## Authoritative result

- The "Connected" state is produced only by a real WebSocket `onopen` against `RELAY_URL` within the probe timeout; an unreachable relay renders "Unavailable" instead.
- Switch account removes the nsec/pubkey pair from SecureStore (`crays.board.identity.*`), clears the venue selection (`crays.board.venue`), and routes to `/` — verified by the absence of those keys and the welcome screen on next launch, not by rendered text alone.
- No nsec or private hex appears in logcat or QA state.

## Forbidden result

- No apparently-connected state while the relay is down, no cached venue content rendered before the probe settles, no mutation published to any relay from this surface, no dead rows: Open, Create another venue, Refresh, and Switch account all route or act.

## Lifecycle boundary

Entering and leaving the screen re-runs the probe on mount; a relay that goes away between visits flips the panel from Connected to Unavailable on the next mount or Refresh.

## Cleanup

Scenario teardown deletes exactly the owned relay, its docker volume, the app package state, and the scenario state file.
