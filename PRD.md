# Crays Board — Product Requirements Document

**Status:** Draft v0.2  
**Working project:** `crays-board`  
**Date:** 2026-08-03  
**Primary platform:** iPad-class tablet  
**Supported platforms:** iOS and Android tablets; usable on Android and iOS phones  
**Implementation:** React Native with Expo, following the established `crays-rn` stack  
**Primary Android QA target:** 11-inch, 16:10 Samsung-like Android virtual device

> Crays Board is the staff side of a Crays venue: keep the menu current, move orders through the kitchen, run events and entry, and manage the people who operate the room.

## 1. Product summary

Crays Board is a tablet-first hospitality operations app for restaurants, cafés, bars, clubs, and event-led venues. It adapts the proven `/admin` workflows in `nuts-cash` into a native React Native application designed for use behind a counter, at the pass, at the door, or while moving through a venue.

`crays-board` and `crays-rn` are two clients of the same venue truth:

- **Crays Board** is used by owners and authorized staff to publish and operate venue data.
- **`crays-rn`** is the guest/member app that reads the resulting room profile, menu, events, memberships, tickets, invites, and order states.
- **The venue Nostr relay and existing coordinator/services** remain authoritative. The project must not create a parallel generic API or mobile-only database.

The operational center of the MVP is the loop:

**An order arrives → staff accepts it → prepares it → marks it ready → serves it.**

Menu availability, event entry, and staff permissions support that loop. Broader community-management features are included where they directly support hospitality operations.

## 2. Source evidence and product boundary

This PRD was extracted from:

- `/root/code/nuts-cash/src/routes/admin`, including Dashboard, People, Roles, Events, Store, Orders, Invites, Settings, Memberships, and Payments;
- the supporting access, catalog, order, event, invite, role, and community-profile contracts in `/root/code/nuts-cash/src/lib`;
- the React Native architecture, dependencies, protocol contract, relay QA harness, and guest projections in `/root/code/crays-rn`.

The reference admin supports several community archetypes. Crays Board v1 deliberately narrows the product to **hospitality**. It may retain reusable domain contracts, but it should not expose sports, village, or professional-community configuration in the MVP.

The existing `crays-rn` PRD says staff continue to use admin software. Crays Board is that native staff software; it does not turn the guest app into an admin app.

### Workflow boundary

Included:

- newcomer welcome, staff-account creation/recovery disclosure, and venue creation;
- staff identity and venue access;
- switching between authorized venues;
- venue overview and operational health;
- live order and kitchen progression;
- menu/catalog creation, editing, ordering, and availability;
- events, RSVP visibility, tickets, and check-in;
- members, staff roles, permissions, and membership revocation;
- join invites and QR/link sharing;
- venue profile, membership, payment, and room/gateway setup;
- real-relay verification and tablet/phone acceptance testing.

Excluded from the MVP:

- guest social feed, messaging, discovery, wallet, checkout, and presence UI;
- table reservations as an in-app booking system;
- inventory, recipes, ingredient depletion, suppliers, purchasing, or workforce scheduling;
- accounting, tax filing, payroll, or full point-of-sale replacement;
- refunds and payment disputes beyond linking to the configured payment provider;
- a new central CRUD backend that mirrors relay data;
- background order notifications until a trustworthy push-delivery service contract exists;
- member-specific invites until the invite service supports them;
- offline write queues that claim success before the venue relay confirms a write.

## 3. Product goals

1. Make the current order queue understandable within two seconds on an iPad-class screen.
2. Let authorized staff advance an order with one deliberate tap and see relay confirmation or a recoverable failure.
3. Let front-of-house staff pause or restore a menu item in no more than two taps.
4. Ensure every change appears in `crays-rn` through the established relay contracts, without duplicate product models.
5. Let an owner configure a venue and delegate narrowly scoped staff permissions without sharing the owner key.
6. Make event and pass check-in fast enough for a real door queue.
7. Preserve a usable single-column experience on phones without shrinking the tablet UI.
8. Prove protocol effects independently against a real relay, not only through rendered UI.
9. Let a newcomer create their first hospitality venue without first obtaining an admin invitation.

## 4. Users and jobs

### Owner or general manager

Needs to see venue health, configure the public profile and payments, manage menus and events, invite members, create staff roles, and switch between venues. The owner has all permissions because the active key is listed by the venue as an authority.

### Floor or bar manager

Needs to manage the menu, accept/cancel orders, coordinate service, and handle exceptions. This user normally holds `store`, `posts`, and possibly `events` permissions.

### Kitchen or bar staff

Needs a distraction-free live queue with large actions and clear elapsed time. This user should not see payments, invites, people moderation, or venue settings unless separately authorized.

### Event host or door staff

Needs upcoming event details, RSVP counts, access rules, and a fast scanner/check-in workflow. This user normally holds `events` permission and may have no store access.

### Community or membership manager

Needs member status, role assignment, expiry/renewal visibility, invitations, and revocation. This user normally holds `moderation`, `invites`, and possibly `settings`.

## 5. Product principles

1. **The live venue is the unit of work.** One selected venue owns the active screen subscriptions and mutations.
2. **Operational truth beats optimistic polish.** A write is complete only after the required venue relay accepts it.
3. **Permissions shape the product.** Unauthorized destinations are neither shown nor executable through deep links.
4. **Tablet first does not mean phone hostile.** Tablet layouts use available space; phones use a different composition and the same workflows.
5. **Guest and staff language must agree.** “Preparing,” “Ready,” “Served,” and cancellation states map consistently between Board and `crays-rn`.
6. **Nostr stays backstage.** Normal UI says venue, menu, order, guest, ticket, and staff; protocol detail belongs in diagnostics.
7. **Destructive actions are explicit.** Cancellation, archiving, revocation, sign-out, and venue changes require clear scope and consequences.
8. **No false offline success.** Cached data may remain visible, but unconfirmed mutations remain failed or retryable.

## 6. Platform and responsive requirements

### Tablet

- iPad and Android tablets are first-class, including landscape and portrait.
- At widths of roughly 840 dp and above, use a persistent navigation rail/sidebar and a content workspace.
- Orders should show multiple status columns in landscape. Detail or action panels may occupy a second pane without covering the queue.
- Forms may use two columns, but reading and focus order must remain logical.
- Do not cap the entire app to the `crays-rn` guest shell's current 620 px content width.

### Compact tablet

