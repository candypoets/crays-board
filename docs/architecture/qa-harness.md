# Crays Board QA harness architecture

## Workflow boundary

The Board QA harness proves a complete native workflow across device UI, signer, coordinator, relay, invite/payment services, and guest-client consumption where applicable.

It includes:

- provisioning isolated venue infrastructure or a precisely scoped service fixture;
- seeding correctly signed, deterministic events;
- driving the public React Native UI with native Agent Device `.ad` scripts;
- querying the authoritative relay or service independently after the UI action;
- checking signatures, authorities, tags, transitions, idempotency, and forbidden side effects;
- removing only infrastructure, processes, app state, and files owned by the scenario.

It excludes:

- replacing production boundaries with a JavaScript store and calling that integration proof;
- using rendered success text as proof of persistence;
- sharing a mutable “demo venue” between automated scenarios;
- putting private keys, payment credentials, invite tokens, or presentation
  payloads in logs or retained diagnostic artifacts;
- broad cleanup commands that may delete another project or active run.

Each executable entry point is named `.qa/qa-<screen-or-workflow>.mjs`. A passing scenario exits only after independent verification. A failing scenario retains non-secret diagnostic artifacts and still performs scoped teardown in `finally`.

### Release-evidence provenance

A visual map is publishable evidence only when its phone and tablet captures
bind both halves of the development client: the installed native APK and the
JavaScript served by Metro. Each complete profile emits a hashed
`run-receipt.json`. The receipt inventories actual working-tree bytes for
application/runtime source, the QA harness and device scripts, Agent Device flows,
and the npm lockfile, including relevant untracked files and tracked deletions.
The suite rejects a revision change during capture; paired publication rejects
any component mismatch and rechecks the receipt against the current worktree
immediately before atomic canonical-map replacement.

The receipt contains structured fast-gate, scenario-attempt, retry, and
independent-verifier results. It proves host/installed APK byte equality by
hashing the device's installed `base.apk`, records package-manager version and
signing observations, identifies the coordinator implementation (managed
binary hash or required external identity hash), and records device geometry,
density, rotation, emulator, model, and API level from observed ADB commands.
Canonical PNGs must pass chunk CRC, compressed-data, scanline, dimension, and
manifest-hash validation. Requested profile constants remain acceptance
contracts; they are never substituted for observed receipt fields.

## Source workflow

This design adapts the established `/root/code/crays-rn/.qa` lifecycle:

```text
bootstrap owned state
  -> exercise public native UI
  -> independently verify authoritative truth
  -> tear down exact owned state
```

The reusable idea is the boundary discipline, not the client’s specific fixtures. Crays Board needs its own fixture families, Android app ID, deep links, route contracts, service verifiers, and failure injection.

## Current repository state

As of 2026-08-21, the repository has the contract registry, native `.ad` flows,
screen-specific `.qa` runners, isolated coordinator/relay provisioning,
independent relay/service verifiers, scoped teardown, and the Board
`nipworker` data layer. Relay scenarios bootstrap NIP-97 trust from the relay's
NIP-11 root key and root-signed `31727` community anchor. Orders, Menu, Events,
Check-in, People, Invites, Settings, Home, and Create Venue all have executable
vertical-slice contracts in addition to the UI-only entry scenarios.

The original canary remains the smallest relay proof: provision one isolated
venue, display one signed pending order through the public app, accept it,
independently verify the retained `37237` current status, prove repeat-tap and
relaunch idempotency, and tear down.

## Test-layer responsibilities

| Layer | Proves | Must not be used as proof of |
| --- | --- | --- |
| Pure Jest tests | parsers, projections, permission decisions, validation, state machines, sorting, tag creation | native routing, relay persistence, service effects |
| React Native Testing Library | component states, accessible names, action enablement, local errors, focus behavior | native camera/browser behavior or authoritative writes |
| Agent Device `.ad` | public navigation, taps, typing, rotation, back behavior, visible feedback, native handoffs | exact relay events, service database state, or cryptographic validity |
| `.qa` independent verifier | signed relay/service truth caused or consumed by the UI | visual quality or every local rendering branch |
| Manual physical-device pass | Samsung/iPad camera, keyboard, safe areas, process death, network switching, vendor behavior | repeatable protocol regression coverage |

`.qa` coordinates the layers; it is not a fifth assertion library. A UI-only screen may use the shared lifecycle without provisioning a relay. Any screen that claims to read or mutate venue truth must use a real isolated boundary and an independent verifier.

## Architectural units

### Contract registry

- Maps every file under `docs/screens/` to one Agent Device flow and one named `.qa` runner.
- Fails when a screen is documented without executable coverage or when registered artifacts are missing.
- May additionally map cross-screen workflow specs under `docs/workflows/`.
- Does not claim behavioral correctness; it is a fast structural gate.

