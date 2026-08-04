#!/usr/bin/env node
import { runRelayScreenScenario } from './relay-screen-scenario.mjs';

try {
  runRelayScreenScenario({
    bootstrap: '.qa/relay-bootstrap-settings.mjs',
    flow: 'maestro/flows/60-settings.yaml',
    scenario: 'settings',
    verifiers: ['.qa/verify-settings.mjs'],
  });
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: settings — ${message}`);
  process.exit(1);
}
