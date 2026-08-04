#!/usr/bin/env node
import { runRelayScreenScenario } from './relay-screen-scenario.mjs';

try {
  runRelayScreenScenario({
    bootstrap: '.qa/relay-bootstrap-people.mjs',
    flow: 'maestro/flows/40-people.yaml',
    scenario: 'people',
    verifiers: ['.qa/verify-people.mjs'],
  });
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: people — ${message}`);
  process.exit(1);
}
