#!/usr/bin/env node
// Independent Home verification (venue-commerce-nip §11 style). Reprojects
// the attention summary from relay truth — trust from the relay's own NIP-11
// document and the venue service's /community/info, never from app code —
// and asserts the app's [crays-board-home] logcat marker matches it exactly.
import { execFileSync } from 'node:child_process';
import { verifyEvent } from 'nostr-tools';
import { assert, emulatorUrl, makePool, readState } from './relay-lib.mjs';

const state = readState();
if (!state?.relay_url || !state?.award_id || !state?.event_id) {
  throw new Error('run .qa/relay-bootstrap-home.mjs first');
}

// --- Independent trust discovery (venue-commerce-nip §4) -------------------
const HEX_64 = /^[0-9a-f]{64}$/i;
const collect = (value, into) => {
  if (typeof value === 'string' && HEX_64.test(value)) into.add(value.toLowerCase());
  else if (Array.isArray(value)) value.forEach((entry) => collect(entry, into));
};
const trusted = new Set();
const nip11Response = await fetch(state.relay_url.replace(/^ws/, 'http'), {
  headers: { accept: 'application/nostr+json' },
});
assert(nip11Response.ok, 'relay NIP-11 document is reachable');
const nip11 = await nip11Response.json();
collect(nip11.pubkey, trusted);
collect(nip11.admin_pubkey, trusted);
collect(nip11.admin_pubkeys, trusted);
collect(nip11.admins, trusted);
const infoResponse = await fetch(`${state.base_url}/community/info`, { headers: { accept: 'application/json' } });
assert(infoResponse.ok, 'venue service /community/info is reachable');
const info = await infoResponse.json();
collect(info.badge_issuer, trusted);
assert(trusted.has(state.admin_pubkey), 'NIP-11 trusts the admin authority');
assert(trusted.has(state.issuer_pubkey), 'service advertises the badge issuer');

// --- Independent relay truth ------------------------------------------------
const pool = makePool();
const events = await pool.querySync([state.relay_url], {
  kinds: [5, 8, 30009, 30078, 31923, 37237],
  limit: 500,
});
pool.close([state.relay_url]);
assert(events.length >= 10, `home fixture family queryable (${events.length} events)`);
assert(events.every(verifyEvent), 'every relay event has a valid Nostr signature');

const tag = (event, name) => event.tags.find((entry) => entry[0] === name)?.[1];
const tagAll = (event, name) => event.tags.filter((entry) => entry[0] === name).map((entry) => entry[1]);
const now = Math.floor(Date.now() / 1000);

// Latest addressable definitions per address (§3.1).
const definitions = new Map();
for (const event of events.filter((entry) => entry.kind === 30009)) {
  const address = `30009:${event.pubkey}:${tag(event, 'd')}`;
  const previous = definitions.get(address);
  if (!previous || event.created_at > previous.created_at) definitions.set(address, event);
}
const isSingleUseSellable = (definition) => {
  if (!tagAll(definition, 't').includes('sellable')) return false;
  const maxUses = Number(tag(definition, 'max_uses'));
  if (Number.isSafeInteger(maxUses) && maxUses > 0) return maxUses === 1;
  return ['food', 'drink', 'merchandise', 'generic', 'event_access'].includes(tag(definition, 'type'));
};

// Status fold per order context (§6.2/§6.6, append-only log).
const STAGE = { pending: 0, accepted: 1, processing: 2, ready: 3, fulfilled: 4, cancelled: 5 };
const statusesByContext = new Map();
for (const status of events.filter((entry) => entry.kind === 37237)) {
  if (!trusted.has(status.pubkey)) continue;
  const contextKey = tag(status, 'd') || tag(status, 'e');
  if (!contextKey) continue;
  const list = statusesByContext.get(contextKey) ?? [];
  list.push(status);
  statusesByContext.set(contextKey, list);
}
const foldedStatus = (awardId) => {
  let stage = 'pending';
  let at = -1;
  let id = '';
  const log = (statusesByContext.get(awardId) ?? []).sort(
    (a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1),
  );
  for (const candidate of log) {
    if (candidate.created_at < at || (candidate.created_at === at && candidate.id <= id)) continue;
    const to = tag(candidate, 'status');
    const context = tag(candidate, 'context');
    const valid =
      stage !== 'fulfilled' &&
      stage !== 'cancelled' &&
      (to === 'cancelled' || (to === 'fulfilled' && context === 'event') || STAGE[to] === STAGE[stage] + 1);
    if (!valid) continue;
    stage = to;
    at = candidate.created_at;
    id = candidate.id;
  }
  return stage;
};

