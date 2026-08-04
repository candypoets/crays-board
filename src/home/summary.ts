import type { BoardOrder } from "@/orders/fold";

/**
 * Pure Home attention-summary projection per PRD §8.3 and QA_WORKFLOWS
 * HOME-01/HOME-02. Everything here is synchronous and fully unit-testable;
 * the subscription coordinator in useHomeSummary.ts only extracts plain
 * inputs from worker events, reuses the orders fold for the order stages, and
 * calls this.
 *
 * Venue binding is owned by the caller: only events learned from the active
 * venue relay reach this projection.
 */

/** NIP-52 timed calendar event (read-only on Home). */
export const KIND_CALENDAR_EVENT = 31923;
/** NIP-09 deletion/revocation referencing award ids. */
export const KIND_DELETION = 5;

export const MEMBER_EXPIRING_SOON_SECONDS = 30 * 24 * 60 * 60;

const PRODUCT_TYPES: ReadonlySet<string> = new Set(["food", "drink", "merchandise", "generic"]);

export type HomeProfileInput = {
  id: string;
  authorPubkey: string;
  /** `d` tag; the venue hospitality profile uses `nuts-community-profile`. */
  d: string;
  name?: string;
  createdAt: number;
};

export type HomeDefinitionInput = {
  /** `30009:<author>:<d>` address. */
  address: string;
  id: string;
  type?: string;
  sellable: boolean;
  /** `availability` tag: available | unavailable | archived. */
  availability?: string;
  createdAt: number;
};

export type HomeAwardInput = {
  id: string;
  issuerPubkey: string;
  definitionAddress: string;
  holderPubkey: string;
  createdAt: number;
  /** NIP-40 expiration, when present. */
  expiresAt?: number;
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
  /** Already-folded board orders (src/orders/fold projectOrders output). */
  orders: BoardOrder[];
  profiles: HomeProfileInput[];
  definitions: HomeDefinitionInput[];
  awards: HomeAwardInput[];
  calendarEvents: HomeCalendarEventInput[];
  deletions: HomeDeletionInput[];
  /** Venue authorities + advertised badge issuer (see venue/trust.ts). */
  trustedIssuers: ReadonlySet<string>;
  now: number;
};

/** Latest-addressable resolution per venue-commerce-nip §3.1. */
export function latestByAddress<T extends { address: string; id: string; createdAt: number }>(
  items: T[],
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const item of items) {
    const previous = latest.get(item.address);
    if (
      !previous ||
      item.createdAt > previous.createdAt ||
      (item.createdAt === previous.createdAt && item.id > previous.id)
    ) {
      latest.set(item.address, item);
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

function projectVenueName(profiles: HomeProfileInput[], trustedIssuers: ReadonlySet<string>): string | undefined {
  let latest: HomeProfileInput | undefined;
  for (const profile of profiles) {
    if (!trustedIssuers.has(profile.authorPubkey)) continue;
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

function projectOrdersSummary(orders: BoardOrder[]): HomeSummary["orders"] {
  const byStage: HomeOrderStages = { pending: 0, accepted: 0, processing: 0, ready: 0 };
  let oldestWaitSeconds = 0;
  for (const order of orders) {
    if (order.status === "fulfilled" || order.status === "cancelled") continue;
    byStage[order.status] += 1;
    if (order.elapsedSeconds > oldestWaitSeconds) oldestWaitSeconds = order.elapsedSeconds;
  }
  const open = byStage.pending + byStage.accepted + byStage.processing + byStage.ready;
  return { open, byStage, oldestWaitSeconds };
}

function projectNextEvent(
  calendarEvents: HomeCalendarEventInput[],
  trustedIssuers: ReadonlySet<string>,
  now: number,
): HomeNextEvent | undefined {
  const candidates = latestCalendarEvents(calendarEvents)
    .filter((event) => trustedIssuers.has(event.authorPubkey))
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

function projectMembers(
  awards: HomeAwardInput[],
  membershipAddresses: ReadonlySet<string>,
  deletions: HomeDeletionInput[],
  trustedIssuers: ReadonlySet<string>,
  now: number,
): HomeSummary["members"] {
  const revoked = new Set<string>();
  for (const deletion of deletions) {
    if (!trustedIssuers.has(deletion.authorPubkey)) continue;
    for (const reference of deletion.references) revoked.add(reference);
  }

  // One live membership line per holder: the furthest expiry wins; an award
  // without expiration never expires.
  const perHolder = new Map<string, number | null>();
  for (const award of awards) {
    if (!trustedIssuers.has(award.issuerPubkey)) continue;
    if (!membershipAddresses.has(award.definitionAddress)) continue;
    if (revoked.has(award.id)) continue;
    if (award.expiresAt !== undefined && award.expiresAt <= now) continue;
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
 * Projects the Home attention summary. Untrusted authors, revoked awards, and
 * expired awards never count. The new-venue checklist (HOME-02) replaces
 * zero-filled analytics only when no menu, event, or membership truth exists
 * at all; each checklist done flag is relay-derived.
 */
export function projectHomeSummary({
  orders,
  profiles,
  definitions,
  awards,
  calendarEvents,
  deletions,
  trustedIssuers,
  now,
}: HomeProjectionInput): HomeSummary {
  const latestDefinitions = latestByAddress(definitions);

  let unavailableMenuCount = 0;
  let menuDone = false;
  const membershipAddresses = new Set<string>();
  for (const definition of latestDefinitions.values()) {
    if (definition.type === "membership") membershipAddresses.add(definition.address);
    if (!definition.sellable || !PRODUCT_TYPES.has(definition.type ?? "")) continue;
    menuDone = true;
    if (definition.availability === "unavailable") unavailableMenuCount += 1;
  }

  const venueName = projectVenueName(profiles, trustedIssuers);
  const ordersSummary = projectOrdersSummary(orders);
  const nextEvent = projectNextEvent(calendarEvents, trustedIssuers, now);
  const members = projectMembers(awards, membershipAddresses, deletions, trustedIssuers, now);

  const checklist: HomeSetupChecklist = {
    menuDone,
    eventsDone: latestCalendarEvents(calendarEvents).some((event) => trustedIssuers.has(event.authorPubkey)),
    membersDone: members.active > 0 || membershipAddresses.size > 0,
  };
  const isNewVenue = !checklist.menuDone && !checklist.eventsDone && !checklist.membersDone;

  return {
    ...(venueName ? { venueName } : {}),
    orders: ordersSummary,
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
