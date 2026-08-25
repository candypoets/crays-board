#!/usr/bin/env node
import { runRelayScreenScenario } from './relay-screen-scenario.mjs';

try {
  await runRelayScreenScenario({
    bootstrap: '.qa/relay-bootstrap-home.mjs',
    flow: 'e2e/flows/80-home.{profile}.ad',
    scenario: 'home',
    verifiers: ['.qa/verify-home.mjs'],
  });
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: home — ${message}`);
  process.exit(1);
}
