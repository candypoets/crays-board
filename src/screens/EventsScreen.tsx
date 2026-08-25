import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Badge, Button, EmptyState, Field, Panel, ScreenTitle } from "@/components/ui";
import { colors } from "@/theme/colors";
import type { VenueEvent } from "@/types/domain";

export function EventsScreen({ width, events, onEventsChange }: { width: number; events: VenueEvent[]; onEventsChange: (events: VenueEvent[]) => void }) {
  const phone = width < 600;
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");

  return (
    <ScrollView contentContainerStyle={[styles.scroll, phone && styles.scrollPhone]} showsVerticalScrollIndicator={false}>
      <ScreenTitle
        title="Events"
        description="Plan gatherings, publish them to the community, and keep attendance visible."
        action={<Button label={phone ? "New" : "Create event"} icon="plus" onPress={() => setCreating(true)} />}
      />

      {creating ? (
        <Panel style={styles.composer}>
          <View style={styles.composerHeader}>
            <View><Text style={styles.composerTitle}>New community event</Text><Text style={styles.composerCopy}>Start with the essentials. You can publish when the details are ready.</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close composer" onPress={() => setCreating(false)} style={styles.closeButton}><MaterialCommunityIcons name="close" size={22} color={colors.ink} /></Pressable>
          </View>
          <View style={[styles.composerGrid, phone && styles.composerGridPhone]}>
            <View style={styles.titleField}><Field label="Event title" value={title} onChangeText={setTitle} placeholder="e.g. Sunday listening room" /></View>
            <Field label="Date" placeholder="DD / MM / YYYY" />
            <Field label="Start time" placeholder="19:30" />
          </View>
          <View style={styles.composerActions}><Button label="Save draft" disabled={!title} onPress={() => {
            onEventsChange([...events, { id: `e${Date.now()}`, title, date: "Date pending", time: "—", status: "draft", attendance: "Not published" }]);
            setTitle(""); setCreating(false);
          }} /></View>
        </Panel>
      ) : null}

      <View style={[styles.featured, phone && styles.featuredPhone]}>
        <View style={styles.featuredDate}><Text style={styles.featuredDay}>03</Text><Text style={styles.featuredMonth}>AUG</Text></View>
        <View style={styles.featuredCopy}>
          <View style={styles.featuredBadges}><Badge label="Tonight" tone="pink" /><Badge label="Sold out" tone="warning" /></View>
          <Text style={styles.featuredTitle}>Soft opening supper</Text>
          <Text style={styles.featuredDescription}>Doors at 19:30 · 48 guests · 5 team members</Text>
        </View>
        <View style={styles.featuredActions}><Button label="Guest list" tone="secondary" compact /><Button label="Open run sheet" compact /></View>
      </View>

      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Upcoming</Text><Text style={styles.sectionCount}>{events.length} events</Text></View>
      <Panel padded={false}>
        {events.length ? events.map((event) => (
          <Pressable key={event.id} accessibilityRole="button" style={[styles.eventRow, phone && styles.eventRowPhone]}>
            <View style={styles.eventDateBlock}><Text style={styles.eventDate}>{event.date}</Text><Text style={styles.eventTime}>{event.time}</Text></View>
            <View style={styles.eventCopy}>
              <Text style={styles.eventTitle}>{event.title}</Text>
              <Text style={styles.eventAttendance}>{event.attendance}</Text>
            </View>
            <Badge label={event.status === "sold-out" ? "Sold out" : event.status === "published" ? "Published" : "Draft"} tone={event.status === "sold-out" ? "warning" : event.status === "published" ? "success" : "neutral"} />
            {!phone ? <MaterialCommunityIcons name="chevron-right" size={22} color={colors.inkFaint} /> : null}
          </Pressable>
        )) : <EmptyState icon="calendar-plus" title="Plan your first gathering" description="Events give your community a time and place to meet." action={<Button label="Create event" onPress={() => setCreating(true)} />} />}
      </Panel>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 30, paddingBottom: 54, maxWidth: 1260, width: "100%", alignSelf: "center" },
  scrollPhone: { padding: 18, paddingBottom: 36 },
  composer: { marginBottom: 20, backgroundColor: colors.surfaceWarm },
  composerHeader: { flexDirection: "row", justifyContent: "space-between", gap: 16, marginBottom: 19 },
  composerTitle: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: "800" },
  composerCopy: { color: colors.inkMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  closeButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  composerGrid: { flexDirection: "row", gap: 14 },
  composerGridPhone: { flexDirection: "column" },
  titleField: { flex: 1 },
  composerActions: { flexDirection: "row", justifyContent: "flex-end", marginTop: 18 },
  featured: { minHeight: 176, backgroundColor: colors.night, borderRadius: 16, padding: 22, flexDirection: "row", alignItems: "center", gap: 22, marginBottom: 29 },
  featuredPhone: { flexDirection: "column", alignItems: "stretch", gap: 15 },
  featuredDate: { width: 86, height: 108, borderRadius: 15, backgroundColor: colors.pink, alignItems: "center", justifyContent: "center" },
  featuredDay: { color: colors.white, fontSize: 38, lineHeight: 40, fontWeight: "900", letterSpacing: -1 },
  featuredMonth: { color: colors.white, fontSize: 11, lineHeight: 15, fontWeight: "900", letterSpacing: 1, marginTop: 4 },
  featuredCopy: { flex: 1 },
  featuredBadges: { flexDirection: "row", gap: 7, marginBottom: 11 },
  featuredTitle: { color: colors.white, fontSize: 24, lineHeight: 29, fontWeight: "800", letterSpacing: -0.4 },
  featuredDescription: { color: "#CDAFBB", fontSize: 13, lineHeight: 18, marginTop: 6 },
  featuredActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 11 },
  sectionTitle: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: "800" },
  sectionCount: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  eventRow: { minHeight: 87, paddingHorizontal: 18, paddingVertical: 13, flexDirection: "row", alignItems: "center", gap: 17, borderBottomWidth: 1, borderBottomColor: colors.border },
  eventRowPhone: { gap: 12, paddingHorizontal: 14 },
  eventDateBlock: { width: 84 },
  eventDate: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "800" },
  eventTime: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, marginTop: 3 },
  eventCopy: { flex: 1, minWidth: 0 },
  eventTitle: { color: colors.ink, fontSize: 14, lineHeight: 19, fontWeight: "700" },
  eventAttendance: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, marginTop: 3 },
  pressed: { opacity: 0.68 },
});
