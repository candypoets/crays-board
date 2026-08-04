#!/usr/bin/env node
/**
 * Independent settings verification (venue-commerce-nip §11 style), per
 * docs/screens/settings.md:
 *  - the venue profile was republished at the exact d=nuts-community-profile
 *    with the QA-updated description, signed by the admin, on the venue relay;
 *  - the membership availability flip landed at the same stable d;
 *  - payments and room stayed read-only: the room manifest is untouched and
 *    the relay holds no extra 30009/30078/37237 events beyond the fixtures.
 * The QA description literal must match maestro/flows/60-settings.yaml.
 */
import { execFileSync } from 'node:child_process';
import { verifyEvent } from 'nostr-tools';
import { assert, makePool, readState } from './relay-lib.mjs';

const QA_DESCRIPTION = 'Updated by the Crays Board settings QA flow.';

const state = readState();
if (!state?.relay_url || !state?.membership_d || !state?.room_manifest_d) {
  throw new Error('run .qa/relay-bootstrap-settings.mjs first');
}

const pool = makePool();
const tag = (event, name) => event.tags.find((entry) => entry[0] === name)?.[1];

// 1. Profile republish: strfry retains exactly the latest addressable event
// per (pubkey, kind, d), so exactly one profile exists and it must carry the
// updated description — provenance of the seeded id lives in the state file.
const profiles = await pool.querySync([state.relay_url], { kinds: [30078], '#d': ['nuts-community-profile'] });
assert(profiles.length === 1, `exactly one 30078 exists at d=nuts-community-profile (${profiles.length} found)`);
const profile = profiles[0];
assert(profile.pubkey === state.admin_pubkey, 'republished profile is signed by the admin');
assert(tag(profile, 'd') === 'nuts-community-profile', 'republished profile keeps the exact d');
assert(tag(profile, 'about') === QA_DESCRIPTION, 'republished profile carries the QA-updated description');
assert(tag(profile, 'type') === 'hospitality', 'republished profile keeps the hospitality type');
assert(profile.id === state.venue_profile_id, 'state tracks the live profile event id (bootstrap watcher)');
if (state.venue_profile_seeded_id) {
  assert(profile.id !== state.venue_profile_seeded_id, 'republished profile replaced the seeded event');
}
assert(profile.created_at > state.venue_profile_created_at, 'republished profile is newer than the seeded one');
assert(verifyEvent(profile), 'republished profile has a valid Nostr signature');

// 2. Membership availability flip at the same stable d.
const memberships = await pool.querySync([state.relay_url], { kinds: [30009], '#d': [state.membership_d] });
assert(memberships.length === 1, `exactly one 30009 exists at the membership d (${memberships.length} found)`);
const membership = memberships[0];
assert(membership.pubkey === state.admin_pubkey, 'membership update is signed by the admin');
assert(tag(membership, 'd') === state.membership_d, 'membership update kept the same stable d');
assert(tag(membership, 'availability') === 'unavailable', 'membership availability flipped to unavailable');
assert(tag(membership, 'type') === 'membership' && tag(membership, 'period') === 'monthly', 'membership classification retained');
assert(tag(membership, 'price') === '12.00' && tag(membership, 'currency') === 'EUR', 'membership price/currency retained');
assert(membership.id !== state.membership_definition_id, 'membership update is a new event at the same d');
assert(verifyEvent(membership), 'membership update has a valid Nostr signature');

// 3. Read-only sections: the room manifest is exactly the seeded event (no
// app write), and the relay holds no events beyond the seeded fixture family
// plus the two deliberate republishes.
const manifests = await pool.querySync([state.relay_url], { kinds: [30078], '#d': [state.room_manifest_d] });
assert(manifests.length === 1 && manifests[0].id === state.room_manifest_id, 'room manifest is untouched (room read-only)');
assert(tag(manifests[0], 'schema') === 'life.crays/room/v1', 'room manifest keeps the versioned schema');
const statuses = await pool.querySync([state.relay_url], { kinds: [37237], limit: 50 });
assert(statuses.length === 0, 'no order statuses were written from the settings flow');
const all30078 = await pool.querySync([state.relay_url], { kinds: [30078], limit: 50 });
assert(all30078.length === 2, `only the profile and room manifest 30078 events exist (${all30078.length} found)`);
const all30009 = await pool.querySync([state.relay_url], { kinds: [30009], limit: 50 });
// The relay's own badge definition (d=members, issuer-signed) is expected
// provisioning infrastructure; the staff key may hold only the seeded
// product and the flipped membership — nothing else was written.
const itemD = state.product_address.split(':').slice(2).join(':');
const adminDefinitionDs = all30009
  .filter((event) => event.pubkey === state.admin_pubkey)
  .map((event) => tag(event, 'd'))
  .sort();
assert(
  JSON.stringify(adminDefinitionDs) === JSON.stringify([itemD, state.membership_d].sort()),
  `staff definitions are exactly the seeded product and membership (${adminDefinitionDs.join(', ')})`,
);
pool.close([state.relay_url]);

// 4. Device truth: the app logged the same event ids that landed on the relay.
const log = execFileSync('adb', ['logcat', '-d'], { maxBuffer: 64 * 1024 * 1024 }).toString();
const markerPayloads = (marker) =>
  log
    .split('\n')
    .filter((line) => line.includes(marker))
    .map((line) => {
      const start = line.indexOf(marker) + marker.length;
      let payload = line.slice(start).trim();
      if (payload.startsWith("'")) payload = payload.slice(1);
      if (payload.endsWith("'")) payload = payload.slice(0, -1);
      try {
        return JSON.parse(payload);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);

const profileMarkers = markerPayloads('[crays-board-profile]');
const profileMatch = profileMarkers.find((entry) => entry.id === profile.id && entry.d === 'nuts-community-profile');
assert(profileMatch, 'app logged the same republished profile event id that landed on the relay');

const membershipMarkers = markerPayloads('[crays-board-membership]');
const membershipMatch = membershipMarkers.find(
  (entry) => entry.id === membership.id && entry.d === state.membership_d && entry.availability === 'unavailable',
);
assert(membershipMatch, 'app logged the same membership update event id that landed on the relay');

assert(!log.includes('nsec1'), 'no nsec appears in logcat');

console.log('CRAYS BOARD SETTINGS PASS');
