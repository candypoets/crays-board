#!/usr/bin/env node
import { runRelayScreenScenario } from './relay-screen-scenario.mjs';

try {
  await runRelayScreenScenario({
    bootstrap: '.qa/relay-bootstrap-orders-ladder.mjs',
    flow: 'e2e/flows/11-orders-ladder.{profile}.ad',
    scenario: 'orders-ladder',
    verifiers: ['.qa/verify-order-ladder.mjs'],
    envFromState: {
      DECLINE_AWARD_ID_PREFIX: 'decline_award_id_prefix',
      CANCEL_AWARD_ID_PREFIX: 'cancel_award_id_prefix',
    },
  });
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: orders-ladder — ${message}`);
  process.exit(1);
}
