# People & roles — team access derived from relay truth

Covers QA_WORKFLOWS PEOPLE-01, PEOPLE-02, PEOPLE-04, PEOPLE-05, ROLE-01 (edit path), ROLE-02, and ROLE-03 for the seeded fixture. PEOPLE-03 (narrower personas), PEOPLE-06 (phone split beyond the single-column composition), ROLE-04 (clock-driven expiry while active), and ROLE-05 (concurrent-edit reconciliation) are later slices.

## Purpose

Prove that the People list is derived from venue relay truth — community
admins from the root-signed NIP-97 anchor plus holders of valid kind `8`
role/membership awards — with the three deterministic statuses, and that the
three staff mutations land as exact protocol events: membership revocation
(kind `5` referencing the award id), role edit (same-`d` kind `30009` with the
final permission set), and role assignment (kind `8` with exact `a`/`p` and
query hints). Every mutation is verified against the relay independently,
never from rendered text alone.

## Persona and permission

Staff identity (QA admin key named by the root-signed community anchor and
holding every permission) on an isolated venue relay provisioned for the run.
Identity is installed only through the dev-only `craysboard://qa-seed` deep
link; the flow then deep-links to `/people`.

## Starting truth

- Isolated relay `craysboardqa-venue-<run>` with its NIP-11 root key,
  root-signed `31727` community anchor, root-authored invite-membership
  definition, and standard venue fixture family (profile `30078`, sellable
  product listing `30402`, delegated-issuer-signed product award), plus the
  people fixtures, each signed by its proper authority and round-tripped:
  - role definition `30009` / `d=qa-role-<run>` ("QA Events host",
    `t=role`, permissions `31923/write` + `invites`, admin-signed; no legacy
    `type` tag);
  - sellable membership definition `30009` / `d=qa-membership-<run>`
    (`t=membership`, recurring `price` tuple, admin-signed);
  - active membership award (kind 8, issuer-signed) to `users[0]` ("QA Active Member" via its own kind 0);
  - membership award expiring in 10 days to `users[1]` ("QA Expiring Member");
  - membership award to `users[2]` ("QA Expired Member") already revoked by an admin-signed kind 5 — the deterministic Expired fixture (an already-past NIP-40 expiration would be dropped by the relay on write, so the fixture uses revocation; both grant nothing and leave the person Expired);
  - a temporary admin-authored `t=role` definition granting
    `permission=0/write`, plus admin-signed awards to `users[0..2]`; this
    capability lets those users publish their own kind `0` profiles and is
    revoked immediately afterward. Membership is not treated as a blanket
    relay-write bypass;
  - kind 0 profiles for the venue admin and the three fixture users.
- App installed, state cleared, Metro on 8090, one Android device.

## User action

Open the seed deep link, then `craysboard://people`. Assert the three statuses. Open "QA Active Member", tap Revoke membership, and confirm in the dialog (double-tap safe). Switch to Roles & access, open "QA Events host", toggle the Posts permission on, and Save. Back on People, open "QA Expiring Member", tap Assign role (which pre-fills the assign form with that person's key), and confirm a permanent assignment to the seeded role.

## Visible result

- `people-screen` appears inside the shell with the People tab first: the venue admin and "QA Active Member" show "Active", "QA Expiring Member" shows "Expiring soon" with its expiry date, "QA Expired Member" shows "Expired".
- The confirmation dialog names the person, the membership, and the venue; confirming shows "Membership revoked" and the person drops to "Expired" once the relay echo arrives. Dismissing the dialog publishes nothing.
- The role editor shows the 7-permission matrix with labels and descriptions; Save confirms with "Role saved" only after the relay ack.
- The assign form shows "Role assigned" only after the relay ack.

## Authoritative result

- Exactly one app-written kind `5` references the seeded active award id via
  an `e` tag (with `k=8`), signed by the staff/admin key, signature valid, and
  `created_at >= award.created_at`. Four other kind `5` fixtures are explicitly
  recorded: the expired membership revocation and three temporary
  profile-writer cleanup revocations. Total kind `5` count is exactly five.
- Exactly one new kind `8` role assignment carries
  `a=30009:<admin>:qa-role-<run>`, `p=<users[1] pubkey>`, and the NIP-97
  `t=30009`/`t=role` query hints, signed by the staff/admin key, with no
  `expiration` tag (permanent).
- The current `30009` at `d=qa-role-<run>` keeps the same `d`, is classified
  only by `t=role`, and its repeated `permission` tags are exactly
  `1/write`, `31923/write`, and `invites` — posts, events, and invites. It is
  signed by the staff/admin key and carries no legacy `type` tag.
- Logcat `[crays-board-person]` markers project each visible person; `[crays-board-revoke]`, `[crays-board-role]`, and `[crays-board-assign]` carry the same event ids that landed on the relay.

## Forbidden result

- No kind 5 before the confirm tap or from dismissing the dialog; no second kind 5 for the same award (including from a double-tap or a tap while publishing); no revocation referencing any other award.
- No role definition with a new `d` from an edit; no `permission` tag outside the canonical seven; no kind 8 for an invalid identity or past expiry (client-side validation produces zero writes).
- No revocation control on a root venue administrator (PEOPLE-05), no write to any other relay, no nsec/private hex in logcat or QA state.

## Lifecycle boundary

Statuses and mutations are relay-derived: the people projection folds kinds
`0`/`5`/`8`/`30009`/`31727` from the venue relay subscription
(`board_people_<relay>`, EOSE-as-loaded, unsubscribe on unmount/background),
so a relaunch re-derives the same list — including the post-revocation Expired
status — without local memory. A confirmed mutation is shown only after relay
ack; the acknowledged revocation folds in immediately and is independently
confirmed by the relay echo.

## Cleanup

Scenario teardown deletes exactly the owned relay, its docker volume, the app package state, and the scenario state file.