- At approximately 600–839 dp, use a compact rail or top-level navigation plus one main pane.
- Kitchen columns may horizontally page or become status tabs, while keeping the current count visible.

### Phone

- Below approximately 600 dp, use five primary destinations: **Home**, **Orders**, **Menu**, **Events**, and **More**.
- **More** contains People, Invites, venue switching, Settings, and account actions according to permission.
- The kitchen becomes a status-tabbed list; it must not render a tiny desktop Kanban board.
- Editors and detail views become full-screen routes or sheets with sticky primary actions.

### Orientation and device configuration

- Unlike the current portrait-locked `crays-rn` app, Crays Board must support the device's current orientation.
- iOS must declare tablet support.
- Android must handle predictive back and process/activity recreation without losing a confirmed venue selection or unsaved form warning.
- The primary automated Android target is a custom 11-inch-class 16:10 AVD at 1600×2560 and approximately 320 dpi. This matches a Samsung tablet form factor, not Samsung One UI behavior.
- A 1080×2400 phone AVD is the compact-width regression target.
- A physical Samsung tablet or phone is a pre-pilot validation target for keyboard, camera, lifecycle, and vendor-specific behavior.

## 7. Information architecture

### Primary destinations

| Destination | Purpose | Required permission |
| --- | --- | --- |
| Home | Venue summary, open-order pressure, next events, expiring members, setup health, quick actions | Any venue access |
| Orders | Live kitchen/service queue, check-ins, completed/cancelled context | `store` or `events` as appropriate |
| Menu | Food, drink, merchandise, passes, availability, section ordering | `store` |
| Events | Upcoming/past events, RSVPs, access, tickets, check-in | `events` |
| People | Members, profiles, expiries, staff roles, permission matrix | `moderation` or `settings` |
| Invites | Expiring join links, QR, share, poster | `invites` |
| Settings | Venue profile, memberships, payments, room/gateway, diagnostics | `settings` |

### Screen and interaction inventory

The complete visual inventory is catalogued in [`design/mockups/README.md`](design/mockups/README.md). Those mockups are a design acceptance input for layout, hierarchy, navigation composition, responsive behavior, and Crays visual language. They are not authoritative for fixture data, protocol fields, permissions, prices, status counts, or final copy; this PRD and the signed service contracts remain authoritative for those details.

The first implementation must account for every surface below. A surface may be a route, a responsive composition of a route, or a durable workflow state, but it may not disappear merely because it is not a top-level navigation destination.

| Area | Required surfaces | Composition contract |
| --- | --- | --- |
| Entry | Welcome; venue discovery/selection; no-access, revoked-access, and runtime-unavailable states | Centered decision surface before venue context; venue selection must show verification/loading truth |
| Home | Established-venue operations; new-venue setup checklist; offline/stale state | Attention-first service strip and actionable summaries, not a generic analytics grid |
| Orders | Live stage board; compact status list; order detail/confirmation; failure and retry | Tablet uses stage columns; phone uses status tabs; confirmed and pending states are visually distinct |
| Menu | Section list; item editor; availability/archive confirmation; empty and foreign-publisher states | Tablet may use master-detail; phone editor is a full-screen route or sheet with a sticky action |
| Events | Event list/detail; create Details; create Schedule & place; create Admission; scanner/manual check-in; result state | Creation preserves a single draft across three steps; check-in isolates camera state from event browsing |
| People | People list/detail; membership revocation; role assignment | Tablet master-detail; permissions determine both visible actions and route entry |
| Roles & access | Role list/editor; permission matrix; assignment duration | Explicit permission language; destructive changes require scope and consequence |
| Invites | Configuration; creation in progress; QR/share result; expired/error state | Never show a generic QR as a successful invite before the service returns a real token |
| Settings | Venue profile; memberships/list/editor; payments; room & gateway | Four explicit sub-destinations with independent loading, unavailable, and failure truth |
| Create Venue | Identity; Place; Service & owner; Review; Provisioning/resume; Success/partial success | Four editable steps followed by a non-duplicating durable workflow and truthful readiness summary |
| Phone More | People; Invites; Settings; venue switching; account actions | Permission-filtered list; this is the compact replacement for tablet rail destinations, not a miscellaneous dump |

Across the authenticated tablet app, the selected venue remains visible in the deep-burgundy navigation rail. The working canvas uses warm, high-legibility surfaces; primary Crays pink/coral is reserved for current location and primary actions, while semantic colors communicate operational status. Dense operational screens may use master-detail composition, but navigation, focus, and screen-reader order must still work as one logical route.

At compact phone widths, the app recomposes rather than scales down: the rail becomes the five-item bottom navigation, secondary destinations move into More, stage boards become filtered lists, master-detail views split into routes, and editors retain persistent primary actions above the keyboard and safe area.

When a generated mockup conflicts with product truth, use this precedence:

1. security, permission, and signed protocol/service contract;
2. this PRD and the relevant screen contract under `docs/screens/`;
3. mockup layout, visual hierarchy, and responsive intent;
4. illustrative text, names, numbers, and imagery inside the mockup.

Implementation changes that materially alter a mockup's navigation model or information hierarchy must update both the screen contract and the mockup/catalog reference so the visual and executable specifications do not drift.

### Venue switcher

The app discovers authorized venues from the active identity's relay feed and relay sets, then verifies actual access against each venue. It remembers the last selected venue locally but revalidates access on launch and resume.

Switching venue must:

1. cancel all subscriptions and pending screen-owned work for the old venue;
2. clear old venue projections from the visible screen;
3. select the new venue and re-resolve permissions;
4. return to the same destination only if the new permission set allows it, otherwise Home;
5. never allow an acknowledgement from the old venue to update the new venue UI.

### Access discovery

The inherited discovery sequence is:

1. read the active identity's kind `10012` relay feed from configured index/default relays;
2. resolve referenced kind `30002` sets named `nuts-relays-admin` and `nuts-relays-member`;
3. fetch NIP-11 metadata for each venue relay;
4. keep only relays where the identity is a root authority or holds an active, trusted role award with at least one admin permission.

A QR/deep link or manually entered service/relay URL may bootstrap a venue, but access must still verify before any admin surface opens.

### Newcomer entry

On a cold launch with no restored staff identity, the primary action is **Create venue** and the secondary action is **Sign in**. A signed-in identity with no accessible venues sees **Create your first venue** as the primary empty-state action. An existing owner may also open **Create another venue** from the venue switcher.