// Orders: trusted, unexpired, single-use awards (§5).
const openOrders = { pending: 0, accepted: 0, processing: 0, ready: 0 };
let oldestAwardCreatedAt = null;
for (const award of events.filter((entry) => entry.kind === 8)) {
  if (!trusted.has(award.pubkey)) continue;
  const expiration = Number(tag(award, 'expiration'));
  if (Number.isSafeInteger(expiration) && expiration > 0 && expiration <= now) continue;
  const definition = definitions.get(tag(award, 'a'));
  if (definition && !isSingleUseSellable(definition)) continue;
  const stage = foldedStatus(award.id);
  if (stage === 'fulfilled' || stage === 'cancelled') continue;
  openOrders[stage] += 1;
  if (oldestAwardCreatedAt === null || award.created_at < oldestAwardCreatedAt) {
    oldestAwardCreatedAt = award.created_at;
  }
}
const open = openOrders.pending + openOrders.accepted + openOrders.processing + openOrders.ready;

// Unavailable sellable products.
const PRODUCT_TYPES = new Set(['food', 'drink', 'merchandise', 'generic']);
const unavailableMenu = [...definitions.values()].filter(
  (definition) =>
    tagAll(definition, 't').includes('sellable') &&
    PRODUCT_TYPES.has(tag(definition, 'type')) &&
    tag(definition, 'availability') === 'unavailable',
).length;

// Next upcoming trusted calendar event (latest per d tag).
const calendarByD = new Map();
for (const event of events.filter((entry) => entry.kind === 31923)) {
  const d = tag(event, 'd');
  const previous = calendarByD.get(d);
  if (!previous || event.created_at > previous.created_at) calendarByD.set(d, event);
}
const nextEvent = [...calendarByD.values()]
  .filter((event) => trusted.has(event.pubkey))
  .filter((event) => {
    const start = Number(tag(event, 'start'));
    const end = Number(tag(event, 'end'));
    return start > now || (start <= now && Number.isSafeInteger(end) && end > now);
  })
  .sort((a, b) => Number(tag(a, 'start')) - Number(tag(b, 'start')))[0];

// Members: trusted live membership awards, minus trusted revocations, deduped
// per holder; expiring soon = within 30 days.
const revoked = new Set();
for (const deletion of events.filter((entry) => entry.kind === 5)) {
  if (!trusted.has(deletion.pubkey)) continue;
  tagAll(deletion, 'e').forEach((reference) => revoked.add(reference));
}
const membershipAddresses = new Set(
  [...definitions.values()]
    .filter((definition) => tag(definition, 'type') === 'membership')
    .map((definition) => `30009:${definition.pubkey}:${tag(definition, 'd')}`),
);
const perHolder = new Map();
for (const award of events.filter((entry) => entry.kind === 8)) {
  if (!trusted.has(award.pubkey)) continue;
  if (!membershipAddresses.has(tag(award, 'a'))) continue;
  if (revoked.has(award.id)) continue;
  const expiration = Number(tag(award, 'expiration'));
  if (Number.isSafeInteger(expiration) && expiration > 0 && expiration <= now) continue;
  const expiry = Number.isSafeInteger(expiration) && expiration > 0 ? expiration : null;
  const holder = tag(award, 'p');
  const previous = perHolder.get(holder);
  if (previous === undefined || previous === null || expiry === null || expiry > previous) {
    perHolder.set(holder, expiry);
  }
}
const expiringSoon = [...perHolder.values()].filter((expiry) => expiry !== null && expiry <= now + 30 * 86400).length;

// Venue name from the latest trusted hospitality profile.
const venueProfile = events
  .filter((entry) => entry.kind === 30078 && tag(entry, 'd') === 'nuts-community-profile' && trusted.has(entry.pubkey))
  .sort((a, b) => b.created_at - a.created_at)[0];
const venueName = venueProfile ? tag(venueProfile, 'name') : undefined;

// Established venue => the checklist projection must be absent.
const menuDone = [...definitions.values()].some(
  (definition) => tagAll(definition, 't').includes('sellable') && PRODUCT_TYPES.has(tag(definition, 'type')),
);
const eventsDone = [...calendarByD.values()].some((event) => trusted.has(event.pubkey));
const membersDone = perHolder.size > 0 || membershipAddresses.size > 0;
const checklist = !menuDone && !eventsDone && !membersDone;

// Fixture sanity: the seeded families are exactly what the scenario promised.
assert(open === 3 && openOrders.pending === 2 && openOrders.accepted === 1, 'relay truth: 3 open orders (2 pending, 1 accepted)');
assert(unavailableMenu === 1, 'relay truth: exactly one unavailable menu item');
assert(nextEvent?.id === state.event_id, 'relay truth: the seeded 31923 is the next upcoming event');
assert(perHolder.size === 1 && expiringSoon === 1, 'relay truth: 1 active member, 1 expiring within 30 days');
assert(checklist === false, 'relay truth: established venue (no checklist)');
assert(venueName === state.name, 'relay truth: venue name matches the seeded profile');

// --- Device truth: the app's marker matches the independent projection ------
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

// The app connects through the emulator-mapped URL (10.0.2.2), so the marker
// names that form of the same relay.
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
  'marker member counts exactly match the independent projection',
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
