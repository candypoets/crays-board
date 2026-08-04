import { extractTagValue, extractTagValues, type WorkerMessage } from "@candypoets/nipworker";
import { useSubscription as subscribeToNostr } from "@candypoets/nipworker/hooks";
import { asKind0, isEoce, isParsedEvent } from "@candypoets/nipworker/utils";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { getNostrRuntime } from "@/nostr/manager";
import { KIND_AWARD, KIND_DEFINITION } from "@/nostr/protocol";
import { useVenue } from "@/venue/VenueContext";
import { fetchVenueTrust } from "@/venue/trust";

import { KIND_DELETION } from "./builders";
import {
  isPermission,
  projectPeople,
  projectRoles,
  type PeopleAwardInput,
  type PeopleDefinitionInput,
  type Person,
  type ProfileInput,
  type RevocationInput,
  type RoleSummary,
} from "./fold";

const KIND_PROFILE = 0;

export type PeopleResult = {
  status: "loading" | "ready" | "error";
  people: Person[];
  roles: RoleSummary[];
  error?: string;
};

type Buffer = {
  profiles: Map<string, ProfileInput>;
  awards: Map<string, PeopleAwardInput>;
  definitions: Map<string, PeopleDefinitionInput>;
  revocations: Map<string, RevocationInput>;
};

const emptyBuffer = (): Buffer => ({
  profiles: new Map(),
  awards: new Map(),
  definitions: new Map(),
  revocations: new Map(),
});

/**
 * Subscription coordinator for the People surface. Owns exactly one stable
 * subscription (`board_people_<sanitized relay>`, kinds 0/5/8/30009), extracts
 * plain inputs at the worker boundary, and folds them through the pure
 * projection in fold.ts. EOSE is the loaded signal. Cleanup unsubscribes on
 * unmount, venue change, and backgrounding.
 *
 * `localRevocations` lets the route fold a just-acknowledged kind 5 in before
 * the relay echo arrives, so a confirmed revocation is never shown as active
 * again (the marker is relay-acknowledged truth, not optimistic intent).
 */
