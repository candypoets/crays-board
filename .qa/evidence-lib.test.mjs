import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { computeRevisionEvidence, parseWindowObservations } from './evidence-lib.mjs';

function repositoryFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'crays-revision-test-'));
  for (const directory of ['src', '.qa', 'e2e/flows']) mkdirSync(path.join(root, directory), { recursive: true });
  writeFileSync(path.join(root, 'src/app.ts'), 'export const value = 1;\n');
  writeFileSync(path.join(root, '.qa/harness.mjs'), 'export {};\n');
  writeFileSync(path.join(root, 'e2e/flows/flow.ad'), 'context platform=android\n');
  writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  return root;
}

test('working-tree digest changes for dirty, untracked, and deleted relevant files', () => {
  const root = repositoryFixture();
  try {
    const initial = computeRevisionEvidence(root);
    writeFileSync(path.join(root, 'src/app.ts'), 'export const value = 2;\n');
    const dirty = computeRevisionEvidence(root);
    assert.notEqual(dirty.digest, initial.digest);
    writeFileSync(path.join(root, '.qa/untracked.mjs'), 'export const newEvidence = true;\n');
    const untracked = computeRevisionEvidence(root);
    assert.notEqual(untracked.digest, dirty.digest);
    assert.ok(untracked.components.harness.files.some((file) => file.path === '.qa/untracked.mjs'));
    unlinkSync(path.join(root, 'e2e/flows/flow.ad'));
    const deleted = computeRevisionEvidence(root);
    assert.notEqual(deleted.digest, untracked.digest);
    assert.deepEqual(deleted.components.flows.files[0], { path: 'e2e/flows/flow.ad', state: 'deleted', sha256: null });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('device dimensions, density, and orientation are parsed from observed command output', () => {
  const observed = parseWindowObservations({
    sizeOutput: 'Physical size: 1080x2400\nOverride size: 1600x1000\n',
    densityOutput: 'Physical density: 420\nOverride density: 240\n',
    inputOutput: '  SurfaceOrientation: 1\n',
    userRotationOutput: '1\n',
  });
  assert.equal(observed.width, 1600);
  assert.equal(observed.height, 1000);
  assert.equal(observed.density, 240);
  assert.equal(observed.orientation, 'landscape');
  assert.equal(observed.observations.surfaceRotation, 1);
});
