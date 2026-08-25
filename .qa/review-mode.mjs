import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

export const REVIEW_DESCRIPTOR_PATH = process.env.QA_REVIEW_DESCRIPTOR || '/tmp/crays-board-design-review.json';
export const REVIEW_STOP_PATH = process.env.QA_REVIEW_STOP || '/tmp/crays-board-design-review.stop';

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readReviewDescriptor(path = REVIEW_DESCRIPTOR_PATH) {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function createReviewDescriptor(details, {
  descriptorPath = REVIEW_DESCRIPTOR_PATH,
  stopPath = REVIEW_STOP_PATH,
} = {}) {
  const existing = readReviewDescriptor(descriptorPath);
  if (existing && processAlive(existing.ownerPid)) {
    throw new Error(`an interactive review already owns ${descriptorPath} (pid ${existing.ownerPid})`);
  }
  rmSync(descriptorPath, { force: true });
  rmSync(stopPath, { force: true });
  const descriptor = {
    schemaVersion: 1,
    token: randomUUID(),
    ownerPid: process.pid,
    readyAt: new Date().toISOString(),
    ...details,
  };
  writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, { mode: 0o600 });
  return descriptor;
}

export function requestReviewStop({
  descriptorPath = REVIEW_DESCRIPTOR_PATH,
  stopPath = REVIEW_STOP_PATH,
} = {}) {
  const descriptor = readReviewDescriptor(descriptorPath);
  if (!descriptor) throw new Error('no interactive design review is running');
  writeFileSync(stopPath, `${JSON.stringify({ token: descriptor.token, requestedAt: new Date().toISOString() })}\n`, {
    mode: 0o600,
  });
  return descriptor;
}

export async function waitForReviewStop(descriptor, {
  stopPath = REVIEW_STOP_PATH,
  pollMs = 300,
} = {}) {
  for (;;) {
    if (existsSync(stopPath)) {
      try {
        const request = JSON.parse(readFileSync(stopPath, 'utf8'));
        if (request.token === descriptor.token) return;
      } catch {
        // A partially written or unrelated stop file must not end the session.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export function clearReviewDescriptor(descriptor, {
  descriptorPath = REVIEW_DESCRIPTOR_PATH,
  stopPath = REVIEW_STOP_PATH,
} = {}) {
  const current = readReviewDescriptor(descriptorPath);
  if (current?.token === descriptor.token) rmSync(descriptorPath, { force: true });
  if (existsSync(stopPath)) {
    try {
      const request = JSON.parse(readFileSync(stopPath, 'utf8'));
      if (request.token === descriptor.token) rmSync(stopPath, { force: true });
    } catch {
      // Leave an unrelated malformed file for its owner to inspect.
    }
  }
}
