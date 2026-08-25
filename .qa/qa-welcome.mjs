#!/usr/bin/env node
import { runScreenScenario } from './qa-entry-lib.mjs';

try {
  runScreenScenario({ flow: 'e2e/flows/00-welcome.ad', scenario: 'welcome' });
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: welcome — ${message}`);
  process.exit(1);
}
