import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const LOCAL_AGENT_DEVICE = resolve(PROJECT_ROOT, 'node_modules', '.bin', 'agent-device');

function safeSegment(value, label) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(value)) {
    throw new Error(`${label} contains unsafe path characters: ${value}`);
  }
  return value;
}

const APP_ID = 'life.crays.board';
const DEV_CLIENT_URL = 'exp+crays-board://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8090';

function agentDeviceEnv(serial) {
  return {
    ...process.env,
    AGENT_DEVICE_ANDROID_DEVICE_ALLOWLIST: serial,
  };
}

function agentDevice(command, args, { serial, capture = false } = {}) {
  return execFileSync(process.env.AGENT_DEVICE_CLI || LOCAL_AGENT_DEVICE, [command, ...args], {
    cwd: PROJECT_ROOT,
    env: agentDeviceEnv(serial),
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function deviceNameForProfile() {
  return process.env.QA_DEVICE_PROFILE === 'tablet' ? 'crays samsung tab' : 'google';
}

/** Attach the Expo development client using Agent Device itself.
 *
 * A freshly-cleared Expo client presents a native consent sheet and then its
 * developer menu. Both surfaces are outside the React Native tree, but Agent
 * Device exposes them semantically as Continue and Close. This preflight is
 * intentionally dynamic: established clients skip those presses.
 */
export function prepareAgentDevice({ scenario, serial, deviceName }) {
  const session = `crays-preflight-${safeSegment(scenario, 'scenario')}`;
  const sessionArgs = ['--session', session];
  const openArgs = [
    APP_ID,
    '--platform', 'android',
    '--device', deviceName,
    '--metro-port', '8090',
    '--launch-url', DEV_CLIENT_URL,
    ...sessionArgs,
  ];
  agentDevice('open', [...openArgs, '--relaunch'], { serial });
  try {
    const deadline = Date.now() + 120_000;
    let ready = false;
    while (Date.now() < deadline) {
      const snapshot = agentDevice('snapshot', ['-i', ...sessionArgs], { serial, capture: true });
      if (/\] "Continue"(?:\n|$)/m.test(snapshot)) {
        try {
          agentDevice('press', ['label="Continue"', '--settle', ...sessionArgs], { serial });
        } catch {
          // Expo may finish the native consent transition by briefly returning
          // Android to the launcher. Foreground the now-consented client and
          // keep observing instead of failing or restarting Metro.
          agentDevice('open', [...openArgs, '--relaunch'], { serial });
        }
        continue;
      }
      if (/\] "Close"(?:\n|$)/m.test(snapshot)) {
        // Expo's tool sheet labels its destructive app-closing affordance
        // "Close" on current Android builds. System Back dismisses the sheet
        // and preserves the Board activity we are preparing.
        agentDevice('back', ['--system', '--settle', ...sessionArgs], { serial });
        // Some Android launcher builds also background the activity when the
        // sheet closes. Relaunch it with the freshly prepared runtime binding.
        agentDevice('open', openArgs, { serial });
        continue;
      }
      if (/com\.google\.android\.apps\.nexuslauncher/.test(snapshot)) {
        // The consent/tool-sheet handoff can report success while Android
        // places the launcher in front one frame later. Rebind the same
        // session to the client; Metro and its bundle stay alive.
        agentDevice('open', [...openArgs, '--relaunch'], { serial });
        continue;
      }
      if (/Welcome to Crays Board|People & roles|Venue online|Connected venue|Create venue|Orders|Menu|Events|Invites|Settings/.test(snapshot)) {
        ready = true;
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
    }
    if (!ready) throw new Error('Agent Device could not attach the Expo development client to a semantic Board screen');
  } finally {
    try { agentDevice('close', sessionArgs, { serial }); } catch { /* best-effort preflight cleanup */ }
    // `close` intentionally force-stops the session app. Start the now-
    // consented development client once through Android, then let the replay
    // attach to that foreground process. This avoids a force-stop/open race in
    // which Android occasionally leaves the launcher in front.
    execFileSync('adb', [
      '-s', serial,
      'shell', 'monkey',
      '-p', APP_ID,
      '-c', 'android.intent.category.LAUNCHER',
      '1',
    ], { stdio: 'ignore' });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3_000);
  }
}

export function agentDeviceFlowFor(flow) {
  const profile = process.env.QA_DEVICE_PROFILE;
  if (!flow.includes('{profile}')) return flow;
  if (!['phone', 'tablet'].includes(profile)) {
    throw new Error(`flow ${flow} requires QA_DEVICE_PROFILE=phone or tablet`);
  }
  return flow.replace('{profile}', profile);
}

export function relaySeedUrl({ relayUrl, serviceUrl, nsec }) {
  const url = new URL('craysboard://qa-seed');
  url.searchParams.set('relay', String(relayUrl));
  url.searchParams.set('service', String(serviceUrl));
  url.searchParams.set('nsec', String(nsec));
  // `adb shell` joins argv before the device shell parses it. Escape query
  // separators so `&` cannot background the intent command remotely.
  return url.toString().replaceAll('&', '\\&');
}

export function agentDeviceValuesForFlow(flowSource, values) {
  return Object.fromEntries(Object.entries(values).filter(([name]) => flowSource.includes(`\${${name}}`)));
}

export function seedAgentDeviceApp({ serial, values }) {
  if (!values.RELAY_URL || !values.SERVICE_URL || !values.QA_NSEC) return;
  const seedUrl = relaySeedUrl({
    relayUrl: values.RELAY_URL,
    serviceUrl: values.SERVICE_URL,
    nsec: values.QA_NSEC,
  });
  execFileSync('adb', [
    '-s', serial,
    'shell', 'am', 'start', '-W',
    '-a', 'android.intent.action.VIEW',
    '-d', seedUrl,
    '-n', `${APP_ID}/.MainActivity`,
  ], { stdio: 'ignore', maxBuffer: 64 * 1024 * 1024 });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_500);
}

