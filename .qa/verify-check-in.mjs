#!/usr/bin/env node
/**
 * Check-in scenario verifier (NIP-97 fulfillment, EVENT-10/11/12).
 * Proves relay truth independently of the rendered UI:
 *
 * - exactly one NEW kind 37237 references award_id (the valid presentation):
 *   status=fulfilled, exact event/d/e/a/p tags, staff (admin)
 *   signer, valid signature, created_at not older than the award;
 * - exactly one 37237 references award2_id — the pre-seeded one — so the
 *   already-fulfilled rejection wrote nothing;
 * - exactly two 37237 events exist in total, so the wrong-event rejection
 *   (and every other rejection attempt) wrote nothing;
 * - logcat [crays-board-check-in] projection markers match relay truth and
 *   [crays-board-check-in-status] carries the same fulfilled status event id
 *   that landed on the relay.
 */
import { execFileSync } from 'node:child_process';
import { verifyEvent } from 'nostr-tools';
import { assert, makePool, readState } from './relay-lib.mjs';

const state = readState();
if (!state?.relay_url || !state?.award_id || !state?.award2_id) {
  throw new Error('run .qa/relay-bootstrap-check-in.mjs first');
}

const tag = (event, name) => event.tags.find((entry) => entry[0] === name)?.[1];

const pool = makePool();
const statuses = await pool.querySync([state.relay_url], { kinds: [37237], limit: 200 });
pool.close([state.relay_url]);

// New fulfilled status for the valid presentation's award: exactly one.
const forAward = statuses.filter((event) => tag(event, 'e') === state.award_id);
assert(forAward.length === 1, `exactly one 37237 references the valid award (${forAward.length} found)`);
const status = forAward[0];
assert(status.id !== state.preseeded_status_id, 'the fulfilled status for the valid award is new');
assert(tag(status, 'status') === 'fulfilled', 'status value is fulfilled');
assert(tag(status, 'event') === state.event_address, 'event tag is the active calendar coordinate');
assert(tag(status, 'd') === `event:${state.event_address}`, 'd tag is the matching NIP-97 event context');
assert(tag(status, 'e') === state.award_id, 'e tag references the exact award event id');
assert(tag(status, 'a') === state.product_address, 'a tag references the exact ticket listing address');
assert(tag(status, 'p') === state.user_pubkey, 'p tag is the fixture holder');
assert(status.pubkey === state.admin_pubkey, 'status is signed by the staff (admin) pubkey');
assert(verifyEvent(status), 'status event has a valid Nostr signature');
assert(status.created_at >= state.award_created_at, 'status created_at is not older than the award');

// Pre-fulfilled award: still exactly the pre-seeded status — the
// already-fulfilled rejection produced no new write.
const forAward2 = statuses.filter((event) => tag(event, 'e') === state.award2_id);
assert(forAward2.length === 1, `exactly one 37237 references the pre-fulfilled award (${forAward2.length} found)`);
assert(forAward2[0].id === state.preseeded_status_id, 'the only status for the pre-fulfilled award is the pre-seeded one');
assert(tag(forAward2[0], 'status') === 'fulfilled', 'pre-seeded status is fulfilled');
assert(tag(forAward2[0], 'a') === state.product_address, 'pre-seeded status binds the exact ticket listing');
assert(tag(forAward2[0], 'p') === state.user2_pubkey, 'pre-seeded status binds the exact second holder');
assert(tag(forAward2[0], 'event') === state.event_address, 'pre-seeded status uses the same event coordinate');
assert(tag(forAward2[0], 'd') === `event:${state.event_address}`, 'pre-seeded status d matches its event tag');
assert(forAward2[0].pubkey === state.issuer_pubkey, 'pre-seeded status uses the delegated issuer slot');
assert(verifyEvent(forAward2[0]), 'pre-seeded status has a valid Nostr signature');
assert(forAward2[0].created_at >= state.award2_created_at, 'pre-seeded status does not predate its award');

// Every rejection attempt (wrong event included) wrote nothing: the two
// seeded/earned statuses are the entire 37237 log.
assert(statuses.length === 2, `exactly two 37237 events exist in total (${statuses.length} found)`);

// Device truth: the app projected the seeded event counts and logged the same
// status event it published. Marker payloads are JSON per the fixed app
// contract:
//   [crays-board-check-in]        {"event": <31923 coordinate>, "expected": n, "checkedIn": n}
//   [crays-board-check-in-status] {"id": <status event id>, "e": <award id>, "status": "fulfilled", "context": "event"}
const log = execFileSync('adb', ['logcat', '-d'], { maxBuffer: 64 * 1024 * 1024 }).toString();
const markerPayloads = (marker) =>
  log
    .split('\n')
    .filter((line) => line.includes(marker))
    .map((line) => {
      const startIndex = line.indexOf(marker) + marker.length;
      let payload = line.slice(startIndex).trim();
      if (payload.startsWith("'")) payload = payload.slice(1);
      if (payload.endsWith("'")) payload = payload.slice(0, -1);
      try {
        return JSON.parse(payload);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);

const projections = markerPayloads('[crays-board-check-in]').filter((entry) => entry.event === state.event_address);
assert(projections.length > 0, 'app projected the seeded check-in event');
assert(
  projections.some((entry) => entry.expected === 2 && entry.checkedIn === 1),
  'app projected the pre-check-in counts (2 expected, 1 checked in) from relay truth',
);
assert(
  projections.some((entry) => entry.expected === 2 && entry.checkedIn === 2),
  'app projected the advanced counts (2 of 2) after the fulfilled status landed',
);

const published = markerPayloads('[crays-board-check-in-status]');
const match = published.find((entry) => JSON.stringify(entry).includes(status.id));
assert(match, 'app logged the same fulfilled status event id that landed on the relay');
const serialized = JSON.stringify(match);
assert(serialized.includes(state.award_id), 'published status marker carries the award check-in context');
assert(serialized.includes('"fulfilled"'), 'published status marker reports fulfilled');
assert(serialized.includes('"event"'), 'published status marker reports the event context');

console.log('CRAYS BOARD CHECK-IN PASS');
