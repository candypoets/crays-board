#!/usr/bin/env node
import { runRelayScreenScenario } from './relay-screen-scenario.mjs';

try {
  runRelayScreenScenario({
    bootstrap: '.qa/relay-bootstrap-events.mjs',
    flow: 'maestro/flows/30-events.yaml',
    scenario: 'events',
    verifiers: ['.qa/verify-events.mjs'],
  });
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: events — ${message}`);
  process.exit(1);
}
