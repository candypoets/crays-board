import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadKeys } from './relay-lib.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);

function run(command, args, env) {
  return execFileSync(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit', maxBuffer: 64 * 1024 * 1024 });
}

export function runRelayScreenScenario({ flow, scenario, verifiers = [], bootstrap = '.qa/relay-bootstrap.mjs', envFromState = {} }) {
  const statePath = `/tmp/qa-crays-board-${scenario}.json`;
  const env = { CRAYS_BOARD_QA_STATE: statePath };
  run('adb', ['get-state'], env);
  run('adb', ['logcat', '-c'], env);
  try {
    run(process.execPath, [bootstrap], env);
    if (!existsSync(statePath)) throw new Error(`bootstrap did not write ${statePath}`);
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    // The staff signer for Board scenarios is the venue admin from keys.json;
    // its nsec is passed to Maestro only (never to state or logs). The exec
    // error is sanitized because Node includes the full argv (with the nsec)
    // in failure messages.
    const staffNsec = loadKeys().admin.nsec;
    // envFromState maps extra Maestro env names to state keys (values are
    // JSON-encoded). Use it for fixture data the flow must type into fields —
    // the Maestro JS sandbox has no host IO, so runScript file reads do not
    // work. Never map secrets: argv is sanitized from logs, but state is not.
    const extraEnv = Object.entries(envFromState).flatMap(([name, key]) => {
      if (!(key in state)) throw new Error(`envFromState: bootstrap state has no key '${key}' for ${name}`);
      return ['-e', `${name}=${JSON.stringify(state[key])}`];
    });
    try {
      run(process.env.MAESTRO_CLI || 'maestro', [
        'test',
        '-e', `RELAY_URL=${state.emulator_relay_url}`,
        '-e', `SERVICE_URL=${state.emulator_base_url}`,
        '-e', `QA_NSEC=${staffNsec}`,
        '-e', `AWARD_ID=${state.award_id}`,
        '-e', `AWARD_ID_PREFIX=${state.award_id.slice(0, 12)}`,
        '-e', `ITEM_ADDRESS=${state.product_address}`,
        '-e', `USER_PUBKEY=${state.user_pubkey}`,
        ...extraEnv,
        flow,
      ], env);
    } catch {
      throw new Error(`maestro flow failed: ${flow}`);
    }
    run(process.execPath, ['.qa/relay-verify.mjs'], env);
    for (const verifier of verifiers) run(process.execPath, [verifier], env);
    console.log(`QA PASS: ${scenario}`);
  } finally {
    try { run(process.execPath, ['.qa/relay-teardown.mjs'], env); } catch (error) { console.error(`teardown failed for ${scenario}:`, error.message); }
  }
}
