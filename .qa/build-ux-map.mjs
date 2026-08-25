#!/usr/bin/env node
/**
 * build-ux-map.mjs — collect Agent Device screenshots and emit an infinite-canvas
 * device-specific UX maps plus clean per-screen PNG folders ready for review
 * or Stitch import.
 *
 * Usage:
 *   node .qa/build-ux-map.mjs --profile <phone|tablet|all> [--from <dir>]
 *     [--out design/ux-map/<profile>] [--hub-root <dir>]
 *
 * --from  Directory of PNGs. Default: scan ~/.agent-device/test-artifacts for
 *         the newest screenshot named by an e2e/flows/*.ad journey.
 *
 * The generator is intentionally dependency-free: the HTML canvas is plain
 * JS (pointer-drag pan, wheel zoom) so the artifact works anywhere.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodePng } from './png-evidence.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PROFILES = {
  phone: { label: 'Phone · portrait', orientation: 'portrait', width: 1080, height: 2400, density: 420, avd: 'google' },
  tablet: { label: 'Tablet · landscape', orientation: 'landscape', width: 1600, height: 1000, density: 240, avd: 'crays_samsung_tab' },
};

// Journey columns in user-journey order. Prefixes match the takeScreenshot
// names in e2e/flows/*.ad.
const JOURNEYS = [
  { id: 'entry', title: 'Entry', prefixes: ['00-', '05-'] },
  { id: 'create-venue', title: 'Create venue', prefixes: ['70-'] },
  { id: 'home', title: 'Home', prefixes: ['80-'] },
  { id: 'orders', title: 'Orders', prefixes: ['10-', '11-'] },
  { id: 'menu', title: 'Menu', prefixes: ['20-'] },
  { id: 'events', title: 'Events & check-in', prefixes: ['30-', '31-'] },
  { id: 'people', title: 'People & roles', prefixes: ['40-'] },
  { id: 'invites', title: 'Invites', prefixes: ['50-'] },
  { id: 'settings', title: 'Settings', prefixes: ['60-'] },
];

/**
 * Expected screenshot names in journey order, parsed from native .ad files.
 * Phone/tablet variants intentionally repeat names; the logical map contains
 * one node for each unique capture name.
 */
function expectedScreens() {
  const flowsDir = path.join(ROOT, 'e2e', 'flows');
  const names = [];
  const seen = new Set();
  for (const file of fs.readdirSync(flowsDir).filter((f) => f.endsWith('.ad')).sort()) {
    const text = fs.readFileSync(path.join(flowsDir, file), 'utf8');
    for (const m of text.matchAll(/^\s*screenshot\s+"\$\{AD_ARTIFACTS\}\/([\w-]+\.png)"\s*$/gm)) {
      if (!seen.has(m[1])) names.push(m[1]);
      seen.add(m[1]);
    }
  }
  return names;
}

