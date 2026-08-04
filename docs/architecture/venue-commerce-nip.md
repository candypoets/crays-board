# NIP-VC: Venue Commerce — catalog definitions, awards, and order fulfillment

**Status:** Draft v0.1 (internal contract candidate, not yet submitted as a NIP)
**Applies to:** `crays-board` (staff), `crays-rn` (guest), venue relays, and the existing coordinator/services.
**Sources:** consolidated from `PRD.md` §8.4–8.8, §10; `docs/testing/QA_WORKFLOWS.md` §5–8. Where this document conflicts with PRD prose, resolve the conflict explicitly — do not let both stand.

> This document specifies the event contract for sellable items (products, passes, memberships, event access), role definitions, awards, and order/check-in status tracking on Nostr venue relays. It exists so that two independent clients can derive the same operational truth from the same relay without a shared database.

## 1. Terminology

- **Definition** — an addressable kind `30009` event describing something a venue offers or grants: a product, pass, membership, event-access ticket, or role.
- **Award** — a kind `8` event granting a definition to a holder. An award for a single-use sellable definition **is** an order.
- **Status** — a kind `37237` event recording a staff action against one award.
- **Presentation** — a short-lived kind `27236` credential shown by a guest at entry.
- **Venue authority** — a root authority from the venue relay's NIP-11 document (`pubkey`, `admin_pubkeys`, `admins`, or `admin_pubkey`).
- **Badge issuer** — the issuer advertised by the venue's `/community/info` service.
- **Order context** — the stable identifier of one order: the award's event id.

Three layers stay strictly separate:

1. The **definition** says what the item *is* (staff-owned, editable in place).
2. The **award** is the immutable purchase/grant fact (issuer-owned, never edited).
3. **Statuses** append staff actions (never modify award or definition).

Kind `8` entitlement issuance and kind `37237` fulfillment are separate stages. Order content never lives in statuses; staff actions never edit awards.

## 2. Kind registry

| Kind | Class | Purpose | Board writes |
| --- | --- | --- | --- |
| `30009` | addressable | Product, pass, membership, event-access, and role definitions | yes |
| `8` | regular | Awards (purchases, grants, role assignments) | role assignments only |
| `5` | regular | Revocation/deletion referencing award ids | yes (membership revocation) |
| `37237` | see §6.7 | Order and check-in status | yes (only status kind written) |
| `27237` | legacy | Prior status contract | **read only**, migration window |
| `27236` | regular | Short-lived entry presentation | no (validated only) |
| `31923` | addressable | Timed calendar event (NIP-52) referencing an event-access definition | yes |
| `10019` | addressable | Organizer Cashu profile, prerequisite for sats-priced entry | conditional |

## 3. Definitions (kind `30009`)

### 3.1 Common shape

Every definition MUST carry:

```
["d", "<stable identifier>"]
["type", "<class>"]          // machine classification
["t", "<same class>"]        // matching topic tag
["name", "<display name>"]
```

Sellable definitions additionally carry `["t", "sellable"]` and:

```
["price", "<positive decimal>"]
["currency", "<ISO-4217 uppercase>"]
["sats", "<positive safe integer>"]        // OPTIONAL
["availability", "available|unavailable|archived"]
["image", "<confirmed media URL>"]         // OPTIONAL
["description", "<text>"]                  // OPTIONAL
```

Validation (client-side before publish, relay-side where enforced): name ≥ 2 characters; price positive decimal; currency three uppercase letters; sats and max_uses positive safe integers.

**Update rule.** Editing price, description, image, section, position, or availability MUST reuse the same `d` and resolve as the latest addressable event. A new `d` means a meaningfully different offer. Only the original publishing key may edit; other trusted definitions remain visible but non-editable.

**Availability.** `unavailable` and `archived` are both non-purchasable for guests. `archived` is explicit and restorable. (Known consumer gap: `crays-rn` currently rejects only `unavailable`; archive controls ship only after the consumer fix — see PRD §19.4.)

### 3.2 Product

`type`/`t` ∈ `food`, `drink`, `merchandise`, `generic`. Products MUST set `max_uses=1`. Hospitality products appear in ordered sections; section and position are definition tags republished in place:

```
["section", "<section name>"]
["position", "<deterministic integer>"]    // OPTIONAL, ties break by d
```

### 3.3 Pass

Reusable credential. `max_uses` OPTIONAL; absent means unlimited. Remaining uses derive from fulfillment (§7).

### 3.4 Membership

```
["type", "membership"], ["t", "membership"], ["t", "sellable"]
["period", "one-time|monthly|yearly"]
```

Requires positive price/currency and a connected payment account before it may be `available`. Managed under Settings → Memberships; displayed in the store.

### 3.5 Event access

