# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Crays Board serves hospitality owners, general managers, floor and bar managers, kitchen or bar staff, event hosts, door staff, and community or membership managers. It is used behind a counter, at the pass, at the door, and while moving through a venue.

## Product Purpose

Crays Board is the staff/operator client for a Crays hospitality venue. It lets staff create and configure a venue, keep a menu current, move live orders through service, run events and check-in, manage members and roles, create invitations, and monitor venue setup. Success means staff can act quickly while every confirmed change becomes the same relay truth consumed by the guest-facing `crays-rn` app.

## Positioning

Crays Board is not a generic back-office database or a traditional POS clone. It operates the same signed venue objects that guests hold and see: venue profile, menu offers, events, tickets, membership awards, and fulfillment states remain Nostr-native and venue-owned.

## Operating Context

- Tablet-first operation on iPad and 16:10 Android tablets, in landscape and portrait.
- Compact single-column operation on iOS and Android phones.
- Frequent, time-sensitive use for order acceptance, preparation, availability changes, and check-in.
- A newcomer can create an owner account and provision a first hospitality venue.
- Existing authorized staff discover and switch among venue relays through their signed relay sets.
- `crays-rn` is the downstream guest/member client for data published by Board.
- A real venue relay and the existing Nuts coordinator/services are authoritative.

## Capabilities and Constraints

- Core areas: Create venue, Home, Orders, Menu, Events, People/Roles, Invites, and Settings.
- Expo 57, React Native, Expo Router, NativeWind, one native `nipworker` manager, SecureStore, Jest, React Native Testing Library, and native Agent Device `.ad` journeys follow the `crays-rn` baseline.
- Expo Go is unsupported because `nipworker` is native.
- There is no parallel generic CRUD backend or mobile-only venue database.
- Writes require venue relay/service acknowledgement and independent QA verification.
- Permission keys are posts, media, events, store, invites, moderation, and settings.
- The app must remain usable with screen readers, text scaling, reduced motion, hardware keyboard, and 48 dp touch targets.
- Open decisions: staff custody/recovery, idempotent coordinator creation attempts, complete hospitality order shape, native Stripe return, gateway hardware telemetry, and production universal links.

## Brand Commitments

- Product name: Crays Board.
- It belongs to the established Crays identity, not the emerald/stone visual language of the Nuts web admin.
- Crays uses a dark night foundation, vivid pink primary, coral accent, paper-pink content, and direct human language.
- The staff experience may become lighter and more operational than `crays-rn`, while staying recognizably Crays through color, typography, shape, and voice.
- Protocol terms remain backstage in normal UI.

## Evidence on Hand

- Product requirements: `PRD.md`.
- Source admin workflows and contracts: `/root/code/nuts-cash/src/routes/admin` and `/root/code/nuts-cash/src/lib`.
- React Native stack and Crays visual tokens: `/root/code/crays-rn`.
- Guest protocol contract and relay QA architecture: `/root/code/crays-rn/docs/architecture`.
- No venue photography, customer logos, production metrics, or final hardware assets are available and must not be fabricated as claims.

## Product Principles

1. The live venue is the unit of work.
2. Operational truth beats optimistic polish.
3. Permissions shape both navigation and action.
4. Tablet first does not mean phone hostile.
5. Guest and staff language must agree.

## Accessibility & Inclusion

The interface must provide color-independent status, logical focus and reading order across multi-pane layouts, large touch targets, text scaling, reduced-motion behavior, hardware-keyboard access, camera alternatives for check-in, and meaningful recovery copy for every failure state.
