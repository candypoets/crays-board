import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { agentDeviceFlowFor, agentDeviceValuesForFlow, relaySeedUrl } from './agent-device-runner.mjs';

test('profiled Agent Device flows resolve to the selected device layout', () => {
  const previous = process.env.QA_DEVICE_PROFILE;
  process.env.QA_DEVICE_PROFILE = 'tablet';
  try {
    assert.equal(
      agentDeviceFlowFor('e2e/flows/40-people.{profile}.ad'),
      'e2e/flows/40-people.tablet.ad',
    );
    assert.equal(agentDeviceFlowFor('e2e/flows/00-welcome.ad'), 'e2e/flows/00-welcome.ad');
  } finally {
    if (previous === undefined) delete process.env.QA_DEVICE_PROFILE;
    else process.env.QA_DEVICE_PROFILE = previous;
  }
});

test('profiled Agent Device flows reject an unknown layout', () => {
  const previous = process.env.QA_DEVICE_PROFILE;
  process.env.QA_DEVICE_PROFILE = 'watch';
  try {
    assert.throws(
      () => agentDeviceFlowFor('e2e/flows/40-people.{profile}.ad'),
      /requires QA_DEVICE_PROFILE=phone or tablet/,
    );
  } finally {
    if (previous === undefined) delete process.env.QA_DEVICE_PROFILE;
    else process.env.QA_DEVICE_PROFILE = previous;
  }
});

test('relay seed URLs survive Android remote-shell parsing', () => {
  const url = relaySeedUrl({ relayUrl: 'ws://10.0.2.2:1234', serviceUrl: 'http://10.0.2.2:5678', nsec: 'nsec1fixture' });
  assert.match(url, /^craysboard:\/\/qa-seed\?relay=ws%3A%2F%2F10\.0\.2\.2%3A1234\\&service=/);
  assert.equal(url.match(/\\&/g)?.length, 2);
});

test('only variables referenced by a saved flow reach Agent Device argv', () => {
  assert.deepEqual(
    agentDeviceValuesForFlow('fill "id=\"name\"" "${QA_VENUE_NAME}"', {
      QA_VENUE_NAME: 'QA Venue',
      QA_NSEC: 'nsec1private',
      RELAY_URL: 'ws://fixture',
    }),
    { QA_VENUE_NAME: 'QA Venue' },
  );
});

test('Expo consent may foreground the launcher without failing preflight', () => {
  const source = readFileSync(new URL('./agent-device-runner.mjs', import.meta.url), 'utf8');
  assert.match(source, /briefly returning\s*\/\/ Android to the launcher/);
  assert.match(source, /agentDevice\('open', openArgs/);
  assert.match(source, /com\\\.google\\\.android\\\.apps\\\.nexuslauncher/);
});
