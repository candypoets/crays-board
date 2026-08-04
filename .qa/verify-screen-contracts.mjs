#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);

// Every screen spec under docs/screens/ is registered here with exactly one
// Maestro flow and one named .qa lifecycle runner.
const contracts = [
  ['docs/screens/check-in.md', 'maestro/flows/31-check-in.yaml', '.qa/qa-check-in.mjs'],
  ['docs/screens/create-venue.md', 'maestro/flows/70-create-venue.yaml', '.qa/qa-create-venue.mjs'],
  ['docs/screens/events.md', 'maestro/flows/30-events.yaml', '.qa/qa-events.mjs'],
  ['docs/screens/home.md', 'maestro/flows/80-home.yaml', '.qa/qa-home.mjs'],
  ['docs/screens/invites.md', 'maestro/flows/50-invites.yaml', '.qa/qa-invites.mjs'],
  ['docs/screens/menu.md', 'maestro/flows/20-menu.yaml', '.qa/qa-menu.mjs'],
  ['docs/screens/orders-ladder.md', 'maestro/flows/11-orders-ladder.yaml', '.qa/qa-orders-ladder.mjs'],
  ['docs/screens/orders.md', 'maestro/flows/10-orders.yaml', '.qa/qa-orders.mjs'],
  ['docs/screens/people.md', 'maestro/flows/40-people.yaml', '.qa/qa-people.mjs'],
  ['docs/screens/settings.md', 'maestro/flows/60-settings.yaml', '.qa/qa-settings.mjs'],
  ['docs/screens/venue-selection.md', 'maestro/flows/05-venue-selection.yaml', '.qa/qa-venue-selection.mjs'],
  ['docs/screens/welcome.md', 'maestro/flows/00-welcome.yaml', '.qa/qa-welcome.mjs'],
];

const documented = readdirSync(resolve(root, 'docs/screens'))
  .filter((name) => name.endsWith('.md'))
  .map((name) => `docs/screens/${name}`)
  .sort();
const registered = contracts.map(([doc]) => doc).sort();
if (JSON.stringify(documented) !== JSON.stringify(registered)) {
  throw new Error(
    `Screen contract registry mismatch.\nDocumented: ${documented.join(', ')}\nRegistered: ${registered.join(', ')}`,
  );
}

for (const [doc, flow, runner] of contracts) {
  for (const file of [doc, flow, runner]) {
    const path = resolve(root, file);
    if (!existsSync(path)) throw new Error(`Missing screen contract artifact: ${path}`);
  }
}

console.log(
  `CRAYS BOARD SCREEN CONTRACTS PASS: ${contracts.length} specs each have a Maestro flow and named .qa lifecycle`,
);
