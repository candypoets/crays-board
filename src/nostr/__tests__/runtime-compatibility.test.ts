/// <reference types="jest" />

import runtimeManifest from "../../../node_modules/@candypoets/nipworker/package.json";

const MINIMUM_NIP97_AWARD_VERSION = [0, 99, 10] as const;

function versionTuple(value: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  if (!match) throw new Error(`Invalid nipworker version: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function versionAtLeast(actual: readonly number[], minimum: readonly number[]): boolean {
  for (let index = 0; index < Math.max(actual.length, minimum.length); index += 1) {
    const difference = (actual[index] ?? 0) - (minimum[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

describe("native Nostr runtime compatibility", () => {
  it("accepts NIP-97 awards for 30402 listings and calendar definitions", () => {
    // nipworker <=0.97.11 parsed kind 8 as strict NIP-58 and dropped awards
    // unless their `a` tag referenced kind 30009. Board extends awards per
    // NIP-97 to 30402/31922/31923; 0.99.10 is the first published runtime
    // containing that native parser fix. Keep this guard beside the protocol
    // tests so a dependency rollback cannot leave pure folds green while the
    // device silently receives zero orders or tickets.
    expect(runtimeManifest.version).toBeDefined();
    expect(versionAtLeast(versionTuple(runtimeManifest.version), MINIMUM_NIP97_AWARD_VERSION)).toBe(true);
  });
});
