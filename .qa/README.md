# Crays Board QA harness

Every screen and every workflow has a named scenario here. Native Agent Device
automation lives in `e2e/flows/*.ad`; non-canonical stress journeys live in
`e2e/battle/*.ad`; orchestration, infrastructure setup, independent truth
checks, and teardown live in `.qa/`. The architecture is described in
`docs/architecture/qa-harness.md`; the product-level scenario catalog is
`docs/testing/QA_WORKFLOWS.md`.

Every scenario follows the same lifecycle:

1. **Bootstrap** checks the device, clears logcat and the exact app package,
   and writes a public-safe state file.
2. **Exercise** drives the public app UI through a screen-specific Agent Device
   flow.
3. **Verify** (when the screen crosses a service boundary) checks truth
   independently of the rendered UI.
4. **Teardown** runs in `finally` and clears exactly the resources recorded by
   the scenario: its relay/volume when present, the `life.crays.board` package,
   and its state file.

`npm run qa:contracts` is the fast structural gate: every file under
`docs/screens/` must be registered in `.qa/verify-screen-contracts.mjs` with
an existing native `.ad` flow and a named `.qa` lifecycle runner.

## Prerequisites

- One booted Android device or emulator reachable by `adb` (`adb get-state`
  returns `device`).
- The Crays Board development-client build installed (`life.crays.board`,
  scheme `craysboard`).
- Metro serving the dev client on port 8090 (Board-specific; 8085 belongs
  to the crays-rn dev server):

  ```sh
  npm run start:qa
  adb reverse tcp:8090 tcp:8090
  ```

- Project dependencies installed. The harness uses the pinned local
  `agent-device` CLI; `AGENT_DEVICE_CLI` can override it for diagnosis.

Relay-backed scenarios additionally require:

- For direct `qa:<scenario>` commands, a current Nuts coordinator running at
  `http://127.0.0.1:7823` (override with `COORDINATOR_URL`). Readiness checks
  require both `GET /healthz` and authenticated fixture-admin access. The
  complete `qa:all` suite owns this coordinator automatically. It provisions
  real strfry relays, so Docker must be available for relay containers and
  volumes.
- Fixture keys at `/root/code/strfry-badge-node/test/env/keys.json`
  (override with `KEYS_JSON`): `admin` (venue authority, NIP-98 signer, staff
  persona), `issuer`, and `users[]` (order holders).
- UI-only scenarios such as welcome do not need any of this.

## Running a scenario

Each scenario is a named entry point `.qa/qa-<screen-or-workflow>.mjs`:

```sh
npm run qa:welcome
# or directly:
node .qa/qa-welcome.mjs
```

## Battle tests

The live-subscription battle test proves more than an app-authored update. It
waits until the already-open Orders subscription logs EOSE, pauses so the
initial query is definitively over, and publishes an independently signed
`37237` event from a separate Node/WebSocket process. The flow then requires
the untouched UI to move the exact order to Accepted. Its verifier independently
queries the exact event ID, verifies its signature and complete NIP-97 context,
and matches both the receive marker and the final app projection:

```sh
npm run qa:battle:phone
npm run qa:battle:tablet
```

Battle artifacts are deliberately previews; they do not change the canonical
30-screen phone/tablet UX maps or their default 12-scenario contract.

## Interactive designer review

Start a fixture-backed live app in one terminal and leave it running:

```sh
npm run qa:review -- start phone home
# or: npm run qa:review -- start tablet home
```

The command owns an isolated relay, seeds the real app, verifies fixture truth,
and then waits. From any other repository terminal—including a design agent—use
the same semantic Agent Device session to inspect and navigate freely:

```sh
npm run qa:review -- status
npm run qa:review -- device snapshot -i
npm run qa:review -- device press 'id="nav-orders"' --settle
npm run qa:review -- device press 'label="Settings"' --settle
npm run qa:review -- stop
```

`stop` is explicit and token-scoped. It closes only that Agent Device session,
deletes only its fixture relay/volume, clears app state, and releases the suite
lock. The reviewer is not constrained to a saved `.ad` path, so this mode is
suitable for visual critique, exploratory testing, and screenshots on the
currently selected phone or tablet contract.

