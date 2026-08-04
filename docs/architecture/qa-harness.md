# Crays Board QA harness architecture

## Workflow boundary

The Board QA harness proves a complete native workflow across device UI, signer, coordinator, relay, invite/payment services, and guest-client consumption where applicable.

It includes:

- provisioning isolated venue infrastructure or a precisely scoped service fixture;
- seeding correctly signed, deterministic events;
- driving the public React Native UI with Maestro;
- querying the authoritative relay or service independently after the UI action;
- checking signatures, authorities, tags, transitions, idempotency, and forbidden side effects;
- removing only infrastructure, processes, app state, and files owned by the scenario.

It excludes:

- replacing production boundaries with a JavaScript store and calling that integration proof;
- using rendered success text as proof of persistence;
- sharing a mutable “demo venue” between automated scenarios;
- putting private keys, invite tokens, payment URLs, or presentation payloads in persistent QA state or logs;
- broad cleanup commands that may delete another project or active run.

Each executable entry point is named `.qa/qa-<screen-or-workflow>.mjs`. A passing scenario exits only after independent verification. A failing scenario retains non-secret diagnostic artifacts and still performs scoped teardown in `finally`.

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

As of 2026-08-03, the Board repository has the Expo/React Native prototype, Jest configuration, generated Android project, and sample-data screens. It does not yet have `docs/screens/`, Maestro flows, `.qa` runners, relay integration, or the Board-specific `nipworker` data layer. The architecture below is therefore an implementation target, not a claim that end-to-end QA already exists.

The first useful milestone is not an empty directory tree or a giant suite. It is one reliable canary that provisions an isolated venue, displays one signed pending order through the public app, accepts it through the UI, independently verifies one exact `37237` event, proves double-tap idempotency, and tears down. That slice validates the harness boundary before it is generalized.

## Test-layer responsibilities

| Layer | Proves | Must not be used as proof of |
| --- | --- | --- |
| Pure Jest tests | parsers, projections, permission decisions, validation, state machines, sorting, tag creation | native routing, relay persistence, service effects |
| React Native Testing Library | component states, accessible names, action enablement, local errors, focus behavior | native camera/browser behavior or authoritative writes |
| Maestro | public navigation, taps, typing, rotation, back behavior, visible feedback, native handoffs | exact relay events, service database state, or cryptographic validity |
| `.qa` independent verifier | signed relay/service truth caused or consumed by the UI | visual quality or every local rendering branch |
| Manual physical-device pass | Samsung/iPad camera, keyboard, safe areas, process death, network switching, vendor behavior | repeatable protocol regression coverage |

`.qa` coordinates the layers; it is not a fifth assertion library. A UI-only screen may use the shared lifecycle without provisioning a relay. Any screen that claims to read or mutate venue truth must use a real isolated boundary and an independent verifier.

## Architectural units

### Contract registry

- Maps every file under `docs/screens/` to one Maestro flow and one named `.qa` runner.
- Fails when a screen is documented without executable coverage or when registered artifacts are missing.
- May additionally map cross-screen workflow specs under `docs/workflows/`.
- Does not claim behavioral correctness; it is a fast structural gate.

### Scenario runner

- Owns one bootstrap → exercise → verify → teardown lifecycle.
- Selects fixture family, Maestro flow, verifier set, persona, permission set, device profile, and optional fault plan.
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

The default file is `/tmp/qa-crays-board-<scenario>-<run>.json`.

It may contain:

- scenario and run IDs;
- owned relay/service resource IDs;
- host and emulator URLs;
- public keys, event IDs, coordinates, expected public values, and permission profile;
- helper PIDs, exact volume names, ports, and diagnostic artifact locations;
- durable creation attempt ID and fault boundary for Create Venue scenarios.

It must never contain:

- nsec or private hex values;
- raw invite tokens after they have been passed ephemerally to the UI;
- presentation payloads or Cashu proofs;
- Stripe onboarding/dashboard URLs;
- unrelated process IDs or resources inferred by a broad name match.

### Native UI exerciser

- Launches the development client and drives only public routes and controls with Maestro.
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
  -> run Maestro
  -> optionally inspect public-safe device diagnostics
  -> clear exact app state
