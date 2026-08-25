#!/usr/bin/env node
import { runRelayScreenScenario } from './relay-screen-scenario.mjs';

try {
  await runRelayScreenScenario({
    bootstrap: '.qa/relay-bootstrap-people.mjs',
    flow: 'e2e/flows/40-people.{profile}.ad',
    scenario: 'people',
    verifiers: ['.qa/verify-people.mjs'],
  });
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: people — ${message}`);
  process.exit(1);
}