## Running the complete suite

Boot the exact target emulator, then run its locked suite. The suite verifies
the installed development APK against the current build and reinstalls only
when their hashes differ:

```sh
npm run qa:device:phone
npm run qa:all:phone

# After stopping the phone emulator:
npm run qa:device:tablet
npm run qa:all:tablet
```

`qa:all` runs full-source Jest coverage with a checked regression floor,
TypeScript, the screen-contract gate, and harness regression tests before
touching device state. Jest coverage deliberately includes unimported
`src/**/*.ts(x)` files; it measures the unit-test layer, not Agent Device or the
independent relay verifiers, and therefore must not be presented as total app
coverage. The suite then owns Metro on port 8090,
injects the device-reachable URL for its owned coordinator into the app bundle,
builds and owns a current coordinator on `127.0.0.1:7823`, and runs
the Agent Device scenario wrappers serially. It continues across scenario failures
so every journey can leave diagnostics and screenshots, prints one aggregate
summary, and exits non-zero if any stage failed. A complete profile is staged
only when all 12 scenarios, the current debug-APK build, and every fast gate
pass. Canonical evidence is replaced atomically only after the matching phone
and tablet stages share the same matrix run ID and pass the matrix verifier.
Failed or partial runs leave a preview under their
`/tmp/crays-board-qa-suite-*` artifact directory and preserve the last complete
paired matrix.

The phone contract is the `google` AVD at 1080x2400/420 dpi (about 411 dp
wide). The tablet contract is `crays_samsung_tab` at 1600x1000/240 dpi (about
1067 dp wide). The runner rejects the wrong AVD, dimensions, or density and
pins every ADB and Agent Device command to the selected device. Give paired runs the
same provenance identifier when producing a release matrix:

```sh
QA_MATRIX_RUN_ID=release-candidate-42 npm run qa:all:phone
QA_MATRIX_RUN_ID=release-candidate-42 npm run qa:all:tablet
```

Each failed Agent Device attempt is retained under `failed-attempts/` and excluded
from the canonical screenshot tree. A scenario receives one retry by default
to isolate Android instrumentation/Fabric startup flakes; deterministic failures
still fail twice. Set `QA_SCENARIO_RETRIES=0` when diagnosing without retries.

The suite takes an atomic `/tmp/crays-board-qa-suite.lock`; do not run raw
Agent Device scenarios against the same device while it is held. Override the
scenario set with a comma-separated list, for example:

```sh
QA_SCENARIOS=welcome,orders npm run qa:all
```

To use an already-managed coordinator deliberately, set
`QA_MANAGE_COORDINATOR=0` and `COORDINATOR_URL`. The default refuses to adopt
an existing process on its port so a stale coordinator cannot silently pass a
mere health check. External coordinators must also provide
`QA_COORDINATOR_IDENTITY_SHA256=<sha256-of-the-exact-coordinator-implementation>`;
the phone and tablet receipts must carry the same implementation identity.

Metro follows the same ownership rule because a healthy Metro status alone
does not prove which `EXPO_PUBLIC_*` values were bundled. To keep one stable
Metro across the complete phone and tablet matrix, set `QA_MANAGE_METRO=0`
after starting port 8090 with
`EXPO_PUBLIC_CRAYS_COORDINATOR_URL` set to the device-reachable coordinator URL
(for the default coordinator, `http://10.0.2.2:7823`). Canonical capture then
verifies and records the listener PID, repository working directory, Expo start
command, explicit port, coordinator environment, and current source revision.
An external server with missing or mismatched provenance is rejected.

Before replay, `.qa/agent-device-runner.mjs` cold-starts the Board package
against the owned Metro URL, accepts the native Expo development-client notice
when present, dismisses its tool sheet semantically, and waits for a Board
surface before handing the device to the `.ad` test. This avoids server-
discovery races and works across the different phone/tablet sheet timings. Do not replace it with a generic
`exp://` link; another installed Expo client may claim that link.

