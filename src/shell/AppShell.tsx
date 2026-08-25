import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { BrandMark } from "@/components/BrandMark";
import { colors } from "@/theme/colors";
import type { IconName } from "@/types/domain";
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

const DESTINATION_ICONS: Record<ShellActive, IconName> = {
  home: "view-dashboard-outline",
  orders: "receipt-text-outline",
  menu: "silverware-fork-knife",
  events: "calendar-blank-outline",
  people: "account-group-outline",
  invites: "ticket-confirmation-outline",
  settings: "cog-outline",
  more: "dots-horizontal-circle-outline",
};

function VenueChip({ compact }: { compact: boolean }) {
  const { venue } = useVenue();
  const router = useRouter();
  const connected = Boolean(venue);
  return (
    <Pressable
      testID="venue-chip"
      onPress={() => router.push("/venue-selection" as never)}
      style={styles.venueChip}
      accessibilityRole="button"
      accessibilityLabel={`${connected ? "Connected venue" : "No venue selected"}. Switch venue`}
    >
      <View style={[styles.venueMark, compact && styles.venueMarkCompact]}>
        <BrandMark size={compact ? 24 : 26} color={colors.coral} />
      </View>
      {!compact && (
        <View style={styles.venueCopy}>
          <Text style={styles.venueChipText} numberOfLines={1}>Crays venue</Text>
          <View style={styles.venueStatusRow}>
            <View style={[styles.venueDot, !connected && styles.venueDotOffline]} />
            <Text style={styles.venueStatus}>{connected ? "Connected" : "Select venue"}</Text>
          </View>
        </View>
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
                onPress={() => router.replace(tab.href as never)}
                style={[
                  styles.tab,
                  isActive && styles.tabActive,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <MaterialCommunityIcons
                  name={DESTINATION_ICONS[tab.id as ShellActive]}
                  size={22}
                  color={isActive ? colors.pink : colors.inkMuted}
                />
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
                onPress={() => router.replace(d.href as never)}
                style={[
                  styles.railItem,
                  isActive && styles.railItemActive,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <MaterialCommunityIcons
                  name={DESTINATION_ICONS[d.id]}
                  size={22}
                  color={isActive ? colors.white : colors.pinkSoft}
                />
                <Text
                  style={[styles.railLabel, isActive && styles.railLabelActive]}
                  numberOfLines={1}
                >
                  {!narrow ? d.label : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.stage}>
        <View style={styles.contextBar}>
          <View style={styles.contextStatus}>
            <View style={styles.contextDot} />
            <Text style={styles.contextStatusText}>Venue online</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Venue and account menu" style={styles.accountButton}>
            <MaterialCommunityIcons name="account-outline" size={21} color={colors.ink} />
          </Pressable>
        </View>
        <View style={[styles.content, { paddingBottom: insets.bottom }]}>{children}</View>
      </View>
    </View>
  );
}

export { breakpointForWidth, visibleDestinations };

const styles = StyleSheet.create({
  // The app-level StatusBar uses light icons. Keep the top safe-area surface
  // dark on every window class so system time/network/battery remain legible.
  root: { flex: 1, backgroundColor: colors.night },
  row: { flexDirection: "row" },
  content: { flex: 1, minWidth: 0, backgroundColor: colors.paper },
  stage: { flex: 1, minWidth: 0, backgroundColor: colors.paper },
  pressed: { opacity: 0.7 },
  venueChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 10,
    marginHorizontal: 8,
    marginVertical: 6,
    borderRadius: 14,
    backgroundColor: colors.nightRaised,
    borderWidth: 1,
    borderColor: colors.nightBorder,
  },
  venueMark: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  venueMarkCompact: { width: 32, height: 32 },
  venueCopy: { flex: 1, minWidth: 0, gap: 2 },
  venueStatusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  venueDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  venueDotOffline: { backgroundColor: colors.inkFaint },
  venueChipText: { color: colors.paper, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  venueStatus: { color: colors.pinkSoft, fontSize: 11, lineHeight: 14 },
  rail: {
    width: 232,
    backgroundColor: colors.night,
    paddingVertical: 8,
  },
  railNarrow: { width: 88 },
  railItems: { marginTop: 8, gap: 4 },
  railItem: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 20,
    marginHorizontal: 8,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  railItemActive: { backgroundColor: colors.pink },
  railLabel: { color: colors.pinkSoft, fontSize: 15 },
  railLabelActive: { color: colors.paper, fontWeight: "600" },
  phoneHeader: {
    backgroundColor: colors.night,
    minHeight: 64,
    justifyContent: "center",
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 5,
    paddingHorizontal: 4,
  },
  tab: {
    flexBasis: "20%",
    flexGrow: 0,
    flexShrink: 0,
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderRadius: 12,
  },
  tabActive: { backgroundColor: colors.pinkSoft },
  tabLabel: { color: colors.inkMuted, fontSize: 10, lineHeight: 13, fontWeight: "700" },
  tabLabelActive: { color: colors.pinkDark, fontWeight: "800" },
  contextBar: {
    minHeight: 64,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.paper,
  },
  contextStatus: { flexDirection: "row", alignItems: "center", gap: 8 },
  contextDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  contextStatusText: { color: colors.inkMuted, fontSize: 13, lineHeight: 17, fontWeight: "600" },
  accountButton: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
