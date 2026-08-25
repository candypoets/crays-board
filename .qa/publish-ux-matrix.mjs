#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pendingBase = path.join(ROOT, 'design', '.ux-map-pending');
const pendingRoot = path.resolve(process.argv[2] ?? '');
const canonicalRoot = path.join(ROOT, 'design', 'ux-map');

if (!pendingRoot.startsWith(`${pendingBase}${path.sep}`) || path.dirname(pendingRoot) !== pendingBase) {
  throw new Error(`pending matrix must be one direct child of ${pendingBase}`);
}
if (!fs.existsSync(pendingRoot)) throw new Error(`pending matrix does not exist: ${pendingRoot}`);

execFileSync(process.execPath, [path.join(ROOT, '.qa', 'verify-ux-matrix.mjs'), pendingRoot], {
  cwd: ROOT,
  env: { ...process.env, QA_VERIFY_CURRENT_REVISION: '1' },
  stdio: 'inherit',
});

const backup = path.join(ROOT, 'design', `.ux-map-previous-${process.pid}`);
fs.rmSync(backup, { recursive: true, force: true });
if (fs.existsSync(canonicalRoot)) fs.renameSync(canonicalRoot, backup);
try {
  fs.renameSync(pendingRoot, canonicalRoot);
  fs.rmSync(backup, { recursive: true, force: true });
} catch (error) {
  if (fs.existsSync(canonicalRoot)) fs.renameSync(canonicalRoot, pendingRoot);
  if (fs.existsSync(backup)) fs.renameSync(backup, canonicalRoot);
  throw error;
}

console.log(`UX MATRIX PUBLISHED ATOMICALLY: ${canonicalRoot}`);
