import "@/polyfills/text-encoding";

import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

import { getActivePubkey, signActiveEvent } from "@/account/account";

import { toBase64Url, type RelayRequest } from "./model";

/**
 * App-side client for the Nuts coordinator's venue provisioning API
 * (POST/GET /relays), authenticated with NIP-98 HTTP auth signed by the
 * active staff identity (signActiveEvent). Mirrors the harness-side contract
 * in .qa/relay-lib.mjs: `Authorization: Nostr <base64url kind-27235 event>`
 * with u/method/payload tags, payload = sha256 hex of the exact body.
 *
 * Base URL resolution: EXPO_PUBLIC_CRAYS_COORDINATOR_URL when set (bundled by
 * Metro), else the Android emulator loopback alias in dev builds, else the
 * production coordinator.
 */

export type CoordinatorRelay = {
  id: string;
  status: string;
  domain?: string;
  relay_url?: string;
  base_url?: string;
};

const PRODUCTION_COORDINATOR = "https://coordinator.crays.life";

export function coordinatorBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_CRAYS_COORDINATOR_URL;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv.replace(/\/+$/, "");
  if (__DEV__) {
    return Platform.OS === "android" ? "http://10.0.2.2:7798" : "http://127.0.0.1:7798";
  }
  return PRODUCTION_COORDINATOR;
}

async function nip98Authorization(url: string, method: string, body: string): Promise<string> {
  const payload = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, body, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
  const event = await signActiveEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", nip98UrlTag(url)],
      ["method", method],
      ["payload", payload],
    ],
    content: "",
  });
  return `Nostr ${toBase64Url(JSON.stringify(event))}`;
}

/**
 * The coordinator verifies the u tag against its own configured base URL
 * (NIP98_BASE_URL). On the Android emulator the app connects through the
 * 10.0.2.2 loopback alias, but the coordinator only knows its host-loopback
 * identity — sign the canonical host form while still fetching via the alias.
 */
function nip98UrlTag(url: string): string {
  return url.replace(/^http:\/\/10\.0\.2\.2:/, "http://127.0.0.1:");
}

async function coordinatorFetch<T>(path: string, method: string, body?: unknown): Promise<T> {
  const url = `${coordinatorBaseUrl()}${path}`;
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        authorization: await nip98Authorization(url, method, bodyText),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: method === "GET" || method === "DELETE" ? undefined : bodyText,
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 409) {
        throw new Error("That venue address is already taken. Adjust the venue name and try again.");
      }
      throw new Error(`The venue coordinator could not complete this step (HTTP ${response.status}). Try again.`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function createVenueRelay(request: RelayRequest): Promise<CoordinatorRelay> {
  const created = await coordinatorFetch<CoordinatorRelay>("/relays", "POST", request);
  if (!created?.id) throw new Error("The coordinator did not return a relay record. Try again.");
  return created;
}

export async function getVenueRelay(id: string): Promise<CoordinatorRelay> {
  return coordinatorFetch<CoordinatorRelay>(`/relays/${encodeURIComponent(id)}`, "GET");
}

export async function waitVenueRelayRunning(
  id: string,
  timeoutMs = 120_000,
  intervalMs = 2_000,
): Promise<CoordinatorRelay> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "creating";
  while (Date.now() < deadline) {
    try {
      const relay = await getVenueRelay(id);
      lastStatus = relay.status;
      if (relay.status === "running") {
        if (!relay.relay_url || !relay.base_url) {
          throw new Error("The venue relay is up but did not report its addresses. Try again.");
        }
        return relay;
      }
      if (relay.status !== "creating" && relay.status !== "pending") {
        throw new Error(`The venue relay entered an unexpected state (${relay.status}).`);
      }
    } catch (error) {
      // Coordinator blips during provisioning are retried until the deadline;
      // genuine state errors above propagate.
      if (error instanceof Error && error.message.includes("unexpected state")) throw error;
      if (error instanceof Error && error.message.includes("did not report")) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`The venue relay is taking too long to start (still ${lastStatus}). Resume venue setup to continue.`);
}

/**
 * The coordinator reports relay/service URLs in host-loopback form in dev
 * (ws://127.0.0.1:port). An Android emulator cannot reach that as-is — the
 * same ports are reachable through the 10.0.2.2 host alias. Production URLs
 * and non-Android platforms pass through unchanged.
 */
export function deviceReachableUrl(url: string): string {
  if (__DEV__ && Platform.OS === "android") {
    return url.replace(/^(wss?:\/\/|https?:\/\/)(127\.0\.0\.1|localhost)/, (_match, scheme: string) => `${scheme}10.0.2.2`);
  }
  return url;
}

/** Active staff pubkey or an honest error — provisioning requires a signer. */
export async function requireActivePubkey(): Promise<string> {
  const pubkey = await getActivePubkey();
  if (!pubkey) throw new Error("No active staff account. Create or import the owner account first.");
  return pubkey;
}
