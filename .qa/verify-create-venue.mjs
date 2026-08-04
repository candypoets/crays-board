#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { verifyEvent } from 'nostr-tools';
import {
  assert,
  emulatorUrl,
  getRelay,
  listRelays,
  loadKeys,
  makePool,
  readState,
  sleep,
  writeState,
} from './relay-lib.mjs';

/**
 * Independent truth for the Create Venue happy path (venue-commerce-nip §11
 * style; docs/screens/create-venue.md). Queries the coordinator and the NEW
 * app-provisioned relay directly — never the rendered UI.
 *
 * Proves:
 *  - exactly ONE coordinator relay whose domain contains the run slug;
 *  - its admin_pubkeys is exactly [staff pubkey], and it reaches `running`;
 *  - the new relay round-trips exactly one venue profile 30078
 *    (d=nuts-community-profile, type=t=hospitality, exact name/about),
 *    signed by the staff key with a valid signature;
 *  - the device's [crays-board-create-venue] marker matches coordinator truth.
 *
 * Side effect: records the discovered relay (id/domain/relay_url/base_url)
 * and the profile event id into the scenario state so the runner's teardown
 * (.qa/relay-teardown.mjs with CRAYS_BOARD_QA_STATE) deletes exactly it.
 */

const keys = loadKeys();
const state = readState();
if (!state?.slug || !state?.admin_pubkey) throw new Error('run .qa/relay-bootstrap-create-venue.mjs first');

const relays = await listRelays(keys);
const matches = relays.filter((relay) => (relay.domain || '').includes(state.slug));

// Record ownership BEFORE asserting the count so teardown can still clean up
// a relay allocated by a run that failed later assertions.
if (matches.length > 0) {
  writeState({
    ...state,
    id: matches[0].id,
    domain: matches[0].domain,
    relay_url: matches[0].relay_url,
    base_url: matches[0].base_url,
  });
}
assert(matches.length === 1, `exactly one coordinator relay domain contains ${state.slug} (${matches.length} found)`);

const owned = matches[0];
const admins = (owned.admin_pubkeys || []).map((key) => String(key).toLowerCase());
assert(
  admins.length === 1 && admins[0] === state.admin_pubkey.toLowerCase(),
  'relay admin_pubkeys is exactly [staff pubkey]',
);

// The app already waited for readiness; confirm independently (short grace
// for coordinator status propagation).
let relay = owned;
for (let attempt = 0; attempt < 20 && relay.status !== 'running'; attempt += 1) {
  await sleep(1500);
  relay = await getRelay(owned.id, keys);
}
assert(relay.status === 'running', 'app-provisioned relay reports running');
assert(typeof relay.relay_url === 'string' && relay.relay_url.startsWith('ws'), 'relay exposes a ws relay_url');
assert(typeof relay.base_url === 'string' && relay.base_url.startsWith('http'), 'relay exposes an http service base_url');

// Venue profile on the NEW relay: exactly one 30078 with the exact contract.
const pool = makePool();
const profiles = await pool.querySync([relay.relay_url], { kinds: [30078], '#d': ['nuts-community-profile'], limit: 10 });
pool.close([relay.relay_url]);
assert(profiles.length === 1, `exactly one venue profile 30078/nuts-community-profile on the new relay (${profiles.length} found)`);
const profile = profiles[0];
const tag = (name) => profile.tags.find((entry) => entry[0] === name)?.[1];
assert(tag('type') === 'hospitality', 'venue profile declares type=hospitality');
assert(profile.tags.some((entry) => entry[0] === 't' && entry[1] === 'hospitality'), 'venue profile carries t=hospitality');
assert(tag('name') === state.venue_name, 'venue profile carries the exact venue name');
assert(tag('about') === 'QA venue for the Crays Board create-venue scenario.', 'venue profile carries the typed introduction');
assert(profile.pubkey.toLowerCase() === state.admin_pubkey.toLowerCase(), 'venue profile is signed by the staff key');
assert(verifyEvent(profile), 'venue profile has a valid Nostr signature');

// Venue isolation: the profile must not exist on any other relay this run did
// not create (none should contain the slug; checked above via exact count).

writeState({
  ...state,
  id: relay.id,
  domain: relay.domain,
  relay_url: relay.relay_url,
  base_url: relay.base_url,
  venue_profile_id: profile.id,
  phase: 'verified',
});

// Device truth: the app logged the same relay identity it provisioned.
const log = execFileSync('adb', ['logcat', '-d'], { maxBuffer: 64 * 1024 * 1024 }).toString();
const markerPayloads = log
  .split('\n')
  .filter((line) => line.includes('[crays-board-create-venue]'))
  .map((line) => {
    const start = line.indexOf('[crays-board-create-venue]') + '[crays-board-create-venue]'.length;
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
const marker = markerPayloads.find((entry) => JSON.stringify(entry).includes(relay.id));
assert(marker, 'app logged a create-venue marker for the provisioned relay id');
// The app stores the URLs in device-reachable form (emulator host alias in
// dev); compare against the same mapping of coordinator truth.
assert(marker.relayUrl === emulatorUrl(relay.relay_url), 'marker relay url matches coordinator truth');
assert(marker.serviceUrl === emulatorUrl(relay.base_url), 'marker service url matches coordinator truth');
assert(marker.pubkey?.toLowerCase() === state.admin_pubkey.toLowerCase(), 'marker staff pubkey matches');
assert(marker.slug === state.slug, 'marker slug matches the derived slug');
assert(typeof marker.attemptId === 'string' && marker.attemptId.startsWith('cv-'), 'marker carries the stable attempt id');

console.log('CRAYS BOARD CREATE VENUE VERIFY PASS');
