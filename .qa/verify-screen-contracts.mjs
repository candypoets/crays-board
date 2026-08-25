#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);

// Every screen spec under docs/screens/ is registered here with exactly one
// native Agent Device flow and one named .qa lifecycle runner.
const contracts = [
  ['docs/screens/check-in.md', 'e2e/flows/31-check-in.{profile}.ad', '.qa/qa-check-in.mjs'],
  ['docs/screens/create-venue.md', 'e2e/flows/70-create-venue.ad', '.qa/qa-create-venue.mjs'],
  ['docs/screens/events.md', 'e2e/flows/30-events.{profile}.ad', '.qa/qa-events.mjs'],
  ['docs/screens/home.md', 'e2e/flows/80-home.{profile}.ad', '.qa/qa-home.mjs'],
  ['docs/screens/invites.md', 'e2e/flows/50-invites.{profile}.ad', '.qa/qa-invites.mjs'],
  ['docs/screens/menu.md', 'e2e/flows/20-menu.{profile}.ad', '.qa/qa-menu.mjs'],
  ['docs/screens/orders-ladder.md', 'e2e/flows/11-orders-ladder.{profile}.ad', '.qa/qa-orders-ladder.mjs'],
  ['docs/screens/orders.md', 'e2e/flows/10-orders.ad', '.qa/qa-orders.mjs'],
  ['docs/screens/people.md', 'e2e/flows/40-people.{profile}.ad', '.qa/qa-people.mjs'],
  ['docs/screens/settings.md', 'e2e/flows/60-settings.{profile}.ad', '.qa/qa-settings.mjs'],
  ['docs/screens/venue-selection.md', 'e2e/flows/05-venue-selection.ad', '.qa/qa-venue-selection.mjs'],
  ['docs/screens/welcome.md', 'e2e/flows/00-welcome.ad', '.qa/qa-welcome.mjs'],
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
  const files = flow.includes('{profile}')
    ? [doc, flow.replace('{profile}', 'phone'), flow.replace('{profile}', 'tablet'), runner]
    : [doc, flow, runner];
  for (const file of files) {
    const path = resolve(root, file);
    if (!existsSync(path)) throw new Error(`Missing screen contract artifact: ${path}`);
  }
}

console.log(
  `CRAYS BOARD SCREEN CONTRACTS PASS: ${contracts.length} specs each have native Agent Device flow coverage and a named .qa lifecycle`,
);
