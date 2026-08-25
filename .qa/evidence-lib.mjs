import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SCOPES = {
  source: [
    'src', 'package.json', 'app.json', 'app.config.js', 'app.config.mjs', 'app.config.ts',
    'babel.config.js', 'metro.config.js', 'tailwind.config.js', 'tsconfig.json',
    'nativewind-env.d.ts', 'global.css', 'patches',
  ],
  harness: ['.qa', 'scripts'],
  flows: ['e2e/flows'],
  lockfile: ['package-lock.json'],
};

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file));
}

function git(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function componentEvidence(root, paths) {
  const output = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...paths], { encoding: 'buffer' });
  const names = output.toString('utf8').split('\0').filter(Boolean).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const files = names.map((name) => {
    const absolute = path.join(root, name);
    if (!fs.existsSync(absolute)) return { path: name, state: 'deleted', sha256: null };
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) return { path: name, state: 'symlink', sha256: sha256Bytes(fs.readlinkSync(absolute)) };
    if (!stat.isFile()) throw new Error(`revision evidence only supports files and symlinks: ${name}`);
    return { path: name, state: 'present', sha256: sha256File(absolute) };
  });
  const digest = createHash('sha256');
  for (const file of files) digest.update(`${file.path}\0${file.state}\0${file.sha256 ?? '-'}\0`);
  return { sha256: digest.digest('hex'), fileCount: files.length, files };
}

/** Hash the exact relevant working-tree bytes, including untracked and deleted tracked files. */
export function computeRevisionEvidence(root, scopes = DEFAULT_SCOPES) {
  const components = Object.fromEntries(
    Object.entries(scopes).map(([name, paths]) => [name, componentEvidence(root, paths)]),
  );
  const digest = createHash('sha256');
  for (const name of Object.keys(components).sort()) digest.update(`${name}\0${components[name].sha256}\0`);
  const allPaths = [...new Set(Object.values(scopes).flat())];
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...allPaths], { encoding: 'buffer' });
  let headCommit = null;
  try { headCommit = git(root, ['rev-parse', 'HEAD']).trim(); } catch { /* an uncommitted fixture repository is valid evidence */ }
  return {
    algorithm: 'sha256-working-tree-v1',
    digest: digest.digest('hex'),
    headCommit,
    dirty: status.length > 0,
    statusSha256: sha256Bytes(status),
    components,
  };
}

export function assertRevisionEqual(before, after) {
  if (before.digest !== after.digest) {
    const changed = Object.keys(before.components)
      .filter((name) => before.components[name]?.sha256 !== after.components[name]?.sha256);
    throw new Error(`relevant worktree changed during QA capture (${changed.join(', ') || 'unknown component'})`);
  }
}

function command(commandName, args, options = {}) {
  return execFileSync(commandName, args, {
    encoding: options.buffer ? 'buffer' : 'utf8',
    // Expo debug clients can exceed 256 MiB. Keep the ceiling explicit while
    // allowing an exact byte hash of the installed base.apk.
    maxBuffer: options.maxBuffer ?? 512 * 1024 * 1024,
  });
}

function adb(serial, args, options = {}) {
  return command('adb', ['-s', serial, ...args], options);
}

function observedNumber(text, overrideLabel, physicalLabel) {
  const override = text.match(new RegExp(`${overrideLabel}:\\s*(\\d+)`));
  const physical = text.match(new RegExp(`${physicalLabel}:\\s*(\\d+)`));
  return { physical: physical ? Number(physical[1]) : null, override: override ? Number(override[1]) : null };
}

