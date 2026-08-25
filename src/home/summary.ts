import type { EntitlementType, Permission } from "@/access/nip97";
import {
  awardIssuerValid,
  definitionAuthorTrusted,
  revocationSignerValid,
  statusSignerValid,
  trustWithFulfillmentRoles,
  type CommunityTrust,
} from "@/access/trust";
import type { PublishedOrderStatus } from "@/nostr/protocol";

/**
 * Pure Home attention-summary projection per PRD §8.3 and QA_WORKFLOWS
 * HOME-01/HOME-02, on NIP-97 shapes (spec of record: ~/nips/97.md).
 * Everything here is synchronous and fully unit-testable; the subscription
 * coordinator in useHomeSummary.ts only extracts plain inputs from worker
 * events and calls this.
 *
 * Venue binding is owned by the caller: only events learned from the active
 * venue relay reach this projection.
 */

/** NIP-52 timed calendar event (read-only on Home). */
export const KIND_CALENDAR_EVENT = 31923;

export const MEMBER_EXPIRING_SOON_SECONDS = 30 * 24 * 60 * 60;

export type HomeProfileInput = {
  id: string;
  authorPubkey: string;
  /** `d` tag; the venue hospitality profile uses `nuts-community-profile`. */
  d: string;
  name?: string;
  createdAt: number;
};

export type HomeDefinitionInput = {
  /** `<kind>:<author>:<d>` address (30009 memberships, 30402 products/passes/tickets). */
  address: string;
  id: string;
  authorPubkey: string;
  /** `title` for 30402 listings, `name` for 30009 badge definitions. */
  name?: string;
  /** NIP-97 classification derived from the definition shape (never a `type` tag). */
  type?: EntitlementType;
  /** True when the definition carries a well-formed `price` tag. */
  sellable: boolean;
  /** Parsed NIP-97 grants when this is a role definition. */
  permissions?: Permission[];
  /** `availability` tag: available (default) | unavailable | archived. */
  availability?: string;
  createdAt: number;
};

export type HomeAwardInput = {
  id: string;
  issuerPubkey: string;
  /** `a` tag: the definition address this award references. */
  definitionAddress: string;
  /** `p` tag: the holder the award was granted to. */
  holderPubkey: string;
  /** `order:<order-ref>` fulfillment context (deriveOrderRef + orderContextKey). */
  orderContextKey: string;
  createdAt: number;
  /** NIP-40 expiration, when present. */
  expiresAt?: number;
};

export type HomeStatusInput = {
  id: string;
  /** Event author; NIP-97 also admits resolved 37237/write role holders. */
  signerPubkey: string;
  /** Exact award/definition/holder binding from e/a/p. */
  awardId: string;
  definitionAddress: string;
  holderPubkey: string;
  /** Validated `d` context key: `order:<ref>` or `event:<coordinate>`. */
  contextKey: string;
  contextType: "order" | "event";
  status: PublishedOrderStatus;
  createdAt: number;
};

export type HomeCalendarEventInput = {
  id: string;
  authorPubkey: string;
  /** `d` tag of the addressable event. */
  d: string;
  title?: string;
  /** `start` tag, unix seconds. */
  startsAt: number;
  /** `end` tag, unix seconds, when present. */
  endsAt?: number;
  createdAt: number;
};

export type HomeDeletionInput = {
  id: string;
  authorPubkey: string;
  /** Award event ids referenced through `e` tags. */
  references: string[];
  createdAt: number;
};

export type HomeOrderStages = {
  pending: number;
  accepted: number;
  processing: number;
  ready: number;
};

export type HomeNextEvent = {
  id: string;
  title?: string;
  startsAt: number;
  endsAt?: number;
  /** True when the event started already and has not ended. */
  happeningNow: boolean;
};

/** New-venue setup checklist (HOME-02): done flags from relay truth. */
export type HomeSetupChecklist = {
  menuDone: boolean;
  eventsDone: boolean;
  membersDone: boolean;
};

