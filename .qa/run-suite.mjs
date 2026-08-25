#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emulatorUrl, loadKeys, nip98Header } from './relay-lib.mjs';
import {
  assertRevisionEqual,
  computeRevisionEvidence,
  coordinatorEvidence,
  observeAndroidDevice,
  observeInstalledPackage,
  sha256File,
} from './evidence-lib.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const LOCK_DIR = '/tmp/crays-board-qa-suite.lock';
const COORDINATOR_URL = (process.env.COORDINATOR_URL || 'http://127.0.0.1:7823').replace(/\/$/, '');
const SCENARIO_TIMEOUT_MS = Number(process.env.QA_SCENARIO_TIMEOUT_MS || 12 * 60_000);
const COMMAND_TIMEOUT_MS = Number(process.env.QA_COMMAND_TIMEOUT_MS || 5 * 60_000);
const SCENARIO_RETRIES = Number(process.env.QA_SCENARIO_RETRIES ?? 1);
const DEVICE_PROFILE = process.env.QA_DEVICE_PROFILE || 'phone';
const REVIEW_MODE = process.env.QA_REVIEW_MODE === '1';
const DEVICE_CONTRACTS = {
  phone: { avd: 'google', width: 1080, height: 2400, density: 420 },
  tablet: { avd: 'crays_samsung_tab', width: 1600, height: 1000, density: 240 },
};
const APP_ID = 'life.crays.board';
const DEBUG_APK = `${ROOT}/android/app/build/outputs/apk/debug/app-debug.apk`;
const DEFAULT_SCENARIOS = [
  'welcome',
  'venue-selection',
  'orders',
  'orders-ladder',
  'menu',
  'events',
  'check-in',
  'people',
  'invites',
  'settings',
  'home',
  'create-venue',
];
const KNOWN_SCENARIOS = [...DEFAULT_SCENARIOS, 'orders-live-wake'];
const SCENARIO_VERIFIERS = {
  welcome: [],
  'venue-selection': ['relay-verify'],
  orders: ['relay-verify', 'verify-order-accepted'],
  'orders-ladder': ['relay-verify', 'verify-order-ladder'],
  menu: ['relay-verify', 'verify-menu'],
  events: ['relay-verify', 'verify-events'],
  'check-in': ['relay-verify', 'verify-check-in'],
  people: ['relay-verify', 'verify-people'],
  invites: ['relay-verify', 'verify-invites'],
  settings: ['relay-verify', 'verify-settings'],
  home: ['relay-verify', 'verify-home'],
  'create-venue': ['verify-create-venue'],
  'orders-live-wake': ['relay-verify', 'verify-order-live-wake'],
};

let activeGroup = null;
let coordinator = null;
let metro = null;
let coordinatorDb = null;
let lockOwned = false;
let clientInstalledThisRun = false;
let clientVerifiedThisRun = false;
let activeReceipt = null;
let activeReceiptPath = null;

if (!['phone', 'tablet'].includes(DEVICE_PROFILE)) {
  throw new Error(`QA_DEVICE_PROFILE must be phone or tablet, received: ${DEVICE_PROFILE}`);
}
if (!Number.isInteger(SCENARIO_RETRIES) || SCENARIO_RETRIES < 0 || SCENARIO_RETRIES > 3) {
  throw new Error(`QA_SCENARIO_RETRIES must be an integer from 0 to 3, received: ${SCENARIO_RETRIES}`);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function connectedAndroidSerial() {
  const output = execFileSync('adb', ['devices'], { encoding: 'utf8' });
  const serials = output
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[0] && parts[1] === 'device')
    .map((parts) => parts[0]);
  if (serials.length !== 1) throw new Error(`expected exactly one ready Android device, found ${serials.length}`);
  return serials[0];
}

function acquireLock() {
  try {
    mkdirSync(LOCK_DIR);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const ownerFile = `${LOCK_DIR}/pid`;
    const owner = existsSync(ownerFile) ? Number(readFileSync(ownerFile, 'utf8').trim()) : NaN;
    if (processAlive(owner)) {
      throw new Error(`another Crays Board QA suite owns ${LOCK_DIR} (pid ${owner})`);
    }
    rmSync(LOCK_DIR, { recursive: true, force: true });
    mkdirSync(LOCK_DIR);
  }
  const fd = openSync(`${LOCK_DIR}/pid`, 'wx', 0o600);
  try {
    writeSync(fd, `${process.pid}\n`);
  } finally {
    closeSync(fd);
  }
  lockOwned = true;
}