Creating a venue is a top-level onboarding route, not a hidden Settings form. Back returns to the welcome or venue-selection screen until provisioning begins. Once the coordinator has created a relay, leaving the screen preserves resumable creation state instead of starting another request.

## 8. Core experiences

### 8.1 Entry, identity, and access

The app does not silently create a new venue administrator. Existing staff use an authorized Nostr identity or approved signer/recovery path. A newcomer may deliberately choose **Create venue**, create a new owner identity on the device, review its custody/recovery consequences, and use that identity to provision the first venue.

Required states:

- no identity: show **Create venue** as primary and supported sign-in/import paths as secondary;
- identity but no venues: show **Create your first venue**, Refresh, and a safe bootstrap/deep-link path;
- venue discovery loading: show cancellable progress without stale venue content;
- read-only signer: allow authorized reads but disable mutations with a direct explanation;
- access revoked: close the affected venue subscriptions, return to venue selection, and retain no privileged cached screen state;
- runtime unavailable: explain that a development or production native build is required because Expo Go cannot load `nipworker`.

Staff private keys must remain in native secure storage or the configured signer boundary. They must never enter route params, logs, analytics, QA state files, or ordinary React component state.

### 8.2 Create venue

Create venue is required for newcomers and existing owners adding another location. Crays Board is hospitality-only, so the flow does not ask the user to choose a generic community archetype; it publishes `type=hospitality`.

#### Screen structure

Create Venue is a four-step editable flow followed by provisioning and success:

1. **Identity:** venue name, required, 2–50 characters; optional description up to 200 characters; optional venue image; live guest-facing preview; derived relay slug.
2. **Place:** required venue timezone, initially suggested from the device; optional address/location label; optional opening hours. Timezone and hours are venue data, not merely formatting preferences.
3. **Service & owner:** owner display name and optional picture when the active identity has no valid kind `0` profile; create-versus-import staff account choice when no signer exists; recovery acknowledgement; initial setup intentions for menu, payments, invites, and room.
4. **Review:** exact venue identity, owner identity, location/timezone, requested services, recovery state, and the effects of the deliberate **Create venue** action.

The initial-service choices prioritize the success checklist; they must not claim that payments, an invite, a menu, or room hardware were configured unless their real service operations complete. Address and opening-hours publication must use an agreed venue-profile contract. Until that contract is finalized, the app preserves those values in resumable creation state and marks the corresponding profile setup incomplete rather than silently discarding or fabricating relay truth.

The screen shows a live guest-facing preview and the derived relay slug. The slug is lowercase ASCII letters/numbers/hyphens, trimmed, no longer than 63 characters, and falls back safely when the name cannot produce one. Final uniqueness belongs to the coordinator; the client must show coordinator conflicts without silently changing the requested venue identity.

If no signer exists, the user chooses either:

- **Create staff account on this device**; or
- **Sign in / import existing account**.

Creating a staff account is explicit. Before provisioning, the app explains device-only versus recoverable custody, secures the key through the native account boundary, and requires acknowledgement of the available recovery path. Raw secret material must never be shown as an incidental success-screen detail or copied without a deliberate reveal action.

#### Provisioning sequence

After one deliberate **Create venue** submission, the creation coordinator performs this ordered workflow:

1. validate the form and confirm an active signing identity;
2. resolve or create the owner's valid kind `0` profile;
3. load the owner's existing kind `10012` relay feed and `30002` admin relay set so publication merges rather than overwrites other venues;
4. send the existing coordinator a venue creation request containing name, optional description, derived domain label, owner pubkey in `admin_pubkeys`, and the established membership badge identifier;
5. retry with an exact NIP-98 authorization if the coordinator requires authentication;
6. persist the returned relay ID, relay URL, service base URL, badge issuer, and creation attempt identifier immediately as resumable non-secret state;
7. wait for a signed round-trip proving the new relay is actually ready;
8. upload optional venue/owner images; an image failure is non-fatal and remains retryable later;
9. publish/update the owner's kind `10002` relay list to include the venue relay and configured indexers;
10. publish a monotonic merged kind `10012` relay feed and kind `30002` `nuts-relays-admin` set, then read back the admin set to verify that both existing venues and the new relay remain present;
11. publish the owner's profile to the new venue relay;
12. publish the venue kind `30078` profile with `d=nuts-community-profile`, `type=hospitality`, description, and confirmed image URL;
13. when room-manifest publication is configured, publish the initial signed `life.crays/room/v1` manifest; otherwise mark Room setup as incomplete rather than claiming the venue is guest-discoverable;
14. select the new venue, resolve owner permissions, and open the creation-success screen.

The progress UI uses friendly, truthful stages: **Setting up your account**, **Reserving your venue**, **Adding it to your venues**, **Publishing the venue profile**, and **Finishing setup**. It must not expose relay internals as the primary copy, but diagnostics may show the current technical step.

#### Idempotency and partial failure

- The coordinator request carries or is associated with a stable creation attempt ID. Retrying after timeout must reconcile that attempt before requesting another relay.
- As soon as a relay record exists, the workflow becomes **Resume venue setup**, not **Create venue**.
- Failure before coordinator acceptance creates no venue resources and returns to the editable form.
- Failure after relay creation preserves the relay/service record and resumes from readiness/directory/profile publication.
- A directory read-back timeout may finish with a warning if the new relay itself is ready and its profile was confirmed; the app keeps a repair action and must never discard existing relay-set entries.
- Optional image failure does not block creation.
- Cancellation after a relay exists does not delete it implicitly. Deletion requires a separate explicit, authenticated lifecycle contract.
- Late callbacks from a previous attempt are ignored by attempt/generation ID.

#### Success screen

The success screen says **Venue created**, identifies the exact venue, and distinguishes:

- relay ready;
- venue profile published;
- directory listing verified or still catching up;
- room/discovery setup complete or action needed.

Primary action: **Open venue**. Secondary next steps are **Add your first menu item**, **Create an invite**, **Set up payments**, and **Configure the room**, filtered by readiness and contract availability. Invite sharing appears only after a real invite token has been created; a generic `/redeem` URL must not be presented as a one-use invitation.

### 8.3 Home

Home answers: “What needs attention now?”

The first viewport on tablet contains:

- venue name, live/offline state, and current staff identity;
- open orders by stage, with oldest wait time and a direct Orders action;
- unavailable menu-item count;
- today's/upcoming events and check-in action;
- active member count and memberships expiring within 30 days;
- visible setup warnings for payments or room/gateway publication.

