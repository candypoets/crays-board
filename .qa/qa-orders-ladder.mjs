#!/usr/bin/env node
import { runRelayScreenScenario } from './relay-screen-scenario.mjs';

try {
  runRelayScreenScenario({
    bootstrap: '.qa/relay-bootstrap-orders-ladder.mjs',
    flow: 'maestro/flows/11-orders-ladder.yaml',
    scenario: 'orders-ladder',
    verifiers: ['.qa/verify-order-ladder.mjs'],
  });
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: orders-ladder — ${message}`);
  process.exit(1);
}