function killGroup(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* already exited */ }
  }
}

function run(command, args, { cwd = ROOT, env = {}, timeoutMs = COMMAND_TIMEOUT_MS, label = command } = {}) {
  return new Promise((resolvePromise) => {
    console.log(`\n▶ ${label}`);
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      detached: true,
    });
    activeGroup = child;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.error(`TIMEOUT after ${Math.round(timeoutMs / 1000)}s: ${label}`);
      killGroup(child);
      setTimeout(() => killGroup(child, 'SIGKILL'), 3_000).unref();
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      if (activeGroup === child) activeGroup = null;
      resolvePromise({ ok: false, code: null, timedOut, error });
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (activeGroup === child) activeGroup = null;
      resolvePromise({ ok: code === 0 && !timedOut, code, signal, timedOut });
    });
  });
}

function receiptResult(result) {
  return {
    status: result?.ok ? 'pass' : 'fail',
    code: result?.code ?? null,
    signal: result?.signal ?? null,
    timedOut: Boolean(result?.timedOut),
    ...(result?.error ? { error: String(result.error.message || result.error).split('\n')[0] } : {}),
  };
}

function persistReceipt(status = activeReceipt?.status ?? 'running', failure = null) {
  if (!activeReceipt || !activeReceiptPath) return;
  activeReceipt.status = status;
  activeReceipt.updatedAt = new Date().toISOString();
  if (status !== 'running') activeReceipt.completedAt = activeReceipt.updatedAt;
  if (failure) activeReceipt.failure = String(failure.message || failure).split('\n')[0];
  writeFileSync(activeReceiptPath, `${JSON.stringify(activeReceipt, null, 2)}\n`, { mode: 0o600 });
}

async function fetchText(url, timeoutMs = 2_000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  return { response, text: await response.text() };
}

async function waitFor(url, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await fetchText(url);
      if (result.response.ok) return result.text;
      lastError = new Error(`HTTP ${result.response.status}: ${result.text}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError?.message || 'timeout'}`);
}

async function coordinatorResponds() {
  try {
    const { response } = await fetchText(`${COORDINATOR_URL}/healthz`);
    return response.ok;
  } catch {
    return false;
  }
}

async function verifyCoordinatorAuth(keys) {
  const url = `${COORDINATOR_URL}/relays`;
  const response = await fetch(url, {
    headers: { Authorization: nip98Header(url, 'GET', '', keys.admin.priv) },
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`coordinator auth probe failed at ${url}: HTTP ${response.status} ${body}`);
  }
}

