# Crays Board QA harness

Every screen and every workflow has a named scenario here. UI automation lives
in `maestro/flows/`; orchestration, infrastructure setup, independent truth
checks, and teardown live in `.qa/`. The architecture is described in
`docs/architecture/qa-harness.md`; the product-level scenario catalog is
`docs/testing/QA_WORKFLOWS.md`.

Every scenario follows the same lifecycle:

1. **Bootstrap** checks the device, clears logcat and the exact app package,
   and writes a public-safe state file.
2. **Exercise** drives the public app UI through a screen-specific Maestro
   flow.
3. **Verify** (when the screen crosses a service boundary) checks truth
   independently of the rendered UI.
4. **Teardown** runs in `finally` and clears exactly the `life.crays.board`
   package plus the scenario state file.

`npm run qa:contracts` is the fast structural gate: every file under
`docs/screens/` must be registered in `.qa/verify-screen-contracts.mjs` with
an existing Maestro flow and a named `.qa` lifecycle runner.

## Prerequisites

- One booted Android device or emulator reachable by `adb` (`adb get-state`
  returns `device`).
- The Crays Board development-client build installed (`life.crays.board`,
  scheme `craysboard`).
- Metro serving the dev client on port 8090 (Board-specific; 8085 belongs
  to the crays-rn dev server):

  ```sh
  npm run start:maestro
  adb reverse tcp:8090 tcp:8090
  ```

- Maestro CLI on `PATH`, or point `MAESTRO_CLI` at the binary
  (e.g. `MAESTRO_CLI=$HOME/.maestro/bin/maestro`).

Relay-backed scenarios additionally require:

- The Nuts coordinator running at `http://127.0.0.1:7798` (`GET /healthz`
  answers `ok`; override with `COORDINATOR_URL`). It provisions real strfry
  relays, so Docker must be available for relay containers and volumes.
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

Current scenarios:

- `qa-welcome.mjs` — UI-only cold welcome (ENTRY-01), flow
  `maestro/flows/00-welcome.yaml`, contract `docs/screens/welcome.md`.
- `qa-orders.mjs` — relay-backed orders vertical slice, flow
  `maestro/flows/10-orders.yaml`, verifiers `.qa/relay-verify.mjs` +
  `.qa/verify-order-accepted.mjs`. **Cannot pass until the app implements its
  side of the contract below** (deep link, markers, testIDs); the harness is
  complete and provisions/verifies/teardown works standalone.

## Relay-backed scenario lifecycle

`node .qa/qa-orders.mjs` (or `npm run qa:orders`) runs the full lifecycle:

1. **Bootstrap** (`.qa/relay-bootstrap.mjs`) creates a coordinator relay with
   `domain_label: craysboardqa-venue-<run>`, waits for `running`, mints an
   invite-service smoke token, and publishes — each signed by its proper
   authority and round-tripped until queryable:
   - venue hospitality profile `30078` / `d=nuts-community-profile` (admin);
   - sellable product definition `30009` / `d=qa-item-<run>` (admin);
   - order award `8` for that product to `users[0]`, signed by the relay's
     badge issuer secret — the implicit-pending order.
2. **Exercise** runs Maestro with `RELAY_URL`, `SERVICE_URL` (emulator
   `10.0.2.2` variants), `QA_NSEC` (staff = keys.json admin nsec), `AWARD_ID`,
   `AWARD_ID_PREFIX`, `ITEM_ADDRESS`, `USER_PUBKEY`.
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
- **Maestro testIDs:** `orders-screen`, `order-card-<awardIdPrefix>` per card
  (`AWARD_ID_PREFIX` is the first 12 chars of the award id), and
  `order-accept-button` on a pending card.

A passing scenario prints `QA PASS: <scenario>` and exits 0 only after its
verification step. A failing scenario still runs scoped teardown in `finally`;
Maestro screenshots remain available for diagnosis.

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

QA state, logs, and screenshots must never contain private keys (nsec/hex),
payment URLs, or presentation payloads; state files carry public keys, event
IDs, resource identifiers, and the bootstrap invite token (kept for later
invite scenarios, mirroring crays-rn discipline — never logged).
