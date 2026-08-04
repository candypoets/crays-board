import type { NostrManagerLike } from "@candypoets/nipworker";
import {
  ReactNativeBackend,
  hasReactNativeModule,
  setManager,
} from "@candypoets/nipworker/react-native";

export type NostrRuntimeStatus = "ready" | "unavailable" | "error";

export type NostrRuntime = {
  manager: NostrManagerLike | null;
  status: NostrRuntimeStatus;
  detail?: string;
};

let sharedRuntime: NostrRuntime | null = null;

/**
 * Creates the single nipworker runtime used throughout the app.
 *
 * Venue relays are intentionally not hard-coded here. A venue descriptor or a
 * screen-specific query owns its relay set and stable subscription IDs.
 */
export function getNostrRuntime(): NostrRuntime {
  if (sharedRuntime) return sharedRuntime;

  if (!hasReactNativeModule()) {
    sharedRuntime = {
      manager: null,
      status: "unavailable",
      detail: "Use a Crays development build; Expo Go cannot load nipworker.",
    };
    return sharedRuntime;
  }

  try {
    const manager = new ReactNativeBackend({
      defaultRelays: [],
      indexerRelays: [],
      logLevel: __DEV__ ? "info" : "warn",
    });
    setManager(manager);
    sharedRuntime = { manager, status: "ready" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn("[nostr] failed to initialize nipworker", error);
    sharedRuntime = { manager: null, status: "error", detail };
  }

  return sharedRuntime;
}
