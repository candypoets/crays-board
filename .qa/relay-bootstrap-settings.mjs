#!/usr/bin/env node
/**
 * Settings scenario bootstrap (docs/screens/settings.md).
 *
 * Fixtures, each signed by its proper authority and round-tripped until
 * queryable:
 *  a. venue hospitality profile 30078 / d=nuts-community-profile (admin);
 *  b. sellable product 30009 / d=qa-item-<run> (admin) + issuer-signed award
 *     (kept from the shared orders fixture family so relay-verify.mjs and the
 *     scenario runner env keep working);
 *  c. monthly membership 30009 / d=qa-membership-<run>, type=membership,
 *     t=membership, t=sellable, period=monthly, availability=available (admin);
 *  d. room manifest 30078 / d=life.crays/room/v1/qa-room-<run> with
 *     schema=life.crays/room/v1, operator=admin, capabilities, open=open, a
 *     future expiration, and award_issuer=<badge issuer> (admin).
 *
 * State file fields (in addition to the shared orders family):
 *  - membership_definition_id / membership_d / membership_address
 *  - room_manifest_id / room_manifest_d
 *  - venue_profile_id / venue_profile_created_at — the CURRENT venue profile
 *    event. strfry retains only the latest addressable event per
 *    (pubkey, kind, d), so when the app republishes the profile the seeded
 *    event is evicted. relay-verify.mjs (shared, read-only) asserts the
 *    profile by state.venue_profile_id, so this bootstrap leaves a detached
 *    watcher (--watch-profile) that rewrites venue_profile_id to the live
 *    event id as soon as the app's republish lands (provenance is kept in
 *    venue_profile_seeded_id). No secrets are involved; the watcher exits on
 *    teardown (state file removed) or after 15 minutes.
 */
import { spawn } from 'node:child_process';
import {
  assert,
  createRelay,
  emulatorUrl,
  getRelaySecrets,
  loadKeys,
  makePool,
  nip98Header,
  nowSeconds,
  publishUntilStored,
  requireCoordinator,
  signEvent,
  sleep,
  waitRelayRunning,
  writeState,
  readState,
} from './relay-lib.mjs';

if (process.argv.includes('--watch-profile')) {
  await watchProfile();
  process.exit(0);
}

const keys = loadKeys();
const run = Date.now().toString(36);
const venueDisplayName = `Crays Board QA Venue ${run}`;
const domainLabel = `craysboardqa-venue-${run}`;
const itemD = `qa-item-${run}`;
const membershipD = `qa-membership-${run}`;
const roomD = `life.crays/room/v1/qa-room-${run}`;
const holder = keys.users[0];
if (!holder) throw new Error('keys.json exposes no fixture users');

