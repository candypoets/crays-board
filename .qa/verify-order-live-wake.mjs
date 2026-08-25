#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { verifyEvent } from 'nostr-tools';
import { assert, makePool, readState, tagValue } from './relay-lib.mjs';

const state = readState();
if (!state?.external_status_id) throw new Error('post-EOSE publisher did not record its exact event id');
const pool = makePool();
const event = await pool.get([state.relay_url], { ids: [state.external_status_id] });
pool.close([state.relay_url]);

assert(event?.id === state.external_status_id, 'independent query finds the exact externally published status');
assert(verifyEvent(event), 'external status has a valid Nostr signature');
assert(event.pubkey === state.admin_pubkey, 'external status is signed by the delegated venue admin');
assert(event.kind === 37237, 'external update uses status kind 37237');
assert(tagValue(event, 'status') === 'accepted', 'external status value is accepted');
assert(tagValue(event, 'order') === state.award_id, 'external status carries the order context');
assert(tagValue(event, 'd') === `order:${state.award_id}`, 'external status d matches its order context');
assert(tagValue(event, 'e') === state.award_id, 'external status references the exact award');
assert(tagValue(event, 'a') === state.product_address, 'external status references the exact listing');
assert(tagValue(event, 'p') === state.user_pubkey, 'external status references the exact holder');

const log = execFileSync('adb', ['logcat', '-d'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const received = `[crays-board-order-received-status]{"id":"${event.id}","e":"${state.award_id}","status":"accepted"}`;
const projected = `[crays-board-order]{"id":"${state.award_id}","a":"${state.product_address}","status":"accepted"}`;
assert(log.includes(received), 'the already-open app received the exact external event after EOSE');
assert(log.includes(projected), 'the already-open app projected that exact order as accepted');
console.log('CRAYS BOARD POST-EOSE LIVE WAKE PASS');
