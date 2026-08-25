#!/usr/bin/env node
// Check-in scenario bootstrap (NIP-97 fulfillment, EVENT-10/11/12).
// Provisions an isolated coordinator relay and publishes, each signed by its
// proper authority and round-tripped until queryable:
//   - venue hospitality profile 30078 / d=nuts-community-profile (admin);
//   - single-use ticket listing 30402 linked to the event coordinate (admin);
//   - timed calendar event 31923 (admin);
//   - two kind 8 awards for the definition (relay badge issuer): award to
//     users[0] (untouched) and award2 to users[1] (pre-fulfilled);
//   - one delegated-issuer-signed 37237 fulfilled/event status for award2 (the
//     pre-seeded "already checked in" truth);
//   - three holder-signed kind 27236 presentations (kept in state only —
//     Board validates presentations, it never reads them from the relay).
//
// State file fields (public-safe ids/pubkeys plus the synthetic fixture
// presentations, whose expiration is exactly 90 seconds after their signed
// created_at and which are never logged):
//   run, id, name, domain                    - relay identity
//   relay_url, emulator_relay_url            - ws urls (host / emulator)
//   base_url, emulator_base_url              - service urls (host / emulator)
//   admin_pubkey, issuer_pubkey              - venue authority / badge issuer
//   user_pubkey, user2_pubkey                - award holders (users[0], users[1])
//   venue_profile_id                         - 30078 profile event id
//   product_definition_id, product_address   - ticket 30402 id + address
//   event_id, event_d                        - 31923 calendar event id + d tag
//   award_id, award_created_at               - untouched award (valid path)
//   award2_id, award2_created_at             - pre-fulfilled award
//   preseeded_status_id                      - issuer-signed fulfilled 37237 for award2
//   wrong_event_address                      - unknown coordinate used by presentation 3
//   presentation, presentation_id            - valid 27236 (users[0], award_id, event address)
//   presentation_fulfilled, ..._id           - valid 27236 referencing award2 (already used)
//   presentation_wrong_event, ..._id         - valid 27236 except event=wrong_event_id
//   invite_token, invite_expires_at          - invite-service smoke token (never logged)
//   phase                                    - provisioned | ready
import {
  assert,
  createRelay,
  emulatorUrl,
  entitlementAwardTags,
  getRelaySecrets,
  KIND_LISTING,
  loadKeys,
  makePool,
  nip98Header,
  nowSeconds,
  productListingTags,
  publishUntilStored,
  requireCoordinator,
  resolveCommunityBootstrap,
  signEvent,
  sleep,
  waitRelayRunning,
  writeState,
} from './relay-lib.mjs';

const keys = loadKeys();
const run = Date.now().toString(36);
const venueDisplayName = `Crays Board QA Venue ${run}`;
const domainLabel = `craysboardqa-venue-${run}`;
const accessD = `qa-event-access-${run}`;
const eventD = `qa-event-${run}`;
const holder = keys.users[0];
const holder2 = keys.users[1];
if (!holder || !holder2) throw new Error('keys.json must expose at least two fixture users');
const eventAddress = `31923:${keys.admin.pub}:${eventD}`;
const wrongEventAddress = `31923:${keys.admin.pub}:qa-wrong-event-${run}`;

await requireCoordinator();
const created = await createRelay(
  {
    name: venueDisplayName,
    description: 'Crays Board relay-backed check-in fixtures; safe to delete.',
    domain_label: domainLabel,
    admin_pubkeys: [keys.admin.pub],
    badge_d: 'members',
  },
  keys,
);
const relay = await waitRelayRunning(created.id, keys);
assert(relay.relay_url.startsWith('ws'), `venue relay running at ${relay.relay_url}`);
writeState({
  run,
  id: created.id,
  name: venueDisplayName,
  domain: relay.domain,
  relay_url: relay.relay_url,
  emulator_relay_url: emulatorUrl(relay.relay_url),
  base_url: relay.base_url,
  emulator_base_url: emulatorUrl(relay.base_url),
  admin_pubkey: keys.admin.pub,
  phase: 'provisioned',
});

const pool = makePool();

