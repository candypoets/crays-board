#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readReviewDescriptor, requestReviewStop } from './review-mode.mjs';

const args = process.argv.slice(2);
const command = args[0] || 'status';
const profile = args[1] || 'phone';
const scenario = args[2] || 'home';
const deviceArgs = args.slice(1);

function descriptorOrThrow() {
  const descriptor = readReviewDescriptor();
  if (!descriptor) throw new Error('no interactive design review is running; start one with npm run qa:review -- start phone home');
  return descriptor;
}

try {
  if (command === 'start') {
    if (!['phone', 'tablet'].includes(profile)) throw new Error('review profile must be phone or tablet');
    if (!/^[a-z0-9-]+$/.test(scenario)) throw new Error('review scenario contains unsafe characters');
    execFileSync(process.execPath, ['.qa/run-suite.mjs'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        QA_DEVICE_PROFILE: profile,
        QA_AVD: profile === 'tablet' ? 'crays_samsung_tab' : 'google',
        QA_SCENARIOS: scenario,
        QA_REVIEW_MODE: '1',
        QA_SCENARIO_RETRIES: '0',
        QA_SCENARIO_TIMEOUT_MS: process.env.QA_SCENARIO_TIMEOUT_MS || '86400000',
        QA_SKIP_FAST_GATES: process.env.QA_SKIP_FAST_GATES || '1',
        COORDINATOR_URL: process.env.COORDINATOR_URL || 'http://127.0.0.1:7831',
        ...(process.env.QA_MANAGE_COORDINATOR ? { QA_MANAGE_COORDINATOR: process.env.QA_MANAGE_COORDINATOR } : {}),
        QA_MANAGE_METRO: process.env.QA_MANAGE_METRO || '0',
      },
    });
  } else if (command === 'stop') {
    const descriptor = requestReviewStop();
    console.log(`Stop requested for ${descriptor.profile} ${descriptor.scenario} review.`);
  } else if (command === 'status') {
    const descriptor = readReviewDescriptor();
    console.log(descriptor ? JSON.stringify(descriptor, null, 2) : 'No interactive design review is running.');
  } else if (command === 'device') {
    const descriptor = descriptorOrThrow();
    if (deviceArgs.length === 0) throw new Error('usage: npm run qa:review -- device <agent-device command and arguments>');
    execFileSync(process.env.AGENT_DEVICE_CLI || 'node_modules/.bin/agent-device', [
      deviceArgs[0],
      ...deviceArgs.slice(1),
      '--session', descriptor.session,
    ], {
      stdio: 'inherit',
      env: { ...process.env, AGENT_DEVICE_ANDROID_DEVICE_ALLOWLIST: descriptor.serial },
    });
  } else {
    throw new Error('usage: npm run qa:review -- start [phone|tablet] [scenario] | status | stop | device <args...>');
  }
} catch (error) {
  console.error(`Design review: ${String(error?.message || error).split('\n')[0]}`);
  process.exit(1);
}
