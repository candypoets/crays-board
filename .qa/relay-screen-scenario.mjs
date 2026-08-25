import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadKeys } from './relay-lib.mjs';
import {
  closeAgentDeviceReviewSession,
  openAgentDeviceReviewSession,
  runAgentDeviceFlow,
} from './agent-device-runner.mjs';
import {
  clearReviewDescriptor,
  createReviewDescriptor,
  waitForReviewStop,
} from './review-mode.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);

export function encodeAgentDeviceEnvValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function run(command, args, env) {
  return execFileSync(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit', maxBuffer: 64 * 1024 * 1024 });
}

function killGroup(child, signal = 'SIGTERM') {
  if (!child?.pid || child.exitCode !== null) return;
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* already exited */ } }
}

function backgroundProcess(script, env) {
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    detached: true,
  });
  const completed = new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`background QA helper ${script} failed (${code ?? signal})`));
    });
  });
  return { child, completed };
}

export async function runRelayScreenScenario({
  flow,
  scenario,
  verifiers = [],
  bootstrap = '.qa/relay-bootstrap.mjs',
  envFromState = {},
  backgroundBeforeFlow,
  reviewTarget = scenario,
}) {
  const statePath = `/tmp/qa-crays-board-${scenario}.json`;
  const env = { CRAYS_BOARD_QA_STATE: statePath };
  let background;
  let review;
  let descriptor;
  run('adb', ['get-state'], env);
  // Every relay-backed journey starts from the same public entry state. This
  // makes the first semantic readiness condition deterministic and prevents a
  // previous scenario's persisted venue from racing the seed deep link.
  run('adb', ['shell', 'pm', 'clear', 'life.crays.board'], env);
  run('adb', ['logcat', '-c'], env);
  try {
    run(process.execPath, [bootstrap], env);
    if (!existsSync(statePath)) throw new Error(`bootstrap did not write ${statePath}`);
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    // The staff signer for Board scenarios is the venue admin from keys.json;
    // its nsec is passed to Agent Device only (never to state or logs). The exec
    // error is sanitized because Node includes the full argv (with the nsec)
    // in failure messages.
    const staffNsec = loadKeys().admin.nsec;
    // envFromState maps extra Agent Device variables to state keys (values are
    // JSON-encoded). Use it for scoped synthetic fixture data the flow must
    // type into fields. Failures sanitize argv; never map private keys,
    // payment credentials, production proofs, or other durable secrets.
    const extraValues = Object.fromEntries(Object.entries(envFromState).map(([name, key]) => {
      if (!(key in state)) throw new Error(`envFromState: bootstrap state has no key '${key}' for ${name}`);
      const value = state[key];
      // Object fixtures such as signed check-in presentations must be JSON;
      // scalar selectors such as a membership d must remain unquoted so the
      // resulting testID matches the native accessibility id.
      return [name, encodeAgentDeviceEnvValue(value)];
    }));
    const values = {
      RELAY_URL: state.emulator_relay_url,
      SERVICE_URL: state.emulator_base_url,
      QA_NSEC: staffNsec,
      AWARD_ID: state.award_id,
      AWARD_ID_PREFIX: state.award_id.slice(0, 12),
      ITEM_ADDRESS: state.product_address,
      USER_PUBKEY: state.user_pubkey,
      ...extraValues,
    };

    if (process.env.QA_REVIEW_MODE === '1') {
      // Prove that the fixture is valid before handing a live app to a human
      // or design agent. Scenario mutation verifiers intentionally do not run:
      // the reviewer is free to navigate without following a scripted path.
      run(process.execPath, ['.qa/relay-verify.mjs'], env);
      review = openAgentDeviceReviewSession({ scenario, target: reviewTarget, values });
      descriptor = createReviewDescriptor({
        scenario,
        profile: process.env.QA_DEVICE_PROFILE || 'phone',
        ...review,
      });
      console.log('\nDESIGN REVIEW READY');
      console.log(`  screen: ${descriptor.profile} / ${scenario} / ${reviewTarget}`);
      console.log('  inspect: npm run qa:review -- device snapshot -i');
      console.log('  navigate: npm run qa:review -- device press \'id="nav-orders"\' --settle');
      console.log('  finish: npm run qa:review -- stop\n');
      await waitForReviewStop(descriptor);
      console.log(`DESIGN REVIEW COMPLETE: ${scenario}`);
      return;
    }

    if (backgroundBeforeFlow) background = backgroundProcess(backgroundBeforeFlow, env);
    try {
      runAgentDeviceFlow({
        flow,
        scenario,
        values,
      });
    } catch {
      throw new Error(`Agent Device flow failed: ${flow}`);
    }
    if (background) await background.completed;
    run(process.execPath, ['.qa/relay-verify.mjs'], env);
    for (const verifier of verifiers) run(process.execPath, [verifier], env);
    console.log(`QA PASS: ${scenario}`);
  } finally {
    if (background) killGroup(background.child);
    if (review) closeAgentDeviceReviewSession(review);
    if (descriptor) clearReviewDescriptor(descriptor);
    try { run(process.execPath, ['.qa/relay-teardown.mjs'], env); } catch (error) { console.error(`teardown failed for ${scenario}:`, error.message); }
    try { run('adb', ['shell', 'pm', 'clear', 'life.crays.board'], env); } catch (error) { console.error(`app-state teardown failed for ${scenario}:`, error.message); }
  }
}
