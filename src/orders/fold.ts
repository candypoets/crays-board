import { orderContextKey } from "@/access/nip97";
import {
  awardIssuerValid,
  definitionAuthorTrusted,
  revocationSignerValid,
  statusSignerValid,
  type CommunityTrust,
} from "@/access/trust";
import type { PublishedOrderStatus } from "@/nostr/protocol";

/**
 * Pure order projection fold for NIP-97 (spec of record: ~/nips/97.md,
 * Awards and Fulfillment sections). Everything here is synchronous and fully
 * unit-testable; the subscription coordinator in useOrders.ts only extracts
 * plain inputs from worker events and calls this.
 */

export type OrderStatus = "pending" | PublishedOrderStatus;

/** Fulfillment context families; only `order` contexts produce Board orders. */
export type StatusContextType = "order" | "event";

export type AwardInput = {
  /** Award event id. */
  id: string;
  issuerPubkey: string;
  /** `a` tag: `30402:<definition-author>:<d>`. */
  definitionAddress: string;
  /** `p` tag: the holder the award was granted to. */
  holderPubkey: string;
  createdAt: number;
  /** NIP-40 expiration, when present. */
  expiresAt?: number;
  /** Purchase reference: the `order` tag, `i` minus its payment prefix, or the award id. */
  orderRef: string;
};

export type DefinitionInput = {
  /** `30402:<author>:<d>` address. */
  address: string;
  id: string;
  createdAt: number;
  /** `title` tag. */
  name?: string;
  /** Carries a well-formed `price` tag. */
  sellable: boolean;
  /** Uses per award (30402 listings default to one). */
  maxUses?: number;
  /** Linked to a calendar event — a ticket, fulfilled via check-in, not orders. */
  eventLinked: boolean;
};

export type StatusInput = {
  id: string;
  authorPubkey: string;
  /** Full fulfillment context key (the `d` tag), e.g. `order:CR-1`. */
  contextKey: string;
  contextType: StatusContextType;
  status: PublishedOrderStatus;
  /** `e` tag: the award this status acts on. */
  awardId: string;
  /** `a` tag: must match the award's definition address. */
  definitionAddress: string;
  /** `p` tag: must match the award holder. */
  holderPubkey: string;
  createdAt: number;
};

export type RevocationInput = {
  authorPubkey: string;
  references: readonly string[];
};

export type BoardOrder = {
  awardId: string;
  definitionAddress: string;
  holderPubkey: string;
  /** Purchase reference shared by every status of this order. */
  orderRef: string;
  /** `order:<orderRef>` — the fulfillment context statuses group by. */
  contextKey: string;
  itemName?: string;
  status: OrderStatus;
  /**
   * True only when the current UI session knows cancellation was published
   * from pending. NIP-97 retains current status, not transition history, so a
   * relay-only projection cannot distinguish decline from later cancellation.
   */
  declined: boolean;
  /** Award creation time (order placement). */
  createdAt: number;
  /** Last accepted status time, or the award time while pending. */
  updatedAt: number;
  /** created_at of the context's current status — the monotonic floor for writes. */
  latestStatusCreatedAt?: number;
  elapsedSeconds: number;
};

const STAGE: Record<OrderStatus, number> = {
  pending: 0,
  accepted: 1,
  processing: 2,
  ready: 3,
  fulfilled: 4,
  cancelled: 5,
};

const PUBLISHED: ReadonlySet<string> = new Set(["accepted", "processing", "ready", "fulfilled", "cancelled"]);

function isTerminal(status: OrderStatus): boolean {
  return status === "fulfilled" || status === "cancelled";
}

/**
 * The fulfillment ladder: normal actions advance exactly one stage forward;
 * cancelled is reachable from any non-terminal stage; event contexts may go
 * directly to fulfilled (check-in). Backward moves, stage skips, and actions
 * on a terminal order are invalid and ignored in the fold.
 */
