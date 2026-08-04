import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Badge, Button, Panel } from "@/components/ui";
import { colors } from "@/theme/colors";
import type { Area, IconName, Order } from "@/types/domain";

const serviceSignals: { label: string; value: string; detail: string; icon: IconName; tone: string }[] = [
  { label: "Needs decision", value: "3", detail: "oldest 5 min", icon: "timer-sand", tone: colors.pink },
  { label: "In the kitchen", value: "3", detail: "2 on time", icon: "chef-hat", tone: colors.coral },
  { label: "Ready to hand off", value: "1", detail: "order #1043", icon: "bell-ring-outline", tone: colors.warning },
  { label: "Tonight's room", value: "48", detail: "doors 19:30", icon: "account-group-outline", tone: colors.success },
];

export function HomeScreen({ width, orders, onNavigate }: { width: number; orders: Order[]; onNavigate: (area: Area) => void }) {
  const phone = width < 600;
  const narrow = width < 980;
  const pending = orders.filter((order) => order.state === "pending");
  const active = orders.filter((order) => ["accepted", "processing", "ready"].includes(order.state));

  return (
    <ScrollView contentContainerStyle={[styles.scroll, phone && styles.scrollPhone]} showsVerticalScrollIndicator={false}>
      <View style={[styles.welcome, phone && styles.welcomePhone]}>
        <View style={styles.welcomeCopy}>
          <Text style={styles.date}>Monday · 3 August</Text>
          <Text style={[styles.heading, phone && styles.headingPhone]}>Good evening, Mina.</Text>
          <Text style={styles.subheading}>Maison Crays is open. Three orders need a decision before the room fills.</Text>
        </View>
        <Button label="Open orders" icon="arrow-right" onPress={() => onNavigate("orders")} />
      </View>

      <View style={[styles.signalBoard, phone && styles.signalBoardPhone]}>
        {serviceSignals.map((signal, index) => (
          <View key={signal.label} style={[styles.signal, phone && styles.signalPhone, index > 0 && !phone && styles.signalDivider]}>
            <View style={[styles.signalIcon, { backgroundColor: `${signal.tone}18` }]}>
              <MaterialCommunityIcons name={signal.icon} size={21} color={signal.tone} />
            </View>
            <View style={styles.signalValueWrap}>
              <Text style={styles.signalValue}>{signal.value}</Text>
              <Text style={styles.signalLabel}>{signal.label}</Text>
              <Text style={styles.signalDetail}>{signal.detail}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={[styles.workGrid, narrow && styles.workGridNarrow]}>
        <Panel style={styles.ordersPanel} padded={false}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.panelTitle}>Service pulse</Text>
              <Text style={styles.panelSubtitle}>{active.length + pending.length} orders moving now</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => onNavigate("orders")} style={styles.linkButton}>
              <Text style={styles.linkText}>See all</Text>
              <MaterialCommunityIcons name="arrow-right" size={18} color={colors.pinkDark} />
            </Pressable>
          </View>
          {orders.slice(0, phone ? 4 : 5).map((order) => (
            <Pressable key={order.id} accessibilityRole="button" onPress={() => onNavigate("orders")} style={({ pressed }) => [styles.orderRow, pressed && styles.pressed]}>
              <View style={styles.orderId}><Text style={styles.orderIdText}>#{order.id}</Text></View>
              <View style={styles.orderCopy}>
                <Text style={styles.orderGuest}>{order.guest}</Text>
                <Text style={styles.orderItems} numberOfLines={1}>{order.items.map((item) => `${item.quantity}× ${item.name}`).join(" · ")}</Text>
              </View>
              <Badge
                label={order.state === "pending" ? `${order.createdAt} waiting` : order.state}
                tone={order.state === "pending" ? "pink" : order.state === "ready" ? "warning" : "info"}
              />
            </Pressable>
          ))}
        </Panel>

        <View style={styles.sideColumn}>
          <Panel>
            <View style={styles.panelHeaderCompact}>
              <View>
                <Text style={styles.panelTitle}>Tonight</Text>
                <Text style={styles.panelSubtitle}>Soft opening supper</Text>
              </View>
              <Badge label="Sold out" tone="pink" />
            </View>
            <View style={styles.eventTimeRow}>
              <View style={styles.eventTimeBlock}>
                <Text style={styles.eventTime}>19:30</Text>
                <Text style={styles.eventTimeLabel}>Doors</Text>
              </View>
              <View style={styles.eventTimeBlock}>
                <Text style={styles.eventTime}>48</Text>
                <Text style={styles.eventTimeLabel}>Guests</Text>
              </View>
              <View style={styles.eventTimeBlock}>
                <Text style={styles.eventTime}>5</Text>
                <Text style={styles.eventTimeLabel}>Team</Text>
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.shiftRow}>
              <View style={styles.avatarStack}>
                {[
                  ["MA", colors.pinkSoft], ["TM", colors.warningSoft], ["AH", colors.successSoft], ["MK", colors.infoSoft],
                ].map(([initials, background], index) => (
                  <View key={initials} style={[styles.miniAvatar, { backgroundColor: background, marginLeft: index ? -8 : 0 }]}><Text style={styles.miniAvatarText}>{initials}</Text></View>
                ))}
              </View>
              <Text style={styles.shiftCopy}>4 on shift · Sam joins at 18:30</Text>
            </View>
            <Button label="View event" tone="secondary" compact onPress={() => onNavigate("events")} />
          </Panel>

          <Panel style={styles.attentionPanel}>
            <View style={styles.attentionTop}>
              <MaterialCommunityIcons name="food-off-outline" size={23} color={colors.coral} />
              <Text style={styles.attentionTitle}>One item unavailable</Text>
            </View>
            <Text style={styles.attentionCopy}>The Supper set is hidden from guests. Add a return time or make it available again.</Text>
            <Button label="Review menu" tone="quiet" compact icon="arrow-right" onPress={() => onNavigate("menu")} />
          </Panel>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 30, paddingBottom: 54, maxWidth: 1500, width: "100%", alignSelf: "center" },
  scrollPhone: { padding: 18, paddingBottom: 36 },
  welcome: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 24, marginBottom: 28 },
  welcomePhone: { flexDirection: "column", alignItems: "stretch", marginBottom: 22 },
  welcomeCopy: { flex: 1, maxWidth: 760 },
  date: { color: colors.pinkDark, fontSize: 12, lineHeight: 16, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 9 },
  heading: { color: colors.ink, fontSize: 36, lineHeight: 42, fontWeight: "800", letterSpacing: -1.1 },
  headingPhone: { fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  subheading: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, marginTop: 7, maxWidth: 620 },
  signalBoard: { minHeight: 138, flexDirection: "row", backgroundColor: colors.night, borderRadius: 16, marginBottom: 24, overflow: "hidden" },
  signalBoardPhone: { flexWrap: "wrap", paddingVertical: 6 },
  signal: { flex: 1, minWidth: 170, flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 20, paddingVertical: 20 },
  signalPhone: { flexBasis: "50%", minWidth: "50%", paddingHorizontal: 14, paddingVertical: 13 },
  signalDivider: { borderLeftWidth: 1, borderLeftColor: colors.nightBorder },
  signalIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  signalValueWrap: { flex: 1 },
  signalValue: { color: colors.white, fontSize: 25, lineHeight: 29, fontWeight: "800", letterSpacing: -0.5 },
  signalLabel: { color: colors.white, fontSize: 12, lineHeight: 16, fontWeight: "700", marginTop: 2 },
  signalDetail: { color: "#CDAFBB", fontSize: 10, lineHeight: 14, marginTop: 2 },
  workGrid: { flexDirection: "row", alignItems: "flex-start", gap: 22 },
  workGridNarrow: { flexDirection: "column" },
  ordersPanel: { flex: 1, width: "100%" },
  sideColumn: { width: 365, maxWidth: "100%", gap: 18 },
  panelHeader: { padding: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  panelHeaderCompact: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 19 },
  panelTitle: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: "800" },
  panelSubtitle: { color: colors.inkMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  linkButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6 },
  linkText: { color: colors.pinkDark, fontSize: 13, lineHeight: 17, fontWeight: "800" },
  orderRow: { minHeight: 75, flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  orderId: { width: 54 },
  orderIdText: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "800" },
  orderCopy: { flex: 1, minWidth: 0 },
  orderGuest: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: "700" },
  orderItems: { color: colors.inkMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  pressed: { opacity: 0.68 },
  eventTimeRow: { flexDirection: "row", marginVertical: 6 },
  eventTimeBlock: { flex: 1 },
  eventTime: { color: colors.ink, fontSize: 23, lineHeight: 28, fontWeight: "800", letterSpacing: -0.4 },
  eventTimeLabel: { color: colors.inkMuted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 18 },
  shiftRow: { flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 18 },
  avatarStack: { flexDirection: "row" },
  miniAvatar: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.white },
  miniAvatarText: { color: colors.ink, fontSize: 9, fontWeight: "900" },
  shiftCopy: { flex: 1, color: colors.inkMuted, fontSize: 12, lineHeight: 17 },
  attentionPanel: { backgroundColor: "#FFF4EF" },
  attentionTop: { flexDirection: "row", alignItems: "center", gap: 9 },
  attentionTitle: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "800" },
  attentionCopy: { color: colors.inkMuted, fontSize: 13, lineHeight: 19, marginTop: 9, marginBottom: 5 },
});
