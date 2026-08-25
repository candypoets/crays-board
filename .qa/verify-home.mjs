#!/usr/bin/env node
// Independent Home verification. Reprojects the attention summary from the
// NIP-97 trust chain and relay events, never from application code or the
// companion service's convenience mirror.
import { execFileSync } from 'node:child_process';
import { verifyEvent } from 'nostr-tools';
import {
  assert,
  emulatorUrl,
  makePool,
  readState,
  relayInfoUrl,
  tagValue,
  tagValues,
} from './relay-lib.mjs';

const state = readState();
if (!state?.relay_url || !state?.award_id || !state?.event_id) {
  throw new Error('run .qa/relay-bootstrap-home.mjs first');
}

const infoResponse = await fetch(relayInfoUrl(state.relay_url), {
  headers: { accept: 'application/nostr+json' },
});
assert(infoResponse.ok, 'relay NIP-11 document is reachable');
const info = await infoResponse.json();
const rootPubkey = typeof info.pubkey === 'string' ? info.pubkey.toLowerCase() : '';
assert(rootPubkey === state.community_root_pubkey, 'NIP-11 root matches bootstrap truth');

const pool = makePool();
const events = await pool.querySync([state.relay_url], {
  kinds: [5, 8, 30009, 30402, 31727, 30078, 31923, 37237],
  limit: 500,
});
pool.close([state.relay_url]);
assert(events.length >= 12, `NIP-97 home fixture family is queryable (${events.length} events)`);
assert(events.every(verifyEvent), 'every relay event has a valid Nostr signature');

const anchor = events
  .filter((event) => event.kind === 31727 && event.pubkey === rootPubkey && tagValue(event, 'd') === 'community')
  .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
assert(anchor?.id === state.community_anchor_id, 'current root-signed community anchor matches bootstrap truth');
const admins = new Set(tagValues(anchor, 'p'));
const issuer = tagValue(anchor, 'badge_issuer');
assert(admins.has(state.admin_pubkey), 'anchor delegates the fixture admin');
assert(issuer === state.issuer_pubkey, 'anchor delegates the fixture badge issuer');

const definitionAuthorTrusted = (pubkey) => pubkey === rootPubkey || admins.has(pubkey);
const priceTag = (event) => event.tags.find((tag) => tag[0] === 'price');
const hasValidPrice = (event) => {
  const price = priceTag(event);
  return Boolean(
    price?.[1] &&
      /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(price[1]) &&
      /^[A-Z]{3}$/.test(price[2] || ''),
  );
};
const addressOf = (event) => `${event.kind}:${event.pubkey}:${tagValue(event, 'd')}`;

const seededAcceptedAward = events.find((event) => event.id === state.accepted_award_id);
const seededAcceptedStatus = events.find((event) => event.id === state.accepted_status_id);
assert(seededAcceptedAward?.kind === 8, 'seeded accepted order award is queryable');
assert(seededAcceptedStatus?.kind === 37237, 'seeded accepted current status is queryable');
assert(tagValue(seededAcceptedStatus, 'status') === 'accepted', 'seeded current status is accepted');
assert(tagValue(seededAcceptedStatus, 'e') === seededAcceptedAward.id, 'seeded status e binds the exact award');
assert(tagValue(seededAcceptedStatus, 'a') === state.product_address, 'seeded status a binds the exact product');
assert(tagValue(seededAcceptedStatus, 'p') === tagValue(seededAcceptedAward, 'p'), 'seeded status p binds the exact holder');
assert(tagValue(seededAcceptedStatus, 'order') === seededAcceptedAward.id, 'seeded status uses the award-id order ref');
assert(tagValue(seededAcceptedStatus, 'd') === `order:${seededAcceptedAward.id}`, 'seeded status d matches its order context');
assert(seededAcceptedStatus.pubkey === state.admin_pubkey, 'seeded status uses the staff admin signer');
assert(seededAcceptedStatus.created_at >= seededAcceptedAward.created_at, 'seeded status does not predate its award');

const definitions = new Map();
for (const event of events.filter((entry) => entry.kind === 30009 || entry.kind === 30402)) {
  if (!definitionAuthorTrusted(event.pubkey) || !tagValue(event, 'd')) continue;
  const address = addressOf(event);
  const previous = definitions.get(address);
  if (
    !previous ||
    event.created_at > previous.created_at ||
    (event.created_at === previous.created_at && event.id > previous.id)
  ) {
    definitions.set(address, event);
  }
}

