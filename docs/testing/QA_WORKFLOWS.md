# Crays Board natural-language QA workflows

## Purpose

This document says what the product must prove in language a product owner, designer, developer, or tester can review before automation exists. It covers the complete screen catalog in [`design/mockups/README.md`](../../design/mockups/README.md), the behavior in [`PRD.md`](../../PRD.md), and the important states that are not visible in the polished mockups.

It is both a release checklist and the source for future screen contracts, Jest tests, Maestro flows, and `.qa` verifiers. A mockup screenshot is not a passing test by itself.

## How to write and automate a scenario

Every executable screen or workflow specification should state:

1. **Purpose:** the user outcome or risk being proved.
2. **Persona and permission:** active identity, selected venue, and exact permissions.
3. **Starting truth:** signed relay events, service state, local persisted state, connectivity, and device form factor.
4. **User action:** only public controls, routes, scanner, browser handoff, or operating-system behavior.
5. **Visible result:** what the user can observe, including pending, success, stale, empty, and error states.
6. **Authoritative result:** exact relay/service truth to query independently.
7. **Forbidden result:** writes, leaks, navigation, duplicates, or stale data that must not occur.
8. **Lifecycle boundary:** background, rotation, process recreation, relaunch, retry, or venue switch when relevant.
9. **Cleanup:** exact app and infrastructure state owned by the run.

Example:

> Given a store staff member viewing a relay-confirmed pending order, when they tap Accept twice, the card shows one pending action and moves only after acknowledgement. The venue relay contains exactly one valid `37237` accepted status for that order, signed by the expected staff identity. It contains no processing status and no write to another venue. Relaunch shows the order as Accepted. The scenario then deletes only its venue relay and app state.

## Pass rules

- A visible success message proves only presentation; a separate verifier proves external truth.
- A relay/service test uses isolated real behavior, correctly signed fixtures, and a unique run ID.
- An error-path test states what did **not** happen.
- A mutation test covers repeat taps, failed acknowledgement, and relaunch unless the operation is purely local.
- Permission tests cover hidden navigation, guarded direct entry, disabled/absent actions, and rejected backend writes.
- Responsive tests preserve the same information and action semantics; they do not require pixel-identical layouts.
- Sample names, counts, prices, and images from generated mockups are fixtures, not expected production copy.

## Coverage map

| Area | Visual surfaces | Minimum executable contract |
| --- | --- | --- |
| Entry | Welcome; venue selection | Cold newcomer, existing staff, bootstrap/sign-in paths, no venues, revoked access, read-only signer, runtime unavailable, sign out |
| Create Venue | Identity; Place; Service & owner; Review; Provisioning; Success | Validation, recovery disclosure, one durable attempt, resume at every boundary, partial success, no duplicate relay |
| Shell | Tablet rail; phone bottom navigation and More | Permission filtering, venue context, back behavior, venue switch disposal |
| Home | Tablet and phone | Established venue, new venue checklist, live updates, stale/offline, permission-filtered quick actions |
| Orders | Tablet board and phone list | Every stage, valid/invalid transitions, decline, acknowledgement failure, idempotency, sorting, authority, compact composition |
| Menu | Tablet master-detail and phone list/editor | CRUD, availability, archive, ordering, validation, ownership, media failure, guest compatibility |
| Events | List/detail; three create steps; check-in; phone | Draft preservation, schedule validation, admission atomicity, RSVP projection, scanner result matrix |
| People | People master-detail, tablet and phone | Membership/role projection, expiry, permission boundaries, revocation, root protection |
| Roles & access | Role editor and matrix | Create/edit, permission matrix, assignment duration, expiry, unauthorized mutation, role limit |
| Invites | Configuration, QR result, and active list | NIP-98 binding, expiry/duration/count, safe share, idempotent guest redemption, failure/expired states, revocation |
| Settings | Profile; Memberships; Payments; Room | Signed mutations, native handoff/return, unavailable telemetry, setup truth, selected-venue isolation |
| Cross-cutting | All | Rotation, process death, offline/stale, accessibility, keyboard, security/redaction, physical Samsung/iPad |

## 1. Entry, identity, and venue access

### ENTRY-01 — Newcomer chooses Create Venue

