import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { makeTestPng } from './test-png.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const VERIFY = path.join(ROOT, '.qa', 'verify-ux-matrix.mjs');
const contracts = {
  phone: { avd: 'google', width: 1080, height: 2400, density: 420, orientation: 'portrait' },
  tablet: { avd: 'crays_samsung_tab', width: 1600, height: 1000, density: 240, orientation: 'landscape' },
};
const verifierCatalog = {
  welcome: [], 'venue-selection': ['relay-verify'], orders: ['relay-verify', 'verify-order-accepted'],
  'orders-ladder': ['relay-verify', 'verify-order-ladder'], menu: ['relay-verify', 'verify-menu'],
  events: ['relay-verify', 'verify-events'], 'check-in': ['relay-verify', 'verify-check-in'],
  people: ['relay-verify', 'verify-people'], invites: ['relay-verify', 'verify-invites'],
  settings: ['relay-verify', 'verify-settings'], home: ['relay-verify', 'verify-home'],
  'create-venue': ['verify-create-venue'],
};
const fastGates = ['jest-coverage', 'typecheck', 'lint', 'screen-contracts', 'harness-tests', 'android-debug-apk'];
const expectedNames = [];
const seenExpectedNames = new Set();
for (const file of readdirSync(path.join(ROOT, 'e2e', 'flows')).filter((name) => name.endsWith('.ad')).sort()) {
  const flow = readFileSync(path.join(ROOT, 'e2e', 'flows', file), 'utf8');
  for (const match of flow.matchAll(/^\s*screenshot\s+"\$\{AD_ARTIFACTS\}\/([\w-]+)\.png"\s*$/gm)) {
    if (!seenExpectedNames.has(match[1])) expectedNames.push(match[1]);
    seenExpectedNames.add(match[1]);
  }
}

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function revisionFixture(seed = 'same') {
  const components = {};
  for (const name of ['source', 'harness', 'flows', 'lockfile']) {
    const file = { path: `${name}/fixture`, state: 'present', sha256: hash(`${seed}-${name}`) };
    components[name] = { sha256: hash(`${file.path}\0${file.state}\0${file.sha256}\0`), fileCount: 1, files: [file] };
  }
  const aggregate = createHash('sha256');
  for (const name of Object.keys(components).sort()) aggregate.update(`${name}\0${components[name].sha256}\0`);
  return { algorithm: 'sha256-working-tree-v1', digest: aggregate.digest('hex'), headCommit: '1'.repeat(40), dirty: true, statusSha256: hash(seed), components };
}

function coordinatorFixture(implementationSha256 = 'c'.repeat(64)) {
  const normalized = { url: 'http://127.0.0.1:7823', mode: 'managed', implementationSha256, health: { status: 200, bodySha256: hash('ok') } };
  return { ...normalized, identityDigest: hash(JSON.stringify(normalized)), deviceUrl: 'http://10.0.2.2:7823' };
}

function receiptFixture(profile, device) {
  const revision = revisionFixture();
  return {
    schemaVersion: 1, runId: 'paired-run', profile, status: 'passed',
    revision,
    fastGates: fastGates.map((name) => ({ name, status: 'pass', code: 0, signal: null, timedOut: false })),
    scenarios: Object.entries(verifierCatalog).map(([name, verifiers]) => ({
      name, status: 'pass', retriesUsed: 0,
      attempts: [{ attempt: 1, status: 'pass', code: 0, signal: null, timedOut: false }],
      verifiers: verifiers.map((verifier) => ({ name: verifier, status: 'pass' })),
    })),
    apk: {
      packageName: 'life.crays.board', installedThisRun: true,
      host: { path: 'android/app-debug.apk', sha256: 'a'.repeat(64), size: 42 },
      installed: { basePath: '/data/app/life.crays.board/base.apk', sha256: 'a'.repeat(64), size: 42, versionCode: 1, versionName: '0.1.0' },
    },
    device: {
      ...device, serial: `emulator-${profile}`, model: `QA ${profile}`, product: profile, apiLevel: 36, widthDp: 411,
      observations: { surfaceRotation: profile === 'phone' ? 0 : 1, userRotation: profile === 'phone' ? 0 : 1, commands: ['wm size', 'wm density', 'dumpsys input', 'settings get system user_rotation'] },
    },
    coordinator: coordinatorFixture(),
    metro: { url: 'http://127.0.0.1:8090', mode: 'managed', publicCoordinatorUrl: 'http://10.0.2.2:7823', bundledRevisionDigest: revision.digest },
  };
}

function writeReceipt(root, profile, receipt, manifest) {
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  writeFileSync(path.join(root, profile, 'run-receipt.json'), bytes);
  manifest.receipt = { file: 'run-receipt.json', sha256: hash(bytes), revisionDigest: receipt.revision.digest };
  writeFileSync(path.join(root, profile, 'manifest.json'), JSON.stringify(manifest));
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'crays-matrix-test-'));
  const state = {};
  for (const [profile, device] of Object.entries(contracts)) {
    const screensDir = path.join(root, profile, 'screens');
    mkdirSync(screensDir, { recursive: true });
    const png = makeTestPng(device.width, device.height);
    const screens = [];
    for (const name of expectedNames) {
      writeFileSync(path.join(screensDir, `${name}.png`), png);
      screens.push({ name, status: 'captured', w: device.width, h: device.height, source: `${name}/takeScreenshot/${name}.png`, sha256: hash(png) });
    }
    const receipt = receiptFixture(profile, device);
    const manifest = { profile, runId: 'paired-run', apkSha256: 'a'.repeat(64), device: receipt.device, sourceRoot: profile, expectedCount: expectedNames.length, capturedCount: expectedNames.length, missingCount: 0, screens };
    writeReceipt(root, profile, receipt, manifest);
    state[profile] = { receipt, manifest };
  }
  return { root, state };
}

