#!/usr/bin/env node
/**
 * Events scenario bootstrap (flow 30, docs/screens/events.md).
 *
 * Copies the base venue fixture family from .qa/relay-bootstrap.mjs (venue
 * profile 30078, sellable product 30402, issuer-signed award 8) so the shared
 * .qa/relay-verify.mjs stays green unchanged, then adds the events fixtures:
 *
 *   d. One upcoming timed calendar event (kind 31923, d=qa-event-<run>,
 *      title "QA Seed Event", location/capacity tags present) signed by the
 *      venue admin authority.
 *   e. A non-sellable RSVP-writer role with permission 31925/write plus
 *      admin-signed role awards for the three attendees. NIP-97 admission is
 *      capability-scoped; membership alone is not a blanket write bypass.
 *   f. Three effective RSVPs (kind 31925) referencing the event address:
 *      users[0] accepted (published after an older declined copy with the
 *      same attendee and a distinct d tag — latest-per-attendee must win in
 *      the projection), users[1] accepted, users[2] tentative. Expected
 *      projection: accepted=2, tentative=1, declined=0.
 *
 * State file (/tmp/qa-crays-board-events.json) fields beyond the base
 * bootstrap state: event_id, event_d, event_address, event_title,
 * event_start, event_end, event_location, event_capacity, rsvp_expected
 * ({accepted, tentative, declined}), rsvp_attendees (pubkeys),
 * rsvp_writer_address, and created_event_title (the title the Agent Device flow
 * types: "QA Event <awardIdPrefix>"; award_id is unique per run, so the
 * title is too). No private keys, no secrets.
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
const eventD = `qa-event-${run}`;
const rsvpWriterD = `qa-rsvp-writer-${run}`;
const eventTitle = 'QA Seed Event';
const holder = keys.users[0];
const [rsvpAccepted, rsvpAcceptedTwo, rsvpTentative] = keys.users;
if (!holder || !rsvpAcceptedTwo || !rsvpTentative) throw new Error('keys.json exposes too few fixture users');

await requireCoordinator();
const created = await createRelay(
  {
    name: venueDisplayName,
    description: 'Crays Board relay-backed events fixtures; safe to delete.',
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

// Invite service smoke (mirrors the base bootstrap; token kept for later
// invite scenarios, never logged).
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

// b. Sellable single-use product definition, signed by the venue admin
// authority (kept from the base bootstrap so relay-verify.mjs stays green).
const product = signEvent(
  {
    kind: KIND_LISTING,
    tags: productListingTags({ d: itemD, title: `QA Miso aubergine ${run}`, price: '9.50' }),
  },
  keys.admin.priv,
);
await publish(product, 'sellable product listing (30402)');
const productAddress = `${KIND_LISTING}:${keys.admin.pub}:${itemD}`;

// c. Implicit-pending order award, signed by the venue badge issuer secret
// (kept from the base bootstrap; the shared scenario runner also passes its
// id to Agent Device as AWARD_ID/AWARD_ID_PREFIX, which the events flow reuses as
// the per-run suffix of the created event title).
const award = signEvent(
  { kind: 8, tags: entitlementAwardTags({ definitionAddress: productAddress, holderPubkey: holder.pub }) },
  issuerSecret,
);
await publish(award, 'issuer-signed product award (implicit pending order)');

// d. Seeded upcoming calendar event (kind 31923) per PRD §8.6, signed by the
// venue admin authority. Location/capacity tags are present so the detail
// panel has relay truth to project.
const eventStart = nowSeconds() + 86_400;
const eventEnd = eventStart + 7200;
const seededEvent = signEvent(
  {
    kind: 31923,
    tags: [
      ['d', eventD],
      ['title', eventTitle],
      ['start', String(eventStart)],
      ['end', String(eventEnd)],
      ['summary', 'Seeded gathering for the events QA slice.'],
      ['location', 'QA Hall'],
      ['capacity', '48'],
    ],
  },
  keys.admin.priv,
);
await publish(seededEvent, 'seeded upcoming calendar event (31923)');
const eventAddress = `31923:${keys.admin.pub}:${eventD}`;

// e. Capability-scoped RSVP role. The relay gate evaluates NIP-97 permission
// tags; the root membership grants posting, not calendar-RSVP writes.
const rsvpWriter = signEvent(
  {
    kind: 30009,
    tags: [
      ['d', rsvpWriterD],
      ['t', 'role'],
      ['name', `QA RSVP writer ${run}`],
      ['permission', '31925', 'write'],
    ],
  },
  keys.admin.priv,
);
await publish(rsvpWriter, 'RSVP-writer role definition (31925/write)');
const rsvpWriterAddress = `30009:${keys.admin.pub}:${rsvpWriterD}`;
const rsvpAttendees = [rsvpAccepted, rsvpAcceptedTwo, rsvpTentative];
for (const [index, attendee] of rsvpAttendees.entries()) {
  const grant = signEvent(
    {
      kind: 8,
      tags: entitlementAwardTags({
        definitionAddress: rsvpWriterAddress,
        holderPubkey: attendee.pub,
        topics: ['role'],
      }),
    },
    keys.admin.priv,
  );
  await publish(grant, `RSVP-writer role award for users[${index}]`);
}
await sleep(1_500);

// f. RSVPs (kind 31925), each signed by its own attendee key. users[0] first
// declined (older created_at, distinct d tag so both stay stored) and then
// accepted: the projection must count only the latest response per attendee
// (EVENT-08).
const rsvp = (user, status, suffix, createdAt) =>
  signEvent(
    {
      kind: 31925,
      created_at: createdAt,
      tags: [
        ['a', eventAddress],
        ['d', `qa-rsvp-${run}-${suffix}`],
        ['status', status],
        ['p', keys.admin.pub],
      ],
    },
    user.priv,
  );
const base = nowSeconds();
await publish(rsvp(rsvpAccepted, 'declined', 'a-old', base - 120), 'superseded declined RSVP (users[0])');
await publish(rsvp(rsvpAccepted, 'accepted', 'a-new', base - 60), 'accepted RSVP (users[0], latest)');
await publish(rsvp(rsvpAcceptedTwo, 'accepted', 'b', base - 60), 'accepted RSVP (users[1])');
await publish(rsvp(rsvpTentative, 'tentative', 'c', base - 60), 'tentative RSVP (users[2])');

const stored = await pool.querySync([relay.relay_url], { kinds: [8, 30009, 30402, 31727, 30078, 31923, 31925], limit: 50 });
assert(stored.length >= 12, `independent relay query sees the NIP-97 venue fixture family (${stored.length} events)`);
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
  event_id: seededEvent.id,
  event_d: eventD,
  event_address: eventAddress,
  event_title: eventTitle,
  event_start: eventStart,
  event_end: eventEnd,
  event_location: 'QA Hall',
  event_capacity: 48,
  rsvp_expected: { accepted: 2, tentative: 1, declined: 0 },
  rsvp_attendees: [rsvpAccepted.pub, rsvpAcceptedTwo.pub, rsvpTentative.pub],
  rsvp_writer_address: rsvpWriterAddress,
  created_event_title: `QA Event ${award.id.slice(0, 12)}`,
  invite_token: invite.token,
  invite_expires_at: invite.expires_at,
  phase: 'ready',
});
console.log('CRAYS BOARD RELAY BOOTSTRAP PASS');
