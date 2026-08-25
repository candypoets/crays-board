#!/usr/bin/env node
import { runRelayScreenScenario } from './relay-screen-scenario.mjs';

try {
  await runRelayScreenScenario({
    bootstrap: '.qa/relay-bootstrap-check-in.mjs',
    flow: 'e2e/flows/31-check-in.{profile}.ad',
    scenario: 'check-in',
    verifiers: ['.qa/verify-check-in.mjs'],
    // The flow types the three seeded presentation payloads into the manual
    // entry field; they are synthetic short-lived fixture data, never logged.
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