Secondary content includes quick actions for **Add menu item**, **Create event**, **Create invite**, and **Assign staff role**, filtered by permission. New venues get a guided checklist rather than zero-filled analytics.

Home metrics are projections of live venue events. They are not stored as a separate analytics database in the app.

### 8.4 Orders and kitchen

Hospitality uses the full status ladder:

`pending → accepted → processing → ready → fulfilled`

Guest-facing labels are:

- `pending`: Sent/New;
- `accepted`: Accepted;
- `processing`: Preparing;
- `ready`: Ready to serve;
- `fulfilled`: Served;
- `cancelled`: Cancelled.

Tablet landscape shows a live column per active stage. Each card shows item name, guest/profile where available, short order reference, latest update time, elapsed time, and the one valid next action. Cancellation is visually secondary and requires confirmation once an order is accepted.

Phone and compact layouts use status tabs with counts and a chronological card list. The current order remains visible after an update long enough to understand the result; motion must not be required to follow the transition.

Rules:

- A single-use product or event-access award creates exactly one order record. With no status event it is implicitly `pending`.
- Reusable memberships and passes create one record per fulfillment context and also appear as active credentials where relevant.
- Normal order actions move only forward by one stage. `fulfilled` and `cancelled` are terminal.
- Event access may go directly to `fulfilled` as **Checked in**.
- Each status update publishes kind `37237` with `status`, `a`, `e`, `p`, exactly one semantic `order` or `event` context, and matching `d`.
- Timestamps for the same context must be strictly monotonic. Latest status resolves by `created_at`, then event ID as deterministic tie-breaker.
- Only root venue authorities, the advertised badge issuer, or staff with the relevant active `store`/`events` permission can produce trusted state.
- A failed acknowledgement leaves the card in its prior confirmed column and offers Retry. Repeated taps while a mutation is pending are ignored.
- Legacy kind `27237` may be read during migration; Board writes `37237` only.

The MVP shows product/order/holder context supported by the current protocol. Table number, modifiers, multi-line carts, tips, taxes, quantities, and cancellation reasons require an agreed order contract before they can be presented as authoritative.

### 8.5 Menu and store

Hospitality uses a section-first menu, with suggested sections such as Starters, Mains, Sides, Desserts, and Drinks. Food and drink products appear in sections; memberships, passes, merchandise, and generic offers appear separately.

Staff can:

- search and filter by type, section, and availability;
- add a product or pass;
- edit an item they originally published;
- upload/replace an image;
- set name, description, fiat price/currency, optional sats price, product kind, section, and availability;
- set optional maximum uses for a pass;
- move an item up/down within its section;
- rename a section by republishing affected definitions;
- mark an item available/unavailable;
- archive and restore an item.

Domain rules:

- Items are addressable kind `30009` definitions classified with both `type` and matching `t`; sellable items also carry `t=sellable`.
- Product types are food, drink, merchandise, or generic. Products explicitly use `max_uses=1`.
- Availability is `available`, `unavailable`, or `archived`.
- Editing price, image, description, position, section, or availability reuses the same `d`. A new `d` is used only for a meaningfully different offer.
- Name is required and at least two characters. Price is a positive decimal. Currency is a three-letter uppercase code. Optional sats and max uses are positive safe integers.
- Only the publishing key may edit an existing definition. Other trusted community items remain visible and identify why editing is unavailable.
- Memberships are displayed in the store but managed under Settings → Memberships.

`crays-rn` must treat both `unavailable` and `archived` as non-purchasable. Its current projection only explicitly rejects `unavailable`; release of archive controls therefore requires a coordinated consumer fix and test.

Native media handling replaces browser-only compression/upload code. The implementation should use a native image picker/manipulator and the existing Blossom/NIP-96 upload contract, with preview, progress, retry, and cancellation.

### 8.6 Events and entry

Events has Upcoming, Past, and All views, plus search. Event details show title, summary, illustration, schedule/timezone, location, capacity, access rules, accepted/tentative/declined RSVP counts, attendee identities where authorized, ticket price, and check-in action.

Event creation is a three-step flow:

1. **Details:** title, summary, hospitality-relevant category/topic, illustration.
2. **Schedule and place:** local date, start/end time, timezone summary, location, optional capacity.
3. **Admission:** open/free, restricted to selected roles or memberships, optional paid entry, fiat price/currency, and optional sats price when a valid organizer Cashu profile exists.

Publishing rules:

- Venue calendar events use addressable NIP-52 kinds `31922`/`31923`; the current timed-event writer uses `31923`.
- RSVPs use kind `31925`; only the latest response per attendee/event counts.
- Restricted events carry repeated `required_badge` addresses.
- Paid entry first publishes a single-use, expiring kind `30009` `event_access` definition, waits for confirmation, then publishes the event referencing the entrance badge. A failed ticket publish must not leave a visible paid event without its access definition.
- Optional sats entry may require publishing a valid kind `10019` organizer Cashu profile before the ticket.
- Check-in validates a short-lived kind `27236` presentation against the venue, event, holder, award, expiry, revocation, remaining uses, and trusted signer. A successful check-in publishes `37237` directly to `fulfilled` with event context.

Camera permission is requested only when the scanner opens. Manual code entry is an accessibility and damaged-camera fallback. Duplicate or already-fulfilled presentations must not consume another use.

Event editing/cancellation and refunds are post-MVP unless the underlying coordinator/payment contracts are finalized before implementation.

### 8.7 People and roles

There is no separate member table. A person appears because they are a root venue admin or hold an active role/membership award whose definition exists on the venue relay.

People shows profile, active roles, status, and nearest expiry. Status is:

- Active;
- Expiring soon when a relevant award ends within 30 days;
- Expired when no relevant role/membership remains active.

Profiles are read from kind `0` events on the selected venue relay. Opening a person shows their venue profile and access summary.

Authorized staff can assign an existing role to a hex pubkey or `npub`, permanently or with a future expiry. Assignment publishes kind `8` with `a`, `p`, and optional `expiration`.

Action-level permissions are explicit: `moderation` may view people and revoke an ordinary member's membership; `settings` is required to create/edit roles, change their permissions, or assign staff roles. An owner has both. A user who can view People must not automatically gain role-administration rights.

The permission matrix contains:

