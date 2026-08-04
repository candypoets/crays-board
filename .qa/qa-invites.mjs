#!/usr/bin/env node
import { runRelayScreenScenario } from './relay-screen-scenario.mjs';

try {
  runRelayScreenScenario({
    bootstrap: '.qa/relay-bootstrap-invites.mjs',
    flow: 'maestro/flows/50-invites.yaml',
    scenario: 'invites',
    verifiers: ['.qa/verify-invites.mjs'],
  });
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: invites — ${message}`);
  process.exit(1);
}
