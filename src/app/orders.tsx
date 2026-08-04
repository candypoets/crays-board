import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";

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
import { colors } from "@/theme/colors";
import { useVenue } from "@/venue/VenueContext";

/** QA/admin persona sees every destination (matches the other shell screens). */
const ADMIN_PERMISSIONS = ["posts", "media", "events", "store", "invites", "moderation", "settings"];

type MutationState = {
  phase: "publishing" | "confirmed" | "error";
  /** Displayed stage the action was taken from (decline/cancel wording, §6.4). */
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

function statusLabel(order: { status: OrderStatus; declined: boolean }): string {
  // Decline = cancelled from the implicit pending stage (§6.4).
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

function OrderCard({
  order,
  mutation,
  onAction,
}: {
  order: BoardOrder;
  mutation?: MutationState;
  onAction: (order: BoardOrder, action: OrderAction, from: OrderStatus) => void;
}) {
  // A relay-acknowledged action that the subscription projection has not
  // echoed yet keeps the card at the confirmed stage (never regressing to the
  // stale fold) until relay truth catches up (§6.8: ack is truth).
  const confirmed =
    mutation?.phase === "confirmed" && orderStageIndex(order.status) < orderStageIndex(mutation.to)
      ? mutation
      : undefined;
  const displayedStatus: OrderStatus = confirmed ? confirmed.to : order.status;
  const displayed = {
    ...order,
    status: displayedStatus,
    declined: confirmed ? confirmed.to === "cancelled" && confirmed.from === "pending" : order.declined,
  };

  const primary = nextOrderAction(displayedStatus);
  const secondary = cancellationAction(displayedStatus);
  const busy = mutation?.phase === "publishing";

  const primaryButton = primary ? (
    <Button
      testID="order-action-button"
      label={actionLabel(primary, mutation)}
      onPress={() => onAction(order, primary, displayedStatus)}
      disabled={busy}
    />
  ) : null;

  return (
    <Panel testID={`order-card-${order.awardId.slice(0, 12)}`} style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.itemName} numberOfLines={2}>
          {order.itemName ?? `Order ${order.awardId.slice(0, 12)}`}
        </Text>
        <Badge label={statusLabel(displayed)} tone={STATUS_TONE[displayedStatus]} />
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>Guest {order.holderPubkey.slice(0, 12)}…</Text>
        <Text style={styles.metaText}>{formatElapsed(order.elapsedSeconds)} elapsed</Text>
      </View>
      {primary || secondary ? (
        <View style={styles.actionRow}>
          {/* The wrapper keeps the flow-10 contract id tappable on pending
              cards while the uniform ladder id lives on the button itself. */}
          {displayedStatus === "pending" && primaryButton ? (
            <View testID="order-accept-button">{primaryButton}</View>
          ) : (
            primaryButton
          )}
          {secondary ? (
            <Button
              testID={displayedStatus === "pending" ? "order-decline-button" : "order-cancel-button"}
              label={actionLabel(secondary, mutation)}
              tone="secondary"
              onPress={() => onAction(order, secondary, displayedStatus)}
              disabled={busy}
            />
          ) : null}
          {mutation?.phase === "error" && mutation.message ? (
            <Text style={styles.errorText}>{mutation.message}</Text>
          ) : null}
        </View>
      ) : null}
    </Panel>
  );
}

function OrdersSubscription({ onRetry }: { onRetry: () => void }) {
  const { venue } = useVenue();
  const { status, orders, error } = useOrders();
  const [mutations, setMutations] = useState<Record<string, MutationState>>({});
  // ORDER-05: synchronous in-flight guard. A double-tap can deliver both
  // presses before React commits the "publishing" state, so React state alone
  // cannot stop a second publish; the ref is updated in the same handler.
  const inFlight = useRef(new Set<string>());
  // created_at floor per order context: §6.6 requires strictly monotonic
  // status timestamps, so rapid consecutive actions never share a second.
  const lastPublishedAt = useRef(new Map<string, number>());

  const publishAction = (order: BoardOrder, action: OrderAction, from: OrderStatus) => {
    if (!venue || inFlight.current.has(order.awardId)) return;
    inFlight.current.add(order.awardId);
    setMutations((current) => ({ ...current, [order.awardId]: { phase: "publishing", from, to: action.to } }));
    void (async () => {
      // §6.8: exactly one status per deliberate action, confirmed only after
      // an affirmative relay acknowledgement; local intent is never shown as
      // confirmed state before that. §6.7 (resolved): the builder gives each
      // transition a stage-scoped d so the relay retains the full ladder.
      const template = buildOrderTransitionStatus({
        awardId: order.awardId,
        definitionAddress: order.definitionAddress,
        holderPubkey: order.holderPubkey,
        status: action.to,
        context: "order",
      });
      template.created_at = Math.max(
        template.created_at ?? 0,
        order.updatedAt + 1,
        (lastPublishedAt.current.get(order.awardId) ?? 0) + 1,
      );
      const signed = await signActiveEvent(template);
      await publishEvent(signed, [venue.relayUrl], "order_status");
      lastPublishedAt.current.set(order.awardId, signed.created_at);
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

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={orders}
      keyExtractor={(order) => order.awardId}
      renderItem={({ item }) => (
        <OrderCard order={item} mutation={mutations[item.awardId]} onAction={handleAction} />
      )}
      ListEmptyComponent={
        status === "loading" ? (
          <View style={styles.center}>
            <Text style={styles.loadingText}>Connecting to the venue relay…</Text>
          </View>
        ) : (
          <EmptyState
            icon="silverware-fork-knife"
            title="No orders yet"
            description="New paid orders will appear here live."
          />
        )
      }
    />
  );
}

export default function OrdersRoute() {
  const router = useRouter();
  const { venue, restoring } = useVenue();
  const [retryKey, setRetryKey] = useState(0);

  return (
    <View testID="orders-screen" style={styles.screen}>
      <AppShell active="orders" permissions={ADMIN_PERMISSIONS}>
        <View style={styles.container}>
          <ScreenTitle
            title="Orders"
            description={venue ? `Live from ${venue.relayUrl.replace(/^wss?:\/\//, "")}` : "No venue selected"}
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
  container: { flex: 1, padding: 24, maxWidth: 860, width: "100%", alignSelf: "center" },
  list: { flex: 1 },
  listContent: { gap: 14, paddingBottom: 32, flexGrow: 1 },
  card: { gap: 10 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  itemName: { flex: 1, color: colors.ink, fontSize: 18, lineHeight: 24, fontWeight: "800" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", gap: 14 },
  metaText: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  actionRow: { gap: 8, marginTop: 4 },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  center: { flex: 1, justifyContent: "center" },
  loadingText: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, textAlign: "center" },
});