Given a clean install with no identity, cold launch shows the Crays Board welcome surface with **Create venue** as the primary action and **Sign in** as secondary. Choosing Create venue opens the first identity step. Back returns to welcome before provisioning. No signer, venue, relay subscription, or coordinator resource is created merely by viewing these screens.

### ENTRY-02 — Existing staff signs in

Given a supported existing identity, successful sign-in discovers venue references, verifies actual access, and presents only authorized venues. The private key never appears in route parameters, logs, screenshots, analytics, or QA state. Cancelling sign-in returns safely to welcome.

### ENTRY-03 — Identity has no venues

Given a valid identity with no verified venue access, the app shows **Create your first venue**, Refresh, and the supported bootstrap/deep-link path. It does not show an empty authenticated dashboard or fabricate a venue.

### ENTRY-04 — Venue discovery and selection

Given two accessible venues and one stale unauthorized reference, selection shows loading/verification honestly, lists the two authorized venues, excludes or explains the unauthorized reference, and remembers the chosen venue. Relaunch restores the shell promptly but marks it stale until access is revalidated.

### ENTRY-05 — Access revoked while active

Given a selected venue whose active role is revoked, the next access refresh closes its subscriptions, clears privileged projections, returns to venue selection, and prevents route/deep-link mutations. Cached order, member, payment, and invite details are no longer visible.

### ENTRY-06 — Read-only signer

Given an identity that can read but cannot sign, authorized screens remain readable. Every mutation is absent or disabled with a useful explanation; direct navigation cannot reveal an enabled mutation path, and no publish attempt reaches the relay.

### ENTRY-07 — Runtime unavailable

Given Expo Go or a build where the native `nipworker` runtime is unavailable, the app shows a precise build requirement and recovery path. It does not crash, spin indefinitely, or show an apparently usable dashboard backed by fake data.

### ENTRY-08 — Malformed or untrusted deep link

Given malformed, unsupported, wrong-scheme, or unauthorized venue parameters, the app normalizes/allowlists the input, verifies access, and routes to a safe entry state. It never logs embedded secrets or opens a privileged screen on URL data alone.

### ENTRY-09 — Bootstrap and sign-in paths

Given the welcome surface, each supported secondary path — import an existing account, scan a staff/venue access code, and enter a service address — normalizes and allowlists its input, verifies access before opening any privileged screen, and returns safely to welcome when cancelled. Malformed, expired, or unauthorized codes and addresses produce a specific recoverable error, never log embedded secrets, and never fabricate a venue.

### ENTRY-10 — Sign out

Given an authenticated session with a selected venue, signing out is a deliberate confirmed action that removes the account from the runtime manager, clears the selected venue and sensitive local state, closes every subscription, camera, browser, and helper handle, and returns to the welcome surface. Relaunch shows cold entry with no privileged cached content and no residual venue subscriptions.

## 2. Create Venue

### CREATE-01 — Identity-step validation and preview

Given a newcomer on the Identity step, blank, one-character, over-50-character, whitespace-only, and unsafe slug inputs show inline accessible errors and cannot continue. A valid name updates the preview and produces a normalized slug without mutating the user’s venue name. Optional image/description limits are enforced.

### CREATE-02 — Place, timezone, and hours

Given a valid Identity step, Place suggests the device timezone but lets the user confirm or change it. Invalid opening-hour ranges and an end before start are explained. Address and hours remain optional. Moving backward and forward preserves the draft, including across rotation and keyboard dismissal.

### CREATE-03 — Owner account and recovery

Given no signer, Service & owner requires either deliberate device account creation or supported sign-in/import. Creating an account requires the promised recovery/device-custody acknowledgement. Secrets are not incidentally shown or copied. Given an existing valid signer/profile, the app does not ask to create another identity.

### CREATE-04 — Initial services are intentions, not false success

Selecting menu, payments, invites, or room setup changes the review and success checklist. It does not create resources before submission and does not label a service configured until its real boundary confirms it.

### CREATE-05 — Review and edit

Review shows the exact venue, owner, place/timezone, recovery state, and initial setup intentions. Each Edit action returns to the correct step without losing other values. Create venue is a single deliberate primary action and communicates that it provisions real venue infrastructure.

### CREATE-06 — Happy-path provisioning

One submission uses one stable creation attempt, resolves/creates the owner profile, allocates one relay, proves signed readiness, merges directory/relay sets without deleting existing venues, publishes the venue profile, selects the new venue, and opens a success surface. Independent checks verify exact relay count, authority, directory entries, profile, and selected venue.