```

### Relay-backed screen scenario

Use for Home projections, Orders, Menu, Events, People, Roles, Memberships, and Room manifest behavior.

```text
provision relay
  -> seed signed fixtures
  -> run Maestro
  -> query relay independently
  -> run screen-specific verifiers
  -> teardown
```

### Service-backed scenario

Use for invites, media upload, coordinator provisioning, and Stripe handoff.

```text
start isolated service boundary
  -> configure deterministic response/fault
  -> run Maestro
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

The harness injects a failure after each durable boundary, kills or relaunches the app, resumes the same attempt, and proves that no second relay or destructive relay-set replacement occurred.

## Core invariants

1. The selected venue is the sole owner of active Board subscriptions and mutations.
2. A mutation is confirmed only after the required relay/service acknowledgement.
3. Every signed event is verified against the expected signer and venue authority relationship.
4. UI permission filtering and route guards are tested, but the relay/service remains the security boundary.
5. Order and check-in state writes use kind `37237`; legacy `27237` is read-only during migration.
6. Status mutations are forward-only where required, strictly monotonic per context, deterministic on ties, and idempotent under repeat taps/relaunch.
7. Addressable definitions retain the same `d` for edits and use a new `d` only for a meaningfully new offer.
8. Invite creation/redemption is exact-URL/method/payload bound, account-bound, expiry-aware, redemption-limited, and idempotent.
9. Paid events are not visible as paid events without a confirmed access definition.
10. Check-in accepts one valid, live, venue/event-bound presentation and rejects invalid, expired, revoked, wrong-context, exhausted, and duplicate presentations without an extra fulfillment.
11. Venue switching disposes old work; late old-venue acknowledgements cannot alter the new venue UI or relay.
12. A Create Venue attempt owns at most one allocated relay and never overwrites pre-existing relay-set entries.
13. Logs, QA state, screenshots, and analytics contain no secrets or raw security credentials.
14. Teardown deletes only resources explicitly recorded as owned by the scenario.

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

## Proposed file layout

```text
docs/screens/<screen>.md
docs/workflows/<workflow>.md
maestro/flows/<screen-or-workflow>.yaml
.qa/README.md
.qa/contracts.mjs
.qa/run-screen-scenario.mjs
.qa/run-relay-scenario.mjs
.qa/run-service-scenario.mjs
.qa/lib/{ownership,android,relay,services,polling,redaction}.mjs
.qa/fixtures/{entry,venue,orders,menu,events,people,invites,settings}.mjs
.qa/verify/{relay,orders,menu,events,roles,invites,create-venue}.mjs
.qa/qa-<screen-or-workflow>.mjs
```

This is a target architecture, not a requirement to create empty scripts before their contracts exist.

## Ordered implementation plan

1. Establish the Board app ID, deep-link scheme, development-client launch path, and Samsung-like AVD.
2. Add the structural registry and one UI-only welcome scenario.
3. Port the isolated coordinator/relay provisioner, state manifest, polling, Android URL translation, redaction, and scoped teardown from the proven Crays pattern.
4. Implement the first relay-backed vertical slice: seed one pending order, render it, advance it once, verify exact `37237`, repeat tap, relaunch, and teardown.
5. Generalize fixture families only after that slice is reliable.
6. Add Menu and guest-consumer compatibility, then Events/check-in, People/Roles, Invites, and Settings.
7. Implement Create Venue last among infrastructure primitives but before pilot: it needs stable attempt/resume and deterministic coordinator fault controls.
8. Add phone/portrait variants to the same semantic workflows rather than cloning all business verifiers.
9. Run physical Samsung/iPad checks as a release checklist and promote only automatable regressions into the device suite.

## Harness acceptance checks

- One command can run a named scenario against one connected Android device.
- The scenario uses a unique run ID and owns every external resource it creates.
- Relay bootstrap waits for a signed round-trip.
- The UI is exercised only through public native controls/routes.
- Each relay/service claim has an independent verifier.
- Repeat taps and relaunch do not create duplicate durable writes.
- A failed scenario still tears down exact owned infrastructure and clears exact app state.
- Diagnostics remain useful and contain no secrets.
- A structural gate fails when a screen spec, Maestro flow, or `.qa` runner is missing.
- The same semantic workflow can run at tablet landscape, tablet portrait, and phone width without changing product truth assertions.