const now = Math.floor(Date.now() / 1000);
const revocations = events.filter((event) => event.kind === 5);
const isRevoked = (award) =>
  revocations.some(
    (deletion) =>
      tagValues(deletion, 'e').includes(award.id) &&
      (deletion.pubkey === award.pubkey || admins.has(deletion.pubkey)),
  );
const awardValid = (award, definition) => {
  if (!definition) return false;
  if (award.pubkey !== issuer && !admins.has(award.pubkey)) return false;
  if (award.pubkey === issuer && !hasValidPrice(definition)) return false;
  const expiration = Number(tagValue(award, 'expiration'));
  if (Number.isSafeInteger(expiration) && expiration > 0 && expiration <= now) return false;
  return !isRevoked(award);
};

// Latest trusted status per valid NIP-97 order context.
const latestStatusByContext = new Map();
for (const status of events.filter((event) => event.kind === 37237)) {
  if (!admins.has(status.pubkey) && status.pubkey !== issuer) continue;
  const orderRef = tagValue(status, 'order');
  const eventRef = tagValue(status, 'event');
  const contextKey = tagValue(status, 'd');
  if (!orderRef || eventRef || contextKey !== `order:${orderRef}`) continue;
  const previous = latestStatusByContext.get(contextKey);
  if (
    !previous ||
    status.created_at > previous.created_at ||
    (status.created_at === previous.created_at && status.id < previous.id)
  ) {
    latestStatusByContext.set(contextKey, status);
  }
}

const orderReference = (award) => {
  const explicit = tagValue(award, 'order');
  if (explicit) return explicit;
  const idempotency = tagValue(award, 'i');
  if (idempotency?.startsWith('payment-redemption:')) return idempotency.slice('payment-redemption:'.length);
  if (idempotency?.startsWith('payment:')) return idempotency.slice('payment:'.length);
  return award.id;
};

const openOrders = { pending: 0, accepted: 0, processing: 0, ready: 0 };
let oldestAwardCreatedAt = null;
for (const award of events.filter((entry) => entry.kind === 8)) {
  const definition = definitions.get(tagValue(award, 'a'));
  if (!definition || definition.kind !== 30402 || tagValue(definition, 'a')) continue;
  const maxUses = Number(tagValue(definition, 'max_uses'));
  if ((Number.isSafeInteger(maxUses) && maxUses > 0 ? maxUses : 1) !== 1) continue;
  if (!awardValid(award, definition)) continue;
  const orderRef = orderReference(award);
  const current = latestStatusByContext.get(`order:${orderRef}`);
  const stage = current && tagValue(current, 'e') === award.id ? tagValue(current, 'status') : 'pending';
  if (stage === 'fulfilled' || stage === 'cancelled') continue;
  if (!(stage in openOrders)) continue;
  openOrders[stage] += 1;
  if (oldestAwardCreatedAt === null || award.created_at < oldestAwardCreatedAt) {
    oldestAwardCreatedAt = award.created_at;
  }
}
const open = openOrders.pending + openOrders.accepted + openOrders.processing + openOrders.ready;

const PRODUCT_TYPES = new Set(['food', 'drink', 'merchandise', 'generic']);
const unavailableMenu = [...definitions.values()].filter(
  (definition) =>
    definition.kind === 30402 &&
    !tagValue(definition, 'a') &&
    hasValidPrice(definition) &&
    PRODUCT_TYPES.has(tagValue(definition, 'product_kind') || 'generic') &&
    tagValue(definition, 'availability') === 'unavailable',
).length;

const calendarByAddress = new Map();
for (const event of events.filter((entry) => entry.kind === 31923 && definitionAuthorTrusted(entry.pubkey))) {
  const d = tagValue(event, 'd');
  if (!d) continue;
  const address = `31923:${event.pubkey}:${d}`;
  const previous = calendarByAddress.get(address);
  if (!previous || event.created_at > previous.created_at || (event.created_at === previous.created_at && event.id > previous.id)) {
    calendarByAddress.set(address, event);
  }
}
const nextEvent = [...calendarByAddress.values()]
  .filter((event) => {
    const start = Number(tagValue(event, 'start'));
    const end = Number(tagValue(event, 'end'));
    return start > now || (start <= now && Number.isSafeInteger(end) && end > now);
  })
  .sort((a, b) => Number(tagValue(a, 'start')) - Number(tagValue(b, 'start')))[0];