function runVerifier(root, overrides = {}) {
  const env = { ...process.env, ...overrides };
  delete env.QA_MATRIX_RUN_ID;
  if (!('QA_VERIFY_CURRENT_REVISION' in overrides)) delete env.QA_VERIFY_CURRENT_REVISION;
  return spawnSync(process.execPath, [VERIFY, root], { encoding: 'utf8', env });
}

test('accepts complete same-revision receipts with decodable PNG evidence', () => {
  const fx = fixture();
  try {
    const result = runVerifier(fx.root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /UX MATRIX PASS/);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test('accepts a verified persistent external Metro for canonical evidence', () => {
  const fx = fixture();
  try {
    for (const profile of Object.keys(contracts)) {
      fx.state[profile].receipt.metro = {
        ...fx.state[profile].receipt.metro,
        mode: 'external',
        pid: 1234,
        cwd: ROOT,
        argv: ['node', `${ROOT}/node_modules/.bin/expo`, 'start', '--dev-client', '--port', '8090'],
        processStartTicks: '123456',
      };
      writeReceipt(fx.root, profile, fx.state[profile].receipt, fx.state[profile].manifest);
    }
    const result = runVerifier(fx.root);
    assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test('rejects external Metro evidence without process provenance', () => {
  const fx = fixture();
  try {
    fx.state.phone.receipt.metro.mode = 'external';
    writeReceipt(fx.root, 'phone', fx.state.phone.receipt, fx.state.phone.manifest);
    const result = runVerifier(fx.root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /external Metro PID is missing/);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test('rejects evidence from different runs', () => {
  const fx = fixture();
  try {
    fx.state.tablet.receipt.runId = 'different-run';
    fx.state.tablet.manifest.runId = 'different-run';
    writeReceipt(fx.root, 'tablet', fx.state.tablet.receipt, fx.state.tablet.manifest);
    const result = runVerifier(fx.root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /run IDs differ/);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test('rejects phone and tablet from different dirty source revisions', () => {
  const fx = fixture();
  try {
    fx.state.tablet.receipt.revision = revisionFixture('changed-source');
    fx.state.tablet.receipt.metro.bundledRevisionDigest = fx.state.tablet.receipt.revision.digest;
    writeReceipt(fx.root, 'tablet', fx.state.tablet.receipt, fx.state.tablet.manifest);
    const result = runVerifier(fx.root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /working-tree revisions differ/);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test('rejects an installed APK identity mismatch', () => {
  const fx = fixture();
  try {
    fx.state.phone.receipt.apk.installed.sha256 = 'b'.repeat(64);
    writeReceipt(fx.root, 'phone', fx.state.phone.receipt, fx.state.phone.manifest);
    const result = runVerifier(fx.root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /host, installed, and manifest APK identities differ/);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test('rejects different coordinator implementations across profiles', () => {
  const fx = fixture();
  try {
    fx.state.tablet.receipt.coordinator = { ...coordinatorFixture('d'.repeat(64)) };
    writeReceipt(fx.root, 'tablet', fx.state.tablet.receipt, fx.state.tablet.manifest);
    const result = runVerifier(fx.root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /coordinator identities differ/);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test('rejects a receipt whose independent verifier did not pass', () => {
  const fx = fixture();
  try {
    fx.state.phone.receipt.scenarios.find((scenario) => scenario.name === 'orders')
      .verifiers.find((verifier) => verifier.name === 'verify-order-accepted').status = 'not-confirmed';
    writeReceipt(fx.root, 'phone', fx.state.phone.receipt, fx.state.phone.manifest);
    const result = runVerifier(fx.root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /scenario orders verifier results are incomplete/);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test('publish-mode verification rejects evidence from a non-current revision', () => {
  const fx = fixture();
  try {
    const result = runVerifier(fx.root, { QA_VERIFY_CURRENT_REVISION: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /revision differs from the current relevant worktree/);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test('rejects a signature-only fake PNG even when its manifest hash matches', () => {
  const fx = fixture();
  try {
    const fake = Buffer.alloc(24);
    fake.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    fake.writeUInt32BE(1080, 16);
    fake.writeUInt32BE(2400, 20);
    const name = expectedNames[0];
    writeFileSync(path.join(fx.root, 'phone', 'screens', `${name}.png`), fake);
    fx.state.phone.manifest.screens.find((screen) => screen.name === name).sha256 = hash(fake);
    writeReceipt(fx.root, 'phone', fx.state.phone.receipt, fx.state.phone.manifest);
    const result = runVerifier(fx.root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not a PNG|truncated|missing/);
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});