export function isValidTransition(from: OrderStatus, to: PublishedOrderStatus, context: StatusContextType): boolean {
  if (isTerminal(from)) return false;
  if (to === "cancelled") return true;
  if (to === "fulfilled" && context === "event") return true;
  return STAGE[to] === STAGE[from] + 1;
}

export type OrderAction = {
  /** Status the action publishes when tapped. */
  to: PublishedOrderStatus;
  label: string;
  /** Confirmation is required only once an order is accepted. */
  confirm: boolean;
};

/**
 * Exactly one valid next action per non-terminal order — Accept, Start
 * preparing, Mark ready, Serve. Terminal orders offer nothing.
 */
export function nextOrderAction(status: OrderStatus): OrderAction | null {
  switch (status) {
    case "pending":
      return { to: "accepted", label: "Accept", confirm: false };
    case "accepted":
      return { to: "processing", label: "Start preparing", confirm: false };
    case "processing":
      return { to: "ready", label: "Mark ready", confirm: false };
    case "ready":
      return { to: "fulfilled", label: "Serve", confirm: false };
    default:
      return null;
  }
}

/**
 * Decline is cancelled published from the implicit pending stage (no
 * confirmation); cancel applies to accepted/processing orders and requires
 * confirmation. Ready and terminal orders offer no cancellation.
 */
export function cancellationAction(status: OrderStatus): OrderAction | null {
  if (status === "pending") return { to: "cancelled", label: "Decline", confirm: false };
  if (status === "accepted" || status === "processing") {
    return { to: "cancelled", label: "Cancel order", confirm: true };
  }
  return null;
}

/**
 * Ladder position for comparing a confirmed staff intent against the folded
 * stage: while the subscription projection still lags a relay-acknowledged
 * action, the card presents the confirmed stage rather than regressing.
 */
export function orderStageIndex(status: OrderStatus): number {
  return STAGE[status];
}

/**
 * NIP-97 resolution: latest by created_at, then lowest event id. Because
 * addressable replacement slots are per-author, conflicting staff signers can
 * hold different states for one context — this rule resolves them.
 */
function isNewer(candidate: StatusInput, current: { createdAt: number; id: string }): boolean {
  return (
    candidate.createdAt > current.createdAt ||
    (candidate.createdAt === current.createdAt && candidate.id < current.id)
  );
}

/** Orders are sellable single-use products: priced 30402 listings, not tickets or passes. */
function isSellableSingleUseProduct(definition: DefinitionInput): boolean {
  return definition.sellable && !definition.eventLinked && definition.maxUses === 1;
}

function definitionAuthor(address: string): string {
  return address.split(":")[1] ?? "";
}