- `posts` — publish venue updates;
- `media` — publish photos/media;
- `events` — create events and manage event entry;
- `store` — manage products, passes, paid memberships, and product orders;
- `invites` — create join invites;
- `moderation` — manage member behavior and revocation;
- `settings` — change roles, permissions, venue, and payment settings.

Role definitions are classified kind `30009` records with `type=role`, `t=role`, name, description, and repeated permission tags. V1 retains the reference admin's maximum of four configurable roles including the effective Admin role. Hospitality suggests **Staff** and **Events host**, but the owner chooses their permissions.

“Ban member” means revoking that person's active membership awards by publishing kind `5` referencing the award IDs. It is not an unrelated local block list. Root venue administrators cannot be banned from this screen. The confirmation explains the relay-access consequence and accepts an optional reason.

### 8.8 Invites

Staff with `invites` permission can configure:

- claim expiry: 1 hour, 1 day, 7 days, or 30 days;
- granted membership duration: permanent, 30 days, 90 days, or 1 year;
- maximum redemptions, minimum 1.

Creation sends a NIP-98-authorized `POST` to the selected venue's existing `/invites` service. The authorization must bind the exact URL, method, and SHA-256 payload. The response contains token, expiry, and maximum redemptions.

The result shows venue identity, expiry, QR, and actions to share through the native share sheet, copy the link, save a poster image, and print where the platform supports it. The raw token must not be separately displayed or logged.

The shared link must open `crays-rn`'s invite entry path and preserve service URL, relay URL, and token through guest authentication. The production HTTPS/universal-link domain and custom-scheme fallback are delivery decisions; Board must not generate a `nuts-cash`-only `/redeem` link.

Member-specific invitations remain disabled until the invite service can enforce an intended pubkey.

### 8.9 Settings

Settings contains four sections:

1. **Venue profile:** hospitality type, description up to 200 characters, image, external menu URL, and external booking URL. This publishes kind `30078` with `d=nuts-community-profile` to the venue relay.
2. **Memberships:** list and create one-time, monthly, or yearly paid plans with name, description, image, positive price, currency, billing period, availability, and connected Stripe account. Membership definitions use kind `30009`, `type=membership`, `t=membership`, and `t=sellable`.
3. **Payments:** show Stripe configuration, connection, charges, payouts, settlement currency, and requirements due. Start/continue onboarding or open the Stripe dashboard through a native browser/auth session with a verified return deep link. Business/card/bank details stay with Stripe.
4. **Room & gateway:** show signed room-manifest freshness, open/closed state, capabilities, relay reachability, advertised badge issuer, QR fallback, and—when the hardware contract exists—gateway/beacon health. Publishing uses the versioned `life.crays/room/v1` contract already consumed by `crays-rn`.

Room/gateway controls must not pretend BLE hardware is healthy based only on a relay record. If direct hardware telemetry is unavailable, show **Status unavailable** and keep relay-manifest health separate.

## 9. Permissions and trust

Root owners are derived from NIP-11 `pubkey`, `admin_pubkeys`, `admins`, or `admin_pubkey` metadata. Non-owner access is valid only when:

1. the role definition is the latest valid addressable kind `30009` from a trusted venue authority;
2. it has `type=role` and `t=role`;
3. the active identity holds a non-expired kind `8` award for that definition;
4. the award issuer is trusted by the venue;
5. the requested action exists in the definition's permissions.

Permission enforcement exists at three layers:

- navigation hides inaccessible destinations;
- screens guard deep-link entry and mutation controls;
- the relay/coordinator remains the final authorization boundary.

Client-side visibility is never treated as security.

## 10. Protocol and service contracts

| Capability | Contract | Board behavior |
| --- | --- | --- |
| Venue provisioning | existing coordinator `POST /relays` + optional NIP-98 | Create one resumable venue relay for a stable attempt; persist returned public/service metadata immediately |
| Staff/member profile | kind `0` | Read venue-local profiles; publish only for the active staff identity when explicitly edited |
| Staff venue discovery | kinds `10012`, `30002` | Resolve authorized venue relay sets |
| Venue metadata/authority | NIP-11 HTTP | Read name, image/description fallback, root admins, relay identity |
| Venue profile/type | kind `30078`, `d=nuts-community-profile` | Read/write hospitality profile and external links |
| Crays room manifest | kind `30078`, schema `life.crays/room/v1` | Read health; publish only after contract and authority validation |
| Role/product/pass/membership/ticket | kind `30009` | Preserve type/topic/sellable classification and addressable update rules |
| Role/ownership/order award | kind `8` | Read trusted awards; publish staff assignments where authorized |
| Revocation/deletion | kind `5` | Apply only with correct author/authority relationship |
| Calendar event | kinds `31922`, `31923` | Read both; write current timed-event shape |
| RSVP | kind `31925` | Resolve latest response per attendee/event |
| Order/check-in state | kind `37237` | Read trusted current state; write only `37237`; temporary legacy read for `27237` |
| Presentation | kind `27236` | Validate short-lived credential before fulfillment |
| Cashu payment profile | kind `10019` | Optional prerequisite for sats-priced event entry |
| Invite creation | venue `/invites` + NIP-98 | Existing scoped HTTP side effect; no replacement API |
| Venue trust/issuer | `/community/info` | Resolve advertised badge/booking issuer |
| Stripe Connect | existing connect service + NIP-98 | Status/onboarding/dashboard handoff; mobile return contract required |
| Media | Blossom/NIP-96 | Native upload with authenticated signer boundary |

### Data invariants

- Parsed relay events remain zero-copy FlatBuffer views while used inside their subscription scope. Copy only minimal stable fields needed across callbacks, navigation, or durable display.
- Every worker message is narrowed before kind-specific fields are read.
- Concurrent live result families use separate stable subscription IDs; a relay replaces a reused NIP-01 `REQ` ID.
- Addressable events resolve by latest `created_at`, then the established deterministic event-ID tie-break.
- Product data is trusted only when its signature and venue-authority relationship validate.
- Kind `8` entitlement issuance and kind `37237` fulfillment are separate stages.
- A fulfilled status consumes one use. `remaining uses = max_uses - fulfilled fulfillment contexts`.
- Product and event-access definitions are single use. Missing `max_uses` is unlimited for pass/membership.
- Expiry and revocation independently make an award unusable.
- A publish succeeds only after the required active venue relay returns an affirmative status. UI rendering alone is not proof.

## 11. Architecture and state ownership

### Architectural units

