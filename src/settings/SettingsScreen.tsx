import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { Button, EmptyState, ScreenTitle } from "@/components/ui";
import { AppShell } from "@/shell/AppShell";
import { colors } from "@/theme/colors";
import { useVenue } from "@/venue/VenueContext";

import { MembershipsSection } from "./MembershipsSection";
import { PaymentsSection } from "./PaymentsSection";
import { ProfileSection } from "./ProfileSection";
import { RoomSection } from "./RoomSection";
import { useSettingsData } from "./useSettingsData";

/** Owner/admin persona: the full permission set (PRD §9). */
export const ADMIN_PERMISSIONS = ["posts", "media", "events", "store", "invites", "moderation", "settings"];

export type SettingsSection = "profile" | "memberships" | "payments" | "room";

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "memberships", label: "Memberships" },
  { id: "payments", label: "Payments" },
  { id: "room", label: "Room" },
];

const SECTION_DESCRIPTION: Record<SettingsSection, string> = {
  profile: "How this venue appears to guests.",
  memberships: "One-time, monthly, and yearly ways to support the venue.",
  payments: "Payout connection truth for this venue.",
  room: "Room manifest, relay reachability, and gateway hardware.",
};

/**
 * Settings hub (SETTINGS-01): four sub-destinations with independent
 * loading/empty/error truth, wrapped in the app shell. Sub-navigation switches
 * sections in place so the venue subscription survives; the sub-routes
 * (src/app/settings/*) deep-link into the same screen with a preselected
 * section.
 */
export function SettingsScreen({ initialSection = "profile" }: { initialSection?: SettingsSection }) {
  const router = useRouter();
  const { venue, restoring } = useVenue();
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const data = useSettingsData();

  const loaded = data.status === "ready";

  return (
    <View testID="settings-screen" style={styles.root}>
      <AppShell active="settings" permissions={ADMIN_PERMISSIONS}>
        <View style={styles.container}>
          <ScreenTitle title="Venue settings" description="Identity, memberships, payments, and room for this venue." />
          <View style={styles.navRow}>
            {SECTIONS.map((item) => {
              const active = item.id === section;
              return (
                <Pressable
                  key={item.id}
                  testID={`settings-nav-${item.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setSection(item.id)}
                  style={[styles.navItem, active && styles.navItemActive]}
                >
                  <Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {restoring ? (
            <Text style={styles.loading}>Restoring the venue…</Text>
          ) : !venue ? (
            <EmptyState
              icon="store-off-outline"
              title="No venue selected"
              description="Select a venue before changing its settings."
              action={<Button label="Back to welcome" tone="secondary" onPress={() => router.replace("/")} />}
            />
          ) : data.status === "error" ? (
            <EmptyState
              icon="lan-disconnect"
              title="Cannot reach this venue"
              description={data.error ?? "The venue relay did not answer."}
            />
          ) : (
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
              <Text style={styles.sectionDescription}>{SECTION_DESCRIPTION[section]}</Text>
              {section === "profile" ? <ProfileSection profile={data.profile} loaded={loaded} /> : null}
              {section === "memberships" ? (
                <MembershipsSection memberships={data.memberships} loaded={loaded} />
              ) : null}
              {section === "payments" ? <PaymentsSection /> : null}
              {section === "room" ? (
                <RoomSection room={data.room} loaded={loaded} relayReachable={data.relayReachable} now={data.now} />
              ) : null}
            </ScrollView>
          )}
        </View>
      </AppShell>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    maxWidth: 860,
    width: "100%",
    alignSelf: "center",
  },
  navRow: { flexDirection: "row", gap: 4, marginBottom: 18 },
  navItem: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  navItemActive: { backgroundColor: colors.pinkSoft },
  navLabel: { color: colors.inkMuted, fontSize: 14, fontWeight: "600" },
  navLabelActive: { color: colors.pinkDark, fontWeight: "800" },
  loading: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, paddingVertical: 24 },
  scroll: { flex: 1 },
  scrollContent: { gap: 16, paddingBottom: 40 },
  sectionDescription: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
});
