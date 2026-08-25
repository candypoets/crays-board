#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadKeys } from './relay-lib.mjs';
import { runAgentDeviceFlow } from './agent-device-runner.mjs';

/**
 * Create Venue scenario runner — BESPOKE (not runRelayScreenScenario):
 * there is no pre-existing relay. The app itself provisions exactly one
 * venue relay during the Agent Device flow, and teardown deletes exactly that
 * relay (recorded by the verifier) plus its volume.
 *
 * Lifecycle:
 *  1. Bootstrap (.qa/relay-bootstrap-create-venue.mjs) — UI-only: coordinator
 *     health, slug-collision check, logcat + pm clear, public-safe state.
 *  2. Exercise — e2e/flows/70-create-venue.ad drives welcome → Create
 *     venue → wizard (unique name via QA_VENUE_NAME, staff nsec via QA_NSEC)
 *     → submit → provisioning → success → Open venue.
 *  3. Verify — .qa/verify-create-venue.mjs proves coordinator + relay truth.
 *  4. Teardown (finally) — .qa/relay-teardown.mjs with CRAYS_BOARD_QA_STATE
 *     when a relay was recorded, then pm clear and state removal.
 */

const root = resolve(new URL('..', import.meta.url).pathname);
const statePath = '/tmp/qa-crays-board-create-venue.json';
const env = { ...process.env, CRAYS_BOARD_QA_STATE: statePath };

const run = (command, args) =>
  execFileSync(command, args, { cwd: root, env, stdio: 'inherit', maxBuffer: 64 * 1024 * 1024 });

function teardown() {
  let recorded;
  try {
    recorded = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    recorded = undefined;
  }
  if (recorded?.id) {
    try {
      run(process.execPath, ['.qa/relay-teardown.mjs']);
    } catch (error) {
      console.error(`teardown failed for create-venue:`, error.message);
    }
  }
  try {
    run('adb', ['shell', 'pm', 'clear', 'life.crays.board']);
  } catch {
    // Device may be gone; nothing more to clean.
  }
  rmSync(statePath, { force: true });
}

try {
  run('adb', ['get-state']);
  run(process.execPath, ['.qa/relay-bootstrap-create-venue.mjs']);
  if (!existsSync(statePath)) throw new Error(`bootstrap did not write ${statePath}`);
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  try {
    // The staff signer is the keys.json admin (imported inside the wizard).
    // Its nsec reaches Agent Device only — never state or logs; the exec error is
    // sanitized because Node includes full argv (with the nsec) in failures.
    const staffNsec = loadKeys().admin.nsec;
    try {
      runAgentDeviceFlow({
        flow: 'e2e/flows/70-create-venue.ad',
        scenario: 'create-venue',
        values: { QA_VENUE_NAME: state.venue_name, QA_NSEC: staffNsec },
      });
    } catch {
      throw new Error('Agent Device flow failed: e2e/flows/70-create-venue.ad');
    }
    run(process.execPath, ['.qa/verify-create-venue.mjs']);
    console.log('QA PASS: create-venue');
  } finally {
    teardown();
  }
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: create-venue — ${message}`);
  process.exit(1);
}