The default `google` AVD uses the Android 34 Google APIs image. The runner keeps
the existing emulator alive when it already matches the profile contract;
restart is recovery behavior, not a normal step between app edits.

Current scenarios cover Welcome, Venue selection, Orders, the full order
ladder, Menu, Events, Check-in, People, Invites, Settings, Home, and Create
Venue. Their entry points are the matching `.qa/qa-*.mjs` files and the npm
scripts in `package.json`; the contract registry is the authoritative mapping
from each `docs/screens/*.md` contract to its flow and runner.

### Native-runtime regression status

The historical relay-backed People `OutOfMemoryError` in
`NipworkerReactNativeModule.emitRuntimeData` is retained as regression context,
not as a current harness blocker. The subsequent zero-retry paired phone/tablet
run completed all 12 scenarios and 30 screenshots per profile. Any recurrence
must be reported as an app/native-runtime failure with its logcat evidence, not
hidden as an Agent Device retry or selector failure.

## Relay-backed scenario lifecycle

`node .qa/qa-orders.mjs` (or `npm run qa:orders`) runs the full lifecycle:

1. **Bootstrap** (`.qa/relay-bootstrap.mjs`) creates a coordinator relay with
   `domain_label: craysboardqa-venue-<run>`, waits for `running`, mints an
   invite-service smoke token, and publishes — each signed by its proper
   authority and round-tripped until queryable:
   - venue hospitality profile `30078` / `d=nuts-community-profile` (admin);
   - NIP-97/NIP-99 sellable product listing `30402` / `d=qa-item-<run>`
     (anchor admin);
   - order award `8` for that product to `users[0]`, signed by the relay's
     badge issuer secret — the implicit-pending order.
2. **Exercise** prepares the public dev-only seed route with `RELAY_URL`,
   `SERVICE_URL` (emulator `10.0.2.2` variants), and `QA_NSEC` (staff =
   keys.json admin nsec), then Agent Device replays the public UI with only the
   fixture variables referenced by that `.ad` file, such as `AWARD_ID`,
   `AWARD_ID_PREFIX`, `ITEM_ADDRESS`, and `USER_PUBKEY`.
3. **Verify** checks relay truth independently (`relay-verify.mjs` always,
   plus scenario verifiers such as `verify-order-accepted.mjs`).
4. **Teardown** (`.qa/relay-teardown.mjs`, in `finally`) deletes the exact
   relay, removes the exact `strfry-badge-data-<id>` volume, and removes the
   scenario state file `/tmp/qa-crays-board-<scenario>.json`.

The stages also run standalone:

```sh
npm run qa:relay:bootstrap   # provision + seed, writes state
npm run qa:relay:teardown    # delete relay + volume + state
node .qa/relay-verify.mjs    # independent relay truth while state is live
node .qa/relay-teardown.mjs --sweep  # crash recovery, craysboardqa- prefix only
```

`--sweep` refuses to run while a live scenario state file exists; use plain
teardown first.

## Fixed app-side contract (relay scenarios)

The app is built against this contract; the harness does not invent
alternatives:

- **Seed deep link (dev only):**
  `craysboard://qa-seed?relay=<ws-url>&service=<http-url>&nsec=<staff-nsec>` —
  installs the staff signer, selects the venue at that relay, lands on the
  Board shell.
- **Logcat markers** (JSON payload after the marker):
  - `[crays-board-venue]` — selected venue relay url + admin pubkey;
  - `[crays-board-order]` — one per projected order:
    `{"id": <award event id>, "a": <definition address>, "status": <projected>}`;
  - `[crays-board-order-status]` — one per published status:
    `{"id": <status event id>, "e": <award id>, "status": <value>}`.
  - `[crays-board-orders-eose]` — the live Orders subscription reached EOSE
    while remaining open for subsequent events;
  - `[crays-board-order-received-status]` — a structurally valid status received
    by that subscription, including its exact event ID, award ID, and value.
