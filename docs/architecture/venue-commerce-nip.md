# Crays Board protocol contract (NIP-97)

**Status:** pilot v2. Entitlement substrate is **NIP-97** (Composable
Entitlements and Community Access Control; draft spec of record at
`~/nips/97.md`). This document pins the Board's implementation choices and its
Board-specific records. Where NIP-97 speaks, this document does not repeat it —
it cites it.

**Applies to:** `crays-board` (staff). Interop counterparts: `crays-rn`
(guest), `nuts-cash` (community admin/storefront), the venue relay node
(`strfry-badge-node`), and the coordinator/services.

## 1. Trust model

The only out-of-band fact is the venue relay's NIP-11 `pubkey` — the community
**root key** (NIP-97 §Trust Model). Everything else is derived from signed
events on the pinned venue relay:

1. Fetch the relay's NIP-11 document over HTTP(S); take `pubkey` as root.
2. Resolve the **community anchor** (kind `31727`, `d=community`) from the
   venue relay; accept only root-signed candidates, latest by `created_at`
   then lowest event id.
3. The anchor's `p` tags are the **anchor admins**; its `badge_issuer` tag is
   the delegated issuer operated by the companion service.

Authority sets used by every Board projection:

- **Definitions** are accepted from anchor admins **plus the root key** (the
  relay node authors its invite-membership definition `30009:<root>:members`
  with the root key).
- **Award issuance** (NIP-97 §Issuance): an anchor admin may award any
  definition; the `badge_issuer` may award **sellable** definitions only — a
  well-formed `price` tag (zero counts).
- **Status signers** (NIP-97 §Fulfillment): anchor admins, the
  `badge_issuer`, or holders of live admin-issued role awards whose current
  role definition grants `["permission","37237","write"]`. Board resolves
  those definitions, awards, expirations, and revocations from the pinned
  venue relay; it does not rely on a deployment-specific write gate for read
  validity.
- **Revocation** (NIP-09 kind `5`): the award's own issuer or an anchor admin.

Deprecated trust signals: NIP-11 `admin_pubkeys`/`admins`, `/community/info`,
and the room manifest `award_issuer` tag are no longer authority sources
(`/community/info` remains as a convenience mirror for the invite flow only —
the service derives it from the same anchor).

## 2. Kind registry

| Kind | Class | Purpose | Board writes |
| --- | --- | --- | --- |
| `31727` | addressable | NIP-97 community anchor (`d=community`, root-signed) | no (relay node bootstraps) |
| `30009` | addressable | Role (`t=role`) and membership (`t=membership`) definitions (NIP-58) | yes |
| `30402` | addressable | Product, pass, and ticket definitions (NIP-99) | yes (products) |
| `31923` | addressable | Timed calendar event (NIP-52) | yes |
| `31925` | regular | RSVP (NIP-52) | no (read only) |
| `8` | regular | Awards (purchases, grants, role assignments) | role assignments only |
| `5` | regular | Revocation referencing award ids (NIP-09) | yes |
| `37237` | addressable | Entitlement status (order ladder, check-in) | yes (only status kind written) |
| `27236` | regular | Short-lived entry presentation | no (validated only) |
| `30078` | addressable | Board-specific: venue profile / room manifest | venue profile only |
| `0` | regular | Venue-local profiles (display names) | no (read only) |

Legacy kind `27237` is **not** read: it predates the Board and was never
implemented here. Pre-NIP-97 Board shapes (`30009` with `type` tags,
`t=sellable`, stage-scoped status `d`) are abandoned, not dual-read — pilot QA
relays are freshly provisioned per scenario, so there is nothing to migrate.

## 3. Definitions

Classification is derived from the definition itself (kind + `t` topic + `a`
link), never from award tags or a `type` tag (NIP-97 §Classification).

### 3.1 Products — kind `30402` (NIP-99 listing)

Board-built tags:

```
["d", "<stable identifier>"]
["title", "<display name>"]                // >= 2 chars
["price", "<positive decimal>", "<ISO-4217 uppercase>"]
["availability", "available|unavailable|archived"]
["product_kind", "food|drink|merchandise|generic"]
["section", "<section name>"]              // OPTIONAL
["position", "<deterministic integer>"]    // OPTIONAL, ties break by d
["summary", "<text>"]                      // OPTIONAL (readers accept `description` too)
```

No `max_uses`: `30402` defaults to one use (NIP-97 §Products). A `price` tag
makes the listing sellable — there is no separate sellable marker.

A listing carrying an `a` tag to a `31922`/`31923` address is a **ticket** and
stays with its event (check-in slice), never in the menu. Tickets are created
by the storefront side (`nuts-cash`); Board ticket creation is future work.