### CREATE-07 — Coordinator rejection before allocation

Given a validation, eligibility, or domain conflict before coordinator acceptance, the editable draft remains available with a specific error. No relay, volume, directory update, or venue profile exists. Correcting the input creates a new submission without stale pending UI.

### CREATE-08 — Timeout around coordinator acceptance

Given a timeout where allocation outcome is initially unknown, Retry first reconciles the stable attempt. It never blindly creates a second relay. The final state contains zero or one relay for that attempt, never two.

### CREATE-09 — Resume after relay allocation/readiness

For failures immediately after relay allocation and after signed readiness, killing and relaunching the app offers **Resume venue setup**. Resume uses the recorded relay and continues from the next incomplete boundary. Back/cancel does not silently delete it.

### CREATE-10 — Directory and profile partial failure

For a directory publish/read-back failure or profile publish failure, the workflow preserves existing admin relay-set entries and the allocated venue. It resumes or finishes with an explicit repair action according to the PRD; it never reports all setup complete when verification is pending.

### CREATE-11 — Optional image failure

Given venue or owner image upload failure, venue creation can complete when its required boundaries succeed. The success state identifies the missing image and offers retry later. No broken image URL is published as a confirmed result.

### CREATE-12 — Provisioning lifecycle safety

During every provisioning stage, repeat taps, rotation, background/foreground, Android activity recreation, and full relaunch cannot start a duplicate attempt or regress a completed durable stage. A late callback from an older generation cannot overwrite the current state.

### CREATE-13 — Truthful success and next actions

Success identifies the exact venue and separately reports relay ready, profile published, directory verified/catching up, and room/discovery ready/action needed. Open venue enters the correct selected venue. Invite sharing is absent until a real invite exists; setup actions are filtered by permission and actual readiness.

## 3. App shell, navigation, and venue switching

### SHELL-01 — Tablet navigation rail

At tablet width in both orientations, the persistent rail shows selected venue and only permission-allowed destinations. Current destination is visually and programmatically selected. Content does not sit under safe areas, system bars, or the rail.

### SHELL-02 — Phone navigation and More

At compact width, bottom navigation contains Home, Orders, Menu, Events, and More when permitted. More contains People, Invites, Settings, venue switching, and account actions, each permission-filtered. A missing permission does not leave a blank tab or dead row.

### SHELL-03 — Guarded direct entry

For every protected route, an unauthorized deep link redirects to Home or venue selection with a useful explanation. The protected screen does not briefly render sensitive cached content and no protected subscription starts.

### SHELL-04 — Switch venues safely

Given venues A and B, switching from A while A has live updates cancels A subscriptions/pending screen work, clears A content, re-resolves B permissions, and opens the same destination only when allowed. A late A event or acknowledgement cannot appear in B or write to B.

### SHELL-05 — Unsaved form during navigation

Leaving a dirty editor, switching venue, using Android predictive back, or closing a sheet prompts to discard or continue editing. Confirming discard removes only the local draft; cancelling remains on the form. Confirmed external writes are not rolled back by this dialog.

## 4. Home

### HOME-01 — Established venue attention summary

Given signed fixtures, Home displays live/offline truth, open-order counts and oldest wait, unavailable menu count, upcoming events/check-in, active/expiring members, and setup warnings. Each value independently matches authoritative projections and each action opens the correct filtered destination.

### HOME-02 — New venue checklist

Given a newly created venue with no menu, invite, payments, or room setup, Home shows a guided checklist rather than zero-filled analytics. Completing one real setup action marks only that item complete after confirmation.

### HOME-03 — Permission-filtered quick actions

Store-only, events-only, invites-only, settings-only, and read-only personas see exactly the quick actions they can perform. Hidden actions remain inaccessible by deep link.

### HOME-04 — Live update and stale/offline state

New relay events update affected summaries without resetting scroll or flashing unrelated cards. On disconnect, cached values remain visibly stale with no false live indicator. Reconnect reconciles once without duplicate counts.

### HOME-05 — Tablet and phone information parity

The phone composition prioritizes the same operational risks and actions as tablet, in a logical reading order, without horizontal clipping or a miniature dashboard grid.

## 5. Orders and kitchen