export type HomeSummary = {
  /** Venue display name from the latest trusted hospitality profile. */
  venueName?: string;
  orders: {
    /** Open = not fulfilled and not cancelled. */
    open: number;
    byStage: HomeOrderStages;
    /** Age of the oldest open order in seconds; 0 when nothing is open. */
    oldestWaitSeconds: number;
  };
  /** Sellable product definitions currently marked unavailable. */
  unavailableMenuCount: number;
  nextEvent?: HomeNextEvent;
  members: {
    /** Distinct holders of a live trusted membership award. */
    active: number;
    /** Active members whose nearest expiry lands within 30 days. */
    expiringSoon: number;
  };
  checklist: HomeSetupChecklist;
  /** True when no menu, event, or membership truth exists yet (HOME-02). */
  isNewVenue: boolean;
};

export type HomeProjectionInput = {
  profiles: HomeProfileInput[];
  definitions: HomeDefinitionInput[];
  awards: HomeAwardInput[];
  statuses: HomeStatusInput[];
  calendarEvents: HomeCalendarEventInput[];
  deletions: HomeDeletionInput[];
  /** NIP-97 trust resolved from the root-signed community anchor. */
  trust: CommunityTrust;
  now: number;
};

/**
 * Latest addressable definition per address, restricted to trusted
 * definition authors (anchor admins plus the community root key — the
 * node's `30009:<root>:members` invite definition must resolve).
 */
function trustedLatestDefinitions(
  definitions: HomeDefinitionInput[],
  trust: CommunityTrust,
): Map<string, HomeDefinitionInput> {
  const latest = new Map<string, HomeDefinitionInput>();
  for (const definition of definitions) {
    if (!definitionAuthorTrusted(definition.authorPubkey, trust)) continue;
    const previous = latest.get(definition.address);
    if (
      !previous ||
      definition.createdAt > previous.createdAt ||
      (definition.createdAt === previous.createdAt && definition.id > previous.id)
    ) {
      latest.set(definition.address, definition);
    }
  }
  return latest;
}

function latestCalendarEvents(events: HomeCalendarEventInput[]): HomeCalendarEventInput[] {
  const byD = new Map<string, HomeCalendarEventInput>();
  for (const event of events) {
    const previous = byD.get(event.d);
    if (
      !previous ||
      event.createdAt > previous.createdAt ||
      (event.createdAt === previous.createdAt && event.id > previous.id)
    ) {
      byD.set(event.d, event);
    }
  }
  return [...byD.values()];
}

function projectVenueName(profiles: HomeProfileInput[], trust: CommunityTrust): string | undefined {
  let latest: HomeProfileInput | undefined;
  for (const profile of profiles) {
    if (!definitionAuthorTrusted(profile.authorPubkey, trust)) continue;
    if (profile.d !== "nuts-community-profile") continue;
    if (
      !latest ||
      profile.createdAt > latest.createdAt ||
      (profile.createdAt === latest.createdAt && profile.id > latest.id)
    ) {
      latest = profile;
    }
  }
  return latest?.name;
}

/**
 * Order figures from NIP-97 shapes: one order per `order:<ref>` fulfillment
 * context, opened by a valid purchase award (admins may award anything, the
 * badge issuer only sellable definitions) for a sellable single-use product.
 * The stage is the latest exactly-bound order-context status (NIP-97 resolution:
 * latest created_at, lowest event id breaks ties) from a valid signer, or
 * the implicit `pending` when no status exists. Event contexts are the
 * check-in slice's truth and never count here.
 */
