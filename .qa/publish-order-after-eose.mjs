#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  assert,
  loadKeys,
  makePool,
  publishUntilStored,
  readState,
  signEvent,
  sleep,
  writeState,
} from './relay-lib.mjs';

const state = readState();
if (!state?.relay_url || !state?.emulator_relay_url || !state?.award_id) {
  throw new Error('run .qa/relay-bootstrap.mjs before the post-EOSE publisher');
}

const eoseMarker = `[crays-board-orders-eose]{"relay":"${state.emulator_relay_url}"}`;
const deadline = Date.now() + 120_000;
let observed = false;
while (Date.now() < deadline) {
  const log = execFileSync('adb', ['logcat', '-d'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (log.includes(eoseMarker)) {
    observed = true;
    break;
  }
  await sleep(300);
}
assert(observed, 'app subscription reached EOSE before the independent publish');

// Keep enough separation that this cannot be confused with the initial query
// response. This publisher has no connection to the app's nipworker runtime.
await sleep(2_500);
const keys = loadKeys();
const status = signEvent(
  {
    kind: 37237,
    tags: [
      ['d', `order:${state.award_id}`],
      ['order', state.award_id],
      ['status', 'accepted'],
      ['e', state.award_id],
      ['a', state.product_address],
      ['p', state.user_pubkey],
    ],
  },
  keys.admin.priv,
);
const pool = makePool();
await publishUntilStored(pool, state.relay_url, status, 'independent accepted status published after app EOSE');
pool.close([state.relay_url]);
writeState({ ...state, external_status_id: status.id, external_status_created_at: status.created_at });
console.log(`CRAYS BOARD EXTERNAL POST-EOSE PUBLISH PASS: ${status.id}`);
