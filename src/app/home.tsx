import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Badge, Button, EmptyState, Panel } from "@/components/ui";
import { useHomeSummary } from "@/home/useHomeSummary";
import type { HomeSummary } from "@/home/summary";
import { AppShell } from "@/shell/AppShell";
import { useBreakpoint } from "@/shell/breakpoint";
import { colors } from "@/theme/colors";
import type { IconName } from "@/types/domain";
import { useVenue } from "@/venue/VenueContext";

/** QA/admin persona sees every quick action (HOME-03). */
const ADMIN_PERMISSIONS = ["posts", "media", "events", "store", "invites", "moderation", "settings"];

function formatWait(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function formatStartTime(startsAt: number): string {
  const date = new Date(startsAt * 1000);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** "Tonight" only when the start lands on the current local calendar day. */
function eventDayLabel(startsAt: number, happeningNow: boolean): string {
  if (happeningNow) return "Happening now";
  const start = new Date(startsAt * 1000);
  const today = new Date();
  const sameDay =
    start.getFullYear() === today.getFullYear() &&
    start.getMonth() === today.getMonth() &&
    start.getDate() === today.getDate();
  return sameDay ? "Tonight" : "Upcoming";
}

function SummaryCard({
  testID,
  icon,
  title,
  onPress,
  children,
  wide,
}: {
  testID: string;
  icon: IconName;
  title: string;
  onPress?: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.card, wide && styles.cardWide, pressed && styles.pressed]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardIconTile}>
          <MaterialCommunityIcons name={icon} size={22} color={colors.pink} />
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
        {onPress ? (
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.inkFaint} />
        ) : null}
      </View>
      {children}
    </Pressable>
  );
}