async function startCoordinator(artifactDir) {
  const keys = loadKeys();
  const manage = process.env.QA_MANAGE_COORDINATOR !== '0';
  if (!manage) {
    const healthBody = await waitFor(`${COORDINATOR_URL}/healthz`, 'external coordinator', 5_000);
    await verifyCoordinatorAuth(keys);
    const implementationSha256 = process.env.QA_COORDINATOR_IDENTITY_SHA256;
    const evidence = coordinatorEvidence({ url: COORDINATOR_URL, mode: 'external', implementationSha256, healthStatus: 200, healthBody });
    console.log(`Using external coordinator: ${COORDINATOR_URL}`);
    return { ...evidence, deviceUrl: emulatorUrl(COORDINATOR_URL) };
  }
  if (await coordinatorResponds()) {
    throw new Error(
      `${COORDINATOR_URL} is already occupied; refusing to adopt an unowned coordinator. ` +
      'Stop it, choose another COORDINATOR_URL, or set QA_MANAGE_COORDINATOR=0 explicitly.',
    );
  }

  const sourceRoot = process.env.COORDINATOR_SOURCE_ROOT || '/root/code/strfry-badge-node';
  const binary = process.env.COORDINATOR_BIN || `${sourceRoot}/target/debug/strfry-badge-coordinator`;
  if (process.env.QA_COORDINATOR_BUILD !== '0') {
    const built = await run('cargo', ['build', '-p', 'strfry-badge-coordinator'], {
      cwd: sourceRoot,
      label: 'Build current QA coordinator',
      timeoutMs: 10 * 60_000,
      env: { CARGO_TERM_COLOR: 'always' },
    });
    if (!built.ok) throw new Error('coordinator build failed');
  }
  if (!existsSync(binary)) throw new Error(`coordinator binary not found: ${binary}`);

  const parsed = new URL(COORDINATOR_URL);
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new Error(`managed coordinator requires a loopback http URL, received ${COORDINATOR_URL}`);
  }
  const listen = `${parsed.hostname}:${parsed.port || '80'}`;
  const runId = `${process.pid}-${Date.now()}`;
  coordinatorDb = `/tmp/qa-coordinator-craysboard-${runId}.sqlite3`;
  const logPath = `${artifactDir}/coordinator.log`;
  const logFd = openSync(logPath, 'a', 0o600);
  coordinator = spawn(binary, [], {
    cwd: sourceRoot,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      LISTEN_ADDR: listen,
      DB_PATH: coordinatorDb,
      NIP98_BASE_URL: COORDINATOR_URL,
      COORDINATOR_ADMIN_PUBKEYS: keys.admin.pub,
      RELAY_IMAGE: process.env.RELAY_IMAGE || 'strfry-badge-relay-node:local',
      RELAY_DOMAIN_SUFFIX: process.env.RELAY_DOMAIN_SUFFIX || 'test.local',
      NUTS_PAYMENT_SERVICE_PUBKEY: process.env.NUTS_PAYMENT_SERVICE_PUBKEY || keys.payment_service.pub,
      DEV_DIRECT_PORTS: 'true',
      CREATE_COOLDOWN_SECONDS: '0',
      MAX_RELAYS_PER_OWNER: '100',
    },
  });
  closeSync(logFd);
  const healthBody = await Promise.race([
    waitFor(`${COORDINATOR_URL}/healthz`, 'managed coordinator', 30_000),
    new Promise((_, reject) => coordinator.once('exit', (code, signal) => {
      reject(new Error(`managed coordinator exited before readiness (${code ?? signal}); see ${logPath}`));
    })),
  ]);
  await verifyCoordinatorAuth(keys);
  console.log(`Managed coordinator ready: ${COORDINATOR_URL} (log: ${logPath})`);
  const evidence = coordinatorEvidence({
    url: COORDINATOR_URL,
    mode: 'managed',
    implementationSha256: sha256File(binary),
    healthStatus: 200,
    healthBody,
  });
  return { ...evidence, deviceUrl: emulatorUrl(COORDINATOR_URL) };
}

function externalMetroEvidence() {
  const pid = Number(execFileSync('lsof', ['-tiTCP:8090', '-sTCP:LISTEN'], { encoding: 'utf8' })
    .split('\n')
    .map((value) => value.trim())
    .find(Boolean));
  if (!processAlive(pid)) throw new Error('external Metro listener PID could not be resolved');

  const cwd = realpathSync(`/proc/${pid}/cwd`);
  const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
  const environment = new Map(
    readFileSync(`/proc/${pid}/environ`, 'utf8')
      .split('\0')
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf('=');
        return [entry.slice(0, separator), entry.slice(separator + 1)];
      }),
  );
  const expectedCoordinatorUrl = emulatorUrl(COORDINATOR_URL);
  if (cwd !== ROOT) throw new Error(`external Metro cwd must be ${ROOT}; received ${cwd}`);
  if (!argv.some((value) => value.includes('/expo')) || !argv.includes('start')) {
    throw new Error(`external Metro listener is not an Expo start process: ${argv.join(' ')}`);
  }
  const portIndex = argv.indexOf('--port');
  if (portIndex < 0 || argv[portIndex + 1] !== '8090') {
    throw new Error(`external Metro must explicitly own port 8090: ${argv.join(' ')}`);
  }
  if (environment.get('EXPO_PUBLIC_CRAYS_COORDINATOR_URL') !== expectedCoordinatorUrl) {
    throw new Error(
      `external Metro coordinator must be ${expectedCoordinatorUrl}; received ` +
      `${environment.get('EXPO_PUBLIC_CRAYS_COORDINATOR_URL') || 'unset'}`,
    );
  }
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').trim().split(/\s+/);
  return {
    mode: 'external',
    pid,
    cwd,
    argv,
    processStartTicks: stat[21] || null,
    publicCoordinatorUrl: expectedCoordinatorUrl,
  };
}

