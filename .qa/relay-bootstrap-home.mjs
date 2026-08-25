#!/usr/bin/env node
// Home scenario fixtures (.qa/qa-home.mjs bootstrap). Provisions an isolated
// venue relay and seeds an ESTABLISHED venue so Home projects a non-trivial
// attention summary and the new-venue checklist stays absent (HOME-01/02).
//
// State file fields (public-safe; never private keys):
//   run, id, name, domain, relay_url, emulator_relay_url, base_url,
//   emulator_base_url, admin_pubkey, issuer_pubkey        — venue identity
//   user_pubkey                                           — order holder users[0]
//   venue_profile_id                                      — 30078 profile (admin)
//   product_definition_id, product_address                — available product
//   unavailable_definition_id, unavailable_address        — unavailable product
//   award_id, award_created_at                            — first pending order
//   pending_award_ids                                     — both pending awards
//   accepted_award_id, accepted_status_id                 — accepted order + status
//   event_id, event_d, event_start, event_end             — tonight's 31923
//   membership_address, membership_award_id, member_pubkey,
//   member_expiration                                     — member expiring in 10d
//   invite_token, invite_expires_at                       — service smoke token
//   phase                                                 — provisioned | ready
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
const itemD = `qa-item-${run}`;
const unavailableD = `qa-item-unavailable-${run}`;
const membershipD = `qa-membership-${run}`;
const eventD = `qa-event-${run}`;
const [holderA, holderB, holderC, memberHolder] = keys.users;
if (!holderA || !holderB || !holderC || !memberHolder) {
  throw new Error('keys.json must expose at least four fixture users');
}

await requireCoordinator();
const created = await createRelay(
  {
    name: venueDisplayName,
    description: 'Crays Board relay-backed home fixtures; safe to delete.',
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
// the scenario runs (token stored for later invite scenarios, never logged).
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

// a. Venue hospitality profile, signed by the venue admin authority. Home
// renders this name and the verifier matches it against the marker.
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

// b. Sellable NIP-99 product listing, signed by an anchor admin.
const product = signEvent(
  {
    kind: KIND_LISTING,
    tags: productListingTags({ d: itemD, title: `QA Miso aubergine ${run}`, price: '9.50' }),
  },
  keys.admin.priv,
);
await publish(product, 'sellable product listing (30402)');
const productAddress = `${KIND_LISTING}:${keys.admin.pub}:${itemD}`;

// c. One unavailable menu item (HOME-01 menu attention count). Never awarded,
// so it cannot create an order.
const unavailableProduct = signEvent(
  {
    kind: KIND_LISTING,
    tags: productListingTags({
      d: unavailableD,
      title: `QA John Dory ${run}`,
      price: '24.00',
      availability: 'unavailable',
    }),
  },
  keys.admin.priv,
);
await publish(unavailableProduct, 'unavailable product listing (30402)');
const unavailableAddress = `${KIND_LISTING}:${keys.admin.pub}:${unavailableD}`;

// d. Sellable membership definition + one membership award expiring in 10
// days (HOME-01 member counts: 1 active, 1 expiring soon).
const membership = signEvent(
  {
    kind: 30009,
    tags: [
      ['d', membershipD],
      ['t', 'membership'],
      ['name', `QA Membership ${run}`],
      ['price', '120.00', 'EUR', 'year'],
      ['availability', 'available'],
    ],
  },
  keys.admin.priv,
);
await publish(membership, 'membership definition (30009)');
const membershipAddress = `30009:${keys.admin.pub}:${membershipD}`;

const memberExpiration = nowSeconds() + 10 * 86400;
const membershipAward = signEvent(
  {
    kind: 8,
    tags: entitlementAwardTags({
      definitionAddress: membershipAddress,
      holderPubkey: memberHolder.pub,
      topics: ['membership'],
      expiration: memberExpiration,
    }),
  },
  issuerSecret,
);
await publish(membershipAward, 'issuer-signed membership award (expiring in 10 days)');

// e. Three implicit-pending orders: single-use awards of the available
// product to three fixture users, signed by the badge issuer (§4/§5).
const orderHolders = [holderA, holderB, holderC];
const awards = [];
for (const [index, holder] of orderHolders.entries()) {
  const award = signEvent(
    { kind: 8, tags: entitlementAwardTags({ definitionAddress: productAddress, holderPubkey: holder.pub }) },
    issuerSecret,
  );
  await publish(award, `issuer-signed product award ${index + 1}/3`);
  awards.push({ award, holder });
}
const [firstPending, secondPending, acceptedOrder] = awards;

// f. One accepted status on the third order, signed by the staff/admin
// authority (§5: pending → accepted at an order context). One deliberate action =
// exactly one status event.
const acceptedStatus = signEvent(
  {
    kind: 37237,
    created_at: Math.max(nowSeconds(), acceptedOrder.award.created_at + 1),
    tags: [
      ['status', 'accepted'],
      ['a', productAddress],
      ['e', acceptedOrder.award.id],
      ['p', acceptedOrder.holder.pub],
      ['order', acceptedOrder.award.id],
      ['d', `order:${acceptedOrder.award.id}`],
    ],
  },
  keys.admin.priv,
);
await publish(acceptedStatus, 'accepted order status (37237)');

// g. Tonight's upcoming event (NIP-52), signed by the venue admin authority.
const eventStart = nowSeconds() + 3 * 3600;
const eventEnd = eventStart + 2 * 3600;
const calendarEvent = signEvent(
  {
    kind: 31923,
    tags: [
      ['d', eventD],
      ['title', `QA Supper ${run}`],
      ['start', String(eventStart)],
      ['end', String(eventEnd)],
    ],
  },
  keys.admin.priv,
);
await publish(calendarEvent, 'upcoming calendar event (31923)');

const stored = await pool.querySync([relay.relay_url], { kinds: [5, 8, 30009, 30402, 31727, 30078, 31923, 37237], limit: 100 });
assert(stored.length >= 12, `independent relay query sees the NIP-97 home fixture family (${stored.length} events)`);
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
  user_pubkey: holderA.pub,
  venue_profile_id: venueProfile.id,
  product_definition_id: product.id,
  product_address: productAddress,
  unavailable_definition_id: unavailableProduct.id,
  unavailable_address: unavailableAddress,
  award_id: firstPending.award.id,
  award_created_at: firstPending.award.created_at,
  pending_award_ids: [firstPending.award.id, secondPending.award.id],
  accepted_award_id: acceptedOrder.award.id,
  accepted_status_id: acceptedStatus.id,
  event_id: calendarEvent.id,
  event_d: eventD,
  event_start: eventStart,
  event_end: eventEnd,
  membership_address: membershipAddress,
  membership_award_id: membershipAward.id,
  member_pubkey: memberHolder.pub,
  member_expiration: memberExpiration,
  invite_token: invite.token,
  invite_expires_at: invite.expires_at,
  phase: 'ready',
});
console.log('CRAYS BOARD RELAY BOOTSTRAP HOME PASS');