const secrets = await getRelaySecrets(created.id, keys);
const issuerSecret = secrets.badge_issuer_secret_key;
if (!/^[0-9a-f]{64}$/i.test(issuerSecret || '')) throw new Error('relay did not expose a badge issuer secret');
const issuerPubkey = signEvent({ kind: 1 }, issuerSecret).pubkey;
const community = await resolveCommunityBootstrap({
  pool,
  relayUrl: relay.relay_url,
  expectedAdmins: [keys.admin.pub],
  expectedIssuerPubkey: issuerPubkey,
});

// Invite service smoke: prove the scoped service mints a signed token before
// the scenario runs (kept for later invite scenarios, mirroring crays-rn
// state discipline — token in state, never in logs).
const inviteEndpoint = `${relay.base_url}/invites`;
const inviteBody = JSON.stringify({ expires_in_seconds: 3600, badge_expires_in_seconds: 604800, max_redemptions: 5 });
let invite;
for (let attempt = 0; attempt < 30 && !invite; attempt += 1) {
  try {
    const inviteResponse = await fetch(inviteEndpoint, {
      method: 'POST',
      headers: {
        authorization: nip98Header(inviteEndpoint, 'POST', inviteBody, keys.admin.priv),
        'content-type': 'application/json',
      },
      body: inviteBody,
    });
    if (inviteResponse.ok) invite = await inviteResponse.json();
  } catch {
    // Coordinator status can turn running just before the invite port accepts.
  }
  if (!invite) await sleep(750);
}
if (!invite) throw new Error('invite service did not mint a token before timeout');
assert(typeof invite.token === 'string' && invite.token.includes('.'), 'real invite service minted a signed token');

const publish = (event, label) => publishUntilStored(pool, relay.relay_url, event, label);

// a. Venue hospitality profile, signed by the venue admin authority.
const venueProfile = signEvent(
  {
    kind: 30078,
    tags: [
      ['d', 'nuts-community-profile'],
      ['type', 'hospitality'],
      ['name', venueDisplayName],
      ['about', 'QA venue for Crays Board relay-backed scenarios.'],
    ],
  },
  keys.admin.priv,
);
await publish(venueProfile, 'venue hospitality profile (30078/nuts-community-profile)');

// b. Single-use NIP-99 ticket listing, linked to the event coordinate and
// confirmed before the calendar event. Its price makes issuer awards valid.
const accessDefinition = signEvent(
  {
    kind: KIND_LISTING,
    tags: productListingTags({
      d: accessD,
      title: `QA Supper Club entry ${run}`,
      price: '15.00',
      productKind: 'generic',
      eventAddress,
      maxUses: 1,
    }),
  },
  keys.admin.priv,
);
await publish(accessDefinition, 'event ticket listing (30402/event_access)');
const accessAddress = `${KIND_LISTING}:${keys.admin.pub}:${accessD}`;

// c. Timed calendar event (NIP-52), signed by the venue admin authority.
const calendarEvent = signEvent(
  {
    kind: 31923,
    tags: [
      ['d', eventD],
      ['title', `QA Supper Club ${run}`],
      ['start', String(nowSeconds() + 4 * 3600)],
      ['end', String(nowSeconds() + 8 * 3600)],
    ],
  },
  keys.admin.priv,
);
await publish(calendarEvent, 'timed calendar event (31923)');

// d. Two awards of the access definition, signed by the relay's badge issuer
// secret (venue-commerce-nip §4): users[0] is the valid check-in path,
// users[1] the already-fulfilled path.
const awardExpiration = nowSeconds() + 7 * 24 * 3600;
const award = signEvent(
  {
    kind: 8,
    tags: entitlementAwardTags({
      definitionAddress: accessAddress,
      holderPubkey: holder.pub,
      topics: ['event_access'],
      expiration: awardExpiration,
    }),
  },
  issuerSecret,
);
await publish(award, 'issuer-signed access award (users[0], untouched)');

const award2 = signEvent(
  {
    kind: 8,
    tags: entitlementAwardTags({
      definitionAddress: accessAddress,
      holderPubkey: holder2.pub,
      topics: ['event_access'],
      expiration: awardExpiration,
    }),
  },
  issuerSecret,
);
await publish(award2, 'issuer-signed access award (users[1], to be pre-fulfilled)');

