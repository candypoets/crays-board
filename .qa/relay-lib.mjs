import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';
import { finalizeEvent, verifyEvent } from 'nostr-tools';
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';

useWebSocketImplementation(WebSocket);

export const COORDINATOR_URL = (process.env.COORDINATOR_URL || 'http://127.0.0.1:7823').replace(/\/$/, '');
export const STATE_PATH = process.env.CRAYS_BOARD_QA_STATE || '/tmp/qa-crays-board-venue.json';
export const DEFAULT_KEYS_JSON = '/root/code/strfry-badge-node/test/env/keys.json';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const nowSeconds = () => Math.floor(Date.now() / 1000);

export const KIND_ANCHOR = 31727;
export const KIND_BADGE_DEFINITION = 30009;
export const KIND_LISTING = 30402;
export const KIND_AWARD = 8;
export const KIND_STATUS = 37237;

export function assert(condition, label) {
  if (!condition) throw new Error(`ASSERT FAILED: ${label}`);
  console.log(`ok - ${label}`);
}

function normalizeKey(value) {
  return {
    priv: value.priv || value.sec_hex,
    pub: value.pub || value.pub_hex,
    nsec: value.nsec,
    npub: value.npub,
  };
}

export function loadKeys(path = process.env.KEYS_JSON || DEFAULT_KEYS_JSON) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const keys = { _path: path };
  for (const [name, value] of Object.entries(raw)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && (value.priv || value.sec_hex)) {
      keys[name] = normalizeKey(value);
    }
  }
  if (Array.isArray(raw.users)) keys.users = raw.users.map(normalizeKey);
  return keys;
}

export function signEvent(template, privHex) {
  return finalizeEvent(
    { created_at: nowSeconds(), content: '', tags: [], ...template },
    Uint8Array.from(Buffer.from(privHex, 'hex')),
  );
}

export function nip98Header(url, method, body, privHex) {
  const payload = createHash('sha256').update(body || '').digest('hex');
  const event = signEvent(
    { kind: 27235, tags: [['u', url], ['method', method], ['payload', payload]] },
    privHex,
  );
  return `Nostr ${Buffer.from(JSON.stringify(event), 'utf8').toString('base64url')}`;
}

