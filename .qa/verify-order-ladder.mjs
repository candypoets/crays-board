#!/usr/bin/env node
// Independent relay truth for the orders full ladder (venue-commerce-nip §11):
//   award 1 (advance): exactly 4 monotonic 37237 statuses — accepted,
//     processing, ready, fulfilled — exact tags, staff signer, valid sigs;
//   award 2 (decline): exactly one cancelled status (cancelled from pending =
//     decline, §6.4), no other status;
//   award 3 (cancel): exactly one accepted then one cancelled, monotonic;
//   no other 37237 events exist on the relay at all.
// Tag contract (§6.7, resolved by device evidence): 37237 is addressable-range,
// so `d` is stage-scoped (`<awardId>:<status>`) to keep every transition
// retained; `e` is the stable order context.
// Device truth: the app projected all three orders and logged the same status
// event ids that landed on the relay.
import { execFileSync } from 'node:child_process';
import { verifyEvent } from 'nostr-tools';
import { assert, makePool, readState } from './relay-lib.mjs';

const state = readState();
if (!state?.relay_url || !state?.award_id || !state?.decline_award_id || !state?.cancel_award_id) {
  throw new Error('run .qa/relay-bootstrap-orders-ladder.mjs first');
}

const pool = makePool();
const statuses = await pool.querySync([state.relay_url], { kinds: [37237], limit: 200 });
pool.close([state.relay_url]);

const tag = (event, name) => event.tags.find((entry) => entry[0] === name)?.[1];
const byContext = (awardId) =>
  statuses
    .filter((event) => tag(event, 'e') === awardId)
    .sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));

function checkStatus(event, awardId, awardCreatedAt, value, label) {
  assert(tag(event, 'status') === value, `${label}: status value is ${value}`);
  assert(tag(event, 'context') === 'order', `${label}: status context is order`);
  assert(tag(event, 'd') === `${awardId}:${value}`, `${label}: d tag is the stage-scoped order context (§6.7)`);
  assert(tag(event, 'e') === awardId, `${label}: e tag references the exact award event id`);
  assert(tag(event, 'a') === state.product_address, `${label}: a tag references the exact product address`);
  assert(tag(event, 'p') === state.user_pubkey, `${label}: p tag is the fixture order holder`);
  assert(event.pubkey === state.admin_pubkey, `${label}: status is signed by the staff (admin) pubkey`);
  assert(verifyEvent(event), `${label}: status event has a valid Nostr signature`);
  assert(event.created_at >= awardCreatedAt, `${label}: status created_at is not older than the award`);
}

function checkMonotonic(events, label) {
  for (let index = 1; index < events.length; index += 1) {
    assert(events[index].created_at > events[index - 1].created_at, `${label}: created_at strictly increases (§6.6)`);
  }
}

// Award 1 — advance-full: exactly the four ladder stages in order.
const advance = byContext(state.award_id);
assert(advance.length === 4, `advance award has exactly four 37237 statuses (${advance.length} found)`);
['accepted', 'processing', 'ready', 'fulfilled'].forEach((value, index) => {
  checkStatus(advance[index], state.award_id, state.award_created_at, value, `advance status #${index + 1}`);
});
checkMonotonic(advance, 'advance ladder');

// Award 2 — decline: exactly one cancelled status (cancelled from pending).
const declined = byContext(state.decline_award_id);
assert(declined.length === 1, `decline award has exactly one 37237 status (${declined.length} found)`);
checkStatus(declined[0], state.decline_award_id, state.decline_award_created_at, 'cancelled', 'decline status');

// Award 3 — cancel: exactly accepted then cancelled.
const cancelled = byContext(state.cancel_award_id);
assert(cancelled.length === 2, `cancel award has exactly two 37237 statuses (${cancelled.length} found)`);
checkStatus(cancelled[0], state.cancel_award_id, state.cancel_award_created_at, 'accepted', 'cancel status #1');
checkStatus(cancelled[1], state.cancel_award_id, state.cancel_award_created_at, 'cancelled', 'cancel status #2');
checkMonotonic(cancelled, 'cancel sequence');

// Forbidden: no 37237 outside the three seeded order contexts (e is the
// stable order context reference).
const known = new Set([state.award_id, state.decline_award_id, state.cancel_award_id]);
const foreign = statuses.filter((event) => !known.has(tag(event, 'e')));
assert(statuses.length === 7, `exactly seven 37237 events exist in total (${statuses.length} found)`);
assert(foreign.length === 0, 'no 37237 status references any other order context');

// Device truth: the app must have projected the seeded orders and published
// the same status events it logged. Marker payloads are JSON per the fixed
// app contract:
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
for (const [awardId, label] of [
  [state.award_id, 'advance'],
  [state.decline_award_id, 'decline'],
  [state.cancel_award_id, 'cancel'],
]) {
  const projected = orders.find((entry) => JSON.stringify(entry).includes(awardId));
  assert(projected, `app projected an order for the ${label} award id`);
  assert(
    JSON.stringify(projected).includes(state.product_address),
    `projected ${label} order carries the exact definition address`,
  );
}

const published = markerPayloads('[crays-board-order-status]');
for (const event of statuses) {
  const match = published.find((entry) => JSON.stringify(entry).includes(event.id));
  assert(match, `app logged the same ${tag(event, 'status')} status event id that landed on the relay`);
}

console.log('CRAYS BOARD ORDER LADDER PASS');
