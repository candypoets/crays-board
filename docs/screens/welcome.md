# Welcome (cold entry)

Executable contract: `maestro/flows/00-welcome.yaml` via `.qa/qa-welcome.mjs`.
Covers ENTRY-01 from `docs/testing/QA_WORKFLOWS.md`; visual reference
`design/mockups/crays-board-welcome-tablet.png`.

- **Purpose:** prove that a newcomer with no identity lands on an honest
  welcome surface that offers venue creation and sign-in, and that merely
  viewing it provisions nothing.
- **Persona and permission:** no active identity, no selected venue, no
  permissions. Cold install equivalent.
- **Starting truth:** app package state cleared (`pm clear life.crays.board`),
  no signer account, no venue references, no relay or coordinator resources
  owned by this scenario. One Android device, Metro serving the dev client on
  port 8085.
- **User action:** cold launch only, through the public development-client
  entry path. No taps beyond reaching the welcome surface.
- **Visible result:** `welcome-screen` is visible with **Create venue** as the
  primary action (`create-venue-button`) and **Sign in** as the secondary
  action (`sign-in-button`). Per the mockup, the secondary bootstrap paths —
  import an existing account, scan a staff/venue access code, and enter a
  service address — are reachable from this surface (their behavior is
  ENTRY-09 and covered by separate contracts).
- **Authoritative result:** none; this is a UI-only scenario. There is no
  relay, service, or signer truth to query because viewing the screen must not
  create any.
- **Forbidden result:** no signer/identity creation, no venue record, no relay
  connection or subscription, and no coordinator request is triggered by
  viewing the welcome surface. No empty authenticated dashboard and no
  fabricated venue appears. No secrets in logcat, screenshots, or QA state.
- **Lifecycle boundary:** scenario ends at the welcome surface; navigation
  into Create venue, sign-in, and the secondary bootstrap paths belongs to
  their own contracts. Rotation, process recreation, and back behavior are
  covered by the cross-cutting QUALITY scenarios.
- **Cleanup:** teardown clears exactly the `life.crays.board` package state
  and removes `/tmp/qa-crays-board-entry.json`. The Maestro screenshot
  `00-welcome` is retained for diagnosis. No infrastructure exists to delete.