function parseArgs(argv) {
  const args = { from: null, out: null, hubRoot: null, profile: 'all', runId: null, apkSha256: null, receipt: null, allowMissing: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--from') args.from = path.resolve(argv[++i]);
    else if (argv[i] === '--out') args.out = path.resolve(argv[++i]);
    else if (argv[i] === '--hub-root') args.hubRoot = path.resolve(argv[++i]);
    else if (argv[i] === '--profile') args.profile = argv[++i];
    else if (argv[i] === '--run-id') args.runId = argv[++i];
    else if (argv[i] === '--apk-sha256') args.apkSha256 = argv[++i];
    else if (argv[i] === '--receipt') args.receipt = path.resolve(argv[++i]);
    else if (argv[i] === '--allow-missing') args.allowMissing = true;
    else {
      console.error(`unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  if (![...Object.keys(PROFILES), 'all'].includes(args.profile)) {
    console.error(`--profile must be phone, tablet, or all; received ${args.profile}`);
    process.exit(2);
  }
  return args;
}

function matchesProfile(file, profile) {
  const { w, h } = pngSize(file);
  return w === PROFILES[profile].width && h === PROFILES[profile].height;
}

/** Newest PNG per expected screenshot name under Agent Device artifacts. */
function collectFromAgentDevice(expected, profile) {
  const base = path.join(os.homedir(), '.agent-device', 'test-artifacts');
  const found = new Map(); // name -> { file, mtime }
  if (!fs.existsSync(base)) return found;
  const wanted = new Set(expected);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && wanted.has(entry.name)) {
        if (!matchesProfile(full, profile)) continue;
        const mtime = fs.statSync(full).mtimeMs;
        const prev = found.get(entry.name);
        if (!prev || mtime > prev.mtime) found.set(entry.name, { file: full, mtime });
      }
    }
  };
  walk(base);
  return found;
}

function collectFromDir(dir, expected, profile) {
  const found = new Map();
  const wanted = new Set(expected);
  if (!fs.existsSync(dir)) return found;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && wanted.has(entry.name) && matchesProfile(full, profile)) {
        const mtime = fs.statSync(full).mtimeMs;
        const prev = found.get(entry.name);
        if (prev) {
          throw new Error(`duplicate ${profile} capture for ${entry.name}: ${prev.file} and ${full}`);
        }
        found.set(entry.name, { file: full, mtime });
      }
    }
  };
  walk(dir);
  return found;
}

function journeyFor(name) {
  for (const j of JOURNEYS) {
    if (j.prefixes.some((p) => name.startsWith(p))) return j.id;
  }
  return null;
}

function pngSize(file) {
  const info = decodePng(fs.readFileSync(file), file);
  return { w: info.width, h: info.height };
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function buildProfile({ profile, from, out, runId, apkSha256, receiptPath, allowMissing }) {
  const receipt = receiptPath ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : null;
  if (!allowMissing && !receipt) throw new Error('complete UX maps require --receipt provenance');
  if (receipt) {
    if (receipt.profile !== profile) throw new Error(`receipt profile ${receipt.profile} does not match ${profile}`);
    if (runId && receipt.runId !== runId) throw new Error(`receipt run ${receipt.runId} does not match ${runId}`);
    if (apkSha256 && receipt.apk?.host?.sha256 !== apkSha256) throw new Error('receipt APK hash does not match --apk-sha256');
    runId = receipt.runId;
    apkSha256 = receipt.apk?.host?.sha256;
  }
  const expected = expectedScreens();
  const found = from ? collectFromDir(from, expected, profile) : collectFromAgentDevice(expected, profile);
  const missingNames = expected.filter((name) => !found.has(name));
  if (missingNames.length && !allowMissing) {
    throw new Error(
      `${profile} capture is incomplete (${found.size}/${expected.length}); refusing to replace the canonical map. ` +
      `Missing: ${missingNames.join(', ')}`,
    );
  }

  const staging = `${out}.staging-${process.pid}`;
  const screensDir = path.join(staging, 'screens');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(screensDir, { recursive: true });
  let receiptEvidence = null;
  if (receiptPath) {
    const receiptBytes = fs.readFileSync(receiptPath);
    fs.writeFileSync(path.join(staging, 'run-receipt.json'), receiptBytes, { mode: 0o600 });
    receiptEvidence = {
      file: 'run-receipt.json',
      sha256: createHash('sha256').update(receiptBytes).digest('hex'),
      revisionDigest: receipt.revision?.digest ?? null,
    };
  }

  const capturedSizes = [...found.values()].map(({ file }) => pngSize(file));
  const sizeCounts = new Map();
  for (const size of capturedSizes) {
    const key = `${size.w}x${size.h}`;
    sizeCounts.set(key, (sizeCounts.get(key) || 0) + 1);
  }
  const profileFallback = profile === 'phone' ? '1080x2400' : '1600x1000';
  const [fallbackKey = profileFallback] = [...sizeCounts.entries()]
    .sort((a, b) => b[1] - a[1])[0] || [];
  const [fallbackW, fallbackH] = fallbackKey.split('x').map(Number);

  const screens = [];
  const missing = [];
  for (const name of expected) {
    const info = found.get(name);
    const journey = journeyFor(name);
    if (!journey) {
      console.error(`internal: no journey prefix for expected screenshot ${name}`);
      process.exit(2);
    }
    if (!info) {
      missing.push(name.replace(/\.png$/, ''));
      screens.push({
        name: name.replace(/\.png$/, ''),
        journey,
        w: fallbackW,
        h: fallbackH,
        status: 'missing',
        capturedAt: null,
      });
      continue;
    }
    fs.copyFileSync(info.file, path.join(screensDir, name));
    const { w, h } = pngSize(info.file);
    screens.push({
      name: name.replace(/\.png$/, ''),
      journey, w, h,
      status: 'captured',
      capturedAt: new Date(info.mtime).toISOString(),
      sha256: sha256(info.file),
      source: from ? path.relative(from, info.file) : null,
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    runId: runId ?? `local-${Date.now()}`,
    apkSha256,
    profile,
    profileLabel: PROFILES[profile].label,
    device: receipt?.device ?? {
      avd: PROFILES[profile].avd,
      width: PROFILES[profile].width,
      height: PROFILES[profile].height,
      density: PROFILES[profile].density,
      orientation: PROFILES[profile].orientation,
      evidence: 'preview-contract-only',
    },
    receipt: receiptEvidence,
    sourceRoot: from ? path.basename(from) : 'agent-device-global-preview',
    expectedCount: expected.length,
    capturedCount: found.size,
    missingCount: missing.length,
    journeys: JOURNEYS.map(({ id, title }) => ({ id, title })),
    screens,
  };
  fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(staging, 'index.html'), renderHtml(manifest));

  const backup = `${out}.previous-${process.pid}`;
  fs.rmSync(backup, { recursive: true, force: true });
  if (fs.existsSync(out)) fs.renameSync(out, backup);
  try {
    fs.renameSync(staging, out);
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(backup) && !fs.existsSync(out)) fs.renameSync(backup, out);
    throw error;
  }

  console.log(`${PROFILES[profile].label} UX map: ${found.size}/${expected.length} captured, ${screens.length} nodes -> ${path.relative(ROOT, out)}/index.html`);
  if (missing.length) console.log(`missing (flow not run yet?): ${missing.join(', ')}`);
  return manifest;
}

function writeHub(baseOut, manifests) {
  fs.mkdirSync(baseOut, { recursive: true });
  const cards = Object.keys(PROFILES).map((profile) => {
    const manifest = manifests.get(profile) ?? (() => {
      const file = path.join(baseOut, profile, 'manifest.json');
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    })();
    const count = manifest ? `${manifest.capturedCount}/${manifest.expectedCount} captured` : 'Not generated yet';
    const generated = manifest ? `Updated ${manifest.generatedAt.slice(0, 16).replace('T', ' ')}Z` : 'Run the matching QA profile';
    return `<a class="profile" href="${profile}/index.html"><span>${PROFILES[profile].label}</span><strong>${count}</strong><small>${generated}</small></a>`;
  }).join('');
  fs.writeFileSync(path.join(baseOut, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Crays Board — responsive UX maps</title><style>
:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,sans-serif;background:#180b14;color:#fff4f7}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}
main{width:min(900px,100%)}h1{font-size:clamp(32px,6vw,64px);line-height:1;margin:0 0 16px;letter-spacing:-.04em}
p{color:#d6afc2;font-size:17px;max-width:60ch;margin:0 0 32px}.profiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}
.profile{display:grid;gap:10px;min-height:180px;padding:24px;border:1px solid #5b2d47;border-radius:16px;background:#2a0d20;color:inherit;text-decoration:none}
.profile:hover,.profile:focus-visible{border-color:#ff3d8d;outline:none}.profile span{color:#ff8db8;font-weight:800;text-transform:uppercase;letter-spacing:.08em;font-size:12px}
.profile strong{font-size:26px}.profile small{color:#bc9eae;align-self:end}
</style></head><body><main><h1>Crays Board UX maps</h1><p>Phone and tablet are captured and reviewed independently so one responsive fix cannot silently replace the other device's evidence.</p><div class="profiles">${cards}</div></main></body></html>`);
}

function main() {
  const args = parseArgs(process.argv);
  const baseOut = path.join(ROOT, 'design', 'ux-map');
  const profiles = args.profile === 'all' ? Object.keys(PROFILES) : [args.profile];
  const manifests = new Map();
  for (const profile of profiles) {
    const out = args.out
      ? (args.profile === 'all' ? path.join(args.out, profile) : args.out)
      : path.join(baseOut, profile);
    manifests.set(profile, buildProfile({
      profile,
      from: args.from,
      out,
      runId: args.runId,
      apkSha256: args.apkSha256,
      receiptPath: args.receipt,
      allowMissing: args.allowMissing,
    }));
  }
  const hubOut = args.hubRoot ?? (args.profile === 'all' && args.out ? args.out : baseOut);
  const outputsInsideHub = profiles.every((profile) => {
    const out = args.out
      ? (args.profile === 'all' ? path.join(args.out, profile) : args.out)
      : path.join(baseOut, profile);
    const relative = path.relative(hubOut, out);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  });
  if (args.profile === 'all' || outputsInsideHub) writeHub(hubOut, manifests);
}

function renderHtml(manifest) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crays Board — ${manifest.profileLabel} UX map</title>
<style>
  :root { color-scheme: dark; --night: #180b14; --rail: #2a0d20; --ink: #24151e;
    --paper: #fff4f7; --pink: #ff3d8d; --coral: #ff7a70; --mint: #70d7ae;
    --muted: #bc9eae; --line: #5b2d47; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: var(--night);
    font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; color: var(--paper); }
  #board { position: absolute; inset: 0; cursor: grab; }
  #board.dragging { cursor: grabbing; }
  #world { position: absolute; transform-origin: 0 0; }
  .column-title { position: absolute; font-size: 15px; font-weight: 600;
    color: #dcb8ca; letter-spacing: .04em; text-transform: uppercase;
    white-space: nowrap; }
  .frame { position: absolute; background: #351426;
    border-radius: 14px; padding: 8px; box-shadow: 0 10px 28px rgba(5,0,3,.38); }
  .frame img { display: block; width: 100%; border-radius: 6px; }
  .frame .label { padding: 8px 3px 2px; color: #f8dfe9; font-size: 12px;
    display: flex; justify-content: space-between; gap: 12px; }
  .frame .label span:last-child { color: var(--muted); white-space: nowrap; }
  .missing-surface { height: 100%; min-height: 360px; border-radius: 8px;
    background: #27101e; display: grid; place-content: center; padding: 30px;
    box-sizing: border-box; text-align: center; color: #f4dce7; }
  .missing-surface strong { display: block; margin-block: 14px 8px; font-size: 18px;
    overflow-wrap: anywhere; }
  .missing-surface p { max-width: 28ch; margin: 0 auto; color: #cdaabd; font-size: 14px; }
  .capture-state { display: inline-flex; align-items: center; justify-self: center; gap: 8px;
    color: #ffd0de; font-weight: 700; }
  .capture-state::before { content: ''; width: 9px; height: 9px; border-radius: 50%;
    background: var(--coral); }
  #edges { position: absolute; overflow: visible; pointer-events: none; }
  #hud { position: fixed; top: 12px; left: 12px; z-index: 10; display: flex;
    gap: 8px; align-items: center; background: rgba(42,13,32,.94);
    border-radius: 14px; padding: 9px 12px; box-shadow: 0 8px 30px rgba(5,0,3,.35); }
  #hud button { background: #4a1832; color: var(--paper); border: 0;
    border-radius: 8px; min-width: 40px; min-height: 38px; padding: 6px 11px;
    cursor: pointer; font: inherit; }
  #hud button:hover { background: #652043; }
  #hud button:focus-visible, #hud select:focus-visible { outline: 3px solid var(--pink); outline-offset: 2px; }
  #hud select { background: #4a1832; color: var(--paper); border: 0;
    border-radius: 8px; min-height: 38px; padding: 6px 10px; font: inherit; }
  #hud .meta { color: #d6afc2; }
  .legend { display: inline-flex; gap: 10px; color: #d6afc2; }
  .legend span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
  .legend i { width: 8px; height: 8px; border-radius: 50%; background: var(--mint); }
  .legend .pending i { background: var(--coral); }
  @media (max-width: 860px) {
    #hud { right: 12px; flex-wrap: wrap; }
    #hud .meta { width: 100%; }
  }
</style>
</head>
<body>
<div id="hud">
  <strong>Crays Board · ${manifest.profileLabel}</strong>
  <button id="zoom-out">−</button>
  <button id="zoom-in">+</button>
  <button id="reset">Reset view</button>
  <select id="jump"><option value="">Jump to journey…</option></select>
  <span class="legend" aria-label="Capture legend"><span><i></i>Captured</span><span class="pending"><i></i>Pending</span></span>
  <span class="meta" id="meta"></span>
</div>
<div id="board">
  <div id="world">
    <svg id="edges"></svg>
  </div>
</div>
<script>
const MANIFEST = ${JSON.stringify(manifest)};
</script>
<script>
(function () {
  const COL_W = 340, COL_GAP = 90, ROW_GAP = 70, TOP = 70, PAD = 40;
  const world = document.getElementById('world');
  const board = document.getElementById('board');
  const edges = document.getElementById('edges');
  const frames = new Map();
  const journeyAnchor = new Map();

  // Layout: one column per journey, screens stacked in name order.
  MANIFEST.journeys.forEach((j, col) => {
    const x = PAD + col * (COL_W + COL_GAP);
    const title = document.createElement('div');
    title.className = 'column-title';
    title.textContent = j.title;
    title.style.left = x + 'px';
    title.style.top = PAD + 'px';
    world.appendChild(title);
    journeyAnchor.set(j.id, { x, y: PAD });

    let y = PAD + TOP;
    MANIFEST.screens.filter(s => s.journey === j.id).forEach((s) => {
      const h = Math.round(COL_W * s.h / s.w);
      const el = document.createElement('div');
      el.className = 'frame ' + s.status;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.width = COL_W + 'px';
      if (s.status === 'captured') {
        el.innerHTML = '<a href="screens/' + s.name + '.png" target="_blank">' +
          '<img src="screens/' + s.name + '.png" alt="' + s.name + '"></a>' +
          '<div class="label"><span>' + s.name + '</span><span>' + s.capturedAt.slice(0, 10) + '</span></div>';
      } else {
        el.innerHTML = '<div class="missing-surface" style="height:' + h + 'px" role="img" ' +
          'aria-label="Capture pending for ' + s.name + '">' +
          '<span class="capture-state">Capture pending</span><strong>' + s.name + '</strong>' +
          '<p>This screen is part of the current Agent Device journey but was not reached in the latest QA artifacts.</p></div>' +
          '<div class="label"><span>' + s.name + '</span><span>Not captured</span></div>';
      }
      world.appendChild(el);
      frames.set(s.name, { x, y, w: COL_W, h });
      y += h + ROW_GAP;
    });
  });

  // Arrows between consecutive screens inside each journey column.
  const NS = 'http://www.w3.org/2000/svg';
  MANIFEST.journeys.forEach((j) => {
    const list = MANIFEST.screens.filter(s => s.journey === j.id);
    for (let i = 0; i + 1 < list.length; i += 1) {
      const a = frames.get(list[i].name), b = frames.get(list[i + 1].name);
      const x1 = a.x + a.w / 2, y1 = a.y + a.h + 34;
      const x2 = b.x + b.w / 2, y2 = b.y - 8;
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);
      line.setAttribute('stroke', '#76405c'); line.setAttribute('stroke-width', '2');
      edges.appendChild(line);
      const head = document.createElementNS(NS, 'circle');
      head.setAttribute('cx', x2); head.setAttribute('cy', y2);
      head.setAttribute('r', '4'); head.setAttribute('fill', '#ff7a70');
      edges.appendChild(head);
    }
  });

  // Pan + zoom.
  let scale = 1, tx = 0, ty = 0;
  function apply() { world.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; }
  function zoomAt(factor, cx, cy) {
    const next = Math.min(3, Math.max(0.1, scale * factor));
    tx = cx - (cx - tx) * (next / scale);
    ty = cy - (cy - ty) * (next / scale);
    scale = next; apply();
  }
  board.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
  }, { passive: false });
  let drag = null;
  board.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a,button,select')) return;
    drag = { x: e.clientX - tx, y: e.clientY - ty };
    board.classList.add('dragging');
    board.setPointerCapture(e.pointerId);
  });
  board.addEventListener('pointermove', (e) => {
    if (!drag) return;
    tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply();
  });
  board.addEventListener('pointerup', () => { drag = null; board.classList.remove('dragging'); });

  // HUD.
  document.getElementById('zoom-in').onclick = () => zoomAt(1.25, innerWidth / 2, innerHeight / 2);
  document.getElementById('zoom-out').onclick = () => zoomAt(1 / 1.25, innerWidth / 2, innerHeight / 2);
  document.getElementById('reset').onclick = () => {
    const worldWidth = PAD * 2 + MANIFEST.journeys.length * COL_W +
      (MANIFEST.journeys.length - 1) * COL_GAP;
    scale = Math.min(0.55, (innerWidth - 60) / worldWidth);
    tx = 30; ty = 76; apply();
  };
  const jump = document.getElementById('jump');
  MANIFEST.journeys.forEach((j) => {
    const o = document.createElement('option');
    o.value = j.id; o.textContent = j.title;
    jump.appendChild(o);
  });
  jump.onchange = () => {
    const a = journeyAnchor.get(jump.value);
    if (!a) return;
    scale = 0.8; tx = 60 - a.x * scale; ty = 96 - a.y * scale; apply();
  };
  document.getElementById('meta').textContent =
    MANIFEST.capturedCount + '/' + MANIFEST.expectedCount + ' captured · ' +
    MANIFEST.missingCount + ' pending · generated ' + MANIFEST.generatedAt.slice(0, 16).replace('T', ' ') + 'Z';
  document.getElementById('reset').click();
})();
</script>
</body>
</html>
`;
}

main();