### ORDER-01 — Project a trusted new order

Given one trusted single-use award with no status, Orders shows one New/pending order with correct item, holder context, age, and reference. Duplicate copies, wrong recipients, untrusted issuers, and unrelated awards do not create extra orders.

### ORDER-02 — Stage composition and sorting

Tablet landscape places active orders in the correct New, Accepted, Preparing, and Ready columns. Phone uses count-bearing status tabs and a chronological list. Within each stage, sorting uses the specified latest status/time and deterministic ID tie-breaker.

### ORDER-03 — Advance the complete ladder

An authorized store staff member can advance one order exactly one step at a time through accepted, processing, ready, and fulfilled. Each step remains pending until acknowledgement, then moves with guest-facing language consistent with `crays-rn`. Independent verification checks one valid `37237` per action, stable context, exact tags, signer, and monotonic timestamp.

### ORDER-04 — Prevent invalid transitions

The UI does not offer skipping normal stages, moving backward, or changing fulfilled/cancelled orders. Forced direct-entry or stale actions are rejected without a write. Event entry may go directly to fulfilled only in the check-in contract.

### ORDER-05 — Repeat tap and delayed acknowledgement

Double-tapping or tapping while pending sends at most one mutation. With delayed acknowledgement, the card stays in its prior confirmed stage and communicates pending status. After acceptance it moves once; relaunch shows one final state.

### ORDER-06 — Failed acknowledgement, offline, and retry

With no accepted relay acknowledgement, the card never shows confirmed success or changes confirmed stage. It offers Retry with the same context. Restoring connectivity and retrying creates one valid next status; an earlier late failure cannot overwrite it.

### ORDER-07 — Cancellation

Cancellation is secondary and, once accepted, requires confirmation naming the order and venue. Confirm publishes one trusted terminal status; dismiss publishes nothing. Cancellation from a terminal order or without permission is impossible.

### ORDER-08 — Authority and legacy reads

Latest valid statuses from allowed venue/admin/badge/staff authorities count. Forged or unauthorized statuses do not. Legacy `27237` can be projected during migration, but every Board write is `37237`.

### ORDER-09 — Missing and changed definitions

An award whose definition is temporarily missing remains diagnosable without crashing or becoming a different product. A legitimate addressable definition update resolves consistently without changing the stable order reference.

### ORDER-10 — Venue switch while mutation is pending

Switching venues during a pending action cancels screen ownership and clears the old card. Any late acknowledgement is recorded only for its original relay/context and cannot alter the new venue UI.

### ORDER-11 — Large and long-running queue

A realistic large queue remains scrollable, virtualized, keyboard accessible, and responsive. Elapsed times update without rerendering every unrelated card, and screen-reader focus does not jump when another order changes stage.

### ORDER-12 — Decline a pending order

Given a trusted pending order, **Decline** is visually secondary to Accept and, per PRD §8.4, does not require the post-acceptance confirmation. It publishes exactly one valid `37237` cancelled status from an authorized signer with stable context and monotonic timestamp; guest-facing wording matches `crays-rn`. Dismissal or double-tapping publishes nothing or at most one event. Decline is unavailable on accepted, processing, ready, fulfilled, or already-cancelled orders, and forced direct entry produces no write.

### ORDER-13 — Order history (deferred)

The Order history surface is deferred until the PRD section 19 history-retention decision is resolved. Until then the app must not present a completed-order history as authoritative. When enabled, a scenario proves completed/cancelled context reads from the venue relay only, paginates honestly within relay query limits, and marks truncated history rather than implying completeness.

## 6. Menu and store

### MENU-01 — Sectioned catalog projection

Food and drink appear in ordered hospitality sections; merchandise, passes, and offers appear in their proper groups. Search/type/section/availability filters compose correctly and empty results explain how to clear filters.

### MENU-02 — Create an item

Given store permission, a valid name, description, price/currency, product kind, section, availability, and optional sats/image data publishes one correctly classified `30009` definition. The confirmed item appears in Board and is independently queryable.

### MENU-03 — Validation

Blank/short names, non-positive or malformed price, invalid currency, invalid safe integers, oversized description, and incompatible product fields show accessible inline errors and produce no relay or upload write.

### MENU-04 — Edit with stable address

