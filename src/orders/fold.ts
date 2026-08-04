import type { OrderContext, PublishedOrderStatus } from "@/nostr/protocol";

/**
 * Pure order projection fold per venue-commerce-nip §4–§6. Everything here is
 * synchronous and fully unit-testable; the subscription coordinator in
 * useOrders.ts only extracts plain inputs from worker events and calls this.
 */

export type OrderStatus = "pending" | PublishedOrderStatus;

export type AwardInput = {
  /** Award event id = the order context. */
  id: string;
  issuerPubkey: string;
  /** `a` tag: `30009:<definition-author>:<d>`. */
  definitionAddress: string;
  /** `p` tag: the holder the award was granted to. */
  holderPubkey: string;
  createdAt: number;
  /** NIP-40 expiration, when present. */
  expiresAt?: number;
};

export type DefinitionInput = {
  /** `30009:<author>:<d>` address. */
  address: string;
  id: string;
  name?: string;
  type?: string;
  sellable: boolean;
  maxUses?: number;
  createdAt: number;
};

export type StatusInput = {
  id: string;
  authorPubkey: string;
  /** Order context the status acts on (`d` tag, falling back to `e`). */
  contextKey: string;
  status: PublishedOrderStatus;
  context: OrderContext;
  createdAt: number;
};

export type BoardOrder = {
  awardId: string;
  definitionAddress: string;
  holderPubkey: string;
  itemName?: string;
  status: OrderStatus;
  /** Cancelled directly from the implicit pending stage = decline (§6.4). */
  declined: boolean;
  /** Award creation time (order placement). */
  createdAt: number;
  /** Last accepted status time, or the award time while pending. */
  updatedAt: number;
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

const PUBLISHED: ReadonlySet<string> = new Set(["accepted", "processing", "ready", "fulfilled", "cancelled"]);const SINGLE_USE_TYPES: ReadonlySet<string> = new Set([
  "food",
  "drink",
  "merchandise",
  "generic",
  "event_access",
]);

function isTerminal(status: OrderStatus): boolean {
  return status === "fulfilled" || status === "cancelled";
}

/**
 * §6.2: normal actions advance exactly one stage forward; cancelled is
 * reachable from any non-terminal stage; event contexts may go directly to
 * fulfilled (check-in, §8). Backward moves, stage skips, and actions on a
 * terminal order are invalid and ignored in the fold.
 */
export function isValidTransition(from: OrderStatus, to: PublishedOrderStatus, context: OrderContext): boolean {
  if (isTerminal(from)) return false;
  if (to === "cancelled") return true;
  if (to === "fulfilled" && context === "event") return true;
  return STAGE[to] === STAGE[from] + 1;
}

export type OrderAction = {
  /** Status the action publishes when tapped. */
  to: PublishedOrderStatus;
  label: string;
  /** §6.4: confirmation is required only once an order is accepted. */
  confirm: boolean;
};

/**
 * §6.2: exactly one valid next action per non-terminal order — Accept,
 * Start preparing, Mark ready, Serve. Terminal orders offer nothing.
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
 * §6.4: decline is cancelled published from the implicit pending stage (no
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

type FoldedStatus = { status: OrderStatus; createdAt: number; id: string; from: OrderStatus };

/** §6.6: latest by created_at; ties break by higher event id. */
function isNewer(candidate: StatusInput, current: FoldedStatus): boolean {
  return (
    candidate.createdAt > current.createdAt ||
    (candidate.createdAt === current.createdAt && candidate.id > current.id)
  );
}

function isSingleUseSellable(definition: DefinitionInput): boolean {
  if (!definition.sellable) return false;
  if (definition.maxUses !== undefined) return definition.maxUses === 1;
  return SINGLE_USE_TYPES.has(definition.type ?? "");
}

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
  /** Venue authorities + advertised badge issuer (see venue/trust.ts). */
  trustedIssuers: ReadonlySet<string>;
  now: number;
};

/**
 * Projects the Board's order list. A trusted single-use award with no status
 * event is implicitly `pending` (§5). Untrusted issuers, expired awards, and
 * awards whose definition exists but is not a sellable single-use item never
 * create orders. A temporarily missing definition leaves the order
 * diagnosable (itemName undefined) without mutating its identity.
 *
 * Venue binding is owned by the caller: only events learned from the active
 * venue relay reach this fold, so awards for other venues never arrive here.
 */
export function projectOrders({ awards, definitions, statuses, trustedIssuers, now }: ProjectionInput): BoardOrder[] {
  const definitionByAddress = latestDefinitions(definitions);

  const statusesByContext = new Map<string, StatusInput[]>();
  for (const status of statuses) {
    if (!trustedIssuers.has(status.authorPubkey)) continue;
    if (!PUBLISHED.has(status.status)) continue;
    if (status.context !== "order" && status.context !== "event") continue;
    if (!status.contextKey) continue;
    const list = statusesByContext.get(status.contextKey) ?? [];
    list.push(status);
    statusesByContext.set(status.contextKey, list);
  }

  const orders: BoardOrder[] = [];
  for (const award of awards) {
    if (!trustedIssuers.has(award.issuerPubkey)) continue;
    if (award.expiresAt !== undefined && award.expiresAt <= now) continue;

    const definition = definitionByAddress.get(award.definitionAddress);
    if (definition && !isSingleUseSellable(definition)) continue;

    const folded: FoldedStatus = { status: "pending", createdAt: -1, id: "", from: "pending" };
    const log = statusesByContext.get(award.id) ?? [];
    const ordered = [...log].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const candidate of ordered) {
      if (!isNewer(candidate, folded)) continue; // stale (§6.6)
      if (!isValidTransition(folded.status, candidate.status, candidate.context)) continue;
      folded.from = folded.status;
      folded.status = candidate.status;
      folded.createdAt = candidate.createdAt;
      folded.id = candidate.id;
    }

    orders.push({
      awardId: award.id,
      definitionAddress: award.definitionAddress,
      holderPubkey: award.holderPubkey,
      ...(definition?.name ? { itemName: definition.name } : {}),
      status: folded.status,
      declined: folded.status === "cancelled" && folded.from === "pending",
      createdAt: award.createdAt,
      updatedAt: folded.createdAt >= 0 ? folded.createdAt : award.createdAt,
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
