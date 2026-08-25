#!/usr/bin/env node
import { runRelayScreenScenario } from './relay-screen-scenario.mjs';

try {
  await runRelayScreenScenario({
    bootstrap: '.qa/relay-bootstrap-menu.mjs',
    flow: 'e2e/flows/20-menu.{profile}.ad',
    scenario: 'menu',
    verifiers: ['.qa/verify-menu.mjs'],
  });
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: menu — ${message}`);
  process.exit(1);
}
