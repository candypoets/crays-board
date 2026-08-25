import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { signActiveEvent } from "@/account/account";
import { Badge, Button, EmptyState, Panel, ScreenTitle } from "@/components/ui";
import type { PublishedOrderStatus } from "@/nostr/protocol";
import { publishEvent } from "@/nostr/publish";
import { buildOrderTransitionStatus } from "@/orders/builders";
import {
  cancellationAction,
  nextOrderAction,
  orderStageIndex,
  type BoardOrder,
  type OrderAction,
  type OrderStatus,
} from "@/orders/fold";
import { useOrders } from "@/orders/useOrders";
import { AppShell } from "@/shell/AppShell";
import { useBreakpoint } from "@/shell/breakpoint";
import { colors } from "@/theme/colors";
import { useVenue } from "@/venue/VenueContext";

/** QA/admin persona sees every destination (matches the other shell screens). */
const ADMIN_PERMISSIONS = ["posts", "media", "events", "store", "invites", "moderation", "settings"];

type MutationState = {
  phase: "publishing" | "confirmed" | "error";
  /** Displayed stage the action was taken from (decline/cancel wording). */
  from: OrderStatus;
  to: PublishedOrderStatus;
  message?: string;
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "New",
  accepted: "Accepted",
  processing: "Preparing",
  ready: "Ready",
  fulfilled: "Served",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<OrderStatus, "neutral" | "pink" | "success" | "warning" | "danger" | "info"> = {
  pending: "pink",
  accepted: "info",
  processing: "warning",
  ready: "success",
  fulfilled: "success",
  cancelled: "neutral",
};

const BUSY_LABEL: Record<PublishedOrderStatus, string> = {
  accepted: "Accepting…",
  processing: "Starting…",
  ready: "Marking ready…",
  fulfilled: "Serving…",
  cancelled: "Cancelling…",
};

/** Active ladder stages, in service order. Terminal orders live in history. */
const LANE_ORDER = ["pending", "accepted", "processing", "ready"] as const;
type LaneId = (typeof LANE_ORDER)[number];
type BucketId = LaneId | "history";

const LANE_LABEL: Record<LaneId, string> = {
  pending: "Pending",
  accepted: "Accepted",
  processing: "Preparing",
  ready: "Ready",
};

const EMPTY_BUCKET_LABEL: Record<BucketId, string> = {
  pending: "No pending orders.",
  accepted: "Nothing accepted yet.",
  processing: "Nothing being prepared.",
  ready: "Nothing ready to serve.",
  history: "No served or cancelled orders yet.",
};

function bucketFor(status: OrderStatus): BucketId {
  return status === "fulfilled" || status === "cancelled" ? "history" : status;
}

function statusLabel(order: { status: OrderStatus; declined: boolean }): string {
  // Decline = cancelled from the implicit pending stage.
  if (order.declined) return "Declined";
  return STATUS_LABEL[order.status];
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function actionLabel(action: OrderAction, mutation?: MutationState): string {
  if (mutation?.phase === "publishing" && mutation.to === action.to) return BUSY_LABEL[action.to];
  if (mutation?.phase === "error" && mutation.to === action.to) return "Retry";
  return action.label;
}

/**
 * The status the card presents: a relay-acknowledged action that the
 * subscription projection has not echoed yet keeps the card at the confirmed
 * stage (never regressing to the stale fold) until relay truth catches up
 * (the ack is the truth). Bucketing uses the same value so the card moves
 * lanes/tabs exactly when the venue confirms the change.
 */
function displayedOrder(order: BoardOrder, mutation?: MutationState): { status: OrderStatus; declined: boolean } {
  const confirmed =
    mutation?.phase === "confirmed" &&
    (orderStageIndex(order.status) < orderStageIndex(mutation.to) ||
      (order.status === mutation.to && mutation.to === "cancelled"))
      ? mutation
      : undefined;
  return {
    status: confirmed ? confirmed.to : order.status,
    declined: confirmed ? confirmed.to === "cancelled" && confirmed.from === "pending" : order.declined,
  };
}

function OrderCard({
  order,
  mutation,
  compact = false,
  onAction,
}: {
  order: BoardOrder;
  mutation?: MutationState;
  compact?: boolean;
  onAction: (order: BoardOrder, action: OrderAction, from: OrderStatus) => void;
}) {
  const displayed = displayedOrder(order, mutation);
  const displayedStatus = displayed.status;

  const primary = nextOrderAction(displayedStatus);
  const secondary = cancellationAction(displayedStatus);
  const busy = mutation?.phase === "publishing";

  const primaryButton = primary ? (
    <Button
      testID="order-action-button"
      label={actionLabel(primary, mutation)}
      compact={compact}
      onPress={() => onAction(order, primary, displayedStatus)}
      disabled={busy}
    />
  ) : null;

  return (
    <Panel
      testID={`order-card-${order.awardId.slice(0, 12)}`}
      style={compact ? [styles.card, styles.cardCompact] : styles.card}
    >
      <View style={[styles.cardHeader, compact && styles.cardHeaderCompact]}>
        <Text style={[styles.itemName, compact && styles.itemNameCompact]} numberOfLines={2}>
          {order.itemName ?? `Order ${order.awardId.slice(0, 12)}`}
        </Text>
        <View
          testID={`order-status-${order.awardId.slice(0, 12)}-${displayedStatus}`}
          style={compact ? styles.statusCompact : undefined}
        >
          <Badge label={statusLabel(displayed)} tone={STATUS_TONE[displayedStatus]} />
        </View>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.metaText} numberOfLines={1}>
          Guest {order.holderPubkey.slice(0, 12)}…
        </Text>
        <Text style={styles.metaText}>{formatElapsed(order.elapsedSeconds)} elapsed</Text>
      </View>
      {primary || secondary ? (
        <View style={styles.actionRow}>
          {/* The wrapper keeps the flow-10 contract id tappable on pending
              cards while the uniform ladder id lives on the button itself. */}
          {primaryButton ? (
            <View testID={`order-action-button-${order.awardId.slice(0, 12)}`}>
              {displayedStatus === "pending" ? (
                <View testID="order-accept-button">{primaryButton}</View>
              ) : (
                primaryButton
              )}
            </View>
          ) : null}
          {secondary ? (
            <View testID={displayedStatus === "pending" ? "order-decline-button" : "order-cancel-button"}>
              <Button
                testID={`${displayedStatus === "pending" ? "order-decline-button" : "order-cancel-button"}-${order.awardId.slice(0, 12)}`}
                label={actionLabel(secondary, mutation)}
                tone="secondary"
                compact={compact}
                onPress={() => onAction(order, secondary, displayedStatus)}
                disabled={busy}
              />
            </View>
          ) : null}
          {mutation?.phase === "error" && mutation.message ? (
            <Text style={styles.errorText}>{mutation.message}</Text>
          ) : null}
        </View>
      ) : null}
    </Panel>
  );
}

type Buckets = Record<BucketId, BoardOrder[]>;

function OrdersSubscription({ onRetry }: { onRetry: () => void }) {
  const { venue } = useVenue();
  const { status, orders, error } = useOrders();
  const breakpoint = useBreakpoint();
  const wide = breakpoint === "tablet";
  const [mutations, setMutations] = useState<Record<string, MutationState>>({});
  // Phone state tabs: null means "follow the work" — the first non-empty
  // stage. A manual tap pins the tab. Buckets follow relay truth, so a card
  // with a freshly confirmed action stays visible in the current tab (showing
  // the confirmed stage) until the relay fold moves it.
  const [pinnedTab, setPinnedTab] = useState<BucketId | null>(null);
  // ORDER-05: synchronous in-flight guard. A double-tap can deliver both
  // presses before React commits the "publishing" state, so React state alone
  // cannot stop a second publish; the ref is updated in the same handler.
  const inFlight = useRef(new Set<string>());
  // created_at floor per fulfillment context: NIP-97 resolves the current
  // status by created_at (lowest id breaks ties), so rapid consecutive
  // actions must never share a second.
  const lastPublishedAt = useRef(new Map<string, number>());

  // Buckets follow relay truth (the fold), never the optimistic override: a
  // confirmed action the projection has not echoed yet keeps the card in its
  // current lane/tab with the confirmed stage on it, and the card moves only
  // when relay truth catches up.
  const buckets = useMemo<Buckets>(() => {
    const grouped: Buckets = { pending: [], accepted: [], processing: [], ready: [], history: [] };
    for (const order of orders) {
      grouped[bucketFor(order.status)].push(order);
    }
    return grouped;
  }, [orders]);

  const activeTab: BucketId =
    pinnedTab ?? LANE_ORDER.find((lane) => buckets[lane].length > 0) ?? "pending";

  const publishAction = (order: BoardOrder, action: OrderAction, from: OrderStatus) => {
    if (!venue || inFlight.current.has(order.awardId)) return;
    inFlight.current.add(order.awardId);
    setMutations((current) => ({ ...current, [order.awardId]: { phase: "publishing", from, to: action.to } }));
    void (async () => {
      // Exactly one status per deliberate action, confirmed only after an
      // affirmative relay acknowledgement; local intent is never shown as
      // confirmed state before that. NIP-97 fulfillment is context-addressed:
      // every transition reuses the order's `d = order:<orderRef>`, so the
      // relay retains the latest status per (author, context) and a retry
      // after a timeout replaces itself instead of duplicating.
      const template = buildOrderTransitionStatus({
        awardId: order.awardId,
        definitionAddress: order.definitionAddress,
        holderPubkey: order.holderPubkey,
        status: action.to,
        orderRef: order.orderRef,
        latestStatusCreatedAt: order.latestStatusCreatedAt,
      });
      template.created_at = Math.max(
        template.created_at ?? 0,
        (lastPublishedAt.current.get(order.contextKey) ?? 0) + 1,
      );
      const signed = await signActiveEvent(template);
      await publishEvent(signed, [venue.relayUrl], "order_status");
      lastPublishedAt.current.set(order.contextKey, signed.created_at);
      if (__DEV__) {
        console.log(
          `[crays-board-order-status]${JSON.stringify({ id: signed.id, e: order.awardId, status: action.to })}`,
        );
      }
      setMutations((current) => ({
        ...current,
        [order.awardId]: { phase: "confirmed", from, to: action.to },
      }));
    })().catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      setMutations((current) => ({ ...current, [order.awardId]: { phase: "error", from, to: action.to, message } }));
    }).finally(() => {
      // Cleared on success too: the confirmed override keeps the card at the
      // confirmed stage until relay truth arrives, and an error path needs
      // Retry free.
      inFlight.current.delete(order.awardId);
    });
  };

  const handleAction = (order: BoardOrder, action: OrderAction, from: OrderStatus) => {
    if (!venue) return;
    if (!action.confirm) {
      publishAction(order, action, from);
      return;
    }
    // ORDER-07: once accepted, cancellation is a deliberate confirmed action
    // naming the order and the venue; dismissing publishes nothing.
    const item = order.itemName ?? `Order ${order.awardId.slice(0, 12)}`;
    const venueName = venue.relayUrl.replace(/^wss?:\/\//, "");
    Alert.alert(
      "Cancel this order?",
      `Cancel “${item}” at ${venueName}? The guest will see the order as cancelled.`,
      [
        { text: "Keep order", style: "cancel" },
        { text: "Yes, cancel order", style: "destructive", onPress: () => publishAction(order, action, from) },
      ],
    );
  };

  if (status === "error") {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="lan-disconnect"
          title="Cannot reach this venue"
          description={error ?? "The venue relay or service did not answer."}
          action={<Button label="Try again" tone="secondary" onPress={onRetry} />}
        />
      </View>
    );
  }

  if (status === "loading") {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Connecting to the venue relay…</Text>
      </View>
    );
  }

  const renderCard = (order: BoardOrder, compact: boolean) => (
    <OrderCard
      key={order.awardId}
      order={order}
      mutation={mutations[order.awardId]}
      compact={compact}
      onAction={handleAction}
    />
  );

  const emptyBoard =
    status === "ready" && orders.length === 0 ? (
      <EmptyState
        icon="silverware-fork-knife"
        title="No orders yet"
        description="New paid orders will appear here live."
      />
    ) : null;

  // Tablet: the operational board. One lane per active stage, compact cards
  // with exactly one next action; terminal orders filter into History below.
  if (wide) {
    if (emptyBoard) return emptyBoard;
    return (
      <ScrollView style={styles.boardScroll} contentContainerStyle={styles.boardScrollContent}>
        <View style={styles.lanes}>
          {LANE_ORDER.map((lane) => (
            <View key={lane} testID={`orders-lane-${lane}`} style={styles.lane}>
              <Text style={styles.laneTitle}>{`${LANE_LABEL[lane]} ${buckets[lane].length}`}</Text>
              {buckets[lane].length === 0 ? (
                <Text style={styles.laneEmpty}>{EMPTY_BUCKET_LABEL[lane]}</Text>
              ) : (
                buckets[lane].map((order) => renderCard(order, true))
              )}
            </View>
          ))}
        </View>
        <View testID="orders-history" style={styles.historySection}>
          <Text style={styles.laneTitle}>{`History ${buckets.history.length}`}</Text>
          {buckets.history.length === 0 ? (
            <Text style={styles.laneEmpty}>{EMPTY_BUCKET_LABEL.history}</Text>
          ) : (
            <View style={styles.historyGrid}>
              {buckets.history.map((order) => (
                <View key={order.awardId} style={styles.historyCell}>
                  {renderCard(order, true)}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    );
  }

  // Phone/compact: sticky state tabs with counts above the filtered list.
  // The strip is fixed above the list, so it never scrolls away.
  const tabDefs: { id: BucketId; label: string }[] = [
    ...LANE_ORDER.map((lane) => ({ id: lane, label: LANE_LABEL[lane] })),
    { id: "history" as const, label: "History" },
  ];
  return (
    <View style={styles.phoneBoard}>
      <View style={styles.tabStrip}>
        {tabDefs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <Pressable
              key={tab.id}
              testID={`orders-tab-${tab.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setPinnedTab(tab.id)}
              style={[styles.tabChip, active && styles.tabChipActive]}
            >
              {/* Single text node: exact-match flow assertions ("New") must not
                  see a bare stage label. */}
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.78}
                numberOfLines={1}
                style={[styles.tabChipLabel, active && styles.tabChipLabelActive]}
              >
                {`${tab.label} ${buckets[tab.id].length}`}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={buckets[activeTab]}
        keyExtractor={(order) => order.awardId}
        renderItem={({ item }) => renderCard(item, false)}
        ListEmptyComponent={
          emptyBoard ?? (
            <View style={styles.center}>
              <Text style={styles.loadingText}>{EMPTY_BUCKET_LABEL[activeTab]}</Text>
            </View>
          )
        }
      />
    </View>
  );
}

export default function OrdersRoute() {
  const router = useRouter();
  const { venue, restoring } = useVenue();
  const [retryKey, setRetryKey] = useState(0);
  const breakpoint = useBreakpoint();

  return (
    <View testID="orders-screen" style={styles.screen}>
      <AppShell active="orders" permissions={ADMIN_PERMISSIONS}>
        <View style={[styles.container, breakpoint === "phone" && styles.containerPhone]}>
          <ScreenTitle
            title="Orders"
            description={venue ? "Live order state from the connected venue." : "No venue selected"}
          />
          {restoring ? (
            <View style={styles.center}>
              <Text style={styles.loadingText}>Restoring the venue…</Text>
            </View>
          ) : !venue ? (
            <EmptyState
              icon="store-off-outline"
              title="No venue selected"
              description="Select a venue before taking orders."
              action={<Button label="Back to welcome" tone="secondary" onPress={() => router.replace("/")} />}
            />
          ) : (
            <OrdersSubscription key={retryKey} onRetry={() => setRetryKey((key) => key + 1)} />
          )}
        </View>
      </AppShell>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, padding: 24, maxWidth: 1600, width: "100%", alignSelf: "center" },
  containerPhone: { paddingHorizontal: 16, paddingTop: 18 },
  phoneBoard: { flex: 1 },
  tabStrip: { flexDirection: "row", gap: 4, marginBottom: 14 },
  tabChip: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 3,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabChipActive: { backgroundColor: colors.pinkSoft, borderColor: colors.pink },
  tabChipLabel: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "700", textAlign: "center" },
  tabChipLabelActive: { color: colors.pinkDark },
  boardScroll: { flex: 1 },
  boardScrollContent: { paddingBottom: 32, gap: 20 },
  lanes: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  lane: { flex: 1, minWidth: 0, gap: 10 },
  laneTitle: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "800" },
  laneEmpty: { color: colors.inkFaint, fontSize: 13, lineHeight: 18 },
  historySection: { gap: 10 },
  historyGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "flex-start" },
  historyCell: { flexBasis: 280, flexGrow: 1, maxWidth: 420 },
  list: { flex: 1 },
  listContent: { gap: 14, paddingBottom: 32, flexGrow: 1 },
  card: { gap: 10 },
  cardCompact: { gap: 8, padding: 14 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  cardHeaderCompact: { flexDirection: "column", alignItems: "stretch", gap: 7 },
  statusCompact: { alignSelf: "flex-start" },
  itemName: { flex: 1, color: colors.ink, fontSize: 18, lineHeight: 24, fontWeight: "800" },
  itemNameCompact: { fontSize: 15, lineHeight: 20 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  metaText: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, flexShrink: 1 },
  actionRow: { gap: 8, marginTop: 4 },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  center: { flex: 1, justifyContent: "center" },
  loadingText: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, textAlign: "center" },
});