Editing price, description, image, section, position, or availability republishes the same `d` and resolves as the latest valid addressable event. It does not create a duplicate offer. Relaunch shows the confirmed edit.

### MENU-05 — Publisher ownership

An item published by another trusted key remains visible but clearly non-editable unless the contract grants that signer authority. Hiding a button alone is insufficient: direct route and attempted publish are rejected.

### MENU-06 — Availability, archive, and restore

Availability can change in the promised number of deliberate taps and remains pending until confirmation. Archive is explicit and restorable. Both unavailable and archived items become non-purchasable in `crays-rn`; this guest-client check is required before archive controls ship.

### MENU-07 — Section ordering and rename

Moving an item updates only affected addressable definitions with stable identities and deterministic positions. Renaming a section republishes affected items consistently; interruption cannot leave duplicate items or silently lose a section.

### MENU-08 — Media upload

Image selection, preview, progress, cancellation, retry, and replacement work in the native client. Permission denial and upload failure retain the editable item. A failed upload does not publish a broken URL or log credentials.

### MENU-09 — Responsive editor

Tablet master-detail keeps selection and list context. Phone opens a full-screen editor/sheet with logical focus, visible validation, and a primary action above keyboard/safe area. Back with unsaved edits uses the shared discard confirmation.

### MENU-10 — Offline and conflicting update

Cached menu content is marked stale. A mutation without acknowledgement is not shown as confirmed. If a newer valid addressable update wins while editing, the app detects the conflict or refreshes explicitly rather than silently overwriting unseen changes.

## 7. Events and entry

### EVENT-01 — Event list and detail

Upcoming, Past, and All filters, search, schedule/timezone, location, capacity, access policy, RSVP counts, ticket price, and attendee visibility match signed event/RSVP truth and the active persona’s permission.

### EVENT-02 — Details-step validation

Event creation requires a valid title and supported details. Optional illustration behaves like native menu media. Moving to Schedule and back preserves the single draft across rotation.

### EVENT-03 — Schedule and timezone

Start/end validation rejects impossible ranges and communicates the chosen timezone. Local daylight-saving transitions are rendered unambiguously. Optional capacity accepts only a positive safe integer and no publish occurs during draft navigation.

### EVENT-04 — Open/free admission

Publishing a valid open/free event creates one correct NIP-52 event and opens its detail only after acknowledgement. Repeat publish taps and relaunch do not create duplicates.

### EVENT-05 — Restricted admission

Selecting roles/memberships produces the exact repeated required-badge addresses. Removed choices are absent. Unauthorized or unknown definitions cannot be smuggled through stale draft state.

### EVENT-06 — Paid-event atomicity

Paid entry first publishes and confirms one single-use expiring `event_access` definition, then publishes the event referencing it. If the definition fails, no visible paid event is published. If the event fails afterward, retry reuses/reconciles the intended access definition rather than multiplying tickets.

### EVENT-07 — Optional sats prerequisite

Sats pricing is enabled only with a valid organizer Cashu profile. When publication is required, it confirms before the ticket definition. Invalid or unavailable payment configuration gives a useful alternative and cannot produce a falsely purchasable event.

### EVENT-08 — RSVP projection

Only the latest valid RSVP per attendee/event counts. Accepted, tentative, and declined totals remain stable under duplicates, ties, wrong-event tags, and untrusted events. Attendee identity visibility follows permission/privacy rules.

### EVENT-09 — Scanner entry and camera permission

Camera permission is requested only when Check in opens. Grant starts one scanner; deny shows manual entry and recovery guidance. Leaving the scanner releases camera resources. Background, rotation, and process recreation do not submit a stale scan twice.

### EVENT-10 — Valid check-in

A valid short-lived presentation bound to the selected venue, event, holder, trusted award, nonce, and time window yields one clear success and one `37237` fulfilled event-context status. Returning to the attendee list reflects the check-in.

### EVENT-11 — Rejection matrix

Invalid signature, malformed payload, expired/not-yet-valid window, wrong venue, wrong event, wrong holder/award, revoked award, exhausted pass, untrusted issuer, and unknown event each produce a specific safe rejection and zero fulfillment writes.

### EVENT-12 — Duplicate check-in

Rescanning or manually resubmitting an already fulfilled presentation shows Already checked in and creates no additional use/status. Concurrent scanners resolve to one fulfillment.

### EVENT-13 — Phone event composition

