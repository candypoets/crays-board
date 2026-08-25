import type { EventTemplate } from "nostr-tools";

import { publishEvent, type PublishResult } from "@/nostr/publish";
import type { VenueSelection } from "@/venue/VenueContext";

import {
  clearAttempt,
  loadAttempt,
  saveAttempt,
  type CreateVenueAttempt,
} from "./attempts";
import {
  createVenueRelay,
  deviceReachableUrl,
  requireActivePubkey,
  waitVenueRelayRunning,
} from "./coordinator";
import {
  buildRelayRequest,
  buildVenueProfileTemplate,
  deriveSlug,
  makeAttemptId,
  makeDomainLabel,
  type VenueDraft,
} from "./model";

/**
 * Create-venue provisioning sequence (PRD §8.2, happy path). One deliberate
 * submission drives the ordered stages below; each stage boundary updates the
 * persisted attempt record so a later resume reconciles the SAME attempt
 * instead of requesting another relay (CREATE-08/09 structure).
 *
 * Out of scope for this slice (tracked in docs/screens/create-venue.md):
 * kind 0 owner profile resolution, 10002/10012/30002 directory merges, image
 * upload, and room-manifest publication. The success surface reports those as
 * not-yet-configured instead of claiming them.
 */

export type ProvisionStageId = "account" | "reserve" | "readiness" | "profile" | "finish";

export type ProvisionStage = {
  id: ProvisionStageId;
  /** Friendly, truthful copy per PRD §8.2 progress UI. */
  label: string;
  status: "waiting" | "running" | "done" | "failed";
};

export const initialStages = (): ProvisionStage[] => [
  { id: "account", label: "Setting up your account", status: "waiting" },
  { id: "reserve", label: "Reserving your venue", status: "waiting" },
  { id: "readiness", label: "Adding it to your venues", status: "waiting" },
  { id: "profile", label: "Publishing the venue profile", status: "waiting" },
  { id: "finish", label: "Finishing setup", status: "waiting" },
];

export type ProvisionResult = {
  venue: VenueSelection;
  slug: string;
  attemptId: string;
  relayId: string;
};

type VenueProfilePublisher = (
  template: EventTemplate,
  relays: string[],
  operation: string,
  timeoutMs?: number,
) => Promise<PublishResult>;

/**
 * A newly-created relay can accept WebSockets just before its NIP-97 policy
 * cache is ready to authorize the owner profile. Retry only this provisioning
 * boundary, with a hard deadline; ordinary mutations still fail immediately
 * when a relay rejects them.
 */
export async function publishVenueProfileWithRetry(
  template: EventTemplate,
  relayUrl: string,
  {
    publish = publishEvent,
    timeoutMs = 25_000,
    intervalMs = 750,
    now = Date.now,
    delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: {
    publish?: VenueProfilePublisher;
    timeoutMs?: number;
    intervalMs?: number;
    now?: () => number;
    delay?: (ms: number) => Promise<void>;
  } = {},
): Promise<PublishResult> {
  const deadline = now() + timeoutMs;
  while (true) {
    try {
      const remaining = Math.max(1_000, deadline - now());
      return await publish(template, [relayUrl], "create_venue_profile", Math.min(5_000, remaining));
    } catch (error) {
      const remaining = deadline - now();
      if (remaining <= 0) throw error;
      await delay(Math.min(intervalMs, remaining));
    }
  }
}

export async function provisionVenue(
  draft: VenueDraft,
  onProgress: (stages: ProvisionStage[]) => void,
  setVenue: (venue: VenueSelection) => void,
): Promise<ProvisionResult> {
  const stages = initialStages();
  const mark = (id: ProvisionStageId, status: ProvisionStage["status"]) => {
    const stage = stages.find((entry) => entry.id === id);
    if (stage) stage.status = status;
    onProgress([...stages]);
  };

  const runStage = async <T>(id: ProvisionStageId, work: () => Promise<T>): Promise<T> => {
    mark(id, "running");
    try {
      const value = await work();
      mark(id, "done");
      return value;
    } catch (error) {
      mark(id, "failed");
      throw error;
    }
  };

  // 1. Validate the form and confirm an active signing identity.
  const ownerPubkey = await runStage("account", () => requireActivePubkey());

  // 2. Reserve the venue. The attempt (stable id + unique domain label) is
  // persisted BEFORE the POST; an unfinished attempt with a relay record is
  // reused instead of creating a second relay.
  const attempt = await runStage("reserve", async () => {
    const existing = await loadAttempt();
    if (existing && existing.phase !== "completed" && existing.relayId) {
      return existing;
    }
    const fresh: CreateVenueAttempt = {
      attemptId: makeAttemptId(),
      domainLabel: makeDomainLabel(deriveSlug(draft.name)),
      draft,
      phase: "requested",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveAttempt(fresh);
    const created = await createVenueRelay(buildRelayRequest(draft, fresh.domainLabel, ownerPubkey));
    const allocated: CreateVenueAttempt = {
      ...fresh,
      phase: "allocated",
      relayId: created.id,
      ...(created.relay_url ? { relayUrl: created.relay_url } : {}),
      ...(created.base_url ? { serviceUrl: created.base_url } : {}),
    };
    await saveAttempt(allocated);
    return allocated;
  });
  if (!attempt.relayId) throw new Error("No relay record exists for this creation attempt.");

  // 3. Wait until the coordinator reports the new relay running. URLs are
  // persisted in the device-reachable form (emulator alias in dev) so a later
  // resume connects the same way.
  const ready = await runStage("readiness", async () => {
    const relay = await waitVenueRelayRunning(attempt.relayId as string);
    await saveAttempt({
      ...attempt,
      phase: "running",
      relayUrl: relay.relay_url ? deviceReachableUrl(relay.relay_url) : relay.relay_url,
      serviceUrl: relay.base_url ? deviceReachableUrl(relay.base_url) : relay.base_url,
    });
    return relay;
  });
  // The coordinator reports host-loopback URLs in dev; map them to the form
  // this device can actually reach (Android emulator host alias).
  const relayUrl = deviceReachableUrl(ready.relay_url as string);
  const serviceUrl = deviceReachableUrl(ready.base_url as string);

  // 4. Publish the venue hospitality profile to the NEW relay; the write is
  // confirmed only by an affirmative relay acknowledgement (publishEvent).
  // QA proves the exact profile independently from relay truth.
  await runStage("profile", async () => {
    await publishVenueProfileWithRetry(buildVenueProfileTemplate(attempt.draft), relayUrl);
    await saveAttempt({ ...attempt, phase: "profile_published", relayUrl, serviceUrl });
  });

  // 5. Select the new venue and finish; the completed attempt is discarded so
  // "Create another venue" later starts fresh.
  const venue: VenueSelection = { relayUrl, serviceUrl, pubkey: ownerPubkey };
  await runStage("finish", async () => {
    setVenue(venue);
    await clearAttempt();
  });

  return {
    venue,
    slug: deriveSlug(attempt.draft.name),
    attemptId: attempt.attemptId,
    relayId: attempt.relayId,
  };
}