### Scenario runner

- Owns one bootstrap → exercise → verify → teardown lifecycle.
- Selects fixture family, Agent Device flow, verifier set, persona, permission set, device profile, and optional fault plan.
- Writes the ownership manifest as soon as each resource is created.
- Always enters teardown through `try/finally`.
- Must not implement product projections or use internal app repositories to bypass the public path.

### Infrastructure provisioner

- Creates a uniquely named Crays Board venue relay through the real coordinator.
- Waits for a signed write/read round-trip, not merely a “running” process status.
- Starts only the service shims required by the scenario, such as deterministic clock, Stripe return stub, image server, or gateway telemetry simulator.
- Exposes separate host URLs for Node verification and device-reachable URLs for Android.
- Records every relay, volume, port, process, and temporary file it owns.

### Fixture seeder

- Publishes deterministic fixtures signed by the authority relationship expected in production.
- Polls until each required fixture can be queried back.
- Namespaces data with a unique run ID so reruns cannot pass on stale state.
- Provides public references to the UI runner without persisting secret signing material.

### Scenario state repository

The default file is `/tmp/qa-crays-board-<scenario>.json`; the state itself
records the unique run ID.

It may contain:

- scenario and run IDs;
- owned relay/service resource IDs;
- host and emulator URLs;
- public keys, event IDs, coordinates, expected public values, and permission profile;
- helper PIDs, exact volume names, ports, and diagnostic artifact locations;
- durable creation attempt ID and fault boundary for Create Venue scenarios.
- an opaque invite token when a scenario must exercise the public invite UI;
- short-lived synthetic presentation payloads when Check-in must type them
  through the public UI.

It must never contain:

- nsec or private hex values;
- Stripe onboarding/dashboard URLs;
- production Cashu proofs or payment credentials;
- unrelated process IDs or resources inferred by a broad name match.

State files are mode `0600`, are never copied into diagnostic artifacts, and
are deleted by scoped teardown. Fixture invite tokens and presentations must
never be logged or rendered separately.

### Native UI exerciser

- Launches the development client and drives only public routes and controls with Agent Device.
- Receives public fixture values through environment variables or a test-only, release-disabled entry route.
- Uses stable accessibility identifiers for controls and stable semantic text for user outcomes.
- Captures screenshots at decision points and failures.
- Never calls an internal store, signer, or repository to manufacture the result being tested.

### Independent relay verifier

- Uses a separate relay connection and protocol implementation from the app.
- Verifies event signature, exact kind, signer authority, tags, content schema, addressability, winner selection, ordering, and event count.
- Verifies both positive effects and important absences, such as no duplicate status, no old-venue write, no presence side effect, or no event publish after ticket-definition failure.
- Polls with a bounded deadline for propagation and reports a wire-level reason on failure.

### Independent HTTP/service verifier

- Queries the scoped coordinator, invite, media, or payment test service directly.
- Verifies exact request binding, idempotency key, resource count, return state, and redaction behavior.
- Must not treat a browser return or toast as proof that the external service accepted an operation.

### Guest-consumer verifier

- Runs only where Board promises guest-visible compatibility.
- Opens `crays-rn` against the same isolated venue through its public entry path.
- Proves examples such as unavailable/archived items becoming non-purchasable, event data rendering, invite context surviving authentication, or an order status changing to guest-facing wording.
- Complements, but does not replace, direct relay verification.

### Teardown owner

- Stops only helper PIDs recorded in the ownership manifest.
- Deletes only relays and volumes recorded by the scenario.
- Clears exactly the Crays Board application package and exact scenario state file.
- Retains screenshots and redacted logs unless a retention policy removes them later.
- A crash-recovery sweep may target only an agreed Crays Board QA prefix and only when no matching live scenario owns the resource.

## Scenario types

### UI-only scenario

Use for welcome layout, local validation, phone More navigation, unsaved-change confirmation, and other claims that do not cross a service boundary.

```text
clear exact app state
  -> run Agent Device
  -> optionally inspect public-safe device diagnostics
  -> clear exact app state
```

### Relay-backed screen scenario

Use for Home projections, Orders, Menu, Events, People, Roles, Memberships, and Room manifest behavior.

```text
provision relay
  -> seed signed fixtures
  -> run Agent Device
  -> query relay independently
  -> run screen-specific verifiers
  -> teardown
```

### Service-backed scenario

Use for invites, media upload, coordinator provisioning, and Stripe handoff.

```text
start isolated service boundary
  -> configure deterministic response/fault
  -> run Agent Device
  -> query service audit truth
  -> verify relay follow-up when applicable
  -> teardown
```

### Bespoke multi-boundary workflow

Use when one generic runner cannot own the lifecycle clearly: venue switching across two relays, Create Venue with coordinator failure injection, paid-event atomicity, invite redemption in `crays-rn`, or event check-in using a second holder identity.