async function startMetro(artifactDir) {
  let healthyMetro = false;
  try {
    const { response, text } = await fetchText('http://127.0.0.1:8090/status');
    healthyMetro = response.ok && text.includes('packager-status:running');
  } catch { /* start our own */ }
  if (healthyMetro) {
    if (process.env.QA_MANAGE_METRO === '0') {
      const evidence = externalMetroEvidence();
      console.log(`Using verified external Metro on port 8090 (pid ${evidence.pid})`);
      return evidence;
    }
    throw new Error(
      'port 8090 already has a Metro process with unknown bundled environment; ' +
      'stop it or set QA_MANAGE_METRO=0 only after starting it with the expected coordinator URL',
    );
  }

  const logPath = `${artifactDir}/metro.log`;
  const logFd = openSync(logPath, 'a', 0o600);
  metro = spawn('npm', ['run', 'start:qa'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      CI: '1',
      EXPO_PUBLIC_CRAYS_COORDINATOR_URL: emulatorUrl(COORDINATOR_URL),
    },
  });
  closeSync(logFd);
  await waitFor('http://127.0.0.1:8090/status', 'Metro', 90_000);
  console.log(`Managed Metro ready on 8090 (log: ${logPath})`);
  return {
    mode: 'managed',
    pid: metro.pid,
    cwd: ROOT,
    publicCoordinatorUrl: emulatorUrl(COORDINATOR_URL),
  };
}

async function devicePreflight() {
  let device = await run('adb', ['get-state'], { label: 'Android device', timeoutMs: 15_000 });
  if (!device.ok && process.env.QA_RECOVER_DEVICE !== '0') {
    const recovered = await run('scripts/emulator-headless.sh', [process.env.QA_AVD || 'google'], {
      label: 'Recover headless Android emulator',
      timeoutMs: 4 * 60_000,
    });
    if (!recovered.ok) throw new Error('Android emulator recovery failed');
    device = await run('adb', ['get-state'], { label: 'Recovered Android device', timeoutMs: 15_000 });
  }
  if (!device.ok) throw new Error('Android device preflight failed');

  const agentDevice = await run(process.env.AGENT_DEVICE_CLI || `${ROOT}/node_modules/.bin/agent-device`, ['--version'], {
    label: 'Agent Device CLI',
    timeoutMs: 15_000,
  });
  if (!agentDevice.ok) throw new Error('Agent Device CLI preflight failed');

  let packageCheck = await run('adb', ['shell', 'pm', 'path', APP_ID], {
    label: 'Installed development client',
    timeoutMs: 15_000,
  });
  if (packageCheck.ok && !clientVerifiedThisRun) {
    const packagePath = execFileSync('adb', ['shell', 'pm', 'path', APP_ID], { encoding: 'utf8', timeout: 15_000 })
      .split('\n')
      .map((line) => line.trim().replace(/^package:/, ''))
      .find((line) => line.endsWith('/base.apk'));
    if (packagePath && existsSync(DEBUG_APK)) {
      try {
        const remoteHash = execFileSync('adb', ['shell', 'sha256sum', packagePath], {
          encoding: 'utf8',
          timeout: 30_000,
        }).trim().split(/\s+/)[0];
        clientVerifiedThisRun = remoteHash === sha256File(DEBUG_APK);
        if (clientVerifiedThisRun) console.log('Installed development client already matches the current APK');
      } catch { /* install below */ }
    }
  }
  if (!packageCheck.ok || !clientVerifiedThisRun) {
    if (!existsSync(DEBUG_APK)) throw new Error(`current development APK is missing: ${DEBUG_APK}`);
    const installed = await run('adb', ['install', '-r', DEBUG_APK], {
      label: packageCheck.ok ? 'Refresh development client from current APK' : 'Install development client after device recovery',
      timeoutMs: 3 * 60_000,
    });
    if (!installed.ok) throw new Error('development client installation failed');
    clientInstalledThisRun = true;
    clientVerifiedThisRun = true;
    packageCheck = await run('adb', ['shell', 'pm', 'path', APP_ID], {
      label: 'Verify installed development client',
      timeoutMs: 15_000,
    });
    if (!packageCheck.ok) throw new Error('development client is still unavailable after installation');
  }
  const reverse = await run('adb', ['reverse', 'tcp:8090', 'tcp:8090'], {
    label: 'Reverse Metro port to Android',
    timeoutMs: 15_000,
  });
  if (!reverse.ok) throw new Error('adb reverse for Metro failed');

  const contract = DEVICE_CONTRACTS[DEVICE_PROFILE];
  const serial = connectedAndroidSerial();
  const observed = observeAndroidDevice(serial);
  const { width: pixelWidth, height: pixelHeight, density } = observed;
  if (process.env.QA_AVD && process.env.QA_AVD !== contract.avd) {
    throw new Error(`${DEVICE_PROFILE} profile cannot override its required AVD ${contract.avd} with ${process.env.QA_AVD}`);
  }
  const expectedAvd = contract.avd;
  if (observed.avd !== expectedAvd) {
    throw new Error(`${DEVICE_PROFILE} profile requires AVD ${expectedAvd}; connected emulator is ${observed.avd || 'unknown'}`);
  }
  if (pixelWidth !== contract.width || pixelHeight !== contract.height || density !== contract.density) {
    throw new Error(
      `${DEVICE_PROFILE} profile requires ${contract.width}x${contract.height} at ${contract.density}dpi; ` +
      `received ${pixelWidth}x${pixelHeight} at ${density}dpi`,
    );
  }
  const widthDp = pixelWidth / (density / 160);
  const compact = widthDp < 600;
  const portrait = pixelHeight > pixelWidth;
  if (DEVICE_PROFILE === 'phone' && (!compact || !portrait)) {
    throw new Error(
      `phone profile requires a portrait window below 600dp; received ${pixelWidth}x${pixelHeight} at ${density}dpi (${Math.round(widthDp)}dp wide)`,
    );
  }
  if (DEVICE_PROFILE === 'tablet' && (compact || portrait)) {
    throw new Error(
      `tablet profile requires a landscape window at least 600dp wide; received ${pixelWidth}x${pixelHeight} at ${density}dpi (${Math.round(widthDp)}dp wide)`,
    );
  }
  console.log(`Device profile verified: ${DEVICE_PROFILE} · ${pixelWidth}x${pixelHeight} · ${Math.round(widthDp)}dp wide`);
  return observed;
}

