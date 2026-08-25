#!/usr/bin/env node
// Independent NIP-97 truth for the full order ladder. Because 37237 is
// addressable by `d=order:<ref>`, the relay retains one current status per
// staff signer/context. Device markers prove the deliberate transition
// sequence; relay truth proves the three final current states and exact tags.
import { execFileSync } from 'node:child_process';
import { verifyEvent } from 'nostr-tools';
import { assert, makePool, readState } from './relay-lib.mjs';

const state = readState();
if (!state?.relay_url || !state?.award_id || !state?.decline_award_id || !state?.cancel_award_id) {
  throw new Error('run .qa/relay-bootstrap-orders-ladder.mjs first');
}

const tag = (event, name) => event.tags.find((entry) => entry[0] === name)?.[1];
const pool = makePool();
const statuses = await pool.querySync([state.relay_url], { kinds: [37237], limit: 200 });
pool.close([state.relay_url]);

function currentFor(awardId) {
  return statuses.filter((event) => tag(event, 'e') === awardId);
}

function checkCurrent(event, awardId, awardCreatedAt, value, label) {
  assert(event, `${label}: current status exists`);
  assert(tag(event, 'status') === value, `${label}: current status is ${value}`);
  assert(tag(event, 'order') === awardId, `${label}: order tag uses the award-id fallback reference`);
  assert(tag(event, 'd') === `order:${awardId}`, `${label}: d matches its NIP-97 order context`);
  assert(tag(event, 'e') === awardId, `${label}: e references the exact award event id`);
  assert(tag(event, 'a') === state.product_address, `${label}: a references the exact product listing`);
  assert(tag(event, 'p') === state.user_pubkey, `${label}: p is the fixture order holder`);
  assert(event.pubkey === state.admin_pubkey, `${label}: status is signed by the staff admin`);
  assert(verifyEvent(event), `${label}: status has a valid Nostr signature`);
  assert(event.created_at >= awardCreatedAt, `${label}: status is not older than its award`);
}

const advance = currentFor(state.award_id);
const declined = currentFor(state.decline_award_id);
const cancelled = currentFor(state.cancel_award_id);
assert(advance.length === 1, `advance context retains exactly one status (${advance.length} found)`);
assert(declined.length === 1, `decline context retains exactly one status (${declined.length} found)`);
assert(cancelled.length === 1, `cancel context retains exactly one status (${cancelled.length} found)`);
checkCurrent(advance[0], state.award_id, state.award_created_at, 'fulfilled', 'advance order');
checkCurrent(declined[0], state.decline_award_id, state.decline_award_created_at, 'cancelled', 'declined order');
checkCurrent(cancelled[0], state.cancel_award_id, state.cancel_award_created_at, 'cancelled', 'cancelled order');

const known = new Set([state.award_id, state.decline_award_id, state.cancel_award_id]);
assert(statuses.length === 3, `exactly three retained 37237 statuses exist (${statuses.length} found)`);
assert(statuses.every((event) => known.has(tag(event, 'e'))), 'no status references another order');

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
  assert(projected, `app projected the ${label} order`);
  assert(JSON.stringify(projected).includes(state.product_address), `${label} order carries the exact listing address`);
}

const published = markerPayloads('[crays-board-order-status]');
const sequenceFor = (awardId) => published.filter((entry) => entry.e === awardId);
const advanceSequence = sequenceFor(state.award_id);
const declineSequence = sequenceFor(state.decline_award_id);
const cancelSequence = sequenceFor(state.cancel_award_id);
assert(
  JSON.stringify(advanceSequence.map((entry) => entry.status)) ===
    JSON.stringify(['accepted', 'processing', 'ready', 'fulfilled']),
  'device published the complete advance sequence exactly once',
);
assert(
  JSON.stringify(declineSequence.map((entry) => entry.status)) === JSON.stringify(['cancelled']),
  'device published one decline status despite the double tap',
);
assert(
  JSON.stringify(cancelSequence.map((entry) => entry.status)) === JSON.stringify(['accepted', 'cancelled']),
  'device published accepted then cancelled after the dismissed confirmation',
);
assert(advanceSequence.at(-1)?.id === advance[0].id, 'advance final marker matches retained relay status');
assert(declineSequence.at(-1)?.id === declined[0].id, 'decline marker matches retained relay status');
assert(cancelSequence.at(-1)?.id === cancelled[0].id, 'cancel final marker matches retained relay status');
assert(new Set(published.map((entry) => entry.id)).size === 7, 'all seven deliberate transition events had unique ids');

console.log('CRAYS BOARD ORDER LADDER PASS');
