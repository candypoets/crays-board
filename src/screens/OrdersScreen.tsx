import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Badge, Button, ScreenTitle } from "@/components/ui";
import { colors, orderStateColor } from "@/theme/colors";
import type { Order, OrderState } from "@/types/domain";

const lanes: { state: OrderState; label: string; next?: OrderState; action?: string }[] = [
  { state: "pending", label: "Needs decision", next: "accepted", action: "Accept" },
  { state: "accepted", label: "Accepted", next: "processing", action: "Start" },
  { state: "processing", label: "In progress", next: "ready", action: "Mark ready" },
  { state: "ready", label: "Ready", next: "fulfilled", action: "Handed off" },
];

export function OrdersScreen({
  width,
  orders,
  onOrdersChange,
}: {
  width: number;
  orders: Order[];
  onOrdersChange: (orders: Order[]) => void;
}) {
  const phone = width < 600;
  const [phoneLane, setPhoneLane] = useState<OrderState>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const visibleLanes = phone ? lanes.filter((lane) => lane.state === phoneLane) : lanes;
  const advance = (order: Order, next: OrderState) => {
    onOrdersChange(orders.map((candidate) => candidate.id === order.id ? { ...candidate, state: next } : candidate));
    setSelectedId(null);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, phone && styles.headerPhone]}>
        <ScreenTitle
          title="Orders"
          description="Keep every hand-off visible from payment to pickup."
          action={!phone ? <Button label="Order history" tone="secondary" icon="history" /> : undefined}
        />
        <View style={styles.summaryLine}>
          <View style={styles.summaryItem}><View style={[styles.summaryDot, { backgroundColor: colors.pink }]} /><Text style={styles.summaryText}>3 need action</Text></View>
          <View style={styles.summaryItem}><MaterialCommunityIcons name="lightning-bolt" size={16} color={colors.warning} /><Text style={styles.summaryText}>Median 11 min</Text></View>
          <Badge label="Live" tone="success" />
        </View>
      </View>

      {phone ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.laneTabs}>
          {lanes.map((lane) => {
            const count = orders.filter((order) => order.state === lane.state).length;
            const selectedLane = lane.state === phoneLane;
            return (
              <Pressable key={lane.state} onPress={() => setPhoneLane(lane.state)} style={[styles.laneTab, selectedLane && styles.laneTabSelected]}>
                <Text style={[styles.laneTabText, selectedLane && styles.laneTabTextSelected]}>{lane.label}</Text>
                <Text style={[styles.laneTabCount, selectedLane && styles.laneTabTextSelected]}>{count}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <ScrollView horizontal={!phone} showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.board, phone && styles.boardPhone]}>
        {visibleLanes.map((lane) => {
          const laneOrders = orders.filter((order) => order.state === lane.state);
          return (
            <View key={lane.state} style={[styles.lane, phone && styles.lanePhone]}>
              <View style={styles.laneHeader}>
                <View style={[styles.laneSignal, { backgroundColor: orderStateColor[lane.state] }]} />
                <Text style={styles.laneTitle}>{lane.label}</Text>
                <View style={styles.laneCount}><Text style={styles.laneCountText}>{laneOrders.length}</Text></View>
              </View>
              <ScrollView nestedScrollEnabled contentContainerStyle={styles.laneList} showsVerticalScrollIndicator={false}>
                {laneOrders.length ? laneOrders.map((order) => (
                  <Pressable
                    key={order.id}
                    accessibilityRole="button"
                    onPress={() => setSelectedId(selectedId === order.id ? null : order.id)}
                    style={({ pressed }) => [styles.ticket, selectedId === order.id && styles.ticketSelected, pressed && styles.pressed]}
                  >
                    <View style={styles.ticketTop}>
                      <Text style={styles.ticketId}>#{order.id}</Text>
                      <Text style={styles.ticketAge}>{order.createdAt}</Text>
                    </View>
                    <Text style={styles.ticketGuest}>{order.guest}</Text>
                    <View style={styles.itemList}>
                      {order.items.map((item) => (
                        <View key={`${order.id}-${item.name}`} style={styles.itemRow}>
                          <Text style={styles.quantity}>{item.quantity}×</Text>
                          <View style={styles.itemCopy}>
                            <Text style={styles.itemName}>{item.name}</Text>
                            {item.note ? <Text style={styles.itemNote}>{item.note}</Text> : null}
                          </View>
                        </View>
                      ))}
                    </View>
                    <View style={styles.ticketFooter}>
                      <Text style={styles.ticketTotal}>{order.total}</Text>
                      <Badge label="Paid" tone="success" />
                    </View>
                    {selectedId === order.id && lane.next ? (
                      <View style={styles.ticketActions}>
                        {lane.state === "pending" ? <Button label="Decline" tone="quiet" compact onPress={() => advance(order, "cancelled")} /> : null}
                        <Button label={lane.action ?? "Continue"} compact onPress={() => advance(order, lane.next!)} />
                      </View>
                    ) : null}
                  </Pressable>
                )) : (
                  <View style={styles.emptyLane}>
                    <MaterialCommunityIcons name="check-circle-outline" size={24} color={colors.success} />
                    <Text style={styles.emptyLaneTitle}>Lane clear</Text>
                    <Text style={styles.emptyLaneCopy}>New orders will appear here automatically.</Text>
                  </View>
                )}
              </ScrollView>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 30, paddingTop: 26, paddingBottom: 17 },
  headerPhone: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 13 },
  summaryLine: { flexDirection: "row", alignItems: "center", gap: 18, marginTop: -12 },
  summaryItem: { flexDirection: "row", alignItems: "center", gap: 7 },
  summaryDot: { width: 8, height: 8, borderRadius: 4 },
  summaryText: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  laneTabs: { paddingHorizontal: 18, gap: 8, paddingBottom: 12 },
  laneTab: { minHeight: 43, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8 },
  laneTabSelected: { backgroundColor: colors.night, borderColor: colors.night },
  laneTabText: { color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  laneTabTextSelected: { color: colors.white },
  laneTabCount: { color: colors.ink, fontSize: 11, fontWeight: "900" },
  board: { paddingHorizontal: 30, paddingBottom: 30, gap: 14, minWidth: "100%", alignItems: "stretch" },
  boardPhone: { paddingHorizontal: 18, paddingBottom: 28, width: "100%" },
  lane: { width: 286, minHeight: 520, maxHeight: 680, backgroundColor: "#F9EDF0", borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  lanePhone: { flex: 1, width: "100%", maxHeight: undefined },
  laneHeader: { minHeight: 55, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  laneSignal: { width: 9, height: 9, borderRadius: 5 },
  laneTitle: { flex: 1, color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "800" },
  laneCount: { minWidth: 25, height: 25, borderRadius: 13, backgroundColor: colors.surfaceWarm, alignItems: "center", justifyContent: "center", paddingHorizontal: 7 },
  laneCountText: { color: colors.inkMuted, fontSize: 11, fontWeight: "900" },
  laneList: { padding: 10, gap: 10, flexGrow: 1 },
  ticket: { backgroundColor: colors.white, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border },
  ticketSelected: { borderColor: colors.pink },
  ticketTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  ticketId: { color: colors.ink, fontSize: 12, fontWeight: "900" },
  ticketAge: { color: colors.pinkDark, fontSize: 11, fontWeight: "700" },
  ticketGuest: { color: colors.ink, fontSize: 17, lineHeight: 22, fontWeight: "800", marginTop: 11 },
  itemList: { marginTop: 11, gap: 8 },
  itemRow: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  quantity: { width: 21, color: colors.inkMuted, fontSize: 12, lineHeight: 17, fontWeight: "800" },
  itemCopy: { flex: 1 },
  itemName: { color: colors.ink, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  itemNote: { color: colors.coral, fontSize: 11, lineHeight: 15, fontWeight: "700", marginTop: 2 },
  ticketFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  ticketTotal: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  ticketActions: { flexDirection: "row", justifyContent: "flex-end", gap: 6, marginTop: 12 },
  pressed: { opacity: 0.74 },
  emptyLane: { flex: 1, minHeight: 190, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  emptyLaneTitle: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: "800", marginTop: 10 },
  emptyLaneCopy: { color: colors.inkMuted, fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: 4 },
});
