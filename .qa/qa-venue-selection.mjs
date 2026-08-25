#!/usr/bin/env node
import { runRelayScreenScenario } from './relay-screen-scenario.mjs';

try {
  await runRelayScreenScenario({
    flow: 'e2e/flows/05-venue-selection.ad',
    scenario: 'venue-selection',
  });
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: venue-selection — ${message}`);
  process.exit(1);
}