function projectOrdersSummary({
  awards,
  statuses,
  definitions,
  deletions,
  trust,
  now,
}: {
  awards: HomeAwardInput[];
  statuses: HomeStatusInput[];
  definitions: ReadonlyMap<string, HomeDefinitionInput>;
  deletions: HomeDeletionInput[];
  trust: CommunityTrust;
  now: number;
}): HomeSummary["orders"] {
  // Awards sharing an order ref are one order; its placement time is the
  // earliest award in the group.
  const ordersByContext = new Map<string, { createdAt: number; awards: HomeAwardInput[] }>();
  for (const award of awards) {
    const definition = definitions.get(award.definitionAddress);
    if (!definition) continue;
    if (definition.type !== "product" || !definition.sellable) continue;
    if (!awardIssuerValid({ issuer: award.issuerPubkey, sellable: definition.sellable, trust })) continue;
    if (award.expiresAt !== undefined && award.expiresAt <= now) continue;
    const revoked = deletions.some(
      (deletion) =>
        deletion.references.includes(award.id) &&
        revocationSignerValid(deletion.authorPubkey, award.issuerPubkey, trust),
    );
    if (revoked) continue;
    const previous = ordersByContext.get(award.orderContextKey);
    if (previous) {
      previous.awards.push(award);
      if (award.createdAt < previous.createdAt) previous.createdAt = award.createdAt;
    } else {
      ordersByContext.set(award.orderContextKey, { createdAt: award.createdAt, awards: [award] });
    }
  }

  const byStage: HomeOrderStages = { pending: 0, accepted: 0, processing: 0, ready: 0 };
  let oldestWaitSeconds = 0;
  for (const [contextKey, order] of ordersByContext) {
    let latest: HomeStatusInput | undefined;
    for (const status of statuses) {
      if (status.contextType !== "order" || status.contextKey !== contextKey) continue;
      if (!statusSignerValid(status.signerPubkey, trust)) continue;
      const boundAward = order.awards.find(
        (award) =>
          status.awardId === award.id &&
          status.definitionAddress === award.definitionAddress &&
          status.holderPubkey === award.holderPubkey &&
          status.createdAt >= award.createdAt,
      );
      if (!boundAward) continue;
      if (
        !latest ||
        status.createdAt > latest.createdAt ||
        (status.createdAt === latest.createdAt && status.id < latest.id)
      ) {
        latest = status;
      }
    }
    const stage = latest?.status ?? "pending";
    if (stage === "fulfilled" || stage === "cancelled") continue;
    byStage[stage] += 1;
    const wait = Math.max(0, now - order.createdAt);
    if (wait > oldestWaitSeconds) oldestWaitSeconds = wait;
  }
  const open = byStage.pending + byStage.accepted + byStage.processing + byStage.ready;
  return { open, byStage, oldestWaitSeconds };
}

