import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { Badge, Button, EmptyState, Panel, ScreenTitle } from "@/components/ui";
import { AppShell } from "@/shell/AppShell";
import { formatSchedule, localTimezoneName } from "@/events/draft";
import { filterEvents, type BoardEvent, type EventTab } from "@/events/fold";
import { useEvents } from "@/events/useEvents";
import { colors } from "@/theme/colors";
import { useVenue } from "@/venue/VenueContext";

/** Owner/admin persona for this slice (matches the QA seed identity). */
const ADMIN_PERMISSIONS = ["posts", "media", "events", "store", "invites", "moderation", "settings"];

const TABS: { id: EventTab; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "all", label: "All" },
];

function EventCard({ event, onOpen }: { event: BoardEvent; onOpen: (event: BoardEvent) => void }) {
  return (
    <Pressable
      testID={`event-card-${event.id.slice(0, 12)}`}
      onPress={() => onOpen(event)}
      accessibilityRole="button"
      accessibilityLabel={`Open event ${event.title}`}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <Panel style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {event.title}
          </Text>
          {event.isPast ? <Badge label="Past" tone="neutral" /> : <Badge label="Published" tone="success" />}
        </View>
        <Text style={styles.cardMeta}>{formatSchedule(event.start, event.end)}</Text>
        <View style={styles.cardMetaRow}>
          <Text style={styles.cardGoing}>{event.rsvps.accepted} going</Text>
          {event.capacity !== undefined ? <Text style={styles.cardMeta}>Capacity {event.capacity}</Text> : null}
        </View>
      </Panel>
    </Pressable>
  );
}

function DetailRow({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text testID={testID} style={styles.detailValue}>
        {value}
      </Text>
    </View>
  );
}

function EventDetailPanel({ event, onClose }: { event: BoardEvent; onClose: () => void }) {
  const router = useRouter();
  return (
    <Panel testID="event-detail-panel" style={styles.detail}>
      <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
        <View style={styles.cardHeader}>
          <Text style={styles.detailTitle}>{event.title}</Text>
          <View style={styles.detailActions}>
            <Button
              testID="event-checkin-button"
              label="Open check-in"
              compact
              onPress={() => router.push("/check-in" as never)}
            />
            <Button testID="event-detail-close" label="Close" tone="quiet" compact onPress={onClose} />
          </View>
        </View>
        {event.summary ? <Text style={styles.detailSummary}>{event.summary}</Text> : null}
        <DetailRow label="Schedule" value={formatSchedule(event.start, event.end)} testID="event-detail-schedule" />
        <DetailRow label="Timezone" value={localTimezoneName()} />
        <DetailRow label="Location" value={event.location ?? "No location set"} />
        <DetailRow
          label="Capacity"
          value={event.capacity !== undefined ? String(event.capacity) : "Unlimited"}
          testID="event-detail-capacity"
        />
        <DetailRow label="Accepted" value={String(event.rsvps.accepted)} testID="event-detail-rsvp-accepted" />
        <DetailRow label="Tentative" value={String(event.rsvps.tentative)} testID="event-detail-rsvp-tentative" />
        <DetailRow label="Declined" value={String(event.rsvps.declined)} testID="event-detail-rsvp-declined" />
        <DetailRow label="Admission" value="Open & free" />
      </ScrollView>
    </Panel>
  );
}

