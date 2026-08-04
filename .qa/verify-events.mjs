#!/usr/bin/env node
/**
 * Events scenario verifier (venue-commerce-nip §11 style). Proves relay truth
 * independently of the rendered UI:
 *
 * - the seeded kind 31923 exists exactly once (d=state.event_d, admin-signed);
 * - the created kind 31923 exists exactly once (double-tap idempotency proof),
 *   signed by the admin, with exactly the tag names d/title/start/end/summary
 *   and a valid schedule;
 * - the RSVP fold over kind 31925 (latest per attendee) is exactly
 *   accepted=2, tentative=1, declined=0;
 * - logcat [crays-board-event] projection markers match that relay truth, and
 *   [crays-board-event-published] carries the same event id that landed.
 */
import { execFileSync } from 'node:child_process';
import { verifyEvent } from 'nostr-tools';
import { assert, makePool, readState } from './relay-lib.mjs';

const state = readState();
if (!state?.relay_url || !state?.event_address) throw new Error('run .qa/relay-bootstrap-events.mjs first');

const tag = (event, name) => event.tags.find((entry) => entry[0] === name)?.[1];

const pool = makePool();
const calendar = await pool.querySync([state.relay_url], { kinds: [31923], limit: 100 });
const rsvps = await pool.querySync([state.relay_url], { kinds: [31925], '#a': [state.event_address], limit: 100 });
pool.close([state.relay_url]);

// Seeded event: exactly once, signed by the admin authority.
const seeded = calendar.filter((event) => tag(event, 'd') === state.event_d);
assert(seeded.length === 1, `exactly one seeded 31923 with d=${state.event_d} (${seeded.length} found)`);
assert(seeded[0].pubkey === state.admin_pubkey, 'seeded event is signed by the admin authority');
assert(tag(seeded[0], 'title') === state.event_title, 'seeded event carries the fixture title');
assert(verifyEvent(seeded[0]), 'seeded event has a valid Nostr signature');

// Created event: exactly once (the double-tap idempotency proof), signed by
// the admin, exact open/free tag set per the events slice contract.
const created = calendar.filter((event) => tag(event, 'title') === state.created_event_title);
assert(created.length === 1, `exactly one created 31923 titled "${state.created_event_title}" (${created.length} found)`);
const event = created[0];
assert(event.pubkey === state.admin_pubkey, 'created event is signed by the staff (admin) pubkey');
assert(verifyEvent(event), 'created event has a valid Nostr signature');
const tagNames = event.tags.map((entry) => entry[0]).sort();
assert(
  JSON.stringify(tagNames) === JSON.stringify(['d', 'end', 'start', 'summary', 'title']),
  `created event carries exactly the d/title/start/end/summary tags (${tagNames.join(',')})`,
);
const start = Number(tag(event, 'start'));
const end = Number(tag(event, 'end'));
assert(Number.isSafeInteger(start) && start > 0, 'created event start is a positive safe integer');
assert(Number.isSafeInteger(end) && end > start, 'created event ends after it starts');
assert((tag(event, 'd') || '').length > 0, 'created event has a non-empty d identifier');
assert(tag(event, 'summary') === 'Created by the events QA flow.', 'created event summary matches the flow input');

// No other calendar events from the admin exist: repeat taps, retries, and
// relaunch did not multiply events.
const byAdmin = calendar.filter((entry) => entry.pubkey === state.admin_pubkey);
assert(byAdmin.length === 2, `the admin authored exactly two 31923 events (seeded + created; ${byAdmin.length} found)`);

// RSVP relay truth: latest response per attendee for the seeded event.
const latestByAttendee = new Map();
for (const rsvp of rsvps) {
  const previous = latestByAttendee.get(rsvp.pubkey);
  if (!previous || rsvp.created_at > previous.created_at || (rsvp.created_at === previous.created_at && rsvp.id > previous.id)) {
    latestByAttendee.set(rsvp.pubkey, rsvp);
  }
}
const counts = { accepted: 0, tentative: 0, declined: 0 };
for (const rsvp of latestByAttendee.values()) counts[tag(rsvp, 'status')] += 1;
assert(
  JSON.stringify(counts) === JSON.stringify(state.rsvp_expected),
  `relay RSVP fold is ${JSON.stringify(state.rsvp_expected)} (got ${JSON.stringify(counts)})`,
);

// Device truth: the app projected the same counts and the same created event.
// Marker payloads are JSON per the fixed app contract:
//   [crays-board-event]           {"a": <event address>, "title": ..., "accepted": n, "tentative": n, "declined": n}
//   [crays-board-event-published] {"id": <event id>, "a": <event address>, "title": ...}
const log = execFileSync('adb', ['logcat', '-d'], { maxBuffer: 64 * 1024 * 1024 }).toString();
const markerPayloads = (marker) =>
  log
    .split('\n')
    .filter((line) => line.includes(marker))
    .map((line) => {
      const startIndex = line.indexOf(marker) + marker.length;
      let payload = line.slice(startIndex).trim();
      if (payload.startsWith("'")) payload = payload.slice(1);
      if (payload.endsWith("'")) payload = payload.slice(0, -1);
      try {
        return JSON.parse(payload);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);

const projections = markerPayloads('[crays-board-event]');
const seededMarker = projections.find((entry) => JSON.stringify(entry).includes(state.event_address));
assert(seededMarker, 'app projected the seeded event address');
assert(
  seededMarker.accepted === state.rsvp_expected.accepted &&
    seededMarker.tentative === state.rsvp_expected.tentative &&
    seededMarker.declined === state.rsvp_expected.declined,
  `projected RSVP counts match relay truth (${JSON.stringify(seededMarker)})`,
);
const createdMarker = projections.find((entry) => JSON.stringify(entry).includes(state.created_event_title));
assert(createdMarker, 'app projected the created event after relay acknowledgement');
assert(createdMarker.accepted === 0, 'created event projects with zero RSVPs');

const published = markerPayloads('[crays-board-event-published]');
assert(
  published.some((entry) => JSON.stringify(entry).includes(event.id)),
  'app logged the same created event id that landed on the relay',
);

console.log('CRAYS BOARD EVENTS PASS');