/** Addressable definitions resolve as the latest per address (created_at, then higher id). */
function latestDefinitions(definitions: DefinitionInput[]): Map<string, DefinitionInput> {
  const latest = new Map<string, DefinitionInput>();
  for (const definition of definitions) {
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

export type ProjectionInput = {
  awards: AwardInput[];
  definitions: DefinitionInput[];
  statuses: StatusInput[];
  revocations: RevocationInput[];
  /** NIP-97 trust view resolved from the venue relay's root-signed anchor. */
  trust: CommunityTrust;
  now: number;
};

/**
 * Projects the Board's order list. An award becomes an order iff its
 * definition is a sellable single-use product and its issuer satisfies the
 * NIP-97 issuance rules against the anchor (admins anything, the delegated
 * badge issuer sellable definitions only). A valid award with no status event
 * is implicitly `pending`. Expired awards and awards whose definition exists
 * but is not a sellable single-use product never create orders; a temporarily
 * missing definition leaves the order diagnosable (itemName undefined)
 * without mutating its identity, though a badge-issuer award cannot be
 * verified sellable without its definition and is dropped.
 *
 * Statuses group by the order's fulfillment context (`order:<orderRef>`) and
 * must reference the award via `e`; the current status resolves by
 * created_at, then lowest event id. Only order-type contexts produce orders —
 * event contexts belong to check-in.
 *
 * Venue binding is owned by the caller: only events learned from the active
 * venue relay reach this fold, so awards for other venues never arrive here.
 */
export function projectOrders({ awards, definitions, statuses, revocations, trust, now }: ProjectionInput): BoardOrder[] {
  const definitionByAddress = latestDefinitions(
    definitions.filter((definition) => definitionAuthorTrusted(definitionAuthor(definition.address), trust)),
  );

  const statusesByContext = new Map<string, StatusInput[]>();
  for (const status of statuses) {
    if (status.contextType !== "order") continue;
    if (!statusSignerValid(status.authorPubkey, trust)) continue;
    if (!PUBLISHED.has(status.status)) continue;
    if (!status.contextKey || !status.awardId) continue;
    const list = statusesByContext.get(status.contextKey) ?? [];
    list.push(status);
    statusesByContext.set(status.contextKey, list);
  }

  const orders: BoardOrder[] = [];
  for (const award of awards) {
    if (award.expiresAt !== undefined && award.expiresAt <= now) continue;
    // A missing 30402 listing can remain diagnosable, but awards of role,
    // membership, or calendar definitions are never store orders. The
    // definition-kind prefix is authoritative even while the event itself is
    // temporarily unavailable.
    if (Number(award.definitionAddress.split(":")[0]) !== 30402) continue;
    if (!definitionAuthorTrusted(definitionAuthor(award.definitionAddress), trust)) continue;
    if (
      revocations.some(
        (revocation) =>
          revocation.references.includes(award.id) &&
          revocationSignerValid(revocation.authorPubkey, award.issuerPubkey, trust),
      )
    ) {
      continue;
    }

    const definition = definitionByAddress.get(award.definitionAddress);
    if (definition && !isSellableSingleUseProduct(definition)) continue;
    if (!awardIssuerValid({ issuer: award.issuerPubkey, sellable: definition?.sellable ?? false, trust })) {
      continue;
    }

    const contextKey = orderContextKey(award.orderRef);
    const log = (statusesByContext.get(contextKey) ?? []).filter(
      (status) =>
        status.awardId === award.id &&
        status.definitionAddress === award.definitionAddress &&
        status.holderPubkey === award.holderPubkey &&
        status.createdAt >= award.createdAt,
    );

    // The context's current status per NIP-97 resolution; its created_at is
    // the monotonic floor for the next write to this context.
    let latest: StatusInput | undefined;
    for (const candidate of log) {
      if (!latest || isNewer(candidate, latest)) latest = candidate;
    }

    // 37237 is addressable by fulfillment context. Relays retain only the
    // current event in each author's replacement slot, so consumers MUST NOT
    // require earlier ladder stages to reconstruct the current stage. The UI
    // validates transitions before publishing; the read projection resolves
    // the latest trusted current status exactly as NIP-97 specifies.
    const currentStatus: OrderStatus = latest?.status ?? "pending";

    orders.push({
      awardId: award.id,
      definitionAddress: award.definitionAddress,
      holderPubkey: award.holderPubkey,
      orderRef: award.orderRef,
      contextKey,
      ...(definition?.name ? { itemName: definition.name } : {}),
      status: currentStatus,
      // The retained status does not encode its predecessor. The screen's
      // confirmed mutation state supplies decline wording during the session.
      declined: false,
      createdAt: award.createdAt,
      updatedAt: latest?.createdAt ?? award.createdAt,
      ...(latest ? { latestStatusCreatedAt: latest.createdAt } : {}),
      elapsedSeconds: Math.max(0, now - award.createdAt),
    });
  }

  // Active orders oldest-first (kitchen order); terminal orders most recent last update first.
  return orders.sort((a, b) => {
    const aTerminal = isTerminal(a.status);
    const bTerminal = isTerminal(b.status);
    if (aTerminal !== bTerminal) return aTerminal ? 1 : -1;
    return aTerminal ? b.updatedAt - a.updatedAt : a.createdAt - b.createdAt;
  });
}