function HomeSummaryView({ summary, permissions }: { summary: HomeSummary; permissions: string[] }) {
  const router = useRouter();
  const breakpoint = useBreakpoint();
  const phone = breakpoint === "phone";
  const { orders, members, nextEvent, unavailableMenuCount } = summary;

  const quickActions: { testID: string; label: string; icon: IconName; permission: string; href: string }[] = [
    { testID: "home-action-menu", label: "Add menu item", icon: "silverware-fork-knife", permission: "store", href: "/menu" },
    { testID: "home-action-event", label: "Create event", icon: "calendar-plus-outline", permission: "events", href: "/events" },
    { testID: "home-action-invite", label: "Create invite", icon: "ticket-confirmation-outline", permission: "invites", href: "/invites" },
    { testID: "home-action-role", label: "Assign staff role", icon: "account-plus-outline", permission: "settings", href: "/settings" },
  ];
  const allowedActions = quickActions.filter((action) => permissions.includes(action.permission));

  // HOME-02: a brand-new venue gets a guided checklist, not zero-filled
  // analytics. Done flags come from relay truth only.
  if (summary.isNewVenue) {
    const items: { testID: string; label: string; done: boolean; href: string }[] = [
      { testID: "home-checklist-menu", label: "Add your first menu item", done: summary.checklist.menuDone, href: "/menu" },
      { testID: "home-checklist-event", label: "Create your first event", done: summary.checklist.eventsDone, href: "/events" },
      { testID: "home-checklist-members", label: "Add members", done: summary.checklist.membersDone, href: "/people" },
    ];
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, !phone && styles.contentTablet]}>
        <Panel testID="home-setup-checklist" style={styles.checklist}>
          <Text style={styles.checklistTitle}>Set up your venue</Text>
          <Text style={styles.checklistBody}>
            This venue is new. Finish these steps to open for service — payments and room setup live in
            Settings.
          </Text>
          {items.map((item) => (
            <Pressable
              key={item.testID}
              testID={item.testID}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              onPress={() => router.push(item.href as never)}
              style={({ pressed }) => [styles.checklistRow, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons
                name={item.done ? "check-circle-outline" : "circle-outline"}
                size={22}
                color={item.done ? colors.success : colors.inkFaint}
              />
              <Text style={styles.checklistLabel}>{item.label}</Text>
              {item.done ? <Badge label="Done" tone="success" /> : null}
            </Pressable>
          ))}
          <Button
            testID="home-checklist-settings"
            label="Open settings"
            tone="secondary"
            onPress={() => router.push("/settings" as never)}
          />
        </Panel>
      </ScrollView>
    );
  }

  const stageLine = `New ${orders.byStage.pending} · Accepted ${orders.byStage.accepted} · Preparing ${orders.byStage.processing} · Ready ${orders.byStage.ready}`;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, !phone && styles.contentTablet]}>
      <SummaryCard
        testID="home-orders-card"
        icon="receipt-text-outline"
        title="Orders"
        wide
        onPress={() => router.push("/orders")}
      >
        <Text style={styles.cardValue}>
          {orders.open === 0 ? "No open orders" : plural(orders.open, "open order", "open orders")}
        </Text>
        <Text style={styles.cardMeta}>{stageLine}</Text>
        {orders.open > 0 ? (
          <Text style={styles.cardMeta}>Oldest wait {formatWait(orders.oldestWaitSeconds)}</Text>
        ) : null}
      </SummaryCard>

      {nextEvent ? (
        <SummaryCard
          testID="home-event-card"
          icon="calendar-blank-outline"
          title={eventDayLabel(nextEvent.startsAt, nextEvent.happeningNow)}
          onPress={() => router.push("/events" as never)}
        >
          <Text style={styles.cardValue} numberOfLines={2}>
            {nextEvent.title ?? "Untitled event"}
          </Text>
          <Text style={styles.cardMeta}>Starts {formatStartTime(nextEvent.startsAt)}</Text>
          <View style={styles.cardAction}>
            <Button
              testID="home-checkin-button"
              label="Check in"
              compact
              onPress={() => router.push("/events" as never)}
            />
          </View>
        </SummaryCard>
      ) : null}

      <SummaryCard
        testID="home-menu-card"
        icon="silverware-fork-knife"
        title="Menu"
        onPress={() => router.push("/menu" as never)}
      >
        <Text style={[styles.cardValue, unavailableMenuCount > 0 && styles.attentionValue]}>
          {unavailableMenuCount === 0
            ? "Menu fully available"
            : plural(unavailableMenuCount, "item unavailable", "items unavailable")}
        </Text>
        {unavailableMenuCount > 0 ? (
          <Text style={styles.cardMeta}>Guests cannot order unavailable items.</Text>
        ) : null}
      </SummaryCard>

      <SummaryCard
        testID="home-members-card"
        icon="account-group-outline"
        title="Members"
        onPress={() => router.push("/people" as never)}
      >
        <Text style={styles.cardValue}>
          {members.active === 0 ? "No active members" : plural(members.active, "active member", "active members")}
        </Text>
        {members.expiringSoon > 0 ? (
          <Text style={styles.cardMeta}>{plural(members.expiringSoon, "expiring soon", "expiring soon")}</Text>
        ) : null}
      </SummaryCard>

      {allowedActions.length > 0 ? (
        <View style={styles.quickActions}>
          {allowedActions.map((action) => (
            <Button
              key={action.testID}
              testID={action.testID}
              label={action.label}
              icon={action.icon}
              tone="secondary"
              onPress={() => router.push(action.href as never)}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function HomeSubscription({ permissions, onRetry }: { permissions: string[]; onRetry: () => void }) {
  const { status, live, summary, error } = useHomeSummary();
  const { venue } = useVenue();

  if (status === "error") {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="lan-disconnect"
          title="This venue is offline"
          description={error ?? "The venue relay or service did not answer. Cached values are not shown as live."}
          action={<Button label="Try again" tone="secondary" onPress={onRetry} />}
        />
      </View>
    );
  }

  if (status === "loading" || !summary) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Connecting to the venue relay…</Text>
      </View>
    );
  }

  const host = venue?.relayUrl.replace(/^wss?:\/\//, "") ?? "";
  return (
    <View style={styles.ready}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text testID="home-venue-name" style={styles.venueName} numberOfLines={1}>
            {summary.venueName ?? host}
          </Text>
          <Text style={styles.headerMeta}>{host}</Text>
        </View>
        <Badge label={live ? "Live" : "Offline"} tone={live ? "success" : "warning"} />
      </View>
      <HomeSummaryView summary={summary} permissions={permissions} />
    </View>
  );
}

export default function HomeRoute() {
  const router = useRouter();
  const { venue, restoring } = useVenue();
  const [retryKey, setRetryKey] = useState(0);

  return (
    <View testID="home-screen" style={styles.screen}>
      <AppShell active="home" permissions={ADMIN_PERMISSIONS}>
        {restoring ? (
          <View style={styles.center}>
            <Text style={styles.loadingText}>Restoring the venue…</Text>
          </View>
        ) : !venue ? (
          <View style={styles.center}>
            <EmptyState
              icon="store-off-outline"
              title="No venue selected"
              description="Select a venue to see what needs attention."
              action={<Button label="Back to welcome" tone="secondary" onPress={() => router.replace("/")} />}
            />
          </View>
        ) : (
          <HomeSubscription
            key={retryKey}
            permissions={ADMIN_PERMISSIONS}
            onRetry={() => setRetryKey((key) => key + 1)}
          />
        )}
      </AppShell>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  ready: { flex: 1 },
  center: { flex: 1, justifyContent: "center" },
  loadingText: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, textAlign: "center" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 12,
  },
  headerCopy: { flex: 1, gap: 2 },
  venueName: { color: colors.ink, fontSize: 24, lineHeight: 30, fontWeight: "800", letterSpacing: -0.4 },
  headerMeta: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  scroll: { flex: 1 },
  content: { padding: 20, gap: 14, paddingBottom: 32 },
  contentTablet: { maxWidth: 980, width: "100%", alignSelf: "center", flexDirection: "row", flexWrap: "wrap" },
  card: {
    flexGrow: 1,
    flexBasis: 300,
    minHeight: 48,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 20,
    gap: 8,
  },
  cardWide: { flexBasis: "100%" },
  pressed: { opacity: 0.78 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardIconTile: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.pinkSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { flex: 1, color: colors.inkMuted, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  cardValue: { color: colors.ink, fontSize: 19, lineHeight: 24, fontWeight: "800" },
  attentionValue: { color: colors.warning },
  cardMeta: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  cardAction: { marginTop: 6, alignItems: "flex-start" },
  quickActions: { flexBasis: "100%", flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 4 },
  checklist: { gap: 12, flexBasis: "100%" },
  checklistTitle: { color: colors.ink, fontSize: 22, lineHeight: 28, fontWeight: "800" },
  checklistBody: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  checklistRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  checklistLabel: { flex: 1, color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "700" },
});
