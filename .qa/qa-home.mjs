#!/usr/bin/env node
import { runRelayScreenScenario } from './relay-screen-scenario.mjs';

try {
  runRelayScreenScenario({
    bootstrap: '.qa/relay-bootstrap-home.mjs',
    flow: 'maestro/flows/80-home.yaml',
    scenario: 'home',
    verifiers: ['.qa/verify-home.mjs'],
  });
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: home — ${message}`);
  process.exit(1);
}