| Unit | Responsibility | Owns | Must not own |
| --- | --- | --- | --- |
| App runtime | Initialize the single native `nipworker` manager after the app is active | Runtime readiness and fatal detail | Screen subscriptions or a second manager |
| Account coordinator | Restore signer, expose public identity, sign requested templates | Secure signer handle and session state | Venue data projections |
| Venue creation coordinator | Orchestrate identity/profile, coordinator provisioning, readiness, directory merge/verification, venue profile, and resume | One stable creation attempt and public relay/service result | Private key material, duplicate relay requests, or unrelated venue subscriptions |
| Venue access coordinator | Discover venues, verify trust/permissions, persist selected venue | Venue list, active venue, permission set | Menu/order subscription buffers |
| Adaptive app shell | Render tablet/phone navigation and permission-aware destinations | Navigation presentation | Domain truth |
| Screen coordinator | Own one screen's subscriptions, transient state, intents, and cleanup | Loading/empty/error/pending states | App-wide copied relay databases |
| Protocol services | Validate/build event and HTTP contracts | Pure validation and minimal projections | UI state |
| Secure repository | Persist signer material and safe selected inputs | Keys and non-secret venue selection | Raw subscription buffers or invite tokens in logs |
| QA scenario runner | Provision, exercise, independently verify, and tear down | Scenario-owned relay/device state | Product truth or production secrets |

### State model

App-level source state:

- runtime: waking, ready, unavailable, error;
- account: locked, restoring, ready, read-only, absent;
- accessible venues and active venue;
- permissions for the active venue;
- lifecycle state and network/relay reachability.

Screen-level source state:

- active subscription handles;
- parsed event views or minimal stable projections;
- loading/EOSE state;
- filters, selection, draft form, pending mutation, and error.

Derived state includes order columns/counts, active member status, remaining uses, upcoming events, RSVP counts, menu sections, and visible permission-filtered actions. It should not be persisted as a second source of truth.

### State machine

```text
launch
  -> runtime_waking
  -> account_restoring
  -> welcome | venue_discovery
  -> no_venues | venue_selecting | venue_loading
  -> ready

welcome | no_venues
  on CreateVenue -> venue_drafting

venue_drafting
  on Submit -> account_preparing
  -> coordinator_provisioning
  -> relay_readiness
  -> directory_publishing
  -> profile_publishing
  -> creation_complete | creation_repairable | creation_failed

creation_repairable
  on Resume -> relay_readiness | directory_publishing | profile_publishing

ready + venue switch
  -> disposing_old_venue
  -> venue_loading
  -> ready | access_denied | venue_offline

ready + user mutation
  -> validating
  -> publishing
  -> confirmed | rejected | timed_out
  -> ready (with retry for rejected/timed_out)

any + app background
  -> suspended (cancel timers and screen-owned live work as required)
  -> resume/revalidate

any + sign out
  -> disposing
  -> signed_out
```

### Lifecycle

- **Create:** initialize SecureStore and the single native Nostr runtime; do not create a manager in a screen.
- **Become active:** settle the native runtime, restore signer, rediscover/revalidate selected venue, then subscribe to the visible screen.
- **Suspend:** stop scanners/camera, cancel transient timers, prevent new mutations, and preserve only safe confirmed/draft state.
- **Resume:** revalidate access and relay freshness before enabling mutations; reconcile any publish whose acknowledgement was interrupted.
- **Venue change/screen exit:** unsubscribe every owned subscription and publish listener, cancel timeouts/uploads where supported, and ignore late callbacks.
- **Destroy/sign out:** remove the account from the manager, clear selected venue and sensitive local state, close all handles, and return to entry.

### Event sources and data flow

State-changing events come from user taps/form submissions, route or deep-link inputs, relay events/EOSE/connection statuses, existing HTTP services, OS permissions, app lifecycle changes, upload progress, and bounded reconciliation timers. Each event is handled by the smallest coordinator that owns its consequence.

The standard read flow is:

```text
active identity + selected venue
  -> permission and trust validation
  -> screen-owned stable subscription
  -> narrowed and validated worker event
  -> minimal source-state update
  -> derived operational projection
  -> adaptive tablet/phone render
```

The standard mutation flow is:

```text
user intent
  -> permission + field + venue guard
  -> pure event/request builder
  -> signer or scoped HTTP authorization
  -> active venue relay/service
  -> acknowledgement or independently queried result
  -> confirmed state, retryable failure, or reconciliation
```

### Side-effect ownership

| Side effect | Owner | Cancellation and cleanup |
| --- | --- | --- |
| Relay subscription | Visible screen coordinator | Unsubscribe on screen exit, venue change, sign-out, and disposal |
| Relay publish listener | Initiating screen coordinator | Settle once; unsubscribe on confirmation, rejection, timeout reconciliation, or disposal |
| NIP-11/community-info fetch | Venue access coordinator | Ignore/cancel results after identity or venue generation changes |
| Invite/Stripe HTTP request | Initiating workflow coordinator | Bind to active venue and signer; cancel or ignore on venue change; never replay blindly |
| Image upload | Editor coordinator | Cancel where supported; clean temporary URIs/previews; preserve safe form text |
| Camera/scanner | Check-in coordinator | Stop camera immediately on background, route exit, success, or permission failure |
| Browser/auth handoff | Payments coordinator | Validate return scheme/state and refresh authoritative status; remove listeners on exit |
| Reconciliation timer | Coordinator that initiated uncertain work | Bounded deadline; clear on settle, venue change, background policy, or disposal |

## 12. Loading, empty, failure, and recovery behavior

| State | Required behavior |
| --- | --- |
| Relay connected, no events | EOSE resolves loading into a truthful empty state |
| Venue name/domain conflict | Keep the form and requested name visible; explain the conflict and let the user edit/retry |
| Coordinator create timeout | Reconcile the stable creation attempt before enabling retry; never issue an uncorrelated duplicate request |
| Relay created, setup interrupted | Show Resume venue setup with the known venue identity and continue from the first unconfirmed stage |
| Directory publication/read-back failed | Keep the ready venue, show Listing still catching up, and offer a repair action that merges existing entries |
| Relay slow | Keep existing confirmed data only when clearly marked stale; show retry after deadline |
| Relay offline | Read-only last-known view where safe; disable writes; never fabricate zero counts as fresh |
| Publish rejected | Preserve prior confirmed state, show actionable reason when safe, offer Retry |
| Publish timeout | Mark outcome unknown, reconcile from relay before allowing a duplicate mutation |
| Access revoked | Dispose venue work immediately and return to selection |
| Stale/forged definition or status | Ignore it and optionally expose a diagnostics count; do not render as operational truth |
| No orders | Explain that new paid product awards will appear live; keep menu/relay health action visible |
| No menu | Offer Add first menu item to authorized staff |
| No events | Offer Create event to authorized staff |
| No members | Offer Create invite; do not invent a local member record |
| Camera denied | Explain how to enable it and offer manual presentation input |
| Image upload interrupted | Preserve form text, remove unsafe temporary URI after cleanup, allow reselect/retry |
| Stripe handoff cancelled | Return to Payments, preserve venue context, and refresh status |