`type=event_access`, single-use, SHOULD carry an expiration. Published and confirmed **before** the referencing `31923` event; the event references the definition as its entrance badge. A failed definition publish MUST NOT leave a visible paid event; a failed event publish retries against the same definition rather than multiplying tickets. Sats pricing requires a valid organizer kind `10019` profile confirmed first.

### 3.6 Role

```
["type", "role"], ["t", "role"]
["name", "..."], ["description", "..."]
["permission", "posts|media|events|store|invites|moderation|settings"]   // repeated
```

Roles are never sellable. V1 allows at most four configurable roles including the effective Admin role (PRD §19.11 may revisit). Editing retains the addressable identity.

## 4. Awards (kind `8`)

An award grants one definition to one holder:

```
["a", "30009:<definition-author>:<d>"]
["p", "<holder pubkey>"]
["expiration", "<unix timestamp>"]         // OPTIONAL (NIP-40)
```

- **Issuer trust.** An award counts only when its issuer is a venue authority or the advertised badge issuer.
- **Expiry and revocation independently make an award unusable.** Revocation publishes kind `5` referencing the award id, from an authorized signer. Root venue administrators cannot be revoked through staff tooling.
- **Role assignment** uses the same shape: award of a role definition, optionally with `expiration`, assignable to a hex pubkey or npub-resolved key.
- Board writes awards only for staff role assignment. Purchase awards are issued by the guest/checkout path.

### 4.1 OPEN — purchase-context tags (award v2)

Order cards in the design mockups show quantities, table/pickup labels, item notes, and modifiers. These are **purchase-time facts** and belong on the award, written by `crays-rn` checkout — never on the definition (not item properties) and never on statuses (not staff actions). Proposed optional tags:

```
["v", "2"]
["qty", "<positive integer>"]
["label", "Table 3"]                       // table or pickup name
["note", "<holder note>"]                  // e.g. "No ice"
["mod", "<modifier text>"]                 // repeated
["cart", "<shared checkout id>"]           // groups multi-item purchases
```

Clients MUST project v1 awards (all tags absent) and v2 awards identically otherwise. Multi-item carts need no new event: awards sharing a `cart` tag group visually; without it, one card per award. **Open:** finalize tag names and checkout writer before Board renders these fields (PRD §19.3).

## 5. Order projection

A **trusted single-use award with no status event is implicitly `pending`** — no creation event is required or written.

A Board order record projects from:

1. one valid award (§4 trust rules) for a sellable single-use definition, addressed to this venue's relay;
2. the referenced definition, resolved as latest valid addressable event;
3. the folded status log (§6).

Duplicate award copies, awards for other venues, untrusted issuers, and unrelated awards MUST NOT create orders. A temporarily missing definition leaves the order diagnosable without crashing or mutating identity; a legitimate addressable definition update resolves against the stable order context. Reusable passes/memberships create one record **per fulfillment context** instead.

## 6. Statuses (kind `37237`)

### 6.1 Shape

```
kind: 37237
tags:
  ["d", "<order context = award event id>"]
  ["e", "<award event id>"]
  ["a", "30009:<definition-author>:<d>"]
  ["p", "<holder pubkey>"]
  ["status", "accepted|processing|ready|fulfilled|cancelled"]
  ["context", "order|event"]
  ["reason", "<text>"]                     // OPTIONAL, proposed — see §6.5
```

Exactly one semantic context per event. `pending` is never published; it is the absence of status.

### 6.2 Status ladder

```
pending → accepted → processing → ready → fulfilled
                          cancelled  (terminal, from any non-terminal stage)
```

- Normal order actions advance exactly one stage forward. `fulfilled` and `cancelled` are terminal.
- **Event contexts may go directly to `fulfilled`** (check-in, §8).
- A status that skips stages, moves backward, or acts on a terminal order is invalid and ignored in the fold.

### 6.3 Guest-facing labels

| `status` | Guest wording (must match `crays-rn`) |
| --- | --- |
| pending (implicit) | Sent / New |
| accepted | Accepted |
| processing | Preparing |
| ready | Ready to serve |
| fulfilled | Served (order) / Checked in (event) |
| cancelled | Cancelled |

### 6.4 Decline

Decline is not a status value. **Decline = `cancelled` published from the implicit `pending` stage.** Presentation derives wording from the prior stage: cancelled-from-pending renders "Declined"; cancelled from a later stage renders "Cancelled". Confirmation is required only once an order is accepted.

### 6.5 Cancellation reason

**Open/proposed:** an optional `["reason", "..."]` tag on the cancelled status. Until ratified, clients MUST NOT require it and MUST NOT surface free-text reasons as authoritative.

### 6.6 Timestamps and resolution

