#!/usr/bin/env node
// Check-in scenario bootstrap (venue-commerce-nip §8, EVENT-10/11/12).
// Provisions an isolated coordinator relay and publishes, each signed by its
// proper authority and round-tripped until queryable:
//   - venue hospitality profile 30078 / d=nuts-community-profile (admin);
//   - single-use expiring event_access definition 30009 (admin);
//   - timed calendar event 31923 referencing the definition as its entrance
//     badge via its `a` tag (admin);
//   - two kind 8 awards for the definition (relay badge issuer): award to
//     users[0] (untouched) and award2 to users[1] (pre-fulfilled);
//   - one admin-signed 37237 fulfilled/event status for award2 (the
//     pre-seeded "already checked in" truth);
//   - three holder-signed kind 27236 presentations (kept in state only —
//     Board validates presentations, it never reads them from the relay).
//
// State file fields (public-safe ids/pubkeys plus the synthetic fixture
// presentations, which expire one hour after bootstrap and are never logged):
//   run, id, name, domain                    - relay identity
//   relay_url, emulator_relay_url            - ws urls (host / emulator)
//   base_url, emulator_base_url              - service urls (host / emulator)
//   admin_pubkey, issuer_pubkey              - venue authority / badge issuer
//   user_pubkey, user2_pubkey                - award holders (users[0], users[1])
//   venue_profile_id                         - 30078 profile event id
//   product_definition_id, product_address   - event_access 30009 id + address
//   event_id, event_d                        - 31923 calendar event id + d tag
//   award_id, award_created_at               - untouched award (valid path)
//   award2_id                                - pre-fulfilled award
//   preseeded_status_id                      - admin-signed fulfilled 37237 for award2
//   wrong_event_id                           - unknown event id used by presentation 3
//   presentation, presentation_id            - valid 27236 (users[0], award_id, event_id)
//   presentation_fulfilled, ..._id           - valid 27236 referencing award2 (already used)
//   presentation_wrong_event, ..._id         - valid 27236 except event=wrong_event_id
//   invite_token, invite_expires_at          - invite-service smoke token (never logged)
//   phase                                    - provisioned | ready
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
const accessD = `qa-event-access-${run}`;
const eventD = `qa-event-${run}`;
const holder = keys.users[0];
const holder2 = keys.users[1];
if (!holder || !holder2) throw new Error('keys.json must expose at least two fixture users');
const wrongEventId = 'ab'.repeat(32);

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

// b. Single-use, expiring event-access definition per venue-commerce-nip
// §3.5, signed by the venue admin authority and confirmed BEFORE the
// referencing calendar event.
const accessDefinition = signEvent(
  {
    kind: 30009,
    tags: [
      ['d', accessD],
      ['type', 'event_access'],
      ['t', 'event_access'],
      ['t', 'sellable'],
      ['name', `QA Supper Club entry ${run}`],
      ['price', '15.00'],
      ['currency', 'EUR'],
      ['max_uses', '1'],
      ['availability', 'available'],
      ['expiration', String(nowSeconds() + 7 * 24 * 3600)],
    ],
  },
  keys.admin.priv,
);
await publish(accessDefinition, 'event-access definition (30009/event_access)');
const accessAddress = `30009:${keys.admin.pub}:${accessD}`;

// c. Timed calendar event (NIP-52) referencing the definition as its
// entrance badge, signed by the venue admin authority.
const calendarEvent = signEvent(
  {
    kind: 31923,
    tags: [
      ['d', eventD],
      ['title', `QA Supper Club ${run}`],
      ['start', String(nowSeconds() + 4 * 3600)],
      ['end', String(nowSeconds() + 8 * 3600)],
      ['a', accessAddress],
    ],
  },
  keys.admin.priv,
);
await publish(calendarEvent, 'timed calendar event (31923)');

// d. Two awards of the access definition, signed by the relay's badge issuer
// secret (venue-commerce-nip §4): users[0] is the valid check-in path,
// users[1] the already-fulfilled path.
const secrets = await getRelaySecrets(created.id, keys);
const issuerSecret = secrets.badge_issuer_secret_key;
if (!/^[0-9a-f]{64}$/i.test(issuerSecret || '')) throw new Error('relay did not expose a badge issuer secret');
const issuerPubkey = signEvent({ kind: 1 }, issuerSecret).pubkey;

const award = signEvent(
  { kind: 8, tags: [['a', accessAddress], ['p', holder.pub]] },
  issuerSecret,
);
await publish(award, 'issuer-signed access award (users[0], untouched)');

const award2 = signEvent(
  { kind: 8, tags: [['a', accessAddress], ['p', holder2.pub]] },
  issuerSecret,
);
await publish(award2, 'issuer-signed access award (users[1], to be pre-fulfilled)');

// e. Pre-seeded check-in truth: one admin-signed fulfilled event-context
// status for award2 (venue-commerce-nip §8.3), so its presentation must read
// "Already checked in" with no new write.
const preseededStatus = signEvent(
  {
    kind: 37237,
    tags: [
      ['d', award2.id],
      ['e', award2.id],
      ['a', accessAddress],
      ['p', holder2.pub],
      ['status', 'fulfilled'],
      ['context', 'event'],
    ],
  },
  keys.admin.priv,
);
await publish(preseededStatus, 'pre-seeded fulfilled status (37237/event for award2)');

// f. Three holder-signed kind 27236 presentations (venue-commerce-nip §8.1).
// Board validates these; they are kept in scenario state for the Maestro flow
// and never published to the relay or logged.
const presentationTags = (awardId, holderPub, eventId) => [
  ['p', holderPub],
  ['e', awardId],
  ['a', accessAddress],
  ['event', eventId],
  ['expiration', String(nowSeconds() + 3600)],
];
const presentation = signEvent(
  { kind: 27236, tags: presentationTags(award.id, holder.pub, calendarEvent.id) },
  holder.priv,
);
const presentationFulfilled = signEvent(
  { kind: 27236, tags: presentationTags(award2.id, holder2.pub, calendarEvent.id) },
  holder2.priv,
);
const presentationWrongEvent = signEvent(
  { kind: 27236, tags: presentationTags(award.id, holder.pub, wrongEventId) },
  holder.priv,
);

const stored = await pool.querySync([relay.relay_url], { kinds: [8, 30009, 30078, 31923, 37237], limit: 50 });
assert(stored.length >= 6, `independent relay query sees the venue fixture family (${stored.length} events)`);
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
  user2_pubkey: holder2.pub,
  venue_profile_id: venueProfile.id,
  product_definition_id: accessDefinition.id,
  product_address: accessAddress,
  event_id: calendarEvent.id,
  event_d: eventD,
  award_id: award.id,
  award_created_at: award.created_at,
  award2_id: award2.id,
  preseeded_status_id: preseededStatus.id,
  wrong_event_id: wrongEventId,
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