## 13. Accessibility, security, and performance

### Accessibility

- Minimum 48×48 dp touch targets.
- Order/status meaning must never depend on color alone.
- Support system text scaling without hiding counts, prices, or primary actions.
- Provide logical screen-reader order across multi-column tablet layouts.
- Announce confirmed status changes and failures without stealing focus repeatedly.
- Support hardware keyboard navigation on tablet, including visible focus.
- Honor reduced motion; haptics and sound are supplementary only.
- Scanner has manual fallback and QR instructions do not rely on vision alone.

### Security and privacy

- Store secrets with device-secure accessibility comparable to `WHEN_UNLOCKED_THIS_DEVICE_ONLY` unless the custody design explicitly requires recovery.
- Redact nsec, private hex, invite tokens, NIP-98 bodies containing secrets, payment URLs, and presentation payloads from logs/analytics.
- Verify signed events and expected signer/authority before use.
- Deep links are untrusted input and must be normalized, allowlisted, and access-checked.
- Prevent screenshots only where platform policy and product need justify it; do not promise it as security.
- Show which venue an irreversible action affects.

### Performance

- After warm launch, restore the last venue shell immediately and show live/stale state while revalidating.
- Order acknowledgement should become visible within one second of relay receipt.
- Large menus, people lists, and completed-order histories use virtualized lists.
- Avoid projecting every FlatBuffer field into plain objects. Retain only fields needed for stable navigation/history.
- Do not keep hidden venue subscriptions active after switching venues.

## 14. Technical baseline

Reuse the `crays-rn` baseline unless a Board requirement demands otherwise:

- Expo 57 and development/production clients, never Expo Go;
- React Native 0.86, React 19, TypeScript;
- Expo Router with typed routes;
- NativeWind with semantic tokens in `global.css` and Tailwind configuration;
- one app-wide `@candypoets/nipworker/react-native` manager;
- `@candypoets/nipworker/hooks` and `/utils` for subscriptions, publishing, narrowing, tags, and FlatBuffer iteration;
- Expo SecureStore, safe-area context, screens, Reanimated, SVG, and vector icons;
- Jest and React Native Testing Library;
- Maestro for public on-device flows;
- the real Nuts coordinator/relay QA harness for protocol verification.

Expected Board-specific additions include native camera/scanning, image selection/manipulation, and secure browser/auth-session handoff. Dependency selection happens during implementation and must be compatible with Expo prebuild and the native `nipworker` development client.

Use Crays brand tokens rather than source-admin emerald hex values. The staff product should favor a light, high-legibility operational canvas with Crays night surfaces and pink/coral actions, while reserving semantic success/warning/error colors for status. Feature components must not scatter raw brand colors.

## 15. Analytics and success measures

Analytics must contain no private keys, full pubkeys unless explicitly consented/hashed for operations, invite tokens, message content, presentation payloads, or payment credentials.

Pilot measures:

- median new-order-to-accept time;
- median accepted-to-served time;
- percentage of status mutations confirmed on first attempt;
- stale menu-item availability incidents reported by venues;
- event check-in median and duplicate-rejection rate;
- invite creation and successful `crays-rn` redemption rate;
- relay reconnect time and access-revalidation failures;
- crash-free tablet sessions;
- task completion and error rate by tablet versus phone;
- accessibility audit failures and text-scaling regressions.

The north-star operational measure is **confirmed service actions per active venue shift**, paired with low correction/retry rates—not time spent in the dashboard.

## 16. Delivery sequence

### Phase 0 — Contract and scaffold

- Scaffold `crays-board` from the `crays-rn` technical baseline with a distinct app ID, scheme, semantic theme, adaptive shell, unrestricted orientation, and development client.
- Reconcile `nipworker` versions between `nuts-cash`, `crays-rn`, and Board.
- Define staff identity/custody and venue bootstrap paths.
- Define idempotent coordinator creation-attempt and resume contracts for the newcomer Create venue screen.
- Port pure access, trust, catalog, order, event, role, and invite contract tests.
- Adapt the real coordinator/relay QA harness and create the Samsung-like tablet AVD.
- Close the known `crays-rn` archive-availability compatibility gap.

### Phase 1 — Operational vertical slice

- Runtime/account gate, newcomer Create venue, venue discovery/switching, permission-aware shell.
- Orders/kitchen with live kind `8` and `37237` projection and independently verified mutation.
- Menu list and available/unavailable controls.
- Home operational summary.
- Tablet landscape, tablet portrait, and phone layouts for these screens.

### Phase 2 — Venue management

- Full menu editor, images, sections, ordering, archive/restore.
- Events, RSVP details, paid access, scanner/check-in.
- People, role assignment, permission matrix, and revocation.
- Invites and native sharing.

### Phase 3 — Setup and pilot hardening

- Venue profile, memberships, Stripe mobile handoff.
- Room manifest/gateway health and QR fallback.
- Lifecycle/relaunch recovery, accessibility, keyboard, offline/stale behavior.
- Physical iPad and Samsung validation, security review, and pilot telemetry.

## 17. Screen delivery and QA contract

The natural-language test inventory and scenario-writing contract live in [`docs/testing/QA_WORKFLOWS.md`](docs/testing/QA_WORKFLOWS.md). The proposed executable harness boundary and rollout live in [`docs/architecture/qa-harness.md`](docs/architecture/qa-harness.md). Together they define what must be proved before individual Maestro and `.qa` files are implemented.

Every screen/workflow implementation must include in the same change:

1. a screen spec under `docs/screens/` covering entry, states, navigation, accessibility, failures, permissions, and relay/service behavior;
2. deterministic pure-logic/component tests;
3. a screen-specific Maestro flow;
4. a named `.qa/qa-<screen-or-workflow>.mjs` lifecycle scenario;
5. independent relay/service verification after UI exercise for every protocol claim;
6. scoped teardown in `finally`, including exact relays, volumes, helpers, app state, and scenario files owned by the run.

