# Create Venue — four-step wizard and happy-path provisioning

Executable contract: `e2e/flows/70-create-venue.ad` via
`.qa/qa-create-venue.mjs` (bespoke runner — there is no pre-existing relay;
the app itself provisions it). Covers CREATE-01, CREATE-02, CREATE-03 (import
path + recovery gate), CREATE-04, CREATE-05, and CREATE-06 from
`docs/testing/QA_WORKFLOWS.md`; visual references
`design/mockups/crays-board-create-venue-*-tablet.png`. Failure-injection
(CREATE-07…CREATE-11) arrives with the durable-boundary scenarios.

## Purpose

Prove that a newcomer can walk the public UI from cold welcome through the
four-step Create Venue wizard, that nothing is created before the deliberate
step-4 **Create venue** action, and that one submission provisions exactly one
real venue: a coordinator relay owned by the staff key, ready, with the venue
hospitality profile published to it — verified independently against the
coordinator and the new relay, never from rendered text.

## Persona and permission

Newcomer with no active identity and no selected venue. During step 3 the
flow imports an existing authorized account (QA admin key) through the
wizard's import path — the same boundary production sign-in uses. After
provisioning, that key is the coordinator's sole `admin_pubkeys` provisioning
input and the sole admin named by the resulting root-signed NIP-97 anchor.

## Starting truth

- App package state cleared (`pm clear life.crays.board`), no signer, no
  selected venue, no local creation attempt.
- Suite-owned Nuts coordinator healthy at `http://127.0.0.1:7823`; **zero** relays whose
  domain contains the run slug exist before the run.
- Metro serving the dev client on 8090, one Android device. The app resolves
  the coordinator at `http://10.0.2.2:7823` (QA Android default) or
  `EXPO_PUBLIC_CRAYS_COORDINATOR_URL`.
- Emulator URL contract: the coordinator verifies NIP-98 `u` tags against its
  own configured base URL (`NIP98_BASE_URL`), so the app signs the canonical
  host-loopback form (`127.0.0.1`) while fetching through the `10.0.2.2`
  alias; and coordinator-reported `relay_url`/`base_url` are host-loopback in
  dev, so the app maps them to the device-reachable alias before connecting
  (`deviceReachableUrl` in `src/create-venue/coordinator.ts`).

## User action

Cold launch → welcome → **Create venue**. Step 1: type a unique venue name
(`QA Venue <run>` via Agent Device env) and an optional introduction; the slug and
guest preview update live; **Continue**. Step 2: keep the device-suggested
timezone, optionally fill address/hours; **Continue**. Step 3: choose **Sign
in / import existing account**, paste the staff nsec, **Import account**, fill
the owner display name, tick the recovery acknowledgement (it gates
**Continue**); **Continue**. Step 4: review the exact summary, then tap
**Create venue** once. Wait through provisioning to the success surface, then
**Open venue**.

## Visible result

- `create-venue-screen` hosts the wizard; steps 1–4 are reachable in order,
  Back/Edit preserve the draft, and **Continue** on step 3 is disabled until
  an account exists and recovery is acknowledged.
- Before submission there is no coordinator traffic and no signer; validation
  errors (`cv-name-error`, `cv-hours-error`) are inline.
- After submission `create-venue-provisioning` shows the five truthful stages
  (Setting up your account / Reserving your venue / Adding it to your venues /
  Publishing the venue profile / Finishing setup), then
  `create-venue-success-screen` shows **Venue created** with honest per-stage
  status: relay **Ready**, venue profile **Published**, directory listing
  **Not configured yet**, room discovery **Action needed**.
- **Open venue** (`cv-open-venue-button`) lands on the board home with the new
  venue selected.

## Authoritative result

- The coordinator (`GET /relays`, NIP-98 as the staff key) contains **exactly
  one** relay whose domain contains the run slug; its `admin_pubkeys` is
  exactly `[staff pubkey]`, and it reports `running` with `relay_url` and
  `base_url`.
- The new relay's NIP-11 `pubkey` identifies its community root. That root's
  current `31727`/`d=community` anchor names exactly the staff admin and the
  relay's delegated badge issuer, and its root-authored invite-membership
  definition resolves at the service-advertised required badge address.
- The NEW relay round-trips exactly one kind `30078` with
  `d=nuts-community-profile`, `type=hospitality`, `t=hospitality`, the venue
  name, and the introduction as `about`, signed by the staff key with a valid
  signature.
- Logcat `[crays-board-create-venue]` carries the same relay id, staff pubkey,
  slug, and stable attempt id — device truth matches coordinator truth, with
  the relay/service URLs compared in device-reachable form (emulator alias).
- The venue selection (`crays.board.venue`) points at the new relay/service
  with the staff pubkey (proven by the board opening on it).

## Forbidden result

- No relay, profile, signer, or coordinator request before the step-4 tap; no
  second relay for the run slug (one deliberate submission, one stable
  attempt); no venue profile on any other relay; no success claim for
  directory/payments/invites/room (reported as not configured); no
  nsec/private hex in logcat, screenshots, or QA state.

## Lifecycle boundary

Scenario ends at the success surface and the Open venue navigation. Resume
structure exists (attempt record persisted before the POST; unfinished
attempts offer **Resume venue setup**), but kill/relaunch resume proofs and
failure injection at each durable boundary are CREATE-08…CREATE-11 and are
covered by their own contracts. Cancellation never deletes a reserved relay.

## Cleanup

Runner teardown (in `finally`) deletes exactly the relay recorded in the
scenario state plus its `strfry-badge-data-<id>` volume (reusing
`.qa/relay-teardown.mjs` with `CRAYS_BOARD_QA_STATE`), clears the
`life.crays.board` package, and removes `/tmp/qa-crays-board-create-venue.json`.
Agent Device screenshots are retained for diagnosis.