function projectNextEvent(
  calendarEvents: HomeCalendarEventInput[],
  trust: CommunityTrust,
  now: number,
): HomeNextEvent | undefined {
  const candidates = latestCalendarEvents(calendarEvents)
    .filter((event) => definitionAuthorTrusted(event.authorPubkey, trust))
    .filter((event) => {
      const happeningNow = event.startsAt <= now && event.endsAt !== undefined && event.endsAt > now;
      return event.startsAt > now || happeningNow;
    })
    .sort((a, b) => a.startsAt - b.startsAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const next = candidates[0];
  if (!next) return undefined;
  return {
    id: next.id,
    ...(next.title ? { title: next.title } : {}),
    startsAt: next.startsAt,
    ...(next.endsAt !== undefined ? { endsAt: next.endsAt } : {}),
    happeningNow: next.startsAt <= now,
  };
}

/**
 * One live membership line per holder: awards of trusted `t=membership`
 * definitions, issued under the NIP-97 rule (admins anything, the badge
 * issuer sellable definitions only), not expired, and not revoked by the
 * award's own issuer or an anchor admin. The furthest expiry wins; an award
 * without expiration never expires.
 */
function projectMembers({
  awards,
  definitions,
  deletions,
  trust,
  now,
}: {
  awards: HomeAwardInput[];
  definitions: ReadonlyMap<string, HomeDefinitionInput>;
  deletions: HomeDeletionInput[];
  trust: CommunityTrust;
  now: number;
}): HomeSummary["members"] {
  const perHolder = new Map<string, number | null>();
  for (const award of awards) {
    const definition = definitions.get(award.definitionAddress);
    if (!definition || definition.type !== "membership") continue;
    if (!awardIssuerValid({ issuer: award.issuerPubkey, sellable: definition.sellable, trust })) continue;
    if (award.expiresAt !== undefined && award.expiresAt <= now) continue;
    const revoked = deletions.some(
      (deletion) =>
        deletion.references.includes(award.id) &&
        revocationSignerValid(deletion.authorPubkey, award.issuerPubkey, trust),
    );
    if (revoked) continue;
    const expiry = award.expiresAt ?? null;
    const previous = perHolder.get(award.holderPubkey);
    if (previous === undefined || previous === null || expiry === null || expiry > previous) {
      perHolder.set(award.holderPubkey, expiry);
    }
  }

  let expiringSoon = 0;
  for (const expiry of perHolder.values()) {
    if (expiry !== null && expiry <= now + MEMBER_EXPIRING_SOON_SECONDS) expiringSoon += 1;
  }
  return { active: perHolder.size, expiringSoon };
}

/**
 * Projects the Home attention summary. Untrusted authors, revoked awards,
 * and expired awards never count. The new-venue checklist (HOME-02)
 * replaces zero-filled analytics only when no menu, event, or membership
 * truth exists at all; each checklist done flag is relay-derived.
 */
export function projectHomeSummary({
  profiles,
  definitions: allDefinitions,
  awards,
  statuses,
  calendarEvents,
  deletions,
  trust,
  now,
}: HomeProjectionInput): HomeSummary {
  const definitions = trustedLatestDefinitions(allDefinitions, trust);
  const fulfillmentTrust = trustWithFulfillmentRoles(trust, {
    definitions: [...definitions.values()]
      .filter((definition) => definition.type === "role")
      .map((definition) => ({
        address: definition.address,
        id: definition.id,
        authorPubkey: definition.authorPubkey,
        permissions: definition.permissions ?? [],
        sellable: definition.sellable,
        createdAt: definition.createdAt,
      })),
    awards,
    revocations: deletions,
    now,
  });

  let unavailableMenuCount = 0;
  let menuDone = false;
  let membershipDefined = false;
  for (const definition of definitions.values()) {
    if (definition.type === "membership") membershipDefined = true;
    // The menu card counts priced 30402 product listings only; passes,
    // tickets, and unpriced listings are not menu items.
    if (definition.type !== "product" || !definition.sellable) continue;
    menuDone = true;
    if (definition.availability === "unavailable") unavailableMenuCount += 1;
  }

  const venueName = projectVenueName(profiles, trust);
  const orders = projectOrdersSummary({
    awards,
    statuses,
    definitions,
    deletions,
    trust: fulfillmentTrust,
    now,
  });
  const nextEvent = projectNextEvent(calendarEvents, trust, now);
  const members = projectMembers({ awards, definitions, deletions, trust, now });

  const checklist: HomeSetupChecklist = {
    menuDone,
    eventsDone: latestCalendarEvents(calendarEvents).some((event) =>
      definitionAuthorTrusted(event.authorPubkey, trust),
    ),
    membersDone: members.active > 0 || membershipDefined,
  };
  const isNewVenue = !checklist.menuDone && !checklist.eventsDone && !checklist.membersDone;

  return {
    ...(venueName ? { venueName } : {}),
    orders,
    unavailableMenuCount,
    ...(nextEvent ? { nextEvent } : {}),
    members,
    checklist,
    isNewVenue,
  };
}

/** Fixed QA contract payload for the `[crays-board-home]` logcat marker. */
export function homeMarkerPayload(summary: HomeSummary, relayUrl: string, live: boolean) {
  return {
    venue: relayUrl,
    ...(summary.venueName ? { venueName: summary.venueName } : {}),
    live,
    orders: {
      open: summary.orders.open,
      pending: summary.orders.byStage.pending,
      accepted: summary.orders.byStage.accepted,
      processing: summary.orders.byStage.processing,
      ready: summary.orders.byStage.ready,
    },
    oldestWaitSeconds: summary.orders.oldestWaitSeconds,
    unavailableMenu: summary.unavailableMenuCount,
    nextEvent: summary.nextEvent
      ? { id: summary.nextEvent.id, startsAt: summary.nextEvent.startsAt }
      : null,
    members: { active: summary.members.active, expiringSoon: summary.members.expiringSoon },
    checklist: summary.isNewVenue,
  };
}