const membershipAddresses = new Set(
  [...definitions.values()]
    .filter((definition) => definition.kind === 30009 && tagValues(definition, 't').includes('membership'))
    .map(addressOf),
);
const perHolder = new Map();
for (const award of events.filter((entry) => entry.kind === 8)) {
  const definition = definitions.get(tagValue(award, 'a'));
  if (!definition || !membershipAddresses.has(addressOf(definition)) || !awardValid(award, definition)) continue;
  const expiration = Number(tagValue(award, 'expiration'));
  const expiry = Number.isSafeInteger(expiration) && expiration > 0 ? expiration : null;
  const holder = tagValue(award, 'p');
  if (!holder) continue;
  const previous = perHolder.get(holder);
  if (previous === undefined || previous === null || expiry === null || expiry > previous) perHolder.set(holder, expiry);
}
const expiringSoon = [...perHolder.values()].filter((expiry) => expiry !== null && expiry <= now + 30 * 86400).length;

const venueProfile = events
  .filter(
    (entry) =>
      entry.kind === 30078 &&
      tagValue(entry, 'd') === 'nuts-community-profile' &&
      definitionAuthorTrusted(entry.pubkey),
  )
  .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))[0];
const venueName = tagValue(venueProfile, 'name');
const menuDone = [...definitions.values()].some(
  (definition) => definition.kind === 30402 && !tagValue(definition, 'a') && hasValidPrice(definition),
);
const checklist = !menuDone && calendarByAddress.size === 0 && membershipAddresses.size === 0;

assert(open === 3 && openOrders.pending === 2 && openOrders.accepted === 1, 'relay truth: 3 open orders (2 pending, 1 accepted)');
assert(unavailableMenu === 1, 'relay truth: exactly one unavailable menu item');
assert(nextEvent?.id === state.event_id, 'relay truth: the seeded 31923 is the next upcoming event');
assert(perHolder.size === 1 && expiringSoon === 1, 'relay truth: 1 active member, 1 expiring within 30 days');
assert(checklist === false, 'relay truth: established venue (no checklist)');
assert(venueName === state.name, 'relay truth: venue name matches the seeded profile');

const log = execFileSync('adb', ['logcat', '-d'], { maxBuffer: 64 * 1024 * 1024 }).toString();
const payloads = log
  .split('\n')
  .filter((line) => line.includes('[crays-board-home]'))
  .map((line) => {
    const start = line.indexOf('[crays-board-home]') + '[crays-board-home]'.length;
    let payload = line.slice(start).trim();
    if (payload.startsWith("'")) payload = payload.slice(1);
    if (payload.endsWith("'")) payload = payload.slice(0, -1);
    try {
      return JSON.parse(payload);
    } catch {
      return undefined;
    }
  })
  .filter(Boolean);
assert(payloads.length > 0, 'app emitted at least one [crays-board-home] marker');
const marker = payloads[payloads.length - 1];

assert(marker.venue === emulatorUrl(state.relay_url), 'marker is bound to the exact venue relay');
assert(marker.live === true, 'marker reports the venue live');
assert(marker.venueName === venueName, 'marker venue name matches the relay profile');
assert(
  marker.orders?.open === open &&
    marker.orders?.pending === openOrders.pending &&
    marker.orders?.accepted === openOrders.accepted &&
    marker.orders?.processing === openOrders.processing &&
    marker.orders?.ready === openOrders.ready,
  'marker order counts exactly match the independent projection',
);
assert(marker.unavailableMenu === unavailableMenu, 'marker unavailable menu count matches relay truth');
assert(marker.nextEvent?.id === state.event_id, 'marker next event is the seeded 31923');
assert(marker.nextEvent?.startsAt === state.event_start, 'marker next event start matches relay truth');
assert(
  marker.members?.active === perHolder.size && marker.members?.expiringSoon === expiringSoon,
  'marker member counts exactly match relay truth',
);
assert(marker.checklist === false, 'marker reports no checklist for the established venue');
if (oldestAwardCreatedAt !== null) {
  const expectedAge = now - oldestAwardCreatedAt;
  assert(
    Number.isSafeInteger(marker.oldestWaitSeconds) && Math.abs(marker.oldestWaitSeconds - expectedAge) <= 900,
    'marker oldest wait matches the oldest open award age within tolerance',
  );
}
const serialized = JSON.stringify(marker);
assert(!serialized.includes('nsec') && !/nsec1/.test(serialized), 'marker contains no secret material');

console.log('CRAYS BOARD HOME PASS');