Per order context, valid statuses MUST have strictly monotonic `created_at`. Resolution: latest by `created_at`; ties break by higher event id. A status older than the current resolved state is stale and ignored.

### 6.7 OPEN — append-only vs addressable retention

`37237` sits in the addressable range, but the contract needs a single, explicit choice:

- **Option A — append-only log (recommended).** Each transition is a distinct event; relays retain all; current state is the fold of the log. Makes idempotency *verifiable* ("exactly one accepted status for this context" is a real relay query), preserves audit history, and matches the QA assertion style. Cost: current-state derivation and heavier queries.
- **Option B — addressable replacement.** `d` = order context; the relay keeps only the latest. Current-state queries are trivial and late writes lose automatically, but replaced events vanish — history, duplicate detection, and independent idempotency proofs become impossible from relay truth.

**Recommendation: Option A**, because this project's QA standard requires proving external truth independently, and replaced events destroy the evidence. If Option A with kind `37237` offends strict NIP-01 addressable-kind conventions, either use a unique `d` per transition (context + stage) or migrate to a regular-range kind; decide before the first Board write ships.

### 6.8 Publication and acknowledgement

A status write succeeds only after the venue relay returns an affirmative acknowledgement. Repeat taps while one intent is in flight MUST NOT publish a second event. On timeout, the client reconciles — queries the order context — **before** retrying; if the intended status already landed, it adopts relay truth instead of publishing. Local pending intent is never presented as confirmed state.

## 7. Uses and remaining uses

- A `fulfilled` status consumes one use of its context.
- `remaining uses = max_uses − count(fulfilled fulfillment contexts)`.
- Missing `max_uses` means unlimited for pass/membership; products and event-access definitions are always single-use.
- An exhausted pass rejects further fulfillment with a specific safe reason and zero writes.

## 8. Check-in (event contexts)

1. Guest presents a short-lived kind `27236` presentation.
2. Board validates: signature, venue, event, holder, referenced award, expiry window, revocation state, remaining uses, trusted signer.
3. On success, Board publishes one `37237` with `status=fulfilled`, `context=event`.
4. Rescanning or concurrent scanners resolve to exactly one fulfillment; an already-fulfilled presentation yields "Already checked in" and no write.
5. Every rejection class — invalid signature, malformed payload, expired/not-yet-valid, wrong venue/event/holder/award, revoked, exhausted, untrusted issuer, unknown event — produces a specific reason and zero fulfillment writes.

## 9. Authority model for status writes

A status event is valid only from:

1. a venue root authority (NIP-11);
2. the advertised badge issuer (`/community/info`); or
3. a staff key holding a non-expired kind `8` award for the latest valid role definition (`type=role`, `t=role`, from a trusted authority) whose permissions include `store` (order contexts) or `events` (event contexts). The award issuer must itself be trusted.

Statuses from any other key are ignored and optionally surfaced as a diagnostics count — never rendered as operational truth. The relay remains the final authorization boundary; client-side hiding is never security.

## 10. Legacy reads

During the migration window, Board MAY project kind `27237` statuses through the same fold. Board writes `37237` exclusively. The window closes when `crays-rn` and coordinator reads are confirmed migrated.

## 11. Independent verification hooks (QA contract)

Every protocol claim in this document is verifiable against an isolated real relay without the UI:

- exact kind, signer, and tag set per mutation;
- one valid status per deliberate action; zero writes on rejection paths;
- monotonic `created_at` per context; stable `d`/context across transitions;
- idempotency: repeat taps, retries, and relaunch leave exactly one event (requires §6.7 Option A);
- authority: forged/untrusted statuses absent from the resolved projection;
- venue isolation: no write appears on another venue's relay.

## 12. Open decisions

| # | Decision | Recommendation |
| --- | --- | --- |
| 1 | Status retention: append-only vs addressable (§6.7) | Append-only; finalize kind/`d` mechanics before first Board write |
| 2 | Award v2 purchase-context tags (§4.1) | Ratify tag set with `crays-rn` checkout; version via `["v","2"]` |
| 3 | Cancellation `reason` tag (§6.5) | Optional tag; keep unparsed until consumer wording agreed |
| 4 | Tag name for availability (§3.1) | Confirm against the established `nuts-cash` contract before codifying |
| 5 | External submission | Once stable through one pilot, renumber/format as a public NIP |

## 13. What this document deliberately excludes

- Invite creation/redemption (scoped HTTP service + NIP-98, not a relay contract);
- payments/Stripe handoff (service contract);
- room manifest (`life.crays/room/v1`, separate document);
- refunds, event cancellation, attendee notification (post-MVP, PRD §19.10);
- order history retention policy (PRD §19.12; partially unblocked by §6.7 Option A).
