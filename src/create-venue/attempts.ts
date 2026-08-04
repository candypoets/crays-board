import * as SecureStore from "expo-secure-store";

import type { VenueDraft } from "./model";

/**
 * Resumable venue-creation attempt state (PRD §8.2 idempotency). This is
 * NON-secret data (attempt id, draft, relay ids/urls); the staff secret never
 * leaves account custody. SecureStore is reused for the record so it survives
 * relaunch without introducing AsyncStorage.
 *
 * The record is persisted BEFORE the coordinator POST, so a retry can
 * reconcile the stable attempt instead of blindly requesting a second relay.
 * As soon as `relayId` exists the UI offers "Resume venue setup", never a
 * fresh "Create venue" (CREATE-08/CREATE-09 structure; failure-injection
 * scenarios arrive with the durable-boundary work).
 */

export type AttemptPhase =
  /** Persisted before POST /relays; coordinator outcome unknown. */
  | "requested"
  /** Coordinator accepted; relay record and urls are known. */
  | "allocated"
  /** Relay reports status running. */
  | "running"
  /** Venue profile 30078 acknowledged by the new relay. */
  | "profile_published"
  /** Venue selected; attempt finished and can be discarded. */
  | "completed";

export type CreateVenueAttempt = {
  attemptId: string;
  domainLabel: string;
  draft: VenueDraft;
  phase: AttemptPhase;
  relayId?: string;
  relayUrl?: string;
  serviceUrl?: string;
  profileEventId?: string;
  createdAt: number;
  updatedAt: number;
};

const STORAGE_KEY = "crays.board.create-venue.attempt";

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const PHASES: AttemptPhase[] = ["requested", "allocated", "running", "profile_published", "completed"];

function isValidAttempt(value: unknown): value is CreateVenueAttempt {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.attemptId === "string" &&
    typeof candidate.domainLabel === "string" &&
    typeof candidate.draft === "object" &&
    candidate.draft !== null &&
    typeof candidate.phase === "string" &&
    PHASES.includes(candidate.phase as AttemptPhase) &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.updatedAt === "number"
  );
}

export async function loadAttempt(): Promise<CreateVenueAttempt | null> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    return isValidAttempt(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveAttempt(attempt: CreateVenueAttempt): Promise<void> {
  await SecureStore.setItemAsync(
    STORAGE_KEY,
    JSON.stringify({ ...attempt, updatedAt: Date.now() }),
    secureOptions,
  );
}

export async function clearAttempt(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY).catch(() => {});
}
