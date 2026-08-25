#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { verifyEvent } from 'nostr-tools';
import { assert, makePool, readState } from './relay-lib.mjs';

const state = readState();
if (!state?.relay_url || !state?.award_id) throw new Error('run .qa/relay-bootstrap.mjs first');

// Independent relay truth per NIP-97: exactly one accepted
// status for the seeded order context, exact tags, staff signer, monotonic.
const pool = makePool();
const statuses = await pool.querySync([state.relay_url], {
  kinds: [37237],
  '#e': [state.award_id],
});
pool.close([state.relay_url]);

assert(statuses.length === 1, `exactly one 37237 status references the award (${statuses.length} found)`);
const status = statuses[0];
const tag = (name) => status.tags.find((entry) => entry[0] === name)?.[1];
assert(tag('status') === 'accepted', 'status value is accepted');
assert(tag('order') === state.award_id, 'order tag uses the award-id fallback order reference');
assert(tag('d') === `order:${state.award_id}`, 'd tag matches the NIP-97 order context');
assert(tag('e') === state.award_id, 'e tag references the exact award event id');
assert(tag('a') === state.product_address, 'a tag references the exact product address');
assert(tag('p') === state.user_pubkey, 'p tag is the fixture order holder');
assert(status.pubkey === state.admin_pubkey, 'status is signed by the staff (admin) pubkey');
assert(verifyEvent(status), 'status event has a valid Nostr signature');
assert(status.created_at >= state.award_created_at, 'status created_at is not older than the award');

// Device truth: the app must have projected the seeded order and published the
// same status event it logged. Marker payloads are JSON per the fixed app
// contract:
//   [crays-board-order]        {"id": <award id>, "a": <definition address>, "status": <projected>}
//   [crays-board-order-status] {"id": <status event id>, "e": <award id>, "status": <value>}
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

const orders = markerPayloads('[crays-board-order]');
const consumed = orders.find((entry) => JSON.stringify(entry).includes(state.award_id));
assert(consumed, 'app projected an order for the seeded award id');
assert(JSON.stringify(consumed).includes(state.product_address), 'projected order carries the exact definition address');

const published = markerPayloads('[crays-board-order-status]');
const match = published.find((entry) => JSON.stringify(entry).includes(status.id));
assert(match, 'app logged the same accepted status event id that landed on the relay');
const serialized = JSON.stringify(match);
assert(serialized.includes(state.award_id), 'published status marker carries the award order context');
assert(serialized.includes('"accepted"') || serialized.includes(':accepted'), 'published status marker reports accepted');

console.log('CRAYS BOARD ORDER ACCEPTED PASS');
