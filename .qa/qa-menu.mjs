#!/usr/bin/env node
import { runRelayScreenScenario } from './relay-screen-scenario.mjs';

try {
  runRelayScreenScenario({
    bootstrap: '.qa/relay-bootstrap-menu.mjs',
    flow: 'maestro/flows/20-menu.yaml',
    scenario: 'menu',
    verifiers: ['.qa/verify-menu.mjs'],
  });
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: menu — ${message}`);
  process.exit(1);
}
