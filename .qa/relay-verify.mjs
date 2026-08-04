#!/usr/bin/env node
import { verifyEvent } from 'nostr-tools';
import { assert, makePool, readState } from './relay-lib.mjs';

const state = readState();
if (!state?.relay_url) throw new Error('run .qa/relay-bootstrap.mjs first');
const pool = makePool();
const events = await pool.querySync([state.relay_url], {
  kinds: [8, 30009, 30078, 37237],
  limit: 200,
});
pool.close([state.relay_url]);

assert(events.length >= 3, 'venue fixture family remains queryable');
assert(events.every(verifyEvent), 'every relay event has a valid Nostr signature');

const profile = events.find((event) => event.id === state.venue_profile_id);
assert(profile?.pubkey === state.admin_pubkey, 'venue profile is signed by the admin authority');
assert(profile.tags.some((tag) => tag[0] === 'd' && tag[1] === 'nuts-community-profile'), 'venue profile uses the nuts-community-profile d tag');
assert(profile.tags.some((tag) => tag[0] === 'type' && tag[1] === 'hospitality'), 'venue profile declares type=hospitality');

const product = events.find((event) => event.id === state.product_definition_id);
assert(product?.pubkey === state.admin_pubkey, 'product definition is signed by the admin authority');
assert(product.tags.some((tag) => tag[0] === 't' && tag[1] === 'sellable'), 'product definition is sellable');

const award = events.find((event) => event.id === state.award_id);
assert(award?.pubkey === state.issuer_pubkey, 'order award is signed by the badge issuer');
assert(award.tags.some((tag) => tag[0] === 'a' && tag[1] === state.product_address), 'award references the exact product address');
assert(award.tags.some((tag) => tag[0] === 'p' && tag[1] === state.user_pubkey), 'award grants the exact fixture user');

console.log('CRAYS BOARD RELAY VERIFY PASS');
