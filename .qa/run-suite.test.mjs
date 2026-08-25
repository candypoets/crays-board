import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { emulatorUrl } from './relay-lib.mjs';

test('managed Metro receives the same coordinator through the Android host alias', () => {
  assert.equal(emulatorUrl('http://127.0.0.1:7823'), 'http://10.0.2.2:7823');

  const suiteSource = readFileSync(new URL('./run-suite.mjs', import.meta.url), 'utf8');
  assert.match(
    suiteSource,
    /EXPO_PUBLIC_CRAYS_COORDINATOR_URL:\s*emulatorUrl\(COORDINATOR_URL\)/,
    'the runner must inject its owned coordinator into the Metro bundle',
  );
});

test('managed mode refuses to adopt a Metro bundle with unknown public env', () => {
  const suiteSource = readFileSync(new URL('./run-suite.mjs', import.meta.url), 'utf8');
  assert.match(suiteSource, /QA_MANAGE_METRO === '0'/);
  assert.match(suiteSource, /unknown bundled environment/);
});

test('an explicitly external Metro is canonical only with local process provenance', () => {
  const suiteSource = readFileSync(new URL('./run-suite.mjs', import.meta.url), 'utf8');
  assert.match(suiteSource, /function externalMetroEvidence/);
  assert.match(suiteSource, /external Metro cwd must be/);
  assert.match(suiteSource, /EXPO_PUBLIC_CRAYS_COORDINATOR_URL/);
  assert.match(suiteSource, /external Metro must explicitly own port 8090/);
  assert.doesNotMatch(suiteSource, /activeReceipt\.metro\.mode === 'managed'/);
});

test('the suite isolates Agent Device output and UX maps by device profile', () => {
  const suiteSource = readFileSync(new URL('./run-suite.mjs', import.meta.url), 'utf8');
  assert.match(suiteSource, /QA_DEVICE_PROFILE/);
  assert.match(suiteSource, /QA_AGENT_DEVICE_OUTPUT_ROOT:\s*agentDeviceOutputRoot/);
  assert.match(suiteSource, /design\/.ux-map-pending/);
  assert.match(suiteSource, /publish-ux-matrix\.mjs/);
  assert.match(suiteSource, /phone profile requires a portrait window below 600dp/);
  assert.match(suiteSource, /tablet profile requires a landscape window at least 600dp wide/);
  assert.match(suiteSource, /Installed development client already matches the current APK/);
  assert.match(suiteSource, /android-debug-apk/);
  assert.match(suiteSource, /observeAndroidDevice/);
  assert.match(suiteSource, /observeInstalledPackage/);
  assert.match(suiteSource, /computeRevisionEvidence/);
  assert.match(suiteSource, /run-receipt\.json/);
  assert.match(suiteSource, /cannot override its required AVD/);
});

test('a transient scenario retry cannot duplicate canonical screenshots', () => {
  const suiteSource = readFileSync(new URL('./run-suite.mjs', import.meta.url), 'utf8');
  assert.match(suiteSource, /QA_SCENARIO_RETRIES/);
  assert.match(suiteSource, /failed-attempts/);
  assert.match(suiteSource, /renameSync\(failedSource/);
  assert.match(suiteSource, /duplicate screenshots/);
});

test('post-EOSE battle coverage is available without changing the canonical 12-scenario matrix', () => {
  const suiteSource = readFileSync(new URL('./run-suite.mjs', import.meta.url), 'utf8');
  assert.match(suiteSource, /KNOWN_SCENARIOS = \[\.\.\.DEFAULT_SCENARIOS, 'orders-live-wake'\]/);
  assert.match(suiteSource, /'orders-live-wake': \['relay-verify', 'verify-order-live-wake'\]/);
  assert.match(suiteSource, /scenarios\.length === DEFAULT_SCENARIOS\.length/);
});

test('interactive review runs are recorded separately and never publish a UX matrix', () => {
  const suiteSource = readFileSync(new URL('./run-suite.mjs', import.meta.url), 'utf8');
  assert.match(suiteSource, /mode: REVIEW_MODE \? 'interactive-review' : 'automated'/);
  assert.match(suiteSource, /persistReceipt\(failedReview \? 'failed' : 'reviewed'\)/);
  assert.match(suiteSource, /Interactive review summary/);
});
