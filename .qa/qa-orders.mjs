#!/usr/bin/env node
import { runRelayScreenScenario } from './relay-screen-scenario.mjs';

try {
  runRelayScreenScenario({
    flow: 'maestro/flows/10-orders.yaml',
    scenario: 'orders',
    verifiers: ['.qa/verify-order-accepted.mjs'],
  });
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: orders — ${message}`);
  process.exit(1);
}
