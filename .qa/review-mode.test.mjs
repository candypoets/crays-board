import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  clearReviewDescriptor,
  createReviewDescriptor,
  readReviewDescriptor,
  requestReviewStop,
  waitForReviewStop,
} from './review-mode.mjs';

test('interactive review descriptor has an explicit, token-scoped stop lifecycle', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'crays-review-test-'));
  const descriptorPath = join(dir, 'review.json');
  const stopPath = join(dir, 'review.stop');
  const paths = { descriptorPath, stopPath };
  const descriptor = createReviewDescriptor({ scenario: 'home', profile: 'phone', session: 'review' }, paths);

  assert.equal(readReviewDescriptor(descriptorPath).scenario, 'home');
  requestReviewStop(paths);
  await waitForReviewStop(descriptor, { stopPath, pollMs: 1 });
  clearReviewDescriptor(descriptor, paths);
  assert.equal(readReviewDescriptor(descriptorPath), undefined);
});

test('stale stop token does not end a different review', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'crays-review-test-'));
  const descriptorPath = join(dir, 'review.json');
  const stopPath = join(dir, 'review.stop');
  const descriptor = createReviewDescriptor({ scenario: 'home' }, { descriptorPath, stopPath });
  const waiting = waitForReviewStop(descriptor, { stopPath, pollMs: 2 }).then(() => 'stopped');
  const timeout = new Promise((resolve) => setTimeout(() => resolve('waiting'), 15));
  await import('node:fs').then(({ writeFileSync }) => writeFileSync(stopPath, '{"token":"stale"}\n'));
  assert.equal(await Promise.race([waiting, timeout]), 'waiting');
  requestReviewStop({ descriptorPath, stopPath });
  assert.equal(await waiting, 'stopped');
  clearReviewDescriptor(descriptor, { descriptorPath, stopPath });
});
