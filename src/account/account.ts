import "@/polyfills/text-encoding";

import { useSignEvent } from "@candypoets/nipworker/hooks";
import * as SecureStore from "expo-secure-store";
import { getPublicKey, nip19, verifyEvent, type Event, type EventTemplate } from "nostr-tools";

import { getNostrRuntime } from "@/nostr/manager";

/**
 * Minimal staff-identity custody for the Board slice, ported from crays-rn
 * src/account/account.ts. The durable secret is an nsec in SecureStore; the
 * nipworker React Native private-key signer accepts the 64-char hex scalar.
 * The nsec and the hex scalar are never logged.
 */
const STORAGE = {
  nsec: "crays.board.identity.nsec",
  pubkey: "crays.board.identity.pubkey",
} as const;

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type StaffIdentity = { pubkey: string };

export function nsecToSignerHex(nsec: string): string {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== "nsec" || !(decoded.data instanceof Uint8Array)) {
    throw new Error("The protected account key is not a valid Nostr secret.");
  }
  return Array.from(decoded.data, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function nsecToPubkey(nsec: string): string {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== "nsec" || !(decoded.data instanceof Uint8Array)) {
    throw new Error("The staff key is not a valid nsec.");
  }
  return getPublicKey(decoded.data);
}

/**
 * Validates an nsec, installs it as the active signer, and persists it in
 * SecureStore. Dev/QA entry point — production custody surfaces come later.
 */
export async function installStaffIdentity(nsec: string): Promise<StaffIdentity> {
  const pubkey = nsecToPubkey(nsec);
  const runtime = getNostrRuntime();
  if (!runtime.manager) {
    throw new Error("The secure Nostr engine is unavailable. Use a Crays development build.");
  }
  runtime.manager.setSigner("privkey", nsecToSignerHex(nsec));
  await SecureStore.setItemAsync(STORAGE.nsec, nsec, secureOptions);
  await SecureStore.setItemAsync(STORAGE.pubkey, pubkey, secureOptions);
  return { pubkey };
}

/**
 * Restores the stored staff identity into the runtime signer on demand
 * (e.g. after relaunch). Returns null when no valid identity is stored.
 */
export async function restoreStaffIdentity(): Promise<StaffIdentity | null> {
  const [nsec, pubkey] = await Promise.all([
    SecureStore.getItemAsync(STORAGE.nsec),
    SecureStore.getItemAsync(STORAGE.pubkey),
  ]);
  if (!nsec || !pubkey) return null;
  try {
    if (nsecToPubkey(nsec) !== pubkey) return null;
  } catch {
    return null;
  }
  const runtime = getNostrRuntime();
  if (!runtime.manager) return null;
  runtime.manager.setSigner("privkey", nsecToSignerHex(nsec));
  return { pubkey };
}

/**
 * Removes the stored staff identity from SecureStore (account switch / sign
 * out). The runtime signer is replaced on the next install; callers also
 * clear the venue selection through VenueContext.
 */
export async function clearStaffIdentity(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(STORAGE.nsec, secureOptions),
    SecureStore.deleteItemAsync(STORAGE.pubkey, secureOptions),
  ]);
}

export async function getActivePubkey(): Promise<string | null> {
  const [nsec, pubkey] = await Promise.all([
    SecureStore.getItemAsync(STORAGE.nsec),
    SecureStore.getItemAsync(STORAGE.pubkey),
  ]);
  if (!nsec || !pubkey) return null;
  try {
    return nsecToPubkey(nsec) === pubkey ? pubkey : null;
  } catch {
    return null;
  }
}

/**
 * Signs a template with the active signer. Verifies the returned event's
 * signature and that it belongs to the stored staff pubkey before resolving;
 * rejects on signer timeout (per crays-rn pattern).
 */
export function signActiveEvent(template: EventTemplate): Promise<Event> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    const timeout = setTimeout(
      () => fail(new Error("The protected signer did not respond. Please try again.")),
      15_000,
    );

    void (async () => {
      const expectedPubkey = await getActivePubkey();
      useSignEvent(template, (event) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (!verifyEvent(event)) {
          reject(new Error("The event signature could not be verified. Please try again."));
          return;
        }
        if (expectedPubkey && event.pubkey !== expectedPubkey) {
          reject(new Error("The signer returned an event for a different account."));
          return;
        }
        resolve(event);
      });
    })().catch((error: unknown) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    });
  });
}