export function parseWindowObservations({ sizeOutput, densityOutput, inputOutput, userRotationOutput }) {
  const overrideSize = sizeOutput.match(/Override size:\s*(\d+)x(\d+)/);
  const physicalSize = sizeOutput.match(/Physical size:\s*(\d+)x(\d+)/);
  const selectedSize = overrideSize ?? physicalSize;
  const density = observedNumber(densityOutput, 'Override density', 'Physical density');
  const selectedDensity = density.override ?? density.physical;
  const surface = inputOutput.match(/SurfaceOrientation:\s*(\d+)/i)
    ?? inputOutput.match(/orientation=(\d+)/i);
  if (!selectedSize || !selectedDensity || !surface) {
    throw new Error('cannot parse observed Android size, density, and surface orientation');
  }
  const width = Number(selectedSize[1]);
  const height = Number(selectedSize[2]);
  const surfaceRotation = Number(surface[1]);
  const userRotation = Number.parseInt(userRotationOutput.trim(), 10);
  return {
    width,
    height,
    density: selectedDensity,
    orientation: width > height ? 'landscape' : 'portrait',
    widthDp: Math.round(width / (selectedDensity / 160)),
    observations: {
      size: { physical: physicalSize ? [Number(physicalSize[1]), Number(physicalSize[2])] : null, override: overrideSize ? [Number(overrideSize[1]), Number(overrideSize[2])] : null },
      density,
      surfaceRotation,
      userRotation: Number.isInteger(userRotation) ? userRotation : null,
      commands: ['wm size', 'wm density', 'dumpsys input', 'settings get system user_rotation'],
    },
  };
}

export function observeAndroidDevice(serial) {
  const sizeOutput = adb(serial, ['shell', 'wm', 'size']);
  const densityOutput = adb(serial, ['shell', 'wm', 'density']);
  const inputOutput = adb(serial, ['shell', 'dumpsys', 'input']);
  const userRotationOutput = adb(serial, ['shell', 'settings', 'get', 'system', 'user_rotation']);
  const window = parseWindowObservations({ sizeOutput, densityOutput, inputOutput, userRotationOutput });
  const avd = adb(serial, ['emu', 'avd', 'name']).split('\n')[0].trim();
  return {
    serial,
    avd,
    model: adb(serial, ['shell', 'getprop', 'ro.product.model']).trim(),
    product: adb(serial, ['shell', 'getprop', 'ro.product.device']).trim(),
    apiLevel: Number(adb(serial, ['shell', 'getprop', 'ro.build.version.sdk']).trim()),
    ...window,
  };
}

function packageField(text, expression) {
  return text.match(expression)?.[1] ?? null;
}

/** Prove the installed base APK bytes equal the APK built by this run. */
export function observeInstalledPackage(serial, packageName, hostApk, { installedThisRun }) {
  const pathOutput = adb(serial, ['shell', 'pm', 'path', packageName]);
  const remotePaths = pathOutput.split('\n').map((line) => line.trim().replace(/^package:/, '')).filter(Boolean);
  const baseApk = remotePaths.find((value) => value.endsWith('/base.apk')) ?? remotePaths[0];
  if (!baseApk) throw new Error(`installed package ${packageName} has no APK path`);
  const installedBytes = adb(serial, ['exec-out', 'cat', baseApk], { buffer: true });
  const hostStat = fs.statSync(hostApk);
  const hostSha256 = sha256File(hostApk);
  const installedSha256 = sha256Bytes(installedBytes);
  if (hostSha256 !== installedSha256) {
    throw new Error(`installed ${packageName} base APK hash differs from the current host APK`);
  }
  const dump = adb(serial, ['shell', 'dumpsys', 'package', packageName]);
  return {
    packageName,
    installedThisRun: Boolean(installedThisRun),
    host: { path: path.relative(process.cwd(), hostApk), sha256: hostSha256, size: hostStat.size },
    installed: {
      basePath: baseApk,
      sha256: installedSha256,
      size: installedBytes.length,
      codePath: packageField(dump, /^\s*codePath=(.+)$/m),
      versionCode: Number(packageField(dump, /^\s*versionCode=(\d+)/m)),
      versionName: packageField(dump, /^\s*versionName=(.+)$/m),
      lastUpdateTime: packageField(dump, /^\s*lastUpdateTime=(.+)$/m),
      signingRecord: packageField(dump, /^\s*signatures=(.+)$/m),
      observations: ['pm path', 'exec-out cat <base.apk>', 'dumpsys package'],
    },
  };
}

export function coordinatorEvidence({ url, mode, implementationSha256, healthStatus, healthBody }) {
  if (!/^[a-f0-9]{64}$/.test(implementationSha256 ?? '')) {
    throw new Error(`${mode} coordinator requires an exact implementation SHA-256 identity`);
  }
  const normalized = {
    url: url.replace(/\/$/, ''),
    mode,
    implementationSha256,
    health: { status: healthStatus, bodySha256: sha256Bytes(healthBody) },
  };
  return { ...normalized, identityDigest: sha256Bytes(JSON.stringify(normalized)) };
}
