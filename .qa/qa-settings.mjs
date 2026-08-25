#!/usr/bin/env node
import { runRelayScreenScenario } from './relay-screen-scenario.mjs';

try {
  await runRelayScreenScenario({
    bootstrap: '.qa/relay-bootstrap-settings.mjs',
    flow: 'e2e/flows/60-settings.{profile}.ad',
    scenario: 'settings',
    verifiers: ['.qa/verify-settings.mjs'],
    envFromState: { MEMBERSHIP_D: 'membership_d' },
  });
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: settings — ${message}`);
  process.exit(1);
}
