import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { clearStaffIdentity } from "@/account/account";
import { ScreenTitle } from "@/components/ui";
import { AppShell } from "@/shell/AppShell";
import { visibleDestinations } from "@/shell/destinations";
import { colors } from "@/theme/colors";
import type { IconName } from "@/types/domain";
import { useVenue } from "@/venue/VenueContext";

/** Current slice runs the admin persona; QA personas pass narrower sets later. */
const ADMIN_PERMISSIONS = ["store", "events", "moderation", "invites", "settings"];

type MoreRow = {
  id: string;
  label: string;
  hint: string;
  icon: IconName;
  onPress: () => void;
};

/**
 * Phone More destination (PRD §6, SHELL-02): the compact replacement for the
 * rail's secondary destinations plus venue/account actions. Destination rows
 * are permission-filtered — a missing permission removes the row entirely.
 */
export default function MoreRoute() {
  const router = useRouter();
  const { setVenue } = useVenue();
  const [switching, setSwitching] = useState(false);
  const visible = visibleDestinations(ADMIN_PERMISSIONS);

  const switchAccount = () => {
    if (switching) return;
    setSwitching(true);
    void (async () => {
      await clearStaffIdentity();
      setVenue(null);
      router.replace("/");
    })().catch(() => setSwitching(false));
  };

  const destinationRows: MoreRow[] = (
    [
      { id: "people", label: "People", hint: "Team access and responsibilities", icon: "account-group-outline" },
      { id: "invites", label: "Invites", hint: "Create and manage join links", icon: "ticket-confirmation-outline" },
      { id: "settings", label: "Settings", hint: "Profile, memberships, payments, and room", icon: "cog-outline" },
    ] as const
  )
    .filter((row) => visible.includes(row.id))
    .map((row) => ({ ...row, onPress: () => router.push(`/${row.id}` as never) }));

  const accountRows: MoreRow[] = [
    {
      id: "switch-venue",
      label: "Switch venue",
      hint: "Move to a different venue",
      icon: "swap-horizontal",
      onPress: () => router.push("/venue-selection" as never),
    },
    {
      id: "switch-account",
      label: switching ? "Switching…" : "Switch account",
      hint: "Change your account",
      icon: "account-outline",
      onPress: switchAccount,
    },
  ];

  const renderRow = (row: MoreRow) => (
    <Pressable
      key={row.id}
      testID={`more-${row.id}`}
      accessibilityRole="button"
      accessibilityLabel={row.label}
      onPress={row.onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.rowIcon}>
        <MaterialCommunityIcons name={row.icon} size={22} color={colors.pink} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel}>{row.label}</Text>
        <Text style={styles.rowHint}>{row.hint}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.inkFaint} />
    </Pressable>
  );

  return (
    <AppShell active="more" permissions={ADMIN_PERMISSIONS}>
      <View testID="more-screen" style={styles.screen}>
        <ScreenTitle title="More" description="Team, access, and venue administration." />
        {destinationRows.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Team & venue</Text>
            {destinationRows.map(renderRow)}
          </View>
        ) : null}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Account & access</Text>
          {accountRows.map(renderRow)}
        </View>
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 22 },
  section: { gap: 6 },
  sectionLabel: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.pinkSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCopy: { flex: 1, gap: 2 },
  rowLabel: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  rowHint: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
});