export async function requireCoordinator() {
  try {
    const response = await fetch(`${COORDINATOR_URL}/healthz`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const keys = loadKeys();
    const listUrl = `${COORDINATOR_URL}/relays`;
    const authResponse = await fetch(listUrl, {
      headers: { Authorization: nip98Header(listUrl, 'GET', '', keys.admin.priv) },
      signal: AbortSignal.timeout(3000),
    });
    if (!authResponse.ok) throw new Error(`fixture admin auth returned status ${authResponse.status}`);
  } catch (error) {
    throw new Error(`Crays Board QA requires a current coordinator at ${COORDINATOR_URL} authorized for the fixture admin (${error.message}); see .qa/README.md.`);
  }
}

async function coordinatorApi(path, method, keys, body) {
  const url = `${COORDINATOR_URL}${path}`;
  const bodyText = body === undefined ? '' : JSON.stringify(body);
  const response = await fetch(url, {
    method,
    headers: {
      authorization: nip98Header(url, method, bodyText, keys.admin.priv),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: method === 'GET' || method === 'DELETE' ? undefined : bodyText,
  });
  if (!response.ok) throw new Error(`coordinator ${method} ${path} -> ${response.status}: ${await response.text()}`);
  if (response.status === 204) return undefined;
  return response.json();
}

export const createRelay = (payload, keys) => coordinatorApi('/relays', 'POST', keys, payload);
export const getRelay = (id, keys) => coordinatorApi(`/relays/${id}`, 'GET', keys);
export const getRelaySecrets = (id, keys) => coordinatorApi(`/relays/${id}/secrets`, 'GET', keys);
export const deleteRelay = (id, keys) => coordinatorApi(`/relays/${id}`, 'DELETE', keys);
export const listRelays = (keys) => coordinatorApi('/relays', 'GET', keys);

export async function waitRelayRunning(id, keys, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const relay = await getRelay(id, keys);
    if (relay.status === 'running') return relay;
    if (relay.status !== 'creating') throw new Error(`relay ${id} entered ${relay.status}`);
    await sleep(1500);
  }
  throw new Error(`relay ${id} did not become ready`);
}

export function makePool() {
  return new SimplePool();
}

/** Poll relay truth until a positive condition is observable. */
export async function queryUntil(
  pool,
  relayUrl,
  filter,
  select,
  label,
  timeoutMs = 45_000,
  intervalMs = 750,
) {
  const deadline = Date.now() + timeoutMs;
  let events = [];
  for (;;) {
    events = await pool.querySync([relayUrl], filter);
    const result = select(events);
    if (result) {
      assert(true, label);
      return { events, result };
    }
    if (Date.now() >= deadline) break;
    await sleep(intervalMs);
  }
  throw new Error(`relay condition not met within ${timeoutMs}ms: ${label} (last poll saw ${events.length} event(s))`);
}

export function tagValue(event, name) {
  return event?.tags?.find((tag) => tag[0] === name)?.[1];
}

export function tagValues(event, name) {
  return event?.tags?.filter((tag) => tag[0] === name).map((tag) => tag[1]) ?? [];
}

export function relayInfoUrl(relayUrl) {
  const url = new URL(relayUrl);
  if (url.protocol === 'ws:') url.protocol = 'http:';
  else if (url.protocol === 'wss:') url.protocol = 'https:';
  else throw new Error(`invalid relay URL: ${relayUrl}`);
  return url.toString();
}

/**
 * Resolve and independently prove the NIP-97 trust bootstrap created by the
 * relay node: NIP-11 root -> root-signed 31727 anchor -> root-authored,
 * zero-priced membership definition. Returns only public protocol facts.
 */
export async function resolveCommunityBootstrap({
  pool,
  relayUrl,
  expectedAdmins = [],
  expectedIssuerPubkey,
}) {
  const infoUrl = relayInfoUrl(relayUrl);
  const deadline = Date.now() + 45_000;
  let response;
  while (Date.now() < deadline && !response?.ok) {
    try {
      response = await fetch(infoUrl, {
        headers: { accept: 'application/nostr+json' },
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      // Coordinator readiness can precede the relay HTTP listener briefly.
    }
    if (!response?.ok) await sleep(750);
  }
  assert(response?.ok, 'relay serves its NIP-11 document');
  const info = await response.json();
  const rootPubkey = typeof info.pubkey === 'string' ? info.pubkey.toLowerCase() : '';
  assert(/^[0-9a-f]{64}$/.test(rootPubkey), 'NIP-11 exposes the community root pubkey');

  const { result: anchor } = await queryUntil(
    pool,
    relayUrl,
    { kinds: [KIND_ANCHOR], authors: [rootPubkey], '#d': ['community'], limit: 5 },
    (events) =>
      events
        .filter(verifyEvent)
        .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0],
    'root-signed NIP-97 community anchor is queryable',
  );
  assert(anchor.pubkey === rootPubkey, 'community anchor is signed by the NIP-11 root');
  assert(tagValue(anchor, 'd') === 'community', 'community anchor uses d=community');
  for (const admin of expectedAdmins) {
    assert(tagValues(anchor, 'p').includes(admin), `community anchor delegates admin ${admin.slice(0, 12)}`);
  }
  const issuerPubkey = tagValue(anchor, 'badge_issuer');
  assert(/^[0-9a-f]{64}$/i.test(issuerPubkey || ''), 'community anchor delegates a badge issuer');
  if (expectedIssuerPubkey) {
    assert(issuerPubkey === expectedIssuerPubkey, 'community anchor delegates the relay badge issuer key');
  }

  const requiredBadgeAddress = `${KIND_BADGE_DEFINITION}:${rootPubkey}:members`;
  const { result: membershipDefinition } = await queryUntil(
    pool,
    relayUrl,
    { kinds: [KIND_BADGE_DEFINITION], authors: [rootPubkey], '#d': ['members'], limit: 5 },
    (events) => events.find((event) => verifyEvent(event) && tagValues(event, 't').includes('membership')),
    'root-authored NIP-97 membership definition is queryable',
  );
  const price = membershipDefinition.tags.find((tag) => tag[0] === 'price');
  assert(price?.[1] === '0' && price?.[2] === 'SAT', 'required membership is zero-priced and issuer-awardable');

  return {
    rootPubkey,
    anchor,
    issuerPubkey,
    requiredBadgeAddress,
    membershipDefinition,
  };
}

/** Complete Board/NIP-99 tag set for one sellable product listing. */
export function productListingTags({
  d,
  title,
  price,
  currency = 'EUR',
  availability = 'available',
  productKind = 'food',
  summary,
  section,
  position,
  eventAddress,
  maxUses,
}) {
  const tags = [
    ['d', d],
    ['title', title],
    ['price', price, currency],
    ['availability', availability],
    ['product_kind', productKind],
  ];
  if (summary) tags.push(['summary', summary]);
  if (section) tags.push(['section', section]);
  if (position !== undefined) tags.push(['position', String(position)]);
  if (eventAddress) tags.push(['a', eventAddress]);
  if (maxUses !== undefined) tags.push(['max_uses', String(maxUses)]);
  return tags;
}

/** Spec-required award query hints, plus optional expiry/context bindings. */
export function entitlementAwardTags({
  definitionAddress,
  holderPubkey,
  topics = [],
  expiration,
  order,
  idempotency,
}) {
  const definitionKind = definitionAddress.split(':')[0];
  const tags = [
    ['a', definitionAddress],
    ['p', holderPubkey],
    ['t', definitionKind],
    ...topics.map((topic) => ['t', topic]),
  ];
  if (expiration !== undefined) tags.push(['expiration', String(expiration)]);
  if (order) tags.push(['order', order]);
  if (idempotency) tags.push(['i', idempotency]);
  return tags;
}

export async function publishUntilStored(pool, relayUrl, event, label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await Promise.allSettled(pool.publish([relayUrl], event));
    await sleep(750);
    const stored = await pool.get([relayUrl], { ids: [event.id] });
    if (stored?.id === event.id) {
      assert(true, label);
      return stored;
    }
  }
  throw new Error(`relay never round-tripped ${label}`);
}

export function emulatorUrl(url) {
  return url.replace('127.0.0.1', '10.0.2.2').replace('localhost', '10.0.2.2');
}

export function readState() {
  if (!existsSync(STATE_PATH)) return undefined;
  return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
}

export function writeState(state) {
  writeFileSync(STATE_PATH, `${JSON.stringify({ ...state, written_at: new Date().toISOString() }, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(STATE_PATH, 0o600);
  assert(true, `state written to ${STATE_PATH}`);
}

export function clearState() {
  rmSync(STATE_PATH, { force: true });
}

export function removeRelayVolume(id) {
  try {
    execFileSync('docker', ['volume', 'rm', '-f', `strfry-badge-data-${id}`], { stdio: 'pipe' });
    console.log(`ok - removed strfry-badge-data-${id}`);
  } catch {
    console.log(`warn - volume strfry-badge-data-${id} already absent`);
  }
}