Phone list/detail/create steps preserve all required fields and actions, use sticky primary actions, survive the keyboard, and do not require viewing a compressed tablet split pane.

## 8. People, memberships, roles, and access

### PEOPLE-01 — Derive the people list

People includes trusted root admins and holders of active role/membership awards whose definitions exist. It deduplicates identities and shows nearest relevant expiry. Untrusted, revoked, expired, malformed, and unrelated awards do not grant active status.

### PEOPLE-02 — Status and detail

Active, Expiring soon within 30 days, and Expired labels match deterministic clock fixtures. Opening a person shows the correct venue-local kind-0 profile and access summary without leaking unrelated global/private data.

### PEOPLE-03 — Permission boundary

Moderation may view and revoke an ordinary membership. Settings is required to create/edit roles, permissions, or assign staff roles. Personas with only one permission cannot reach the other capability by hidden control, direct route, or stale screen.

### PEOPLE-04 — Membership revocation

Confirming revocation names the person, membership, and venue and publishes the correct kind-5 reference from an authorized signer. Dismissal produces no event. The member loses derived access only after confirmation.

### PEOPLE-05 — Root protection

A root venue administrator cannot be banned/revoked from People. The UI explains why, direct entry is guarded, and no deletion/revocation publish is attempted.

### PEOPLE-06 — Phone people composition

At compact width, the People master-detail splits into list and detail routes preserving search, status filters, expiry labels, and only the revocation/assignment actions allowed by PEOPLE-03. Roles & access remains reachable and editable with logical focus order, and the permission matrix keeps its labels and descriptions without horizontal clipping.

### ROLE-01 — Create and edit a role

An owner/settings user can create a valid role definition with exact `type=role`, `t=role`, name, description, and selected repeated permissions. Editing retains the addressable identity and confirmed latest definition.

### ROLE-02 — Permission matrix semantics

Posts, media, events, store, invites, moderation, and settings each have understandable descriptions and programmatic labels. Toggle state survives navigation within the draft; Save publishes only the final intended set.

### ROLE-03 — Assign role permanently or until expiry

A valid hex pubkey or npub and selected role can be assigned permanently or to a future expiry. The kind-8 award contains exact `a`, `p`, and optional expiration. Invalid identity/past expiry produces no write.

### ROLE-04 — Expiry and access refresh

With a deterministic clock crossing expiry, the person’s access becomes expired, protected destinations disappear, active subscriptions close where appropriate, and attempted writes are rejected.

### ROLE-05 — Role limit and concurrent changes

The v1 configurable-role limit is enforced with clear guidance. Concurrent latest-definition changes are reconciled; a stale editor does not silently erase newly added permissions without a conflict/refresh decision.

## 9. Invites

### INVITE-01 — Configure and create

Given invites permission, every allowed claim expiry, membership duration, and maximum-redemption value serializes exactly. Invalid count or unsupported combination is rejected locally with no request.

### INVITE-02 — NIP-98 request binding

Creation sends one authorization bound to the exact selected venue URL, `POST` method, and SHA-256 payload. An expired, replayed, wrong-URL, wrong-method, wrong-body, or unauthorized event is rejected and no invite is created.

### INVITE-03 — Pending, retry, and idempotency

While the service response is pending, repeat taps do not create multiple invites. A timeout can reconcile or deliberately retry according to the service contract. The result count and token ownership are verified independently.

### INVITE-04 — QR and native sharing

Only a successful service response produces the venue-branded QR/link. Copy and native share use the complete guest URL while the raw token is never separately displayed or logged. Save poster and platform print behave honestly when supported or unavailable.

### INVITE-05 — Guest handoff

Opening the link in `crays-rn` preserves service URL, relay URL, and token through guest authentication. Successful redemption grants the exact intended membership to the authenticated account and opens the correct venue context.

### INVITE-06 — Redemption limits and failures

Expired, exhausted, malformed, wrong-service, and unauthorized invites fail safely. Maximum redemptions is enforced. Retry by the same account is idempotent and cannot burn a second use or grant a duplicate award.

### INVITE-07 — Permission loss and venue switching

If permission is revoked or venue changes while configuration/result is open, sharing/mutation controls close and no request targets the old venue. Existing result data is not shown as belonging to the new venue.

### INVITE-08 — Active invite list and revocation

