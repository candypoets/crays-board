import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgentDeviceFlow } from './agent-device-runner.mjs';

export const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const APP_ID = 'life.crays.board';
export const STATE_FILE = process.env.QA_ENTRY_STATE || '/tmp/qa-crays-board-entry.json';

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: PROJECT_ROOT,
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.capture ? 'pipe' : 'inherit',
  });
}

export function requireAndroidDevice() {
  const state = run('adb', ['get-state'], { capture: true }).toString().trim();
  if (state !== 'device') throw new Error(`Expected one Android device, received: ${state}`);
}

export function bootstrapEntryQa(scenario) {
  requireAndroidDevice();
  run('adb', ['logcat', '-c']);
  run('adb', ['shell', 'pm', 'clear', APP_ID]);
  // QA state carries only public-safe values: app id, scenario name, timestamps.
  // Never write keys, tokens, URLs with credentials, or presentation payloads here.
  const state = { appId: APP_ID, scenario, startedAt: new Date().toISOString() };
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  chmodSync(STATE_FILE, 0o600);
  console.log(`QA bootstrap ready: ${scenario}`);
}

export function readLogcat() {
  return run('adb', ['logcat', '-d'], { capture: true }).toString();
}

export function parseMarker(logcat, marker) {
  const records = parseMarkers(logcat, marker);
  if (records.length === 0) throw new Error(`Missing ${marker} in Android logcat`);
  return records.at(-1);
}

export function parseMarkers(logcat, marker) {
  return logcat
    .split('\n')
    .filter((line) => line.includes(marker))
    .map((line) => {
      const start = line.indexOf(marker) + marker.length;
      let payload = line.slice(start).trim();
      if (payload.startsWith("'")) payload = payload.slice(1);
      if (payload.endsWith("'")) payload = payload.slice(0, -1);
      return JSON.parse(payload);
    });
}

export function teardownEntryQa() {
  requireAndroidDevice();
  run('adb', ['shell', 'pm', 'clear', APP_ID]);
  if (existsSync(STATE_FILE)) rmSync(STATE_FILE);
  console.log(`QA teardown complete: cleared ${APP_ID}`);
}

export function readQaState() {
  if (!existsSync(STATE_FILE)) throw new Error(`Run bootstrap first; missing ${STATE_FILE}`);
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

export function runScreenScenario({ flow, scenario, verify }) {
  bootstrapEntryQa(scenario);
  try {
    runAgentDeviceFlow({ flow, scenario });
    if (verify) verify();
    console.log(`QA PASS: ${scenario}`);
  } finally {
    teardownEntryQa();
  }
}
