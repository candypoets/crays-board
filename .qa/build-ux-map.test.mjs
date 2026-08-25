import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { makeTestPng } from './test-png.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const BUILDER = path.join(ROOT, '.qa', 'build-ux-map.mjs');

function writePngHeader(file, width, height) {
  writeFileSync(file, makeTestPng(width, height));
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'crays-map-test-'));
  const source = path.join(root, 'source', 'welcome', 'takeScreenshot');
  mkdirSync(source, { recursive: true });
  writePngHeader(path.join(source, '00-welcome.png'), 1080, 2400);
  return { root, source: path.join(root, 'source'), out: path.join(root, 'out') };
}

test('profile preview accepts only the exact phone viewport and records provenance', () => {
  const fx = fixture();
  try {
    execFileSync(process.execPath, [BUILDER, '--profile', 'phone', '--from', fx.source, '--out', fx.out, '--run-id', 'test-run', '--apk-sha256', 'a'.repeat(64), '--allow-missing']);
    const manifest = JSON.parse(readFileSync(path.join(fx.out, 'manifest.json'), 'utf8'));
    assert.equal(manifest.profile, 'phone');
    assert.equal(manifest.runId, 'test-run');
    assert.equal(manifest.apkSha256, 'a'.repeat(64));
    assert.deepEqual(manifest.device, {
      avd: 'google', width: 1080, height: 2400, density: 420, orientation: 'portrait',
      evidence: 'preview-contract-only',
    });
    assert.equal(manifest.capturedCount, 1);
    assert.equal(manifest.screens.find((screen) => screen.name === '00-welcome').sha256.length, 64);

    const tabletOut = path.join(fx.root, 'tablet');
    execFileSync(process.execPath, [BUILDER, '--profile', 'tablet', '--from', fx.source, '--out', tabletOut, '--allow-missing']);
    const tablet = JSON.parse(readFileSync(path.join(tabletOut, 'manifest.json'), 'utf8'));
    assert.equal(tablet.capturedCount, 0, 'phone evidence must never enter the tablet map');
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('an incomplete canonical build preserves the previous output', () => {
  const fx = fixture();
  try {
    mkdirSync(fx.out, { recursive: true });
    writeFileSync(path.join(fx.out, 'sentinel'), 'previous-map');
    const result = spawnSync(process.execPath, [BUILDER, '--profile', 'phone', '--from', fx.source, '--out', fx.out], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(path.join(fx.out, 'sentinel'), 'utf8'), 'previous-map');
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('duplicate captures in one exact run root are rejected', () => {
  const fx = fixture();
  try {
    const duplicate = path.join(fx.source, 'duplicate', 'takeScreenshot');
    mkdirSync(duplicate, { recursive: true });
    writePngHeader(path.join(duplicate, '00-welcome.png'), 1080, 2400);
    const result = spawnSync(process.execPath, [BUILDER, '--profile', 'phone', '--from', fx.source, '--out', fx.out, '--allow-missing'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /duplicate phone capture/);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test('a profile map embeds and hashes its run receipt', () => {
  const fx = fixture();
  try {
    const receiptPath = path.join(fx.root, 'run-receipt.json');
    writeFileSync(receiptPath, JSON.stringify({
      profile: 'phone', runId: 'receipt-run', apk: { host: { sha256: 'b'.repeat(64) } },
      revision: { digest: 'c'.repeat(64) },
      device: { avd: 'google', width: 1080, height: 2400, density: 420, orientation: 'portrait', serial: 'emulator-5554' },
    }));
    execFileSync(process.execPath, [
      BUILDER, '--profile', 'phone', '--from', fx.source, '--out', fx.out,
      '--run-id', 'receipt-run', '--apk-sha256', 'b'.repeat(64), '--receipt', receiptPath, '--allow-missing',
    ]);
    const manifest = JSON.parse(readFileSync(path.join(fx.out, 'manifest.json'), 'utf8'));
    assert.equal(manifest.receipt.file, 'run-receipt.json');
    assert.equal(manifest.receipt.sha256.length, 64);
    assert.equal(manifest.receipt.revisionDigest, 'c'.repeat(64));
    assert.equal(readFileSync(path.join(fx.out, 'run-receipt.json'), 'utf8'), readFileSync(receiptPath, 'utf8'));
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});