Given invites permission, the active-invite list shows each invite's created/expiry times, configured membership duration, redemption count against its maximum, and honest Active/Expired status from the venue service. Revoking an invite requires confirmation naming the invite and venue, and a revoked invite then fails guest redemption safely. If the existing `/invites` service cannot list or revoke invites, this surface stays out of the build rather than projecting local guesses.

### INVITE-09 — Phone invite composition

At compact width, invite configuration, pending creation, and the QR/share result recompose into full-screen routes with sticky primary actions. The QR remains scannable under text scaling, sharing uses the native sheet, and no raw token is exposed. Permission loss or venue switch closes the result exactly as in INVITE-07.

## 10. Settings

### PROFILE-01 — Venue profile load and save

Profile loads the selected venue’s hospitality type, description, image, and external menu/booking links from the authoritative latest profile. Valid save publishes one correct kind `30078` with `d=nuts-community-profile` to only that venue.

### PROFILE-02 — Validation and media failure

Description and URLs are validated and accessible. Image failure remains retryable and does not publish a broken URL. Unsaved edits survive rotation and use discard confirmation on exit/venue switch.

### MEMBER-01 — Membership list and editor

One-time, monthly, and yearly plans project correctly. A valid plan publishes one correctly classified sellable membership definition with positive price/currency, period, availability, and connected-payment requirement. Invalid fields produce no write.

### MEMBER-02 — Membership update and availability

Editing a plan retains its stable `d`; availability changes are confirmed before presentation as final. Guest purchase availability in `crays-rn` matches the latest confirmed definition.

### PAYMENT-01 — Status truth

Payments distinguishes not configured, onboarding required, requirements due, active, restricted, and service unavailable using authoritative service status. It never infers connection from a cached browser return alone.

### PAYMENT-02 — Native onboarding handoff

Start/continue onboarding opens the native browser/auth session with an allowlisted HTTPS URL and return scheme. Cancelling returns safely. A verified return restores the same venue and refreshes status; payment/business credentials and returned URL secrets are not logged.

### PAYMENT-03 — Expired/wrong-venue return

Expired link, malformed callback, replay, wrong state/venue, and process death during browser handoff cannot mark Payments connected or switch context. The user receives a recoverable action.

### PAYMENT-04 — Dashboard and settlement data

Open dashboard uses the current authorized link and handles unavailability honestly. Charges, payouts, settlement currency, and requirements match the service and remain scoped to the selected venue.

### ROOM-01 — Manifest and relay health

Room shows signed manifest freshness, open/closed state, capabilities, relay reachability, advertised issuer, and QR fallback from authoritative sources. Expired, forged, wrong-authority, and malformed manifests are not shown as healthy.

### ROOM-02 — Gateway truth separation

Relay-manifest health and direct gateway/beacon telemetry are separate. When telemetry is absent, the UI says **Status unavailable**; it never turns a relay record into a green hardware-health claim.

### ROOM-03 — Publish and permission

An authorized settings user can publish only the versioned agreed room contract to the selected venue and verify it independently. Read-only/unauthorized users cannot. A failed acknowledgement stays retryable and does not show a confirmed room state.

### SETTINGS-01 — Sub-navigation and responsive behavior

Profile, Memberships, Payments, and Room are distinct destinations with independent loading/empty/error states. Tablet sub-navigation and phone routes preserve the same state and accessibility semantics without exposing sections the persona cannot access.

## 11. Cross-cutting quality workflows

### QUALITY-01 — Rotation and responsive breakpoints

Run every primary destination at 11-inch landscape, the same tablet portrait, and 1080×2400 phone. Rotation preserves selected venue, route, confirmed data, scroll/selection where practical, and dirty-form warning. No control clips, overlaps system UI, or becomes unreachable.

### QUALITY-02 — Android process recreation

With “Don’t keep activities” or an equivalent controlled kill, recreate the app at entry, a dirty form, a pending mutation, the scanner, browser handoff, and each durable Create Venue boundary. The app restores only safe state, never duplicates a write, and releases obsolete native handles.

### QUALITY-03 — Network transitions

Test launch offline, loss during subscription, loss before publish, loss after relay acceptance but before UI acknowledgement, and reconnect. Cached reads are marked stale; writes never claim false success; reconciliation does not duplicate projections.

### QUALITY-04 — Accessibility