export function usePeople(localRevocations: RevocationInput[] = [], retryKey = 0): PeopleResult {
  const { venue, restoring } = useVenue();
  const relayUrl = venue?.relayUrl;
  const serviceUrl = venue?.serviceUrl;
  const activePubkey = venue?.pubkey;

  const [trust, setTrust] = useState<{ trustedIssuers: ReadonlySet<string>; authorities: ReadonlySet<string> } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [buffer, setBuffer] = useState<Buffer>(emptyBuffer);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Issuer trust (venue-commerce-nip §4): NIP-11 venue authorities (also the
  // root-admin people source, PRD §8.7) plus the advertised badge issuer.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTrust(null);
    setError(null);
    if (!relayUrl || !serviceUrl) return;
    let cancelled = false;
    fetchVenueTrust(relayUrl, serviceUrl)
      .then((venueTrust) => {
        if (!cancelled) {
          setTrust({ trustedIssuers: venueTrust.trustedIssuers, authorities: new Set(venueTrust.authorities) });
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [relayUrl, serviceUrl, retryKey]);

  // The single people subscription (pattern from useOrders: the REQ opens
  // after a small foreground settle window).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBuffer(emptyBuffer());
    setLoaded(false);
    if (!relayUrl) return;
    if (!getNostrRuntime().manager) {
      setError("The secure Nostr engine is unavailable. Use a Crays development build.");
      return;
    }

    let unsubscribe: () => void = () => {};
    let subscribeTimer: ReturnType<typeof setTimeout> | null = null;
    let eoseFallback: ReturnType<typeof setTimeout> | null = null;
    let subscribed = false;

    const stop = () => {
      if (subscribeTimer) clearTimeout(subscribeTimer);
      if (eoseFallback) clearTimeout(eoseFallback);
      subscribeTimer = null;
      eoseFallback = null;
      if (subscribed) unsubscribe();
      unsubscribe = () => {};
      subscribed = false;
    };

    const handleMessage = (message: WorkerMessage) => {
      if (isEoce(message)) {
        setLoaded(true);
        return;
      }
      const event = isParsedEvent(message);
      if (!event) return;
      const kind = event.kind();

      if (kind === KIND_PROFILE) {
        // Kind 0 arrives pre-parsed by the worker (no raw content accessor).
        const parsed = asKind0(event);
        const pubkey = (event.pubkey() ?? "").toLowerCase();
        const id = event.id() ?? "";
        if (!pubkey || !id) return;
        const name = parsed?.displayName()?.toString() || parsed?.name()?.toString() || undefined;
        const profile: ProfileInput = {
          pubkey,
          createdAt: event.createdAt(),
          ...(name ? { name } : {}),
        };
        setBuffer((current) => {
          const previous = current.profiles.get(pubkey);
          if (previous && previous.createdAt > profile.createdAt) return current;
          return { ...current, profiles: new Map(current.profiles).set(pubkey, profile) };
        });
        return;
      }

      if (kind === KIND_AWARD) {
        const id = event.id() ?? "";
        const issuerPubkey = (event.pubkey() ?? "").toLowerCase();
        const definitionAddress = extractTagValue(event, "a") ?? "";
        const holderPubkey = (extractTagValue(event, "p") ?? "").toLowerCase();
        if (!id || !issuerPubkey || !definitionAddress || !holderPubkey) return;
        const expiration = Number(extractTagValue(event, "expiration"));
        const award: PeopleAwardInput = {
          id,
          issuerPubkey,
          definitionAddress,
          holderPubkey,
          createdAt: event.createdAt(),
          ...(Number.isSafeInteger(expiration) && expiration > 0 ? { expiresAt: expiration } : {}),
        };
        setBuffer((current) => ({ ...current, awards: new Map(current.awards).set(id, award) }));
        return;
      }

      if (kind === KIND_DEFINITION) {
        const d = extractTagValue(event, "d");
        const author = (event.pubkey() ?? "").toLowerCase();
        const id = event.id() ?? "";
        if (!d || !author || !id) return;
        const address = `${KIND_DEFINITION}:${author}:${d}`;
        const createdAt = event.createdAt();
        const name = extractTagValue(event, "name");
        const type = extractTagValue(event, "type");
        const description = extractTagValue(event, "description");
        const definition: PeopleDefinitionInput = {
          address,
          authorPubkey: author,
          d,
          id,
          createdAt,
          ...(name ? { name } : {}),
          ...(type ? { type } : {}),
          ...(description ? { description } : {}),
          permissions: extractTagValues(event, "permission").filter(isPermission),
        };
        setBuffer((current) => {
          // Addressable events resolve as the latest per address (§3.1).
          const previous = current.definitions.get(address);
          if (
            previous &&
            (previous.createdAt > createdAt || (previous.createdAt === createdAt && previous.id > id))
          ) {
            return current;
          }
          return { ...current, definitions: new Map(current.definitions).set(address, definition) };
        });
        return;
      }

      if (kind === KIND_DELETION) {
        const id = event.id() ?? "";
        const authorPubkey = (event.pubkey() ?? "").toLowerCase();
        const awardIds = extractTagValues(event, "e").filter((value) => /^[0-9a-f]{64}$/i.test(value));
        if (!id || !authorPubkey || awardIds.length === 0) return;
        const revocation: RevocationInput = { id, authorPubkey, awardIds, createdAt: event.createdAt() };
        setBuffer((current) => ({ ...current, revocations: new Map(current.revocations).set(id, revocation) }));
      }
    };

    const startAfterForegroundSettles = () => {
      stop();
      subscribeTimer = setTimeout(() => {
        subscribeTimer = null;
        const subId = `board_people_${relayUrl.replace(/[^a-z0-9]/gi, "_")}`;
        unsubscribe = subscribeToNostr(
          subId,
          [
            {
              kinds: [KIND_PROFILE, KIND_DELETION, KIND_AWARD, KIND_DEFINITION],
              relays: [relayUrl],
              limit: 500,
              noCache: true,
            },
          ],
          handleMessage,
          { closeOnEose: false },
        );
        subscribed = true;
        // EOSE is the authoritative loaded signal; this fallback keeps the
        // screen honest when a relay never answers.
        eoseFallback = setTimeout(() => setLoaded(true), 12_000);
      }, 350);
    };

    if (AppState.currentState === "active") startAfterForegroundSettles();
    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") startAfterForegroundSettles();
      else stop();
    });

    return () => {
      appStateSubscription.remove();
      stop();
    };
  }, [relayUrl]);

  // Elapsed-time ticker so expiry statuses stay honest without a reload.
  useEffect(() => {
    if (!relayUrl) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(timer);
  }, [relayUrl]);

  const people = useMemo(() => {
    if (!trust) return [];
    return projectPeople({
      awards: [...buffer.awards.values()],
      definitions: [...buffer.definitions.values()],
      revocations: [...buffer.revocations.values(), ...localRevocations],
      profiles: [...buffer.profiles.values()],
      authorities: trust.authorities,
      trustedIssuers: trust.trustedIssuers,
      now,
    });
  }, [trust, buffer, localRevocations, now]);

  const roles = useMemo(() => {
    if (!trust) return [];
    return projectRoles({
      definitions: [...buffer.definitions.values()],
      trustedIssuers: trust.trustedIssuers,
      ...(activePubkey ? { activePubkey } : {}),
    });
  }, [trust, buffer, activePubkey]);

  // Fixed QA contract: one projection marker per visible person.
  useEffect(() => {
    if (!__DEV__) return;
    for (const person of people) {
      console.log(
        `[crays-board-person]${JSON.stringify({
          pubkey: person.pubkey,
          status: person.status,
          ...(person.nearestExpiry !== undefined ? { expiry: person.nearestExpiry } : {}),
        })}`,
      );
    }
  }, [people]);

  if (restoring) return { status: "loading", people: [], roles: [] };
  if (error) return { status: "error", people: [], roles: [], error };
  if (!venue) return { status: "ready", people: [], roles: [] };
  if (!loaded || !trust) return { status: "loading", people: [], roles: [] };
  return { status: "ready", people, roles };
}