The QA lifecycle is:

```text
provision isolated real venue relay
  -> wait for signed relay round-trip
  -> seed signed fixtures
  -> launch the native development client
  -> exercise public UI with Maestro
  -> query relay/service truth independently
  -> verify exact kind, signer, tags, transitions, idempotency, and forbidden writes
  -> tear down exact owned state
```

UI text or an in-memory JavaScript store is never sufficient proof that an order, menu item, role, event, invite, or check-in succeeded.

`.qa` is an orchestration layer, not a replacement for Jest, React Native Testing Library, or Maestro. Pure tests prove deterministic logic, component tests prove local rendering and interaction states, Maestro proves behavior through the public native UI, and `.qa` proves that the UI caused or consumed the correct external truth. A scenario should use the cheapest layer capable of proving a claim and add real-relay/service verification only where the claim crosses that boundary.

The structural QA gate must maintain a registry mapping every screen contract to an existing Maestro flow and named `.qa` runner. A new screen contract without both executable artifacts fails the gate before device testing begins.

Create venue additionally requires a failure-injection QA scenario for each durable boundary: before coordinator acceptance, after relay allocation, after readiness, after directory publication, and after profile publication. Each rerun must prove that at most one relay belongs to the stable creation attempt and that pre-existing admin relay-set entries survive.

### Device matrix

| Target | Automated expectation |
| --- | --- |
| 11-inch 16:10 Android tablet AVD, landscape | Primary complete Maestro suite and screenshots |
| Same tablet AVD, portrait | Navigation, forms, scanner handoff, rotation/lifecycle suite |
| 1080×2400 Android phone AVD | Core Home, Orders, Menu, Events, More, and mutation flows |
| iPad simulator, landscape/portrait | Layout, keyboard, safe area, camera fallback, and smoke suite when macOS runner is available |
| Physical Samsung tablet/phone | Pre-pilot camera, keyboard, process recreation, network switch, and vendor behavior |

## 18. MVP acceptance criteria

The MVP is ready for a hospitality pilot when:

1. A newcomer can choose **Create venue** from cold entry, deliberately create or sign into an owner account, provide valid venue details, and understand recovery before provisioning.
2. One submission provisions at most one relay, preserves existing admin relay-set entries, confirms readiness/profile publication, selects the venue, and opens a truthful success/setup screen.
3. An interrupted post-allocation creation resumes the same attempt and relay instead of creating a duplicate.
4. An authorized staff identity can discover its venues, select one, and see only permission-allowed destinations.
5. A read-only or unauthorized identity cannot publish through UI, deep links, or stale local state.
6. Switching venues disposes old subscriptions and late callbacks cannot alter the new venue.
7. Home reflects live open orders, menu availability, upcoming events, and expiring members without a parallel database.
8. A guest purchase arriving as a trusted kind `8` award appears as a New order.
9. Authorized staff can move that order through Accepted, Preparing, Ready to serve, and Served.
10. Each mutation writes one valid kind `37237` with monotonic time, stable context, correct signer, and exact tags; repeated taps do not duplicate state.
11. Rejected, timed-out, offline, and interrupted order updates recover without showing false success.
12. Staff can add/edit a food or drink item, reorder it, and change availability; `crays-rn` reflects the confirmed result.
13. Archived and unavailable items cannot be purchased in `crays-rn`.
14. Staff can create an event with a valid schedule and access policy, inspect RSVP counts, and check in a valid attendee exactly once.
15. Invalid, expired, revoked, wrong-venue, wrong-event, exhausted, and duplicate presentations are rejected with a useful reason and no fulfillment write.
16. An owner can create a narrowly scoped staff role and assign it permanently or until a future date.
17. A moderator can revoke a membership award with confirmation; a root admin cannot be banned from People.
18. Staff can create an expiring invite, share its QR/link, and a guest can open it in `crays-rn` without losing context.
19. Venue profile and membership changes publish only to the selected venue relay.
20. Stripe handoff returns to the same venue and refreshes authoritative status without exposing payment credentials.
21. App backgrounding, rotation, process recreation, and relaunch do not duplicate writes or leak camera/subscription handles.
22. Every live result family has a stable distinct subscription ID and cleans up when its owner exits.
23. Core workflows pass on the Samsung-like tablet AVD in landscape and portrait and remain usable on the phone AVD.
24. Screen reader, text scaling, contrast, reduced motion, 48 dp touch targets, and hardware keyboard checks pass.
25. Every relay-backed acceptance claim is independently verified against an isolated real relay with exact teardown.

## 19. Open decisions and known gaps

These decisions must be resolved before the affected phase is considered production-ready:

1. **Staff custody:** local imported key, remote signer, organization-managed signer, recovery, device unlock, and multi-device policy.
2. **Newcomer provisioning:** coordinator eligibility/rate limits, stable creation-attempt idempotency, resume lookup, name/domain conflicts, and cleanup of an explicitly abandoned relay.
3. **Order shape:** quantities, modifiers, multi-item carts, table/pickup location, notes, taxes/tips, cancellation reasons, refunds, and receipts are not fully represented by the current award/status projection.
4. **Consumer compatibility:** `crays-rn` must reject archived items and align event paid-entry tags with the final Board writer.
5. **Invite link:** production universal-link domain, Android App Links, iOS Universal Links, and custom-scheme fallback.
6. **Stripe on native:** externally reachable connect endpoint, NIP-98 URL binding, secure return URI, and cancelled/expired link behavior.
7. **Media on native:** supported Blossom/NIP-96 servers, authentication, compression metadata, upload cancellation, and content moderation.
8. **Room/gateway ownership:** who refreshes the expiring room manifest, how Board talks to venue hardware, and which health signals are relay truth versus local telemetry.
9. **Background orders:** push transport and privacy model. The app must not simulate reliable background service with an unsafe persistent websocket.
10. **Event lifecycle:** edit, cancellation, attendee notification, ticket invalidation, and refund behavior.
11. **Role limit:** confirm whether four roles is a product constraint or only a reference-admin UI limit before expanding it.
12. **History retention:** relay query limits, completed-order retention, audit/export expectations, and whether a server-side operational index is required without becoming a second source of truth.
13. **Physical device bar:** which exact iPad and Samsung models are required for pilot sign-off.
