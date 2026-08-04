#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { verifyEvent } from 'nostr-tools';
import { assert, makePool, readState } from './relay-lib.mjs';

const state = readState();
if (!state?.relay_url || !state?.active_award_id || !state?.role_address) {
  throw new Error('run .qa/relay-bootstrap-people.mjs first');
}

// Independent relay truth per venue-commerce-nip §11 (docs/screens/people.md).
const pool = makePool();
const revocations = await pool.querySync([state.relay_url], { kinds: [5], limit: 50 });
const assignments = await pool.querySync([state.relay_url], { kinds: [8], '#p': [state.expiring_user_pubkey] });
const roleVersions = await pool.querySync([state.relay_url], { kinds: [30009], '#d': [state.role_d] });
pool.close([state.relay_url]);

const tag = (event, name) => event.tags.find((entry) => entry[0] === name)?.[1];
const tags = (event, name) => event.tags.filter((entry) => entry[0] === name).map((entry) => entry[1]);

// 1. Membership revocation (PEOPLE-04): exactly one kind 5 references the
// revoked award id; the seeded fixture revocation is the only other one.
assert(revocations.length === 2, `exactly two kind 5 events exist: the fixture and the app revocation (${revocations.length} found)`);
const appRevocations = revocations.filter((event) => tags(event, 'e').includes(state.active_award_id));
assert(appRevocations.length === 1, `exactly one kind 5 references the revoked membership award (${appRevocations.length} found)`);
const revocation = appRevocations[0];
assert(revocation.pubkey === state.admin_pubkey, 'revocation is signed by the staff (admin) pubkey');
assert(tag(revocation, 'k') === '8', 'revocation carries the NIP-09 k=8 hint');
assert(verifyEvent(revocation), 'revocation has a valid Nostr signature');
assert(revocation.created_at >= state.active_award_created_at, 'revocation is not older than the award');
// Forbidden: no revocation touches any other award.
assert(!revocations.some((event) => tags(event, 'e').includes(state.expiring_award_id)), 'no revocation references the expiring award');
assert(!revocations.some((event) => tags(event, 'e').includes(state.award_id)), 'no revocation references the product order award');

// 2. Role assignment (ROLE-03): exactly one new kind 8 for the assigned user
// with exact a/p tags and no expiration (permanent).
const roleAwards = assignments.filter((event) => tag(event, 'a') === state.role_address);
assert(roleAwards.length === 1, `exactly one kind 8 assigns the seeded role to the user (${roleAwards.length} found)`);
const assignment = roleAwards[0];
assert(tag(assignment, 'p') === state.expiring_user_pubkey, 'assignment p tag is the exact assigned user');
assert(assignment.pubkey === state.admin_pubkey, 'assignment is signed by the staff (admin) pubkey');
assert(tag(assignment, 'expiration') === undefined, 'permanent assignment carries no expiration tag');
assert(verifyEvent(assignment), 'assignment has a valid Nostr signature');

// 3. Role edit (ROLE-01/02): the republished definition keeps the same d and
// carries exactly the original set plus the toggled permission.
// Kind 30009 is addressable: strfry retains only the latest event per
// (kind, pubkey, d), so the original seeded version is replaced, not kept.
// Republication is proved by the new id at the same d (asserted below).
assert(roleVersions.length >= 1, `role definition is queryable at its d (${roleVersions.length} versions found)`);
assert(roleVersions.every((event) => event.pubkey === state.admin_pubkey), 'every role version is signed by the admin authority');
const latest = roleVersions.reduce((a, b) => (b.created_at > a.created_at || (b.created_at === a.created_at && b.id > a.id) ? b : a));
assert(tag(latest, 'type') === 'role' && tag(latest, 't') === 'role', 'latest role keeps type=role and t=role');
const permissions = tags(latest, 'permission').sort();
assert(
  JSON.stringify(permissions) === JSON.stringify(['events', 'invites', 'posts']),
  `latest role permission set is exactly posts+events+invites (${JSON.stringify(permissions)})`,
);
assert(verifyEvent(latest), 'latest role definition has a valid Nostr signature');
assert(latest.id !== state.role_definition_id, 'the latest role definition is a new event at the same d');

// 4. Device truth: the app logged the same event ids/values that landed on
// the relay (fixed marker contract, JSON payload after the marker):
//   [crays-board-person] {"pubkey": ..., "status": ...}
//   [crays-board-revoke] {"id": <kind5 id>, "e": <award id>}
//   [crays-board-role]   {"id": <30009 id>, "d": <role d>, "permissions": [...]}
//   [crays-board-assign] {"id": <kind8 id>, "a": <role address>, "p": <pubkey>}
const log = execFileSync('adb', ['logcat', '-d'], { maxBuffer: 64 * 1024 * 1024 }).toString();
const markerPayloads = (marker) =>
  log
    .split('\n')
    .filter((line) => line.includes(marker))
    .map((line) => {
      const start = line.indexOf(marker) + marker.length;
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

const people = markerPayloads('[crays-board-person]');
assert(people.some((entry) => JSON.stringify(entry).includes(state.expiring_user_pubkey)), 'app projected the expiring fixture user');
assert(people.some((entry) => JSON.stringify(entry).includes('"expiring"')), 'app projected an Expiring soon person');
assert(people.some((entry) => JSON.stringify(entry).includes('"expired"')), 'app projected an Expired person');

const revokeMarkers = markerPayloads('[crays-board-revoke]');
assert(
  revokeMarkers.some((entry) => JSON.stringify(entry) === JSON.stringify({ id: revocation.id, e: state.active_award_id })),
  'app logged the same revocation event id and award reference that landed on the relay',
);

const roleMarkers = markerPayloads('[crays-board-role]');
assert(
  roleMarkers.some((entry) => JSON.stringify(entry).includes(latest.id) && JSON.stringify(entry).includes(state.role_d)),
  'app logged the same republished role definition id that landed on the relay',
);

const assignMarkers = markerPayloads('[crays-board-assign]');
assert(
  assignMarkers.some(
    (entry) =>
      JSON.stringify(entry).includes(assignment.id) &&
      JSON.stringify(entry).includes(state.role_address) &&
      JSON.stringify(entry).includes(state.expiring_user_pubkey),
  ),
  'app logged the same role assignment event id that landed on the relay',
);

console.log('CRAYS BOARD PEOPLE VERIFY PASS');
