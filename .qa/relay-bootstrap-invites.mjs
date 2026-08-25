#!/usr/bin/env node
// Invites scenario bootstrap. Provisions an isolated venue relay and seeds the
// shared venue fixture family (identical to .qa/relay-bootstrap.mjs, which is
// shared swarm infrastructure and must not be edited): the harness-wide
// relay-verify.mjs and relay-screen-scenario.mjs require these fixtures and
// state fields for every relay scenario.
//
// State file fields (CRAYS_BOARD_QA_STATE, default /tmp/qa-crays-board-invites.json):
//   run, id, name, domain          — coordinator relay identity (craysboardqa- prefix)
//   relay_url / emulator_relay_url — venue relay ws URL (host + 10.0.2.2 variants)
//   base_url / emulator_base_url   — invite service http URL (host + 10.0.2.2 variants)
//   admin_pubkey                   — venue authority (staff persona, NIP-98 signer)
//   issuer_pubkey                  — badge issuer pubkey (derived from relay secret)
//   user_pubkey                    — fixture order holder (keys.json users[0])
//   venue_profile_id               — 30078 nuts-community-profile event id (admin)
//   product_definition_id          — 30402 sellable product event id (admin)
//   product_address                — 30402:<admin>:qa-item-<run>
//   award_id / award_created_at    — issuer-signed kind 8 (implicit pending order)
//   invite_token / invite_expires_at — invite-service smoke token (kept for
//                                    later invite scenarios, never logged)
//   phase                          — provisioned → ready
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
const holder = keys.users[0];
if (!holder) throw new Error('keys.json exposes no fixture users');

await requireCoordinator();
const created = await createRelay(
  {
    name: venueDisplayName,
    description: 'Crays Board relay-backed invites fixtures; safe to delete.',
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
// the scenario runs. The token is stored for later invite scenarios, mirroring
// crays-rn state discipline (token in state, never in logs).
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

// b. NIP-97/NIP-99 sellable product listing, signed by an anchor admin.
const product = signEvent(
  {
    kind: KIND_LISTING,
    tags: productListingTags({ d: itemD, title: `QA Miso aubergine ${run}`, price: '9.50' }),
  },
  keys.admin.priv,
);
await publish(product, 'sellable product listing (30402)');
const productAddress = `${KIND_LISTING}:${keys.admin.pub}:${itemD}`;

// c. Implicit-pending order: a single-use award of the product to the fixture
// user, signed by the venue badge issuer secret (venue-commerce-nip §4/§5).
const award = signEvent(
  { kind: 8, tags: entitlementAwardTags({ definitionAddress: productAddress, holderPubkey: holder.pub }) },
  issuerSecret,
);
await publish(award, 'issuer-signed product award (implicit pending order)');

const stored = await pool.querySync([relay.relay_url], { kinds: [8, 30009, 30402, 31727, 30078], limit: 50 });
assert(stored.length >= 5, `independent relay query sees the NIP-97 venue fixture family (${stored.length} events)`);
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
  venue_profile_id: venueProfile.id,
  product_definition_id: product.id,
  product_address: productAddress,
  award_id: award.id,
  award_created_at: award.created_at,
  invite_token: invite.token,
  invite_expires_at: invite.expires_at,
  phase: 'ready',
});
console.log('CRAYS BOARD RELAY BOOTSTRAP PASS');
