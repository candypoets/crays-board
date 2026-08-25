#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { computeRevisionEvidence } from './evidence-lib.mjs';
import { decodePng } from './png-evidence.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const matrixRoot = path.resolve(process.argv[2] ?? path.join(ROOT, 'design', 'ux-map'));
const expectedRunId = process.env.QA_MATRIX_RUN_ID || null;
const contracts = {
  phone: { avd: 'google', width: 1080, height: 2400, density: 420, orientation: 'portrait' },
  tablet: { avd: 'crays_samsung_tab', width: 1600, height: 1000, density: 240, orientation: 'landscape' },
};
const scenarioVerifiers = {
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
};
const requiredFastGates = ['jest-coverage', 'typecheck', 'lint', 'screen-contracts', 'harness-tests', 'android-debug-apk'];
const expectedNames = [];
const seenExpectedNames = new Set();
for (const file of fs.readdirSync(path.join(ROOT, 'e2e', 'flows')).filter((name) => name.endsWith('.ad')).sort()) {
  const flow = fs.readFileSync(path.join(ROOT, 'e2e', 'flows', file), 'utf8');
  for (const match of flow.matchAll(/^\s*screenshot\s+"\$\{AD_ARTIFACTS\}\/([\w-]+)\.png"\s*$/gm)) {
    if (!seenExpectedNames.has(match[1])) expectedNames.push(match[1]);
    seenExpectedNames.add(match[1]);
  }
}
const expectedNameSet = new Set(expectedNames);