// e. Pre-seeded check-in truth: one delegated-issuer-signed fulfilled
// event-context status for award2, so its presentation must read "Already
// checked in" with no new write. Using a different authorized signer from the
// app's active admin keeps both awards' same-event addressable slots present.
const preseededStatus = signEvent(
  {
    kind: 37237,
    tags: [
      ['status', 'fulfilled'],
      ['a', accessAddress],
      ['e', award2.id],
      ['p', holder2.pub],
      ['event', eventAddress],
      ['d', `event:${eventAddress}`],
    ],
  },
  issuerSecret,
);
await publish(preseededStatus, 'pre-seeded fulfilled status (37237/event for award2)');

// f. Three holder-signed kind 27236 presentations using the NIP-97 context
// grammar mirrored by crays-rn. They are never published or logged.
// Board validates these; they are kept in scenario state for the Agent Device flow
// and never published to the relay or logged.
const presentationCreatedAt = nowSeconds() + 240;
// Use the same clock for every presentation. The previous extra +120 seconds
// put the third fixture 360 seconds in the future, beyond the app's 300-second
// clock-skew allowance whenever a healthy flow reached it quickly. That made
// the "wrong event" assertion observe "not valid yet" instead.
const wrongEventPresentationCreatedAt = presentationCreatedAt;
const presentationTags = (awardId, eventCoordinate, nonce, createdAt) => [
  ['type', 'nuts_entitlement_presentation'],
  ['nonce', nonce],
  ['e', awardId],
  ['a', accessAddress],
  ['r', emulatorUrl(relay.relay_url)],
  ['event', eventCoordinate],
  ['expiration', String(createdAt + 90)],
];
const presentation = signEvent(
  {
    kind: 27236,
    created_at: presentationCreatedAt,
    tags: presentationTags(award.id, eventAddress, `qa-valid-${run}`, presentationCreatedAt),
  },
  holder.priv,
);
const presentationFulfilled = signEvent(
  {
    kind: 27236,
    created_at: presentationCreatedAt,
    tags: presentationTags(award2.id, eventAddress, `qa-used-${run}`, presentationCreatedAt),
  },
  holder2.priv,
);
const presentationWrongEvent = signEvent(
  {
    kind: 27236,
    created_at: wrongEventPresentationCreatedAt,
    tags: presentationTags(award.id, wrongEventAddress, `qa-wrong-${run}`, wrongEventPresentationCreatedAt),
  },
  holder.priv,
);

const stored = await pool.querySync([relay.relay_url], { kinds: [8, 30009, 30402, 31727, 30078, 31923, 37237], limit: 50 });
assert(stored.length >= 8, `independent relay query sees the NIP-97 venue fixture family (${stored.length} events)`);
pool.close([relay.relay_url]);

writeState({
  run,
  id: created.id,
  name: venueDisplayName,
  domain: relay.domain,
  relay_url: relay.relay_url,
  emulator_relay_url: emulatorUrl(relay.relay_url),
  base_url: relay.base_url,
  emulator_base_url: emulatorUrl(relay.base_url),
  admin_pubkey: keys.admin.pub,
  issuer_pubkey: issuerPubkey,
  community_root_pubkey: community.rootPubkey,
  community_anchor_id: community.anchor.id,
  required_badge_address: community.requiredBadgeAddress,
  user_pubkey: holder.pub,
  user2_pubkey: holder2.pub,
  venue_profile_id: venueProfile.id,
  product_definition_id: accessDefinition.id,
  product_address: accessAddress,
  event_id: calendarEvent.id,
  event_d: eventD,
  event_address: eventAddress,
  award_id: award.id,
  award_created_at: award.created_at,
  award2_id: award2.id,
  award2_created_at: award2.created_at,
  preseeded_status_id: preseededStatus.id,
  wrong_event_address: wrongEventAddress,
  presentation,
  presentation_id: presentation.id,
  presentation_fulfilled: presentationFulfilled,
  presentation_fulfilled_id: presentationFulfilled.id,
  presentation_wrong_event: presentationWrongEvent,
  presentation_wrong_event_id: presentationWrongEvent.id,
  invite_token: invite.token,
  invite_expires_at: invite.expires_at,
  phase: 'ready',
});
console.log('CRAYS BOARD RELAY BOOTSTRAP PASS');
