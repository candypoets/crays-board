#!/usr/bin/env node
// People & roles fixtures (docs/screens/people.md). Extends the standard
// venue fixture family (profile/product/product-award, required by the shared
// .qa/relay-verify.mjs) with the people surface fixtures per PRD §8.7 and
// NIP-97, each signed by its proper authority and
// round-tripped until queryable:
//   - role definition 30009 d=qa-role-<run> (t=role, NIP-97 permissions
//     events+invites) — admin-signed;
//   - membership definition 30009 d=qa-membership-<run> — admin-signed;
//   - active membership award (kind 8, no expiration) to users[0] —
//     badge-issuer-signed;
//   - membership award expiring in 10 days to users[1] — badge-issuer-signed;
//   - membership award to users[2] plus an admin-signed kind 5 revoking it —
//     the deterministic Expired fixture (an already-past NIP-40 expiration
//     would be dropped by the relay on write, so expiry is expressed through
//     revocation; both grant nothing and leave the person Expired);
//   - temporary profile-writer role (permission 0/write) + awards to
//     users[0..2], revoked after their kind-0 profiles round-trip;
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
const roleD = `qa-role-${run}`;
const membershipD = `qa-membership-${run}`;
const profileWriterD = `qa-profile-writer-${run}`;
const ROLE_PERMISSIONS = ['events', 'invites'];
const ROLE_PERMISSION_TAGS = [['permission', '31923', 'write'], ['permission', 'invites']];
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
    kind: KIND_LISTING,
    tags: productListingTags({ d: itemD, title: `QA Miso aubergine ${run}`, price: '9.50' }),
  },
  keys.admin.priv,
);
await publish(product, 'sellable product listing (30402)');
const productAddress = `${KIND_LISTING}:${keys.admin.pub}:${itemD}`;

// c. Implicit-pending order award for the standard relay verify.
const award = signEvent(
  { kind: 8, tags: entitlementAwardTags({ definitionAddress: productAddress, holderPubkey: activeUser.pub }) },
  issuerSecret,
);
await publish(award, 'issuer-signed product award (implicit pending order)');

// d. Role definition per venue-commerce-nip §3.6, signed by the admin.
const roleDefinition = signEvent(
  {
    kind: 30009,
    tags: [
      ['d', roleD],
      ['t', 'role'],
      ['name', 'QA Events host'],
      ['description', 'Welcomes guests, manages events, and handles entry.'],
      ...ROLE_PERMISSION_TAGS,
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
      ['t', 'membership'],
      ['name', 'QA Membership'],
      ['price', '25.00', 'EUR', 'month'],
      ['availability', 'available'],
    ],
  },
  keys.admin.priv,
);
await publish(membershipDefinition, 'membership definition (30009)');
const membershipAddress = `30009:${keys.admin.pub}:${membershipD}`;

// f. The three membership awards, signed by the venue badge issuer (§4 trust).
const activeAward = signEvent(
  {
    kind: 8,
    tags: entitlementAwardTags({
      definitionAddress: membershipAddress,
      holderPubkey: activeUser.pub,
      topics: ['membership'],
    }),
  },
  issuerSecret,
);
await publish(activeAward, 'active membership award (users[0])');

const expiringAward = signEvent(
  {
    kind: 8,
    tags: entitlementAwardTags({
      definitionAddress: membershipAddress,
      holderPubkey: expiringUser.pub,
      topics: ['membership'],
      expiration: nowSeconds() + 10 * 24 * 60 * 60,
    }),
  },
  issuerSecret,
);
await publish(expiringAward, 'expiring membership award (users[1], 10 days)');

const expiredAward = signEvent(
  {
    kind: 8,
    tags: entitlementAwardTags({
      definitionAddress: membershipAddress,
      holderPubkey: expiredUser.pub,
      topics: ['membership'],
    }),
  },
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

// g2. Temporary, capability-scoped profile writer. Membership is not a
// blanket write bypass under NIP-97; kind-0 authors need permission 0/write.
const profileWriterDefinition = signEvent(
  {
    kind: 30009,
    tags: [
      ['d', profileWriterD],
      ['t', 'role'],
      ['name', `QA profile fixture writer ${run}`],
      ['permission', '0', 'write'],
    ],
  },
  keys.admin.priv,
);
await publish(profileWriterDefinition, 'temporary profile-writer role definition (0/write)');
const profileWriterAddress = `30009:${keys.admin.pub}:${profileWriterD}`;
const profileWriterAwards = [];
for (const [index, user] of [activeUser, expiringUser, expiredUser].entries()) {
  const grant = signEvent(
    {
      kind: 8,
      tags: entitlementAwardTags({
        definitionAddress: profileWriterAddress,
        holderPubkey: user.pub,
        topics: ['role'],
      }),
    },
    keys.admin.priv,
  );
  await publish(grant, `temporary profile-writer award for users[${index}]`);
  profileWriterAwards.push(grant);
}
await sleep(1_500);

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

// Remove the harness-only capability after the self-authored profiles land.
// The revoked awards remain signed evidence but grant nothing to People.
const profileWriterRevocations = [];
for (const [index, grant] of profileWriterAwards.entries()) {
  const revocation = signEvent(
    { kind: 5, tags: [['e', grant.id], ['k', '8']] },
    keys.admin.priv,
  );
  await publish(revocation, `revoke temporary profile-writer award for users[${index}]`);
  profileWriterRevocations.push(revocation);
}

const stored = await pool.querySync([relay.relay_url], { kinds: [0, 5, 8, 30009, 30402, 31727, 30078], limit: 100 });
// strfry applies the three kind-5 revocations and omits their deleted
// temporary profile-writer awards from a normal query. The 19 visible events
// are therefore the complete current fixture family, not a partial seed.
assert(stored.length >= 19, `independent relay query sees the NIP-97 people fixture family (${stored.length} events)`);
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
  profile_writer_address: profileWriterAddress,
  profile_writer_award_ids: profileWriterAwards.map((event) => event.id),
  profile_writer_revocation_ids: profileWriterRevocations.map((event) => event.id),
  active_user_pubkey: activeUser.pub,
  expiring_user_pubkey: expiringUser.pub,
  expired_user_pubkey: expiredUser.pub,
  invite_token: invite.token,
  invite_expires_at: invite.expires_at,
  phase: 'ready',
});
console.log('CRAYS BOARD RELAY BOOTSTRAP PEOPLE PASS');
