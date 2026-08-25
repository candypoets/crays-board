#!/usr/bin/env node
/**
 * Menu scenario fixtures (.qa/qa-menu.mjs, docs/screens/menu.md).
 *
 * Provisions the same base fixture family as relay-bootstrap.mjs (venue
 * profile, one sellable product, one issuer-signed award — required by the
 * shared .qa/relay-verify.mjs) and adds three kind 30402 menu listings
 * with deterministic `d` values (the relay is fresh per run, so no
 * collisions):
 *
 *   qa-menu-soup      food,  "QA Tomato soup",      6.50 EUR, Mains/1,  available — admin-signed; EDITED by the flow
 *   qa-menu-espresso  drink, "QA Espresso",         3.00 EUR, Drinks/1, available — admin-signed; TOGGLED by the flow
 *   qa-menu-foreign   drink, "QA Foreign lemonade", 4.20 EUR, Drinks/2, available — signed by a SECOND anchor
 *                     admin: visible but non-editable for the active admin persona (MENU-05)
 *
 * State file (/tmp/qa-crays-board-menu.json) fields beyond the base set:
 *   menu_toggle_d / menu_toggle_address          d + 30402 address of the toggled item
 *   menu_edit_d / menu_edit_address              d + address of the edited item
 *   menu_edit_original_name / menu_edit_expected_name
 *   menu_foreign_d / menu_foreign_address        d + address of the foreign-publisher item
 *   menu_foreign_pubkey                          second anchor admin that signed the foreign item
 *   menu_item_ids                                { d: event id } for every seeded menu definition
 */
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
const foreignAdmin = keys.users[1];
if (!holder || !foreignAdmin) throw new Error('keys.json must expose at least two fixture users');

// Deterministic menu fixtures (see header).
const TOGGLE_D = 'qa-menu-espresso';
const EDIT_D = 'qa-menu-soup';
const FOREIGN_D = 'qa-menu-foreign';
const EDIT_ORIGINAL_NAME = 'QA Tomato soup';
const EDIT_EXPECTED_NAME = 'QA Roasted tomato soup';

await requireCoordinator();
const created = await createRelay(
  {
    name: venueDisplayName,
    description: 'Crays Board relay-backed menu fixtures; safe to delete.',
    domain_label: domainLabel,
    admin_pubkeys: [keys.admin.pub, foreignAdmin.pub],
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
  expectedAdmins: [keys.admin.pub, foreignAdmin.pub],
  expectedIssuerPubkey: issuerPubkey,
});

// Invite service smoke: prove the scoped service mints a signed token before
// the scenario runs (mirrors relay-bootstrap.mjs; token in state, never logs).
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

// b. Base sellable single-use product + award (required by the shared
// .qa/relay-verify.mjs; also exercises the unsectioned menu group).
const product = signEvent(
  {
    kind: KIND_LISTING,
    tags: productListingTags({ d: itemD, title: `QA Miso aubergine ${run}`, price: '9.50' }),
  },
  keys.admin.priv,
);
await publish(product, 'sellable product listing (30402)');
const productAddress = `${KIND_LISTING}:${keys.admin.pub}:${itemD}`;

// c. Implicit-pending order award, signed by the venue badge issuer secret.
const award = signEvent(
  { kind: 8, tags: entitlementAwardTags({ definitionAddress: productAddress, holderPubkey: holder.pub }) },
  issuerSecret,
);
await publish(award, 'issuer-signed product award (implicit pending order)');

// d. Menu fixtures per the header: two admin-signed sections (Mains, Drinks)
// plus one definition signed by a second anchor admin — a different trusted
// author, visible but non-editable for the active admin persona.
const productTags = ({ d, type, name, price, section, position }) => [
  ...productListingTags({ d, title: name, price, productKind: type, section, position }),
];

const soup = signEvent(
  { kind: KIND_LISTING, tags: productTags({ d: EDIT_D, type: 'food', name: EDIT_ORIGINAL_NAME, price: '6.50', section: 'Mains', position: 1 }) },
  keys.admin.priv,
);
await publish(soup, 'menu definition qa-menu-soup (Mains, admin)');

const espresso = signEvent(
  { kind: KIND_LISTING, tags: productTags({ d: TOGGLE_D, type: 'drink', name: 'QA Espresso', price: '3.00', section: 'Drinks', position: 1 }) },
  keys.admin.priv,
);
await publish(espresso, 'menu definition qa-menu-espresso (Drinks, admin)');

const foreign = signEvent(
  { kind: KIND_LISTING, tags: productTags({ d: FOREIGN_D, type: 'drink', name: 'QA Foreign lemonade', price: '4.20', section: 'Drinks', position: 2 }) },
  foreignAdmin.priv,
);
await publish(foreign, 'menu listing qa-menu-foreign (Drinks, second anchor admin)');

const stored = await pool.querySync([relay.relay_url], { kinds: [8, 30009, 30402, 31727, 30078], limit: 50 });
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
  venue_profile_id: venueProfile.id,
  product_definition_id: product.id,
  product_address: productAddress,
  award_id: award.id,
  award_created_at: award.created_at,
  invite_token: invite.token,
  invite_expires_at: invite.expires_at,
  menu_toggle_d: TOGGLE_D,
  menu_toggle_address: `${KIND_LISTING}:${keys.admin.pub}:${TOGGLE_D}`,
  menu_edit_d: EDIT_D,
  menu_edit_address: `${KIND_LISTING}:${keys.admin.pub}:${EDIT_D}`,
  menu_edit_original_name: EDIT_ORIGINAL_NAME,
  menu_edit_expected_name: EDIT_EXPECTED_NAME,
  menu_foreign_d: FOREIGN_D,
  menu_foreign_address: `${KIND_LISTING}:${foreignAdmin.pub}:${FOREIGN_D}`,
  menu_foreign_pubkey: foreignAdmin.pub,
  menu_item_ids: { [EDIT_D]: soup.id, [TOGGLE_D]: espresso.id, [FOREIGN_D]: foreign.id },
  phase: 'ready',
});
console.log('CRAYS BOARD RELAY BOOTSTRAP PASS');
