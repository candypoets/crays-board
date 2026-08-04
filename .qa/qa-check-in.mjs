#!/usr/bin/env node
import { runRelayScreenScenario } from './relay-screen-scenario.mjs';

try {
  runRelayScreenScenario({
    bootstrap: '.qa/relay-bootstrap-check-in.mjs',
    flow: 'maestro/flows/31-check-in.yaml',
    scenario: 'check-in',
    verifiers: ['.qa/verify-check-in.mjs'],
    // The flow types the three seeded presentation payloads into the manual
    // entry field; they are fixture data (synthetic, 1h expiry), never logged.
    envFromState: {
      PRESENTATION_VALID: 'presentation',
      PRESENTATION_FULFILLED: 'presentation_fulfilled',
      PRESENTATION_WRONG_EVENT: 'presentation_wrong_event',
    },
  });
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: check-in — ${message}`);
  process.exit(1);
}
