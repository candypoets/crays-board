#!/usr/bin/env node
import { runScreenScenario } from './qa-entry-lib.mjs';

try {
  runScreenScenario({ flow: 'maestro/flows/00-welcome.yaml', scenario: 'welcome' });
} catch (error) {
  const message = String(error?.shortMessage || error?.message || error).split('\n')[0];
  console.error(`QA FAIL: welcome — ${message}`);
  process.exit(1);
}