- **Public testIDs:** `orders-screen`, `order-card-<awardIdPrefix>` per card
  (`AWARD_ID_PREFIX` is the first 12 chars of the award id), and
  `order-accept-button` on a pending card.

A passing scenario prints `QA PASS: <scenario>` and exits 0 only after its
verification step. A failing scenario still runs scoped teardown in `finally`;
Agent Device screenshots and divergence reports remain available for diagnosis.

## UX map

The complete suites publish two independent, infinite-canvas boards:

- `design/ux-map/phone/index.html` for the exact phone viewport.
- `design/ux-map/tablet/index.html` for the exact tablet viewport.
- `design/ux-map/index.html` as the device-map hub.

Each board contains all 30 logical screenshots declared by `e2e/flows/*.ad`,
grouped into journey columns in flow order. Its manifest records profile, run
identifier, source artifact directory, development APK hash, hashes for every
PNG, and the hash of an adjacent `run-receipt.json`. Canonical device, density,
and orientation claims come from ADB observations (`wm`, `dumpsys input`,
emulator identity, and build properties), not requested profile constants. The
suite streams the installed package's `base.apk` back from the device and
requires its SHA-256 and byte length to equal the APK built on the host. Exact
dimension filtering prevents phone/tablet or historical artifacts from being
mixed. PNG evidence is CRC-checked, inflated, and scanline-validated rather
than trusted from its signature and IHDR alone.

The receipt binds Metro-served JavaScript and harness behavior to the exact
working tree. It deterministically inventories and hashes four components:
application source/runtime configuration, `.qa` plus device scripts, Agent Device
flows, and `package-lock.json`. Relevant modified files, untracked files, and
tracked deletions are represented by their current bytes/state. The suite
computes this digest before fast gates and again after all scenarios, refusing
a canonical stage if it changed. Publish requires exact phone/tablet equality
for the aggregate digest and every component hash, APK, run ID, screen set, and
coordinator implementation. It also requires the pending receipt revision to
equal the current working tree immediately before the atomic rename.

Each profile receipt records every fast gate (including lint and the Android
build), every scenario attempt and retry count, the independent verifiers
implied by a successful scenario runner, installed package/version/signing
observations, coordinator URL/mode/health/implementation identity, Metro's
public coordinator URL and revision binding, and observed device identity and
window properties. Partial and failed suites retain a receipt in their `/tmp`
artifact directory but can never pass the publish verifier. The adjacent
`screens/*.png` files remain named for image review or Stitch import.

`npm run qa:ux-map:phone` and `npm run qa:ux-map:tablet` build local partial
previews under `/tmp/crays-board-ux-map-preview`; they can never overwrite
canonical evidence. `npm run qa:ux-map` refreshes that preview hub and reports
the status of both profiles. `npm run qa:ux-map:verify` rejects incomplete,
missing-receipt, failed-gate, failed-scenario/verifier, cross-run,
cross-revision, cross-APK, installed-package mismatch, coordinator mismatch,
wrong-device, unexpected-name, duplicate, missing, undecodable-PNG,
wrong-dimension, or hash-mismatched paired evidence.

## Ownership prefix and sweep rules

Everything this harness creates outside the app package is namespaced with the
`craysboardqa-` prefix: coordinator `domain_label` values, `/tmp/qa-crays-board-*`
state files, and sweep matching. The sibling `crays-rn` harness uses
`craysqa-`; the distinct prefixes guarantee one harness never deletes the
other's relays, volumes, or state.

Teardown only ever removes resources explicitly recorded in the scenario's
ownership manifest. A crash-recovery `--sweep` may target only the
`craysboardqa-` prefix and refuses to run while a live scenario state file
exists.

QA state files are created mode `0600` and removed during scoped teardown.
They normally carry only public keys, event IDs, and resource identifiers. An
invite scenario may also carry its opaque bootstrap token, and Check-in carries
its short-lived synthetic presentations because Agent Device must enter them through
the public UI. Those fixture credentials are never printed, copied to logs or
screenshots, or retained after teardown. Private signing keys and payment
credentials are never written to scenario state.