export function openAgentDeviceReviewSession({ scenario, target, values }) {
  const serial = process.env.ANDROID_SERIAL;
  if (!serial) throw new Error('ANDROID_SERIAL is required for Agent Device review');
  const deviceName = deviceNameForProfile();
  prepareAgentDevice({ scenario: `review-${scenario}`, serial, deviceName });
  seedAgentDeviceApp({ serial, values });
  const session = `crays-review-${safeSegment(scenario, 'scenario')}`;
  agentDevice('open', [
    `craysboard://qa-handoff?target=${safeSegment(target, 'target')}`,
    '--platform', 'android',
    '--device', deviceName,
    '--metro-port', '8090',
    '--session', session,
  ], { serial });
  return { session, serial, deviceName, target };
}

export function closeAgentDeviceReviewSession({ session, serial }) {
  try { agentDevice('close', ['--session', session], { serial }); } catch { /* scoped best effort */ }
}

export function runAgentDeviceFlow({ flow, scenario, values = {} }) {
  const selectedFlow = agentDeviceFlowFor(flow);
  const serial = process.env.ANDROID_SERIAL;
  if (!serial) throw new Error('ANDROID_SERIAL is required for Agent Device QA');
  const deviceName = deviceNameForProfile();
  prepareAgentDevice({ scenario, serial, deviceName });

  // Relay journeys use the dev-only public seed route as their prepared
  // starting condition. Dispatch it outside replay so Android receives one
  // argument-safe URL and the saved .ad plan contains no private-key-bearing
  // deep link. The flow immediately proves the resulting orders surface.
  seedAgentDeviceApp({ serial, values });

  const outputRoot = resolve(
    process.env.QA_AGENT_DEVICE_OUTPUT_ROOT || '/tmp/crays-board-agent-device-artifacts',
    safeSegment(scenario, 'scenario'),
  );
  mkdirSync(outputRoot, { recursive: true });

  const args = [
    'test', selectedFlow,
    '--device', deviceName,
    '--fail-fast',
    '--retries', '0',
    '--timeout', process.env.QA_AGENT_DEVICE_TIMEOUT_MS || '720000',
    '--artifacts-dir', outputRoot,
    '--reporter', 'default',
  ];
  const flowSource = readFileSync(resolve(PROJECT_ROOT, selectedFlow), 'utf8');
  for (const [name, value] of Object.entries(agentDeviceValuesForFlow(flowSource, values))) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`invalid Agent Device variable: ${name}`);
    args.push('-e', `${name}=${String(value)}`);
  }

  execFileSync(process.env.AGENT_DEVICE_CLI || LOCAL_AGENT_DEVICE, args, {
    cwd: PROJECT_ROOT,
    env: agentDeviceEnv(serial),
    stdio: 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
}
