#!/usr/bin/env node
// People & roles fixtures (docs/screens/people.md). Extends the standard
// venue fixture family (profile/product/product-award, required by the shared
// .qa/relay-verify.mjs) with the people surface fixtures per PRD §8.7 and
// venue-commerce-nip §3.6/§4, each signed by its proper authority and
// round-tripped until queryable:
//   - role definition 30009 d=qa-role-<run> (type=role, t=role, permissions
//     events+invites) — admin-signed;
//   - membership definition 30009 d=qa-membership-<run> — admin-signed;
//   - active membership award (kind 8, no expiration) to users[0] —
//     badge-issuer-signed;
//   - membership award expiring in 10 days to users[1] — badge-issuer-signed;
//   - membership award to users[2] plus an admin-signed kind 5 revoking it —
//     the deterministic Expired fixture (an already-past NIP-40 expiration
//     would be dropped by the relay on write, so expiry is expressed through
//     revocation; both grant nothing and leave the person Expired);
//   - non-sellable gate badge 30009 d=members (type=badge) + kind 8 grants to
//     users[0..2] — the relay write gate requires this badge for non-admin
//     writes; the people projection ignores type=badge definitions;
//   - kind 0 profiles for the admin and users[0..2], each self-signed.
//
// State file (public-safe; never any secret): standard orders fields (run,
// id, name, domain, relay_url, emulator_relay_url, base_url,
// emulator_base_url, admin_pubkey, issuer_pubkey, user_pubkey = users[0],
// venue_profile_id, product_definition_id, product_address, award_id,
// award_created_at, invite_token, invite_expires_at) plus:
//   role_d, role_definition_id, role_address      — seeded role, edit target
//   membership_definition_id, membership_address  — membership def
//   active_award_id, active_award_created_at      — users[0]'s award (revoke target)
//   expiring_award_id                             — users[1]'s award (≤30d)
//   expired_award_id, expired_revocation_id       — users[2]'s revoked award
//   active_user_pubkey, expiring_user_pubkey, expired_user_pubkey
//   role_permissions                              — seeded permission set
//   phase                                         — lifecycle marker
import {
  assert,
  createRelay,
  emulatorUrl,
  getRelaySecrets,
  loadKeys,
  makePool,
  nip98Header,
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
const roleD = `qa-role-${run}`;
const membershipD = `qa-membership-${run}`;
const ROLE_PERMISSIONS = ['events', 'invites'];
const nowSeconds = () => Math.floor(Date.now() / 1000);
if (!Array.isArray(keys.users) || keys.users.length < 3) {
  throw new Error('keys.json exposes fewer than three fixture users');
}
const [activeUser, expiringUser, expiredUser] = keys.users;

await requireCoordinator();
const created = await createRelay(
  {
    name: venueDisplayName,
    description: 'Crays Board relay-backed people/roles fixtures; safe to delete.',
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

// Invite service smoke (kept from the standard bootstrap; token stored, never logged).
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

// b. Sellable single-use product definition (standard orders fixture).
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

// c. Implicit-pending order award for the standard relay verify.
const award = signEvent(
  { kind: 8, tags: [['a', productAddress], ['p', activeUser.pub]] },
  issuerSecret,
);
await publish(award, 'issuer-signed product award (implicit pending order)');

// d. Role definition per venue-commerce-nip §3.6, signed by the admin.
const roleDefinition = signEvent(
  {
    kind: 30009,
    tags: [
      ['d', roleD],
      ['type', 'role'],
      ['t', 'role'],
      ['name', 'QA Events host'],
      ['description', 'Welcomes guests, manages events, and handles entry.'],
      ...ROLE_PERMISSIONS.map((permission) => ['permission', permission]),
    ],
  },
  keys.admin.priv,
);
await publish(roleDefinition, 'role definition (30009, events+invites)');
const roleAddress = `30009:${keys.admin.pub}:${roleD}`;

// e. Membership definition per §3.4, signed by the admin.
const membershipDefinition = signEvent(
  {
    kind: 30009,
    tags: [
      ['d', membershipD],
      ['type', 'membership'],
      ['t', 'membership'],
      ['t', 'sellable'],
      ['name', 'QA Membership'],
      ['period', 'monthly'],
      ['price', '25.00'],
      ['currency', 'EUR'],
      ['availability', 'available'],
    ],
  },
  keys.admin.priv,
);
await publish(membershipDefinition, 'membership definition (30009)');
const membershipAddress = `30009:${keys.admin.pub}:${membershipD}`;

// f. The three membership awards, signed by the venue badge issuer (§4 trust).
const activeAward = signEvent(
  { kind: 8, tags: [['a', membershipAddress], ['p', activeUser.pub]] },
  issuerSecret,
);
await publish(activeAward, 'active membership award (users[0])');

const expiringAward = signEvent(
  {
    kind: 8,
    tags: [
      ['a', membershipAddress],
      ['p', expiringUser.pub],
      ['expiration', String(nowSeconds() + 10 * 24 * 60 * 60)],
    ],
  },
  issuerSecret,
);
await publish(expiringAward, 'expiring membership award (users[1], 10 days)');

const expiredAward = signEvent(
  { kind: 8, tags: [['a', membershipAddress], ['p', expiredUser.pub]] },
  issuerSecret,
);
await publish(expiredAward, 'membership award to be revoked (users[2])');

// g. The seeded revocation that makes users[2] deterministically Expired,
// signed by the venue admin authority (§4: revocation = kind 5 referencing
// the award id from an authorized signer).
const expiredRevocation = signEvent(
  {
    kind: 5,
    tags: [
      ['e', expiredAward.id],
      ['k', '8'],
    ],
  },
  keys.admin.priv,
);
await publish(expiredRevocation, 'seeded membership revocation (users[2])');

// g2. Gate badge grants (same pattern as relay-bootstrap-events.mjs): the
// relay's write gate accepts non-admin writes only from current holders of
// the required badge 30009:<issuer>:<badge_d> (badge_d=members at creation).
// The membership awards above reference the admin-signed membership product,
// which is NOT the gate badge, so without these grants every member-signed
// kind 0 profile is rejected ("required badge missing"). The definition is
// non-sellable type=badge, so the people projection (role/membership only)
// ignores it.
const membersBadgeAddress = `30009:${issuerPubkey}:members`;
const membersBadge = signEvent(
  {
    kind: 30009,
    tags: [
      ['d', 'members'],
      ['type', 'badge'],
      ['t', 'badge'],
      ['name', `QA members badge ${run}`],
    ],
  },
  issuerSecret,
);
await publish(membersBadge, 'non-sellable members badge definition (30009)');
for (const [index, user] of [activeUser, expiringUser, expiredUser].entries()) {
  const grant = signEvent({ kind: 8, tags: [['a', membersBadgeAddress], ['p', user.pub]] }, issuerSecret);
  await publish(grant, `gate badge grant for users[${index}]`);
}

// h. Venue-local kind 0 profiles (PRD §8.7: profiles read from the venue relay),
// each self-signed by its own key.
const profiles = [
  [keys.admin, 'QA Venue Admin'],
  [activeUser, 'QA Active Member'],
  [expiringUser, 'QA Expiring Member'],
  [expiredUser, 'QA Expired Member'],
];
for (const [key, displayName] of profiles) {
  await publish(
    signEvent({ kind: 0, content: JSON.stringify({ name: displayName, display_name: displayName }) }, key.priv),
    `kind 0 profile (${displayName})`,
  );
}

const stored = await pool.querySync([relay.relay_url], { kinds: [0, 5, 8, 30009, 30078], limit: 100 });
assert(stored.length >= 16, `independent relay query sees the people fixture family (${stored.length} events)`);
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
  user_pubkey: activeUser.pub,
  venue_profile_id: venueProfile.id,
  product_definition_id: product.id,
  product_address: productAddress,
  award_id: award.id,
  award_created_at: award.created_at,
  role_d: roleD,
  role_definition_id: roleDefinition.id,
  role_address: roleAddress,
  role_permissions: ROLE_PERMISSIONS,
  membership_definition_id: membershipDefinition.id,
  membership_address: membershipAddress,
  active_award_id: activeAward.id,
  active_award_created_at: activeAward.created_at,
  expiring_award_id: expiringAward.id,
  expired_award_id: expiredAward.id,
  expired_revocation_id: expiredRevocation.id,
  active_user_pubkey: activeUser.pub,
  expiring_user_pubkey: expiringUser.pub,
  expired_user_pubkey: expiredUser.pub,
  invite_token: invite.token,
  invite_expires_at: invite.expires_at,
  phase: 'ready',
});
console.log('CRAYS BOARD RELAY BOOTSTRAP PEOPLE PASS');
