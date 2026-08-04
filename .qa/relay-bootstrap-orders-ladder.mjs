#!/usr/bin/env node
// Orders full-ladder bootstrap (venue-commerce-nip §5/§6): one sellable
// product and THREE issuer-signed implicit-pending awards against it —
// advance (driven accepted→processing→ready→fulfilled), decline (cancelled
// from pending), cancel (accepted then cancelled from the confirmation
// dialog). Award created_at values are spaced one second apart so the active
// queue sort (oldest-first) is deterministic: advance, decline, cancel.
//
// State file fields (CRAYS_BOARD_QA_STATE, default
// /tmp/qa-crays-board-orders-ladder.json): run, id, name, domain, relay_url,
// emulator_relay_url, base_url, emulator_base_url, admin_pubkey,
// issuer_pubkey, user_pubkey, venue_profile_id, product_definition_id,
// product_address, award_id + award_created_at (the advance award),
// decline_award_id + decline_award_created_at, cancel_award_id +
// cancel_award_created_at, invite_token, invite_expires_at, phase.
// Public keys, event ids, and resource identifiers only — never secrets.
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
    description: 'Crays Board relay-backed orders ladder fixtures; safe to delete.',
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

// Invite service smoke: prove the scoped service mints a signed token before
// the scenario runs (kept for later invite scenarios, never logged).
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

// b. Sellable single-use product definition per venue-commerce-nip §3.1/§3.2,
// signed by the venue admin authority. All three ladder awards reference it.
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

// c. Three implicit-pending orders: single-use awards of the product to the
// fixture user, signed by the venue badge issuer secret (§4/§5). created_at
// is spaced one second apart so the queue order is deterministic.
const secrets = await getRelaySecrets(created.id, keys);
const issuerSecret = secrets.badge_issuer_secret_key;
if (!/^[0-9a-f]{64}$/i.test(issuerSecret || '')) throw new Error('relay did not expose a badge issuer secret');
const issuerPubkey = signEvent({ kind: 1 }, issuerSecret).pubkey;
const baseTime = nowSeconds();
const mintAward = (offset, label) =>
  publish(
    signEvent(
      { kind: 8, created_at: baseTime + offset, tags: [['a', productAddress], ['p', holder.pub]] },
      issuerSecret,
    ),
    label,
  );
const advanceAward = await mintAward(0, 'issuer-signed advance-full award (implicit pending order)');
const declineAward = await mintAward(1, 'issuer-signed decline award (implicit pending order)');
const cancelAward = await mintAward(2, 'issuer-signed cancel award (implicit pending order)');

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
  product_definition_id: product.id,
  product_address: productAddress,
  award_id: advanceAward.id,
  award_created_at: advanceAward.created_at,
  decline_award_id: declineAward.id,
  decline_award_created_at: declineAward.created_at,
  cancel_award_id: cancelAward.id,
  cancel_award_created_at: cancelAward.created_at,
  invite_token: invite.token,
  invite_expires_at: invite.expires_at,
  phase: 'ready',
});
console.log('CRAYS BOARD RELAY BOOTSTRAP PASS');
