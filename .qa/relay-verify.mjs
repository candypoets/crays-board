#!/usr/bin/env node
import { verifyEvent } from 'nostr-tools';
import { assert, makePool, readState, relayInfoUrl, tagValue, tagValues } from './relay-lib.mjs';

const state = readState();
if (!state?.relay_url) throw new Error('run .qa/relay-bootstrap.mjs first');
const pool = makePool();
const events = await pool.querySync([state.relay_url], {
  kinds: [8, 30009, 30402, 31727, 30078, 37237],
  limit: 200,
});
pool.close([state.relay_url]);

assert(events.length >= 5, 'NIP-97 venue fixture family remains queryable');
assert(events.every(verifyEvent), 'every relay event has a valid Nostr signature');

const infoResponse = await fetch(relayInfoUrl(state.relay_url), {
  headers: { accept: 'application/nostr+json' },
});
assert(infoResponse.ok, 'relay NIP-11 document remains reachable');
const info = await infoResponse.json();
assert(info.pubkey === state.community_root_pubkey, 'NIP-11 exposes the recorded community root');

const anchor = events.find((event) => event.id === state.community_anchor_id);
assert(anchor?.kind === 31727 && anchor.pubkey === state.community_root_pubkey, 'recorded root-signed community anchor remains queryable');
assert(tagValue(anchor, 'd') === 'community', 'community anchor uses d=community');
assert(tagValues(anchor, 'p').includes(state.admin_pubkey), 'community anchor delegates the staff admin');
assert(tagValue(anchor, 'badge_issuer') === state.issuer_pubkey, 'community anchor delegates the badge issuer');

const requiredMembership = events.find(
  (event) =>
    event.kind === 30009 &&
    `${event.kind}:${event.pubkey}:${tagValue(event, 'd')}` === state.required_badge_address,
);
assert(requiredMembership?.pubkey === state.community_root_pubkey, 'required membership definition is root-authored');
assert(tagValues(requiredMembership, 't').includes('membership'), 'required definition is t=membership');
assert(
  JSON.stringify(requiredMembership.tags.find((tag) => tag[0] === 'price')) === JSON.stringify(['price', '0', 'SAT']),
  'required membership is zero-priced and issuer-awardable',
);

const profile = events.find((event) => event.id === state.venue_profile_id);
assert(profile?.pubkey === state.admin_pubkey, 'venue profile is signed by the admin authority');
assert(profile.tags.some((tag) => tag[0] === 'd' && tag[1] === 'nuts-community-profile'), 'venue profile uses the nuts-community-profile d tag');
assert(profile.tags.some((tag) => tag[0] === 'type' && tag[1] === 'hospitality'), 'venue profile declares type=hospitality');

const product = events.find((event) => event.id === state.product_definition_id);
assert(product?.pubkey === state.admin_pubkey, 'product definition is signed by the admin authority');
assert(product?.kind === 30402, 'product definition is a NIP-99 30402 listing');
assert(tagValue(product, 'title'), 'product listing carries a title');
assert(product.tags.some((tag) => tag[0] === 'price' && tag[1] && tag[2] === 'EUR'), 'product listing is sellable through its NIP-99 price tag');
assert(tagValue(product, 'type') === undefined && !tagValues(product, 't').includes('sellable'), 'product has no legacy type/t=sellable taxonomy');

const award = events.find((event) => event.id === state.award_id);
assert(award?.pubkey === state.issuer_pubkey, 'order award is signed by the badge issuer');
assert(award.tags.some((tag) => tag[0] === 'a' && tag[1] === state.product_address), 'award references the exact product address');
assert(award.tags.some((tag) => tag[0] === 'p' && tag[1] === state.user_pubkey), 'award grants the exact fixture user');
assert(tagValues(award, 't').includes('30402'), 'award carries the definition-kind query hint');

console.log('CRAYS BOARD RELAY VERIFY PASS');