The bespoke runner still follows the same ownership and verification rules. It should compose shared provisioner/verifier utilities instead of duplicating them.

## Lifecycle and state model

```text
idle
  -> provisioning
  -> seeding
  -> ready
  -> exercising
  -> verifying
  -> passed | failed
  -> tearing_down
  -> disposed
```

Create Venue has an additional durable workflow owned by the app rather than the test runner:

```text
editable draft
  -> submitted(attempt ID)
  -> relay allocated
  -> relay ready
  -> directory published/read back
  -> venue profile published
  -> selected
  -> complete | complete with repair action
```

The implemented Create Venue slice covers the happy path. Planned durable-
boundary scenarios will inject a failure after each boundary, kill or relaunch
the app, resume the same attempt, and prove that no second relay or destructive
relay-set replacement occurred.

## Core invariants

1. The selected venue is the sole owner of active Board subscriptions and mutations.
2. A mutation is confirmed only after the required relay/service acknowledgement.
3. Every signed event is verified against the expected signer and venue authority relationship.
4. UI permission filtering and route guards are tested, but the relay/service remains the security boundary.
5. Trust derives from the relay's NIP-11 root key and the root-signed NIP-97 community anchor (kind `31727`); entitlement truth resolves only from the pinned venue relay.
6. Order and check-in state writes use kind `37237` with NIP-97 contexts (`d = order:<order-ref>` / `event:<coordinate>` plus the matching context tag); no legacy status kinds are read or written.
7. Status mutations are forward-only where required, strictly monotonic per context, resolved by `created_at` then lowest event id, and idempotent under repeat taps/relaunch (same context `d`, one retained status per author+context).
8. Addressable definitions retain the same `d` for edits and use a new `d` only for a meaningfully new offer.
9. Invite creation/redemption is exact-URL/method/payload bound, account-bound, expiry-aware, redemption-limited, and idempotent.
10. Paid events are not visible as paid events without a confirmed access definition.
11. Check-in accepts one valid, live, venue/event-bound presentation and rejects invalid, expired, revoked, wrong-context, exhausted, and duplicate presentations without an extra fulfillment.
12. Venue switching disposes old work; late old-venue acknowledgements cannot alter the new venue UI or relay.
13. A Create Venue attempt owns at most one allocated relay and never overwrites pre-existing relay-set entries.
14. Logs, QA state, screenshots, and analytics contain no secrets or raw security credentials.
15. Teardown deletes only resources explicitly recorded as owned by the scenario.

## Failure injection

The shared harness should expose named failure points rather than arbitrary sleeps:

- coordinator rejects, times out before acceptance, or returns an existing attempt;
- relay reports running before signed round-trip readiness;
- relay publish returns no acknowledgement, delayed acknowledgement, or one accepted/one failed destination;
- directory publication succeeds but read-back times out;
- media upload fails or is cancelled;
- ticket-definition publish fails before event publish;
- invite service returns expired, exhausted, unauthorized, or duplicate redemption;
- Stripe link is cancelled, expires, returns to the wrong venue, or returns before status changes;
- camera permission is denied or activity is recreated while scanning;
- network drops before and after a durable mutation boundary;
- an old venue sends a late subscription result or publish callback after switching.

Faults must be deterministic and externally observable. A scenario must state which side effects are expected and which are forbidden at the injected boundary.

## Current file layout

```text
docs/screens/<screen>.md
e2e/flows/<screen-or-workflow>[.<phone|tablet>].ad
.qa/README.md
.qa/qa-<screen-or-workflow>.mjs
.qa/relay-bootstrap[-<screen>].mjs
.qa/verify[-<screen-or-workflow>].mjs
.qa/relay-screen-scenario.mjs
.qa/{relay-lib,qa-entry-lib,relay-teardown}.mjs
```

## Remaining expansion

The implemented vertical slices establish the lifecycle and NIP-97 wire
contracts. Further coverage should add deterministic fault injection, public
guest-consumer compatibility with `crays-rn`, compact/portrait variants of the
same semantic flows, and the physical Samsung/iPad release pass. Those extend
the existing harness; they do not change its ownership or verification model.

## Harness acceptance checks

- One command can run a named scenario against one connected Android device.
- The scenario uses a unique run ID and owns every external resource it creates.
- Relay bootstrap waits for a signed round-trip.
- The UI is exercised only through public native controls/routes.
- Each relay/service claim has an independent verifier.
- Repeat taps and relaunch do not create duplicate durable writes.
- A failed scenario still tears down exact owned infrastructure and clears exact app state.
- Diagnostics remain useful and contain no secrets.
- A structural gate fails when a screen spec, Agent Device flow, or `.qa` runner is missing.
- The same semantic workflow can run at tablet landscape, tablet portrait, and phone width without changing product truth assertions.
