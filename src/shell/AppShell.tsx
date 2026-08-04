import type { PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { colors } from "@/theme/colors";
import { useVenue } from "@/venue/VenueContext";
import { breakpointForWidth, useBreakpoint } from "./breakpoint";
import {
  DESTINATIONS,
  PHONE_TABS,
  visibleDestinations,
  type Destination,
} from "./destinations";

export type ShellActive = Destination | "more";

export type AppShellProps = PropsWithChildren<{
  active: ShellActive;
  /** Active persona permissions; owner/admin passes the full set. */
  permissions: string[];
}>;

function VenueChip({ compact }: { compact: boolean }) {
  const { venue } = useVenue();
  const router = useRouter();
  const host = venue?.relayUrl.replace(/^wss?:\/\//, "") ?? "No venue";
  return (
    <Pressable
      testID="venue-chip"
      onPress={() => router.push("/venue-selection" as never)}
      style={({ pressed }) => [styles.venueChip, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Selected venue ${host}. Switch venue`}
    >
      <View style={styles.venueDot} />
      {!compact && (
        <Text style={styles.venueChipText} numberOfLines={1}>
          {host}
        </Text>
      )}
    </Pressable>
  );
}

/** Adaptive app chrome per PRD §6: tablet rail, compact rail, phone tabs. */
export function AppShell({ active, permissions, children }: AppShellProps) {
  const breakpoint = useBreakpoint();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const visible = visibleDestinations(permissions);

  if (breakpoint === "phone") {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.phoneHeader}>
          <VenueChip compact={false} />
        </View>
        <View style={styles.content}>{children}</View>
        <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          {PHONE_TABS.map((tab) => {
            const isActive = tab.id === active;
            return (
              <Pressable
                key={tab.id}
                testID={`tab-${tab.id}`}
                onPress={() => router.push(tab.href as never)}
                style={({ pressed }) => [
                  styles.tab,
                  isActive && styles.tabActive,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  const narrow = breakpoint === "compact";
  return (
    <View style={[styles.root, styles.row, { paddingTop: insets.top }]}>
      <View
        style={[styles.rail, narrow && styles.railNarrow, { paddingBottom: insets.bottom }]}
        testID="nav-rail"
      >
        <VenueChip compact={narrow} />
        <View style={styles.railItems}>
          {DESTINATIONS.filter((d) => visible.includes(d.id)).map((d) => {
            const isActive = d.id === active;
            return (
              <Pressable
                key={d.id}
                testID={`nav-${d.id}`}
                onPress={() => router.push(d.href as never)}
                style={({ pressed }) => [
                  styles.railItem,
                  isActive && styles.railItemActive,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <Text
                  style={[styles.railLabel, isActive && styles.railLabelActive]}
                  numberOfLines={1}
                >
                  {narrow ? d.label.slice(0, 1) : d.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

export { breakpointForWidth, visibleDestinations };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  row: { flexDirection: "row" },
  content: { flex: 1 },
  pressed: { opacity: 0.7 },
  venueChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    margin: 8,
    borderRadius: 12,
    backgroundColor: colors.nightRaised,
  },
  venueDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  venueChipText: { color: colors.paper, fontSize: 13, flexShrink: 1 },
  rail: {
    width: 232,
    backgroundColor: colors.night,
    paddingVertical: 8,
  },
  railNarrow: { width: 88 },
  railItems: { marginTop: 8 },
  railItem: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 20,
    marginHorizontal: 8,
    borderRadius: 10,
  },
  railItemActive: { backgroundColor: colors.pink },
  railLabel: { color: colors.pinkSoft, fontSize: 15 },
  railLabelActive: { color: colors.paper, fontWeight: "600" },
  phoneHeader: {
    backgroundColor: colors.night,
    paddingVertical: 4,
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.night,
  },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  tabActive: { backgroundColor: colors.nightRaised },
  tabLabel: { color: colors.pinkSoft, fontSize: 12 },
  tabLabelActive: { color: colors.pink, fontWeight: "600" },
});
