#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  assert,
  listRelays,
  loadKeys,
  requireCoordinator,
  writeState,
} from './relay-lib.mjs';

/**
 * Create Venue bootstrap — UI-only entry (bespoke scenario: there is NO
 * pre-existing relay; the app itself provisions it during the Maestro flow).
 * Checks the coordinator, clears the device state, proves the run slug is
 * unused, and writes the public-safe scenario state.
 *
 * State file fields (CRAYS_BOARD_QA_STATE, default
 * /tmp/qa-crays-board-create-venue.json):
 *   run           unique run suffix (base36 timestamp)
 *   scenario      "create-venue"
 *   venue_name    the venue name typed into the wizard ("QA Venue <run>")
 *   slug          derived slug (mirrors src/create-venue/model.ts deriveSlug)
 *   admin_pubkey  staff/owner pubkey (keys.json admin; never the secret)
 *   started_at    ISO timestamp
 *   phase         "ready" after bootstrap; "verified" after verify adds:
 *   id / domain / relay_url / base_url   the app-provisioned relay (verifier)
 *   venue_profile_id                     the 30078 profile event id (verifier)
 */

const APP_ID = 'life.crays.board';

// Mirror of src/create-venue/model.ts deriveSlug — keep in sync.
function deriveSlug(name) {
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  return normalized.length > 0 ? normalized : 'venue';
}

const keys = loadKeys();
const run = process.env.QA_RUN || Date.now().toString(36);
const venueName = process.env.QA_VENUE_NAME || `QA Venue ${run}`;
const slug = deriveSlug(venueName);

execFileSync('adb', ['get-state'], { stdio: 'pipe' });
await requireCoordinator();

// Starting truth: no relay owned by a previous run may contain this slug.
const existing = await listRelays(keys);
const collisions = existing.filter((relay) => (relay.domain || '').includes(slug));
assert(collisions.length === 0, `no pre-existing relay domain contains ${slug}`);

execFileSync('adb', ['logcat', '-c'], { stdio: 'pipe' });
execFileSync('adb', ['shell', 'pm', 'clear', APP_ID], { stdio: 'pipe' });

writeState({
  run,
  scenario: 'create-venue',
  venue_name: venueName,
  slug,
  admin_pubkey: keys.admin.pub,
  phase: 'ready',
});
console.log('CRAYS BOARD CREATE VENUE BOOTSTRAP PASS');
