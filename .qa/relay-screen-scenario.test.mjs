import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { encodeAgentDeviceEnvValue } from './relay-screen-scenario.mjs';

test('Agent Device env keeps scalar selectors unquoted', () => {
  assert.equal(encodeAgentDeviceEnvValue('qa-membership-run'), 'qa-membership-run');
});

test('Agent Device env JSON-encodes signed presentation fixtures', () => {
  const presentation = { kind: 27236, tags: [['event', '31923:admin:event']] };
  assert.equal(encodeAgentDeviceEnvValue(presentation), JSON.stringify(presentation));
});

test('battle helpers start only after fixture bootstrap and must finish before verification', () => {
  const source = readFileSync(new URL('./relay-screen-scenario.mjs', import.meta.url), 'utf8');
  const bootstrap = source.indexOf("run(process.execPath, [bootstrap], env)");
  const background = source.indexOf('backgroundProcess(backgroundBeforeFlow, env)');
  const replay = source.indexOf('runAgentDeviceFlow({');
  const completion = source.indexOf('await background.completed');
  const verification = source.indexOf("run(process.execPath, ['.qa/relay-verify.mjs'], env)", completion);
  assert.ok(bootstrap < background && background < replay && replay < completion && completion < verification);
  assert.match(source, /killGroup\(background\.child\)/);
});