function EventsSubscription({ onRetry }: { onRetry: () => void }) {
  const { status, events, error } = useEvents();
  const [tab, setTab] = useState<EventTab>("upcoming");
  const [search, setSearch] = useState("");
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);

  const visible = useMemo(() => filterEvents(events, tab, search), [events, tab, search]);
  const selected = selectedAddress ? (events.find((event) => event.address === selectedAddress) ?? null) : null;

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
    <View style={styles.body}>
      <View style={styles.controls}>
        <View style={styles.tabs}>
          {TABS.map((entry) => {
            const isActive = entry.id === tab;
            return (
              <Pressable
                key={entry.id}
                testID={`events-tab-${entry.id}`}
                onPress={() => setTab(entry.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                style={[styles.tab, isActive && styles.tabActive]}
              >
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{entry.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          testID="events-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search events"
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel="Search events"
          style={styles.search}
        />
      </View>
      {selected ? <EventDetailPanel event={selected} onClose={() => setSelectedAddress(null)} /> : null}
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={visible}
        keyExtractor={(event) => event.address}
        renderItem={({ item }) => <EventCard event={item} onOpen={(event) => setSelectedAddress(event.address)} />}
        ListEmptyComponent={
          status === "loading" ? (
            <View style={styles.center}>
              <Text style={styles.loadingText}>Connecting to the venue relay…</Text>
            </View>
          ) : (
            <EmptyState
              icon="calendar-blank-outline"
              title={search ? "No events match the search" : "No events here yet"}
              description={search ? "Clear the search or pick another tab." : "Create the first gathering for this venue."}
            />
          )
        }
      />
    </View>
  );
}

export default function EventsRoute() {
  const router = useRouter();
  const { venue, restoring } = useVenue();
  const [retryKey, setRetryKey] = useState(0);

  return (
    <AppShell active="events" permissions={ADMIN_PERMISSIONS}>
      <View testID="events-screen" style={styles.screen}>
        <View style={styles.container}>
          <ScreenTitle
            title="Events"
            description={venue ? `Live from ${venue.relayUrl.replace(/^wss?:\/\//, "")}` : "No venue selected"}
            action={
              venue ? (
                <Button
                  testID="event-create-button"
                  label="Create"
                  icon="plus"
                  compact
                  onPress={() => router.push("/events/create" as never)}
                />
              ) : undefined
            }
          />
          {restoring ? (
            <View style={styles.center}>
              <Text style={styles.loadingText}>Restoring the venue…</Text>
            </View>
          ) : !venue ? (
            <EmptyState
              icon="store-off-outline"
              title="No venue selected"
              description="Select a venue before planning events."
              action={<Button label="Back to welcome" tone="secondary" onPress={() => router.replace("/")} />}
            />
          ) : (
            <EventsSubscription key={retryKey} onRetry={() => setRetryKey((key) => key + 1)} />
          )}
        </View>
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, padding: 24, maxWidth: 860, width: "100%", alignSelf: "center" },
  body: { flex: 1, gap: 16 },
  controls: { gap: 12 },
  tabs: { flexDirection: "row", gap: 8 },
  tab: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.surfaceWarm,
  },
  tabActive: { backgroundColor: colors.pinkSoft },
  tabLabel: { color: colors.inkMuted, fontSize: 14, fontWeight: "700" },
  tabLabelActive: { color: colors.pinkDark },
  search: {
    minHeight: 48,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    paddingHorizontal: 15,
    color: colors.ink,
    fontSize: 15,
  },
  list: { flex: 1 },
  listContent: { gap: 14, paddingBottom: 32, flexGrow: 1 },
  pressed: { opacity: 0.78 },
  card: { gap: 8 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  cardTitle: { flex: 1, color: colors.ink, fontSize: 18, lineHeight: 24, fontWeight: "800" },
  cardMeta: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  cardMetaRow: { flexDirection: "row", justifyContent: "space-between", gap: 14 },
  cardGoing: { color: colors.ink, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  detail: { maxHeight: 560 },
  detailScroll: { flexGrow: 0 },
  detailContent: { gap: 10 },
  detailTitle: { flex: 1, color: colors.ink, fontSize: 20, lineHeight: 26, fontWeight: "800" },
  detailSummary: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  detailRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailLabel: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  detailValue: { color: colors.ink, fontSize: 14, lineHeight: 20, flexShrink: 1, textAlign: "right" },
  detailActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  center: { flex: 1, justifyContent: "center" },
  loadingText: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, textAlign: "center" },
});