function selectedScenarios() {
  const requested = (process.env.QA_SCENARIOS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (requested.length === 0) return DEFAULT_SCENARIOS;
  for (const scenario of requested) {
    if (!KNOWN_SCENARIOS.includes(scenario)) throw new Error(`unknown QA scenario: ${scenario}`);
  }
  return requested;
}

async function cleanup() {
  killGroup(activeGroup);
  activeGroup = null;
  if (metro) {
    killGroup(metro);
    metro = null;
  }
  if (coordinator) {
    killGroup(coordinator);
    coordinator = null;
  }
  if (coordinatorDb) {
    for (const suffix of ['', '-shm', '-wal']) rmSync(`${coordinatorDb}${suffix}`, { force: true });
    coordinatorDb = null;
  }
  if (lockOwned) {
    rmSync(LOCK_DIR, { recursive: true, force: true });
    lockOwned = false;
  }
}

async function main() {
  acquireLock();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const matrixRunId = process.env.QA_MATRIX_RUN_ID || stamp;
  if (!/^[A-Za-z0-9._-]+$/.test(matrixRunId)) {
    throw new Error('QA_MATRIX_RUN_ID may contain only letters, digits, dots, underscores, and hyphens');
  }
  const artifactDir = `/tmp/crays-board-qa-suite-${DEVICE_PROFILE}-${stamp}`;
  const agentDeviceOutputRoot = `${artifactDir}/agent-device/${DEVICE_PROFILE}`;
  const scenarios = selectedScenarios();
  mkdirSync(artifactDir, { recursive: true });
  const results = [];
  const revisionAtStart = computeRevisionEvidence(ROOT);
  activeReceiptPath = `${artifactDir}/run-receipt.json`;
  activeReceipt = {
    schemaVersion: 1,
    mode: REVIEW_MODE ? 'interactive-review' : 'automated',
    runId: matrixRunId,
    profile: DEVICE_PROFILE,
    status: 'running',
    startedAt: new Date().toISOString(),
    retryPolicy: { maximumRetriesPerScenario: SCENARIO_RETRIES },
    revision: revisionAtStart,
    fastGates: [],
    scenarios: [],
    apk: null,
    device: null,
    coordinator: null,
    metro: null,
  };
  persistReceipt();

  console.log(`Crays Board QA suite artifacts: ${artifactDir}`);
  if (process.env.QA_SKIP_FAST_GATES === '1') {
    console.log('Skipping fast gates for this explicit visual iteration; canonical runs must omit QA_SKIP_FAST_GATES.');
  } else {
    for (const [name, command, args] of [
      ['jest-coverage', 'npm', ['run', 'test:coverage', '--', `--coverageDirectory=${artifactDir}/coverage`]],
      ['typecheck', 'npm', ['run', 'typecheck']],
      ['lint', 'npm', ['run', 'lint']],
      ['screen-contracts', 'npm', ['run', 'qa:contracts']],
      ['harness-tests', 'npm', ['run', 'qa:harness-tests']],
    ]) {
      const result = await run(command, args, { label: name });
      results.push({ name, ...result });
      activeReceipt.fastGates.push({ name, ...receiptResult(result) });
      persistReceipt();
      if (!result.ok) throw new Error(`fast gate failed: ${name}`);
    }
    if (scenarios.length === DEFAULT_SCENARIOS.length && scenarios.every((name) => DEFAULT_SCENARIOS.includes(name))) {
      const androidBuild = await run('./gradlew', ['app:assembleDebug'], {
        cwd: `${ROOT}/android`,
        label: 'android-debug-apk',
        timeoutMs: 10 * 60_000,
      });
      results.push({ name: 'android-debug-apk', ...androidBuild });
      activeReceipt.fastGates.push({ name: 'android-debug-apk', ...receiptResult(androidBuild) });
      persistReceipt();
      if (!androidBuild.ok) throw new Error('fast gate failed: android-debug-apk');
    }
  }

  // Pin every adb child process before the first device command. `adb`
  // otherwise rejects even a healthy target when a stale/offline emulator is
  // also listed, and later scenarios can fail for reasons unrelated to the app.
  const deviceSerial = connectedAndroidSerial();
  process.env.ANDROID_SERIAL = deviceSerial;
  activeReceipt.device = await devicePreflight();
  activeReceipt.apk = observeInstalledPackage(deviceSerial, APP_ID, DEBUG_APK, { installedThisRun: clientInstalledThisRun });
  const metroEvidence = await startMetro(artifactDir);
  if (scenarios.some((scenario) => scenario !== 'welcome')) activeReceipt.coordinator = await startCoordinator(artifactDir);
  activeReceipt.metro = {
    ...metroEvidence,
    url: 'http://127.0.0.1:8090',
    bundledRevisionDigest: revisionAtStart.digest,
  };
  persistReceipt();

  for (const scenario of scenarios) {
    let result = null;
    const scenarioReceipt = { name: scenario, status: 'running', retriesUsed: 0, attempts: [], verifiers: [] };
    activeReceipt.scenarios.push(scenarioReceipt);
    for (let attempt = 0; attempt <= SCENARIO_RETRIES; attempt += 1) {
      try {
        await devicePreflight();
        result = await run('npm', ['run', `qa:${scenario}`], {
          label: `Agent Device: ${scenario}${attempt ? ` (retry ${attempt}/${SCENARIO_RETRIES})` : ''}`,
          timeoutMs: SCENARIO_TIMEOUT_MS,
          env: {
            COORDINATOR_URL,
            ANDROID_SERIAL: deviceSerial,
            QA_AGENT_DEVICE_OUTPUT_ROOT: agentDeviceOutputRoot,
          },
        });
      } catch (error) {
        result = { ok: false, code: null, error };
      }
      scenarioReceipt.attempts.push({ attempt: attempt + 1, ...receiptResult(result) });
      scenarioReceipt.retriesUsed = attempt;
      persistReceipt();
      if (result.ok || attempt === SCENARIO_RETRIES) break;

      // Keep failed-attempt diagnostics, but outside the canonical source
      // root so a successful retry cannot introduce duplicate screenshots.
      const failedSource = `${agentDeviceOutputRoot}/${scenario}`;
      if (existsSync(failedSource)) {
        const failedDir = `${artifactDir}/failed-attempts`;
        mkdirSync(failedDir, { recursive: true });
        renameSync(failedSource, `${failedDir}/${scenario}-attempt-${attempt + 1}`);
      }
      console.warn(
        `Retrying ${scenario} after failed attempt ${attempt + 1}; diagnostics retained in ${artifactDir}/failed-attempts.`,
      );
    }
    scenarioReceipt.status = result.ok ? 'pass' : 'fail';
    const receiptVerifiers = REVIEW_MODE ? ['relay-verify'] : SCENARIO_VERIFIERS[scenario];
    scenarioReceipt.verifiers = receiptVerifiers.map((name) => ({
      name,
      status: result.ok ? 'pass' : 'not-confirmed',
      basis: REVIEW_MODE
        ? 'fixture integrity was independently verified before interactive handoff'
        : 'scenario runner exits zero only after its independent verifier completes',
    }));
    persistReceipt();
    results.push({ name: scenario, ...result });
  }

  // Re-observe the device and installed package after every scenario. This
  // catches emulator replacement or package drift during a long paired run.
  activeReceipt.device = observeAndroidDevice(deviceSerial);
  activeReceipt.apk = observeInstalledPackage(deviceSerial, APP_ID, DEBUG_APK, { installedThisRun: clientInstalledThisRun });
  assertRevisionEqual(revisionAtStart, computeRevisionEvidence(ROOT));

  if (REVIEW_MODE) {
    const failedReview = results.some((result) => scenarios.includes(result.name) && !result.ok);
    persistReceipt(failedReview ? 'failed' : 'reviewed');
    console.log(`\nInteractive review summary: ${failedReview ? 'failed' : 'complete'}`);
    return;
  }

  const failedScenarioNames = new Set(
    results.filter((result) => scenarios.includes(result.name) && !result.ok).map((result) => result.name),
  );
  const canonicalCapture =
    scenarios.length === DEFAULT_SCENARIOS.length &&
    scenarios.every((name) => DEFAULT_SCENARIOS.includes(name)) &&
    failedScenarioNames.size === 0 &&
    process.env.QA_SKIP_FAST_GATES !== '1';
  persistReceipt(canonicalCapture ? 'passed' : (failedScenarioNames.size ? 'failed' : 'partial'));
  const pendingMatrixRoot = `${ROOT}/design/.ux-map-pending/${matrixRunId}`;
  const mapOut = canonicalCapture
    ? `${pendingMatrixRoot}/${DEVICE_PROFILE}`
    : `${artifactDir}/ux-map-preview/${DEVICE_PROFILE}`;
  const mapArgs = [
    '.qa/build-ux-map.mjs',
    '--profile', DEVICE_PROFILE,
    '--from', agentDeviceOutputRoot,
    '--out', mapOut,
    '--run-id', matrixRunId,
    '--apk-sha256', activeReceipt.apk.host.sha256,
    '--receipt', activeReceiptPath,
    ...(canonicalCapture ? ['--hub-root', pendingMatrixRoot] : []),
    ...(!canonicalCapture ? ['--allow-missing'] : []),
  ];
  if (!canonicalCapture) {
    console.log(
      `Canonical ${DEVICE_PROFILE} map preserved: this run is partial or has failed scenarios (${[...failedScenarioNames].join(', ') || 'subset selected'}).`,
    );
  }
  const map = await run(process.execPath, mapArgs, { label: `Rebuild ${DEVICE_PROFILE} infinite UX map` });
  results.push({ name: 'ux-map', ...map });
  if (canonicalCapture && map.ok) {
    const counterpart = DEVICE_PROFILE === 'phone' ? 'tablet' : 'phone';
    const counterpartManifest = `${pendingMatrixRoot}/${counterpart}/manifest.json`;
    if (existsSync(counterpartManifest)) {
      const publish = await run(
        process.execPath,
        ['.qa/publish-ux-matrix.mjs', pendingMatrixRoot],
        { label: 'Verify and atomically publish paired UX matrix' },
      );
      results.push({ name: 'ux-matrix-publish', ...publish });
    } else {
      console.log(`Paired matrix staged: waiting for ${counterpart} run ${matrixRunId}; canonical maps are unchanged.`);
    }
  }

  console.log('\nQA suite summary');
  for (const result of results) {
    const detail = result.timedOut ? 'timeout' : result.ok ? 'pass' : `fail (${result.code ?? result.signal ?? 'spawn error'})`;
    console.log(`  ${result.ok ? '✓' : '✗'} ${result.name}: ${detail}`);
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length) process.exitCode = 1;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.error(`\nReceived ${signal}; stopping owned QA processes.`);
    void cleanup().finally(() => process.exit(128 + (signal === 'SIGINT' ? 2 : 15)));
  });
}

try {
  await main();
} catch (error) {
  console.error(`\nQA suite aborted: ${error.message}`);
  persistReceipt('failed', error);
  process.exitCode = 1;
} finally {
  await cleanup();
}