### 3.2 Memberships — kind `30009` (NIP-58)

```
["d", "<stable identifier>"]
["t", "membership"]
["name", "<display name>"]
["price", "<amount>", "<CURRENCY>", "<recurrence?>"]   // month | year; absent = one-time
["availability", "available|unavailable|archived"]
["description", "<text>"]                              // OPTIONAL
```

Managed under Settings → Memberships. The plans list is scoped to **anchor
admin** authors: the relay node's root-authored `30009:<root>:members`
invite-badge definition resolves for member display but is not an editable
plan.

### 3.3 Roles — kind `30009` (NIP-58 + NIP-97 permission tags)

```
["d", "<stable identifier>"]
["t", "role"]
["name", "..."], ["description", "..."]                // description OPTIONAL
["permission", "<capability>", "<access?>", "<topic?>"]  // repeated
```

Board's 7-key matrix maps to NIP-97 capabilities (identical to `nuts-cash`):

| UI key | permission tag |
| --- | --- |
| posts | `["permission", "1", "write"]` |
| media | `["permission", "1063", "write"]` |
| events | `["permission", "31923", "write"]` |
| store | `["permission", "30402", "write"]` |
| invites | `["permission", "invites"]` |
| moderation | `["permission", "moderation"]` |
| settings | `["permission", "settings"]` |

Role authoring is reserved to anchor admins (privilege-escalation boundary,
NIP-97 §The permission tag). Roles are never sellable. At most four
configurable roles; editing retains the addressable identity; only the
original author edits.

### 3.4 Update rule (all Board-owned definitions)

Editing MUST reuse the same `d` and resolve as the latest addressable event
(`created_at`, tie → higher event id). Only the original publishing key may
edit; other trusted definitions remain visible but non-editable.

## 4. Awards (kind `8`)

NIP-58 base: `["a", "<definition address>"]`, one or more `["p", recipient]`,
optional NIP-40 `["expiration"]`. NIP-97 extensions the Board parses:

- **Query hints** (`t` tags, spec MUST): the definition kind prefix
  (`["t","30402"]`) plus the finer topic when it subdivides (`role` /
  `membership` / `event_access`).
- **Semantic context**: `["order", "<order-ref>"]` for store purchases or
  `["event", "3192x:<author>:<d>"]` for admissions.
- **Idempotency binding**: `["i", "payment-redemption:<id>"]` on the payment
  path.

The **order ref** of a purchase award resolves as: `order` tag → `i` minus its
`payment-redemption:` (or `payment:`) prefix → the award event id.

Board writes awards only for staff role assignment:

```
["a", "30009:<author>:<role-d>"], ["p", "<holder hex>"], ["expiration", "..."]?,
["t", "30009"], ["t", "role"]
```

Validity (NIP-97 §Validity): signature, resolved from the pinned venue relay,
issuer satisfies §1 issuance rules against the current anchor, unexpired, not
revoked.

## 5. Fulfillment statuses (kind `37237`)

One status records the state of **one use** of one award, addressed by its
fulfillment context so the latest per context survives addressable
replacement:

```
kind: 37237
tags:
  ["status", "accepted|processing|ready|fulfilled|cancelled"]
  ["a", "<definition address>"]
  ["e", "<award event id>"]
  ["p", "<holder pubkey>"]
  ["order", "<order-ref>"]            // XOR:
  ["event", "3192x:<author>:<d>"]
  ["d", "order:<order-ref>"]          // or "event:<coordinate>" — MUST equal
                                      // the context tag value prefixed by its name
```

Statuses failing the XOR/`d`-match rule are ignored. A status must also bind
exactly to the award's definition and holder through `a`/`e`/`p`, and cannot
predate the award; a mismatched status is not part of that award/context pair.
`pending` is never published: a valid single-use award with no status at its
`order:<ref>` context is implicitly pending.

Resolution: the current status of one (award, context) pair is the latest
valid status by `created_at`, then **lowest** event id (NIP-97 cross-author
rule). Publishers keep `created_at` strictly monotonic per context
(`max(now, latest + 1)`), which also makes a retry after timeout replace
itself — same `d`, newer `created_at`.

### 5.1 Order ladder (Board)

```
pending → accepted → processing → ready → fulfilled
                          cancelled  (terminal, from any non-terminal stage)
```

Normal actions advance exactly one stage; event contexts may go directly to
`fulfilled`. Stage-skipping, backward moves, and actions on terminal orders
are invalid in the fold. Decline = `cancelled` from implicit `pending`
(renders "Declined"); cancellation after acceptance requires confirmation.

