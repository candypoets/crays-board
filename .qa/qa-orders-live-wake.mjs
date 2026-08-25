#!/usr/bin/env node
import { runRelayScreenScenario } from './relay-screen-scenario.mjs';

try {
  await runRelayScreenScenario({
    flow: 'e2e/battle/10-orders-live-wake.{profile}.ad',
    scenario: 'orders-live-wake',
    backgroundBeforeFlow: '.qa/publish-order-after-eose.mjs',
    verifiers: ['.qa/verify-order-live-wake.mjs'],
    reviewTarget: 'orders',
  });
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: orders-live-wake — ${message}`);
  process.exit(1);
}