await requireCoordinator();
const created = await createRelay(
  {
    name: venueDisplayName,
    description: 'Crays Board relay-backed settings fixtures; safe to delete.',
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

// Invite service smoke, mirroring the shared bootstrap discipline (token in
// state, never in logs).
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

// b. Sellable single-use product definition + issuer-signed award (shared
// orders fixture family; untouched by the settings flow).
const product = signEvent(
  {
    kind: 30009,
    tags: [
      ['d', itemD],
      ['type', 'food'],
      ['t', 'food'],
      ['t', 'sellable'],
      ['name', `QA Miso aubergine ${run}`],
      ['price', '9.50'],
      ['currency', 'EUR'],
      ['max_uses', '1'],
      ['availability', 'available'],
    ],
  },
  keys.admin.priv,
);
await publish(product, 'sellable product definition (30009)');
const productAddress = `30009:${keys.admin.pub}:${itemD}`;

const secrets = await getRelaySecrets(created.id, keys);
const issuerSecret = secrets.badge_issuer_secret_key;
if (!/^[0-9a-f]{64}$/i.test(issuerSecret || '')) throw new Error('relay did not expose a badge issuer secret');
const issuerPubkey = signEvent({ kind: 1 }, issuerSecret).pubkey;
const award = signEvent(
  { kind: 8, tags: [['a', productAddress], ['p', holder.pub]] },
  issuerSecret,
);
await publish(award, 'issuer-signed product award (implicit pending order)');

// c. Monthly sellable membership definition, signed by the venue admin
// authority (venue-commerce-nip §3.4).
const membership = signEvent(
  {
    kind: 30009,
    tags: [
      ['d', membershipD],
      ['type', 'membership'],
      ['t', 'membership'],
      ['t', 'sellable'],
      ['name', `QA Supporter ${run}`],
      ['description', 'Monthly support for the QA venue.'],
      ['price', '12.00'],
      ['currency', 'EUR'],
      ['period', 'monthly'],
      ['availability', 'available'],
    ],
  },
  keys.admin.priv,
);
await publish(membership, 'monthly membership definition (30009)');
const membershipAddress = `30009:${keys.admin.pub}:${membershipD}`;

// d. Signed room manifest per the versioned life.crays/room/v1 contract,
// signed by the venue admin authority (operator === signer).
const roomManifest = signEvent(
  {
    kind: 30078,
    tags: [
      ['d', roomD],
      ['schema', 'life.crays/room/v1'],
      ['name', `QA Room ${run}`],
      ['relay', relay.relay_url],
      ['operator', keys.admin.pub],
      ['capability', 'menu'],
      ['capability', 'events'],
      ['open', 'open'],
      ['expiration', String(nowSeconds() + 86_400)],
      ['award_issuer', issuerPubkey],
    ],
  },
  keys.admin.priv,
);
await publish(roomManifest, 'signed room manifest (30078/life.crays/room/v1)');

const stored = await pool.querySync([relay.relay_url], { kinds: [8, 30009, 30078], limit: 50 });
assert(stored.length >= 5, `independent relay query sees the venue fixture family (${stored.length} events)`);
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
  user_pubkey: holder.pub,
  venue_profile_id: venueProfile.id,
  venue_profile_created_at: venueProfile.created_at,
  product_definition_id: product.id,
  product_address: productAddress,
  award_id: award.id,
  award_created_at: award.created_at,
  membership_definition_id: membership.id,
  membership_d: membershipD,
  membership_address: membershipAddress,
  room_manifest_id: roomManifest.id,
  room_manifest_d: roomD,
  invite_token: invite.token,
  invite_expires_at: invite.expires_at,
  phase: 'ready',
});

// See the file header: keep state.venue_profile_id truthful across the app's
// addressable republish so the shared relay-verify.mjs can find it.
const watcher = spawn(process.execPath, [new URL(import.meta.url).pathname, '--watch-profile'], {
  detached: true,
  stdio: 'ignore',
  env: process.env,
});
watcher.unref();

console.log('CRAYS BOARD RELAY BOOTSTRAP PASS');

/**
 * Polls the venue relay until the app republishes the venue profile (a newer
 * 30078 at d=nuts-community-profile replaces the seeded event), then rewrites
 * state.venue_profile_id to the live event id. Exits quietly when the state
 * file disappears (teardown) or after 15 minutes.
 */
async function watchProfile() {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const state = readState();
    if (!state?.relay_url) return; // teardown ran
    const seededId = state.venue_profile_seeded_id ?? state.venue_profile_id;
    try {
      const pool = makePool();
      const events = await pool.querySync([state.relay_url], { kinds: [30078], '#d': ['nuts-community-profile'] });
      pool.close([state.relay_url]);
      const live = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (live && live.id !== seededId && live.created_at > state.venue_profile_created_at) {
        writeState({
          ...state,
          venue_profile_seeded_id: seededId,
          venue_profile_id: live.id,
          venue_profile_republished_at: live.created_at,
        });
        return;
      }
    } catch {
      // Relay momentarily unreachable; keep polling until the deadline.
    }
    await sleep(2_000);
  }
}