### 5.2 Uses

One fulfillment context whose latest status is `fulfilled` = one use.
`remaining = max_uses − fulfilled contexts` (clamped ≥ 0; a later `cancelled`
un-counts). `30402` defaults to one use; definitions without `max_uses` are
unlimited except `30402`.

## 6. Check-in (event contexts)

1. Guest presents a short-lived kind `27236` presentation, wire format
   `nuts:present:<base64url(JSON)>` (manual entry also accepts bare JSON).
2. Grammar: `["type","nuts_entitlement_presentation"]`, `["nonce", ...]`,
   `["expiration", created_at + 90]`, `["e", awardId]`, `["a", definitionAddress]`,
   `["r", "<venue relay ws url>"]`, exactly one of `["order", ref]` /
   `["event", coordinate]`.
3. Board validates in order: malformed → invalid signature → grammar →
   not-yet-valid (`created_at > now + 300`) → expired (`expiration < now`, or
   `created_at < now − 90`) → wrong event (event context ≠ the active event
   coordinate) → unknown/wrong award or holder → untrusted issuer → revoked →
   already checked in. Every class yields a guest-safe reason and zero writes.
4. Admission eligibility: awards of a ticket definition (kind `30402` with
   `a` = the event coordinate) or direct free-admission awards (`a` = the
   event coordinate itself; the event is its own definition — unsellable, so
   admin-issued only), issuer valid per §1, unexpired, unrevoked, with
   remaining uses.
5. On success Board publishes exactly one `37237` `status=fulfilled` with the
   `event` context (`d = event:<coordinate>`). Rescans and concurrent scanners
   resolve to one use; an exhausted award rejects with "Already checked in".

## 7. Board-specific records (unchanged by NIP-97)

- **Venue profile** — kind `30078`, `d=nuts-community-profile`: hospitality
  profile (`type`, `name`, `about`, `menu_url`, `booking_url`), written by the
  venue on provisioning and editable in Settings. Trusted from anchor admins +
  root.
- **Room manifest** — kind `30078`, `d=life.crays/room/v1/<room-id>`: read
  only; validated by `schema`, `operator === author`, and future `expiration`.
  Its `award_issuer` tag is parsed for interop, never trusted.
- **Invites** — companion HTTP service (`POST /invites`, NIP-98 kind `27235`
  auth bound to exact URL/method/body-sha256). Already the NIP-97 companion
  surface: the service restricts creation to current anchor admins.
- **Coordinator provisioning** — `POST /relays` (`admin_pubkeys`,
  `badge_d:"members"`); the relay node bootstraps the NIP-11 root key, the
  root-signed anchor, and the `30009:<root>:members` invite-membership
  definition. The Board never publishes the anchor.
- **NIP-98 HTTP auth**, kind `0` profiles, relay runtime/publish plumbing:
  unchanged.

## 8. Cut-over note (from NIP-VC v0.1)

The entitlement substrate moved from the venue-custom model (everything on
`30009` with `type` tags, trust from NIP-11 `admin_pubkeys` +
`/community/info`) to NIP-97 in one clean cut, mirroring `crays-rn`: pilot QA
relays are freshly provisioned per scenario, so no dual-read of pre-NIP-97
data was kept. The old status `d` conventions (`<awardId>`,
`<awardId>:<status>`) and the `context` tag are gone; order contexts are now
`order:<order-ref>` and check-in contexts `event:<coordinate>`. The Board
keeps no persistent projection caches, so no archive versioning was required.

## 9. Independent verification hooks (QA contract)

Every protocol claim here is verifiable against an isolated real relay without
the UI:

- exact kind, signer, and tag set per mutation;
- the exact retained current status on the relay, plus one device publish
  marker per deliberate action; zero writes on rejection paths;
- monotonic `created_at` per context; stable `d = order:<ref>` across
  transitions; one retained status per (author, context);
- idempotency: repeat taps, retries, and relaunch leave exactly one retained
  event per (author, context);
- authority: forged/untrusted awards, definitions, and statuses absent from
  the resolved projection; anchor spoofed by a non-root key never becomes
  trust;
- venue isolation: no write appears on another venue's relay.

## 10. What this document deliberately excludes

- payments/Stripe handoff and sats pricing (service contract; no Board writes);
- ticket/pass **creation** in the event wizard (storefront side; future work);
- pass/membership fulfillment UI (Board fulfills products and event tickets);
- refunds, event cancellation, attendee notification (post-MVP);
- `src/types/domain.ts` / `src/data/sample.ts` — stale prototype fixtures
  disconnected from the relay model (presentation-only, scheduled for removal).
