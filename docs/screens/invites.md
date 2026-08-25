# Invites — configure, create, QR/share result

Covers QA_WORKFLOWS INVITE-01 (configure and create, 7d/90d/5 slice), INVITE-02 (NIP-98 request binding), INVITE-03 (pending/repeat-tap idempotency), and INVITE-04 (QR and native sharing). INVITE-05/06 (guest redemption) belong to `crays-rn`; INVITE-07 (permission loss/venue switching) and INVITE-08 (active invite list and revocation) stay out of this build because the existing `/invites` service can neither list nor revoke invites — no local guesses are projected.

## Purpose

Prove that staff with `invites` permission can configure claim expiry, membership duration, and maximum redemptions, and that one deliberate Create sends exactly one NIP-98-authorized `POST` to the selected venue's `/invites` service — the kind `27235` authorization bound to the exact URL, `POST` method, and SHA-256 of the exact payload. Only a real service response produces the venue-branded QR/share result. Verified independently against the live invite service and the relay, never from rendered text alone.

## Persona and permission

Staff identity (QA admin key) with venue authority on an isolated venue relay provisioned for the run. Identity is installed only through the dev-only `craysboard://qa-seed` deep link.

## Starting truth

- Isolated relay `craysboardqa-venue-<run>` with its NIP-11 root key,
  root-signed `31727` community anchor, root-authored invite-membership, venue
  profile `30078`, one anchor-admin-signed kind `30402` product listing, and
  one delegated-issuer-signed kind `8` award — the shared venue fixture
  family. The invite HTTP service is running at the relay container's base
  URL; the bootstrap invite-smoke token lives only in the mode-`0600` scenario
  state and is never logged.
- App installed, state cleared, Metro on 8090, one Android device.

## User action

Open the seed deep link (lands on Orders), open the Invites destination, set **Claim link expires** to *7 days*, **Membership duration** to *90 days*, **Maximum redemptions** to *5*, then **double-tap** Create secure invite. When the result appears, tap **Copy link**.

## Visible result

- `invites-screen` appears inside the Board shell with the configuration panel (`invite-expiry-field`, `invite-duration-field`, `invite-redemptions-field` dropdowns).
- While the service response is pending, the button reads "Creating…", is disabled, and a repeat tap starts no second request.
- On success, `invite-result-panel` shows the venue identity (relay host), the QR (`invite-qr`) of the full guest redeem URL, and three badges: "Valid for 7 days", "5 uses", "90 days membership". `invite-share-button` uses the native share sheet; `invite-copy-button` copies the redeem URL and reads "Copied".
- The raw token is never displayed separately anywhere on screen.

## Authoritative result

- The invite service (`POST {serviceUrl}/invites`) enforces the NIP-98 binding exactly: independent probes with a wrong `u` tag, wrong `method` tag, wrong `payload` hash, or an unauthorized signer are all rejected, while a correctly bound admin request succeeds (INVITE-02). Because creation is impossible otherwise, the app's created invite was bound to the exact URL, method, and payload.
- An independently minted probe invite decodes to claims with the exact requested `exp`/`badge_exp`/`max`, and its HMAC signature verifies against the relay's invite secret — proving the service mints invites with exact parameters on this instance.
- Logcat `[crays-board-invite]` carries exactly one marker with the created invite's unsigned claims: `max=5`, `badge_exp − exp = 7171200` (90 days − 7 days, exact), `exp` still in the future at verification time, and the venue service host. The marker contains no raw token (no `token` key, no token-shaped value, neither the bootstrap smoke token nor any probe token as substring).
- The venue relay holds no invite-related writes: creation is a scoped HTTP side effect, so exactly the seeded fixture family exists and no additional kind `8` award appears (§13: invites are not a relay contract).
- The double-tap produces exactly one marker and exactly one result panel (INVITE-03 in-flight guard).

## Forbidden result

- No request leaves the device before the Create tap; no second `POST /invites` from a repeat tap while one intent is in flight.
- No raw invite token in logcat, screenshots, markers, or a separate on-screen
  field; QR/share/copy carry only the full redeem URL. The harness's scoped
  bootstrap token is confined to its mode-`0600` state file and removed at
  teardown.
- No generic QR or fake success before the service returns a real token; no result presented for an HTTP error or rejected authorization.
- No NIP-98 event published to any relay (it is HTTP authorization only); no write to any other venue's relay; no nsec/private hex anywhere.

## Lifecycle boundary

Configuration and result live only for the mounted screen: changing venue or leaving the destination discards the in-memory result, and a stale result is never attributed to a different venue. No invite list is persisted locally (INVITE-08 deferred per above).

## Cleanup

Scenario teardown deletes exactly the owned relay, its docker volume, the app package state, and the scenario state file.