function fail(message) {
  throw new Error(`UX matrix verification failed: ${message}`);
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function requireSha(value, label) {
  if (!/^[a-f0-9]{64}$/.test(value ?? '')) fail(`${label} is missing or invalid`);
}

function validateRevision(revision, profile) {
  if (revision?.algorithm !== 'sha256-working-tree-v1') fail(`${profile} revision algorithm is invalid`);
  requireSha(revision.digest, `${profile} revision digest`);
  requireSha(revision.statusSha256, `${profile} revision status hash`);
  for (const componentName of ['source', 'harness', 'flows', 'lockfile']) {
    const component = revision.components?.[componentName];
    requireSha(component?.sha256, `${profile} ${componentName} revision hash`);
    if (!Number.isInteger(component?.fileCount) || component.fileCount < 1 || component.fileCount !== component.files?.length) {
      fail(`${profile} ${componentName} file inventory is invalid`);
    }
    const digest = createHash('sha256');
    let previous = null;
    for (const file of component.files) {
      if (typeof file.path !== 'string' || file.path.length === 0 || file.path.includes('\0')) fail(`${profile} ${componentName} has an invalid path`);
      if (previous !== null && file.path <= previous) fail(`${profile} ${componentName} inventory is not strictly sorted`);
      previous = file.path;
      if (!['present', 'deleted', 'symlink'].includes(file.state)) fail(`${profile} ${file.path} has invalid revision state`);
      if (file.state === 'deleted' && file.sha256 !== null) fail(`${profile} deleted ${file.path} has a content hash`);
      if (file.state !== 'deleted') requireSha(file.sha256, `${profile} ${file.path} hash`);
      digest.update(`${file.path}\0${file.state}\0${file.sha256 ?? '-'}\0`);
    }
    if (digest.digest('hex') !== component.sha256) fail(`${profile} ${componentName} inventory hash does not match`);
  }
  const aggregate = createHash('sha256');
  for (const name of Object.keys(revision.components).sort()) aggregate.update(`${name}\0${revision.components[name].sha256}\0`);
  if (aggregate.digest('hex') !== revision.digest) fail(`${profile} revision aggregate does not match its components`);
}

function validateReceipt(receipt, manifest, profile, contract) {
  if (receipt.schemaVersion !== 1 || receipt.profile !== profile || receipt.runId !== manifest.runId) fail(`${profile} run receipt identity does not match its manifest`);
  if (receipt.status !== 'passed') fail(`${profile} run receipt status is ${receipt.status ?? 'missing'}`);
  validateRevision(receipt.revision, profile);
  if (!['managed', 'external'].includes(receipt.metro?.mode)) fail(`${profile} Metro mode is invalid`);
  if (receipt.metro.mode === 'external') {
    if (!Number.isInteger(receipt.metro.pid) || receipt.metro.pid < 1) fail(`${profile} external Metro PID is missing`);
    if (receipt.metro.cwd !== ROOT) fail(`${profile} external Metro cwd does not match the repository`);
    if (!Array.isArray(receipt.metro.argv)) fail(`${profile} external Metro argv is missing`);
    const portIndex = receipt.metro.argv.indexOf('--port');
    if (!receipt.metro.argv.some((value) => value.includes('/expo'))
      || !receipt.metro.argv.includes('start')
      || portIndex < 0
      || receipt.metro.argv[portIndex + 1] !== '8090') {
      fail(`${profile} external Metro process provenance is invalid`);
    }
    if (!/^\d+$/.test(receipt.metro.processStartTicks ?? '')) fail(`${profile} external Metro start identity is missing`);
  }
  if (receipt.metro?.bundledRevisionDigest !== receipt.revision.digest) fail(`${profile} Metro bundle is not bound to its revision digest`);
  if (receipt.metro?.publicCoordinatorUrl !== receipt.coordinator?.deviceUrl) fail(`${profile} Metro/coordinator device URLs differ`);

  const gates = new Map((receipt.fastGates ?? []).map((gate) => [gate.name, gate]));
  for (const name of requiredFastGates) if (gates.get(name)?.status !== 'pass') fail(`${profile} fast gate ${name} did not pass`);
  if (gates.size !== requiredFastGates.length) fail(`${profile} run receipt has an unexpected fast-gate set`);

  const scenarios = new Map((receipt.scenarios ?? []).map((scenario) => [scenario.name, scenario]));
  if (scenarios.size !== Object.keys(scenarioVerifiers).length) fail(`${profile} run receipt does not contain all scenarios`);
  for (const [name, expectedVerifiers] of Object.entries(scenarioVerifiers)) {
    const scenario = scenarios.get(name);
    if (scenario?.status !== 'pass') fail(`${profile} scenario ${name} did not pass`);
    if (!Array.isArray(scenario.attempts) || scenario.attempts.length < 1) fail(`${profile} scenario ${name} has no attempt evidence`);
    if (scenario.retriesUsed !== scenario.attempts.length - 1) fail(`${profile} scenario ${name} retry count is inconsistent`);
    if (scenario.attempts.at(-1)?.status !== 'pass') fail(`${profile} scenario ${name} final attempt did not pass`);
    const actualVerifiers = (scenario.verifiers ?? []).filter((item) => item.status === 'pass').map((item) => item.name).sort();
    if (JSON.stringify(actualVerifiers) !== JSON.stringify([...expectedVerifiers].sort())) fail(`${profile} scenario ${name} verifier results are incomplete`);
  }

  requireSha(receipt.apk?.host?.sha256, `${profile} host APK hash`);
  requireSha(receipt.apk?.installed?.sha256, `${profile} installed APK hash`);
  if (receipt.apk.host.sha256 !== receipt.apk.installed.sha256 || receipt.apk.host.sha256 !== manifest.apkSha256) fail(`${profile} host, installed, and manifest APK identities differ`);
  if (receipt.apk.host.size !== receipt.apk.installed.size || receipt.apk.host.size < 1) fail(`${profile} installed APK size differs from host`);
  if (receipt.apk.packageName !== 'life.crays.board' || !receipt.apk.installed.basePath?.endsWith('/base.apk')) fail(`${profile} installed package evidence is invalid`);
  if (!Number.isInteger(receipt.apk.installed.versionCode) || !receipt.apk.installed.versionName) fail(`${profile} installed package version evidence is missing`);

  for (const [key, value] of Object.entries(contract)) if (receipt.device?.[key] !== value) fail(`${profile} observed ${key} must be ${value}; received ${receipt.device?.[key]}`);
  if (!receipt.device?.serial || !receipt.device?.model || !Number.isInteger(receipt.device?.apiLevel)) fail(`${profile} observed device identity is incomplete`);
  if (!Number.isInteger(receipt.device?.observations?.surfaceRotation)) fail(`${profile} surface orientation was not observed`);
  const commands = receipt.device?.observations?.commands ?? [];
  for (const expected of ['wm size', 'wm density', 'dumpsys input', 'settings get system user_rotation']) if (!commands.includes(expected)) fail(`${profile} device receipt lacks ${expected} observation`);

  requireSha(receipt.coordinator?.implementationSha256, `${profile} coordinator implementation hash`);
  requireSha(receipt.coordinator?.identityDigest, `${profile} coordinator identity digest`);
  requireSha(receipt.coordinator?.health?.bodySha256, `${profile} coordinator health body hash`);
  if (receipt.coordinator?.health?.status !== 200) fail(`${profile} coordinator health was not observed as HTTP 200`);
  if (!['managed', 'external'].includes(receipt.coordinator?.mode)) fail(`${profile} coordinator mode is invalid`);
  const coordinatorIdentity = {
    url: receipt.coordinator.url,
    mode: receipt.coordinator.mode,
    implementationSha256: receipt.coordinator.implementationSha256,
    health: receipt.coordinator.health,
  };
  if (createHash('sha256').update(JSON.stringify(coordinatorIdentity)).digest('hex') !== receipt.coordinator.identityDigest) {
    fail(`${profile} coordinator identity digest does not match its observations`);
  }
}

const manifests = Object.entries(contracts).map(([profile, contract]) => {
  const profileRoot = path.join(matrixRoot, profile);
  const manifestPath = path.join(profileRoot, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail(`${profile} manifest is missing`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.profile !== profile) fail(`${profile} manifest declares ${manifest.profile}`);
  requireSha(manifest.apkSha256, `${profile} APK hash`);
  for (const [key, value] of Object.entries(contract)) if (manifest.device?.[key] !== value) fail(`${profile} ${key} must be ${value}; received ${manifest.device?.[key]}`);
  const receiptPath = path.join(profileRoot, manifest.receipt?.file ?? '');
  if (manifest.receipt?.file !== 'run-receipt.json' || !fs.existsSync(receiptPath)) fail(`${profile} run receipt is missing`);
  if (sha256(receiptPath) !== manifest.receipt.sha256) fail(`${profile} run receipt hash does not match its manifest`);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (manifest.receipt.revisionDigest !== receipt.revision?.digest) fail(`${profile} manifest revision digest does not match its receipt`);
  validateReceipt(receipt, manifest, profile, contract);

  if (manifest.expectedCount !== expectedNames.length || manifest.capturedCount !== expectedNames.length || manifest.missingCount !== 0) fail(`${profile} is incomplete (${manifest.capturedCount}/${manifest.expectedCount}, ${manifest.missingCount} missing)`);
  if (manifest.sourceRoot !== profile) fail(`${profile} source root must be the isolated profile directory`);
  if (!Array.isArray(manifest.screens) || manifest.screens.length !== expectedNames.length) fail(`${profile} must contain exactly ${expectedNames.length} screen records`);
  const names = new Set();
  for (const screen of manifest.screens) {
    if (names.has(screen.name)) fail(`${profile} contains duplicate screen ${screen.name}`);
    names.add(screen.name);
    if (!expectedNameSet.has(screen.name)) fail(`${profile} contains unexpected screen ${screen.name}`);
    if (!screen.source) fail(`${profile}/${screen.name} has no run-local source provenance`);
    if (screen.status !== 'captured' || screen.w !== contract.width || screen.h !== contract.height) fail(`${profile}/${screen.name} has the wrong capture contract`);
    const file = path.join(profileRoot, 'screens', `${screen.name}.png`);
    if (!fs.existsSync(file)) fail(`${profile}/${screen.name}.png is missing`);
    let decoded;
    try { decoded = decodePng(fs.readFileSync(file), file); } catch (error) { fail(error.message); }
    if (decoded.width !== contract.width || decoded.height !== contract.height) fail(`${profile}/${screen.name}.png has dimensions ${decoded.width}x${decoded.height}`);
    if (sha256(file) !== screen.sha256) fail(`${profile}/${screen.name}.png hash does not match its manifest`);
  }
  for (const name of expectedNames) if (!names.has(name)) fail(`${profile} is missing expected screen ${name}`);
  return { manifest, receipt };
});

const [{ manifest: phone, receipt: phoneReceipt }, { manifest: tablet, receipt: tabletReceipt }] = manifests;
if (!phone.runId || phone.runId !== tablet.runId) fail(`phone and tablet run IDs differ (${phone.runId ?? 'missing'} / ${tablet.runId ?? 'missing'})`);
if (phone.apkSha256 !== tablet.apkSha256) fail('phone and tablet were not captured from the same development APK');
if (phoneReceipt.revision.digest !== tabletReceipt.revision.digest) fail('phone and tablet relevant working-tree revisions differ');
for (const name of ['source', 'harness', 'flows', 'lockfile']) if (phoneReceipt.revision.components[name].sha256 !== tabletReceipt.revision.components[name].sha256) fail(`phone and tablet ${name} hashes differ`);
if (phoneReceipt.coordinator.identityDigest !== tabletReceipt.coordinator.identityDigest) fail('phone and tablet coordinator identities differ');
const phoneNames = phone.screens.map((screen) => screen.name).sort();
const tabletNames = tablet.screens.map((screen) => screen.name).sort();
if (JSON.stringify(phoneNames) !== JSON.stringify(tabletNames)) fail('phone and tablet screen sets differ');
if (expectedRunId && phone.runId !== expectedRunId) fail(`matrix run ID must be ${expectedRunId}; received ${phone.runId}`);
if (process.env.QA_VERIFY_CURRENT_REVISION === '1' && computeRevisionEvidence(ROOT).digest !== phoneReceipt.revision.digest) fail('pending matrix revision differs from the current relevant worktree');

console.log(`UX MATRIX PASS: phone ${expectedNames.length}/${expectedNames.length} + tablet ${expectedNames.length}/${expectedNames.length} · run ${phone.runId} · revision ${phoneReceipt.revision.digest.slice(0, 12)}`);
