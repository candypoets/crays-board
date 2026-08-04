#!/usr/bin/env node
/**
 * Independent menu verifier (docs/screens/menu.md, venue-commerce-nip §11).
 *
 * After the flow toggles availability on qa-menu-espresso and renames
 * qa-menu-soup, asserts on the relay — independent of the rendered UI:
 *   - latest 30009 for each edited d carries the exact expected
 *     availability/name, admin-signed, with the SAME d (no duplicates);
 *   - untouched fields (price/currency/section) survive the edit;
 *   - the foreign-publisher d has NO event from the admin key;
 *   - device markers project the items and log the exact published event ids.
 */
import { execFileSync } from 'node:child_process';
import { verifyEvent } from 'nostr-tools';
import { assert, makePool, readState } from './relay-lib.mjs';

const state = readState();
if (!state?.relay_url || !state?.menu_toggle_d) throw new Error('run .qa/relay-bootstrap-menu.mjs first');

const pool = makePool();
const definitions = await pool.querySync([state.relay_url], { kinds: [30009], limit: 100 });
pool.close([state.relay_url]);

const tag = (event, name) => event.tags.find((entry) => entry[0] === name)?.[1];
const withD = (d) => definitions.filter((event) => tag(event, 'd') === d);
// Latest addressable resolution per author (venue-commerce-nip §3.1): latest
// by created_at, ties by higher id.
const latest = (events) =>
  [...events].sort((a, b) => b.created_at - a.created_at || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0))[0];

assert(definitions.every(verifyEvent), 'every menu definition has a valid Nostr signature');

// --- Toggled item: qa-menu-espresso is now unavailable, same d, admin-signed.
const toggleEvents = withD(state.menu_toggle_d);
const adminToggleEvents = toggleEvents.filter((event) => event.pubkey === state.admin_pubkey);
assert(adminToggleEvents.length === 1, `exactly one admin event exists for ${state.menu_toggle_d} (${adminToggleEvents.length} found — no duplicate d)`);
const toggled = latest(toggleEvents);
assert(toggled.pubkey === state.admin_pubkey, 'the latest toggled definition is signed by the admin (staff) key');
assert(tag(toggled, 'availability') === 'unavailable', 'the toggled item is unavailable in the latest definition');
assert(tag(toggled, 'name') === 'QA Espresso', 'the toggle preserved the item name');
assert(tag(toggled, 'price') === '3.00' && tag(toggled, 'currency') === 'EUR', 'the toggle preserved price and currency');
assert(tag(toggled, 'section') === 'Drinks', 'the toggle preserved the section');
assert(toggled.id !== state.menu_item_ids[state.menu_toggle_d], 'the toggle replaced the seeded event (same d, new id)');

// --- Edited item: qa-menu-soup carries the new name, same d, admin-signed.
const editEvents = withD(state.menu_edit_d);
const adminEditEvents = editEvents.filter((event) => event.pubkey === state.admin_pubkey);
assert(adminEditEvents.length === 1, `exactly one admin event exists for ${state.menu_edit_d} (${adminEditEvents.length} found — no duplicate d)`);
const edited = latest(editEvents);
assert(edited.pubkey === state.admin_pubkey, 'the latest edited definition is signed by the admin (staff) key');
assert(tag(edited, 'name') === state.menu_edit_expected_name, `the edited item carries the exact expected name "${state.menu_edit_expected_name}"`);
assert(tag(edited, 'name') !== state.menu_edit_original_name, 'the old name no longer resolves as latest');
assert(tag(edited, 'price') === '6.50' && tag(edited, 'currency') === 'EUR', 'the edit preserved price and currency');
assert(tag(edited, 'section') === 'Mains' && tag(edited, 'position') === '1', 'the edit preserved section and position');
assert(tag(edited, 'availability') === 'available', 'the edit preserved availability');

// --- Foreign-publisher item: the admin key never wrote against its d (MENU-05).
const foreignEvents = withD(state.menu_foreign_d);
assert(foreignEvents.length === 1, `exactly one event exists for ${state.menu_foreign_d} (${foreignEvents.length} found)`);
assert(foreignEvents[0].pubkey === state.menu_foreign_pubkey, 'the foreign item is still the badge-issuer-signed original');
assert(
  !foreignEvents.some((event) => event.pubkey === state.admin_pubkey),
  'the admin key published NOTHING against the foreign d',
);
assert(tag(foreignEvents[0], 'availability') === 'available', 'the foreign item kept its original availability');

// --- Device truth: the app projected the items and logged the exact event
// ids it published. Marker payloads are JSON per the fixed app contract:
//   [crays-board-menu]            {"d":..., "address":..., "name":..., "availability":...}
//   [crays-board-menu-definition] {"id": <event id>, "d":..., "availability":..., "name":...}
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

const projected = markerPayloads('[crays-board-menu]');
for (const d of [state.menu_toggle_d, state.menu_edit_d, state.menu_foreign_d]) {
  assert(projected.some((entry) => JSON.stringify(entry).includes(d)), `app projected menu item ${d}`);
}
const published = markerPayloads('[crays-board-menu-definition]');
assert(published.some((entry) => JSON.stringify(entry).includes(toggled.id)), 'app logged the exact toggle event id that landed on the relay');
assert(published.some((entry) => JSON.stringify(entry).includes(edited.id)), 'app logged the exact edit event id that landed on the relay');
assert(!published.some((entry) => JSON.stringify(entry).includes(state.menu_foreign_d)), 'app never published against the foreign d');

console.log('CRAYS BOARD MENU PASS');
