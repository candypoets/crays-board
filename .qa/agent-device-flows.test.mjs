import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const FLOW_DIR = path.join(ROOT, 'e2e', 'flows');
const flowFiles = readdirSync(FLOW_DIR).filter((name) => name.endsWith('.ad')).sort();

function screenshots(source) {
  return [...source.matchAll(/^\s*screenshot\s+"\$\{AD_ARTIFACTS\}\/([\w-]+\.png)"\s*$/gm)]
    .map((match) => match[1]);
}

test('native Agent Device journeys are portable and screenshot-complete', () => {
  assert.equal(flowFiles.length, 20);
  const allScreens = new Set();
  for (const file of flowFiles) {
    const source = readFileSync(path.join(FLOW_DIR, file), 'utf8');
    assert.match(source, /^context platform=android\b/m, `${file} must declare Android context`);
    if (['00-welcome.ad', '70-create-venue.ad'].includes(file)) {
      assert.match(source, /^open /m, `${file} must launch the unseeded app`);
    }
    assert.match(source, /^close\s*$/m, `${file} must release its session`);
    assert.doesNotMatch(source, /--settle\b/, `${file} uses an interactive-only flag`);
    assert.doesNotMatch(source, /^\s*scroll\s+(?:top|bottom)\b/m, `${file} uses an unbounded nested-scroll command`);
    assert.doesNotMatch(source, /^\s*swipe(?:\s+\d+){5}\b/m, `${file} uses the removed swipe duration argument`);
    assert.doesNotMatch(source, /\bnsec1[023456789acdefghjklmnpqrstuvwxyz]+/i, `${file} embeds a private key`);
    for (const name of screenshots(source)) allScreens.add(name);
  }
  assert.equal(allScreens.size, 30, 'the responsive journey set must declare all 30 logical screenshots');
});

test('phone and tablet variants preserve the same screenshot contract', () => {
  const stems = new Set(flowFiles.flatMap((name) => {
    const match = name.match(/^(.*)\.(?:phone|tablet)\.ad$/);
    return match ? [match[1]] : [];
  }));
  for (const stem of stems) {
    const phone = screenshots(readFileSync(path.join(FLOW_DIR, `${stem}.phone.ad`), 'utf8'));
    const tablet = screenshots(readFileSync(path.join(FLOW_DIR, `${stem}.tablet.ad`), 'utf8'));
    assert.deepEqual(tablet, phone, `${stem} variants must emit the same named evidence`);
  }
});

test('relay journeys use a subscription-free seeded handoff and card-specific order states', () => {
  const relayFlows = flowFiles.filter((name) => !['00-welcome.ad', '70-create-venue.ad'].includes(name));
  for (const file of relayFlows) {
    const source = readFileSync(path.join(FLOW_DIR, file), 'utf8');
    assert.match(
      source,
      /^open "craysboard:\/\/qa-handoff\?target=[\w-]+" --metro-port 8090$/m,
      `${file} must enter through the subscription-free QA handoff`,
    );
    assert.doesNotMatch(source, /^open "craysboard:\/\/orders"/m, `${file} must not stack Orders under the target screen`);
    assert.match(source, /^wait "id=\\"[\w-]+-screen\\""/m, `${file} must prove the seeded target screen`);
  }

  for (const file of flowFiles.filter((name) => /^1[01]-orders/.test(name))) {
    const source = readFileSync(path.join(FLOW_DIR, file), 'utf8');
    assert.doesNotMatch(
      source,
      /^wait text "(?:Accepted|Preparing|Ready|Served|Declined|Cancelled)"/m,
      `${file} must not confuse a static lane heading with a card state`,
    );
    assert.match(source, /order-status-\$\{[A-Z_]+\}-(?:accepted|processing|ready|fulfilled|cancelled)/);
  }
});