With TalkBack/VoiceOver, keyboard navigation, 200% text scaling, high contrast expectations, reduced motion, and large touch-target checks, every primary workflow remains understandable and operable. Status is not color-only, focus order follows reading order, errors are announced, icons have names, and targets are at least 48 dp.

### QUALITY-05 — Hardware keyboard and software keyboard

All forms support logical tab/focus order, submit only when intended, keep focused fields and primary actions visible, and dismiss predictably. Enter in multiline fields does not accidentally submit. Scanner manual entry works without touch-only assumptions.

### QUALITY-06 — Safe areas and platform navigation

iPad multitasking/safe areas, Android edge-to-edge system bars, gesture navigation, hardware back, and predictive back do not hide actions or unexpectedly discard work. Modals/sheets return focus to their trigger.

### QUALITY-07 — Subscription and resource cleanup

Each live result family has a stable distinct subscription ID. Leaving a screen, switching venue/account, signing out, or losing access removes its subscriptions and camera/browser/helper ownership. Repeated navigation does not increase active handles or duplicate events.

### QUALITY-08 — Security and redaction

Inspect application logs, Android logcat, crash reports, analytics payloads, route state, screenshots, clipboard behavior, and QA state. They contain no private keys, raw invite tokens, NIP-98 secret bodies, payment URLs/credentials, or presentation payloads. Irreversible actions always identify the affected venue.

### QUALITY-09 — Performance under operational load

Warm launch restores the venue shell promptly; order acknowledgement appears within one second of relay receipt; large menus/people/history remain virtualized; live timers do not churn unrelated views; switching venues leaves no hidden subscriptions. Record device class and fixture size with results.

### QUALITY-10 — Physical Samsung validation

Before pilot, run entry, Orders, Menu image selection, Event scanner/manual fallback, rotation, keyboard, process recreation, and Wi-Fi/mobile-network transition on the selected physical Samsung tablet or phone. Record Android/One UI version and device model; investigate behavior not reproduced by the AVD.

### QUALITY-11 — Physical iPad validation

Before pilot, run the equivalent core workflows on the chosen iPad model, including landscape/portrait, safe areas, hardware/software keyboard, camera permission, browser return, memory pressure, and multitasking where supported.

### QUALITY-12 — Cleanup proof

Force failure during bootstrap, Maestro, and verification. In every case the runner deletes only recorded relays, volumes, helpers, app package state, and scenario file. Screenshots/redacted logs remain diagnosable. Another simultaneously owned test resource remains untouched.

## Release suites

### Pull-request gate

- typecheck, lint, and deterministic unit/component tests;
- screen-contract registry;
- UI-only smoke flows for welcome and shell;
- one relay-backed operational canary, initially pending-order → accepted;
- changed-feature scenario and its negative/idempotency verifier.

### Android tablet regression

- complete named Maestro/`.qa` suite in 11-inch 16:10 landscape;
- primary navigation/forms/scanner lifecycle in portrait;
- screenshot artifacts at stable decision points;
- resource-leak and teardown checks.

### Phone regression

- Entry/Create Venue, Home, Orders, Menu, Events, More;
- at least one confirmed mutation per permitted primary domain;
- text scaling, keyboard, back, and safe-area checks.

### Pre-pilot release

- full automated Android suites;
- iPad simulator smoke where available;
- physical Samsung and iPad checklists;
- guest compatibility in `crays-rn` for menu availability/archive, event access/check-in, invite redemption, and order status wording;
- security/redaction review and cleanup audit;
- explicit review of every open decision in PRD section 19 that affects enabled functionality.

## Initial automation order

Do not automate all screens at once. Build confidence in this order:

1. Welcome UI-only scenario and structural contract registry.
2. One isolated relay plus pending-order projection and Accept mutation.
3. Repeat tap, failed acknowledgement, relaunch, and venue-switch variants for that order.
4. Menu availability plus `crays-rn` consumer compatibility.
5. Home projections and responsive shell.
6. Event creation/check-in and People/Roles.
7. Invite service/guest handoff and Settings service boundaries.
8. Create Venue failure-injection matrix after stable coordinator attempt/resume controls exist.
9. Full phone, portrait, lifecycle, accessibility, and physical-device release suites.

This sequence tests the harness itself on the central hospitality loop before multiplying fixture families.

