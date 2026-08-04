import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BrandMark } from "@/components/BrandMark";
import { colors } from "@/theme/colors";
import type { Area, IconName } from "@/types/domain";

const primaryNav: { area: Area; label: string; icon: IconName }[] = [
  { area: "home", label: "Home", icon: "view-dashboard-outline" },
  { area: "orders", label: "Orders", icon: "receipt-text-outline" },
  { area: "menu", label: "Menu", icon: "silverware-fork-knife" },
  { area: "events", label: "Events", icon: "calendar-blank-outline" },
  { area: "people", label: "People", icon: "account-group-outline" },
  { area: "invites", label: "Invites", icon: "ticket-confirmation-outline" },
];

const phoneNav: { area: Area; label: string; icon: IconName }[] = [
  ...primaryNav.slice(0, 4),
  { area: "more", label: "More", icon: "dots-horizontal-circle-outline" },
];

function NavButton({
  area,
  label,
  icon,
  selected,
  compact,
  onSelect,
}: {
  area: Area;
  label: string;
  icon: IconName;
  selected: boolean;
  compact?: boolean;
  onSelect: (area: Area) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={() => onSelect(area)}
      style={({ pressed }) => [
        styles.navButton,
        compact && styles.navButtonCompact,
        selected && styles.navButtonSelected,
        pressed && styles.navPressed,
      ]}
    >
      <MaterialCommunityIcons name={icon} size={22} color={selected ? colors.white : "#CDAFBB"} />
      {!compact ? <Text style={[styles.navLabel, selected && styles.navLabelSelected]}>{label}</Text> : null}
      {area === "orders" ? <View style={[styles.count, compact && styles.countCompact]}><Text style={styles.countText}>3</Text></View> : null}
    </Pressable>
  );
}

export function BoardShell({
  area,
  width,
  onSelect,
  children,
}: PropsWithChildren<{ area: Area; width: number; onSelect: (area: Area) => void }>) {
  const expanded = width >= 840;
  const tablet = width >= 600;
  const activeNavArea = ["people", "invites", "settings", "create-venue"].includes(area) && !tablet ? "more" : area;

  if (!tablet) {
    return (
      <View style={styles.phoneShell}>
        <View style={styles.phoneHeader}>
          <View style={styles.phoneVenue}>
            <BrandMark size={27} />
            <View>
              <Text style={styles.phoneVenueName}>Maison Crays</Text>
              <Text style={styles.phoneVenueMeta}>Luxembourg · Open</Text>
            </View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Venue and account menu" style={styles.avatar}>
            <Text style={styles.avatarText}>MA</Text>
          </Pressable>
        </View>
        <View style={styles.phoneContent}>{children}</View>
        <View style={styles.phoneBar}>
          {phoneNav.map((item) => (
            <Pressable
              key={item.area}
              accessibilityRole="button"
              accessibilityState={{ selected: activeNavArea === item.area }}
              onPress={() => onSelect(item.area)}
              style={({ pressed }) => [styles.phoneNavItem, pressed && styles.navPressed]}
            >
              <MaterialCommunityIcons name={item.icon} size={23} color={activeNavArea === item.area ? colors.pink : colors.inkMuted} />
              <Text style={[styles.phoneNavLabel, activeNavArea === item.area && styles.phoneNavLabelActive]}>{item.label}</Text>
              {item.area === "orders" ? <View style={styles.phoneCount}><Text style={styles.phoneCountText}>3</Text></View> : null}
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.tabletShell}>
      <View style={[styles.rail, !expanded && styles.railCompact]}>
        <View style={[styles.brand, !expanded && styles.brandCompact]}>
          <BrandMark size={expanded ? 31 : 29} />
          {expanded ? <Text style={styles.brandText}>crays board</Text> : null}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch venue"
          style={[styles.venue, !expanded && styles.venueCompact]}
        >
          <View style={styles.venueMark}><Text style={styles.venueMarkText}>MC</Text></View>
          {expanded ? (
            <View style={styles.venueCopy}>
              <Text style={styles.venueName} numberOfLines={1}>Maison Crays</Text>
              <Text style={styles.venueMeta}>Open for service</Text>
            </View>
          ) : null}
          {expanded ? <MaterialCommunityIcons name="chevron-down" size={18} color="#CDAFBB" /> : null}
        </Pressable>

        <View style={styles.nav}>
          {primaryNav.map((item) => (
            <NavButton key={item.area} {...item} selected={area === item.area} compact={!expanded} onSelect={onSelect} />
          ))}
        </View>

        <View style={styles.railFooter}>
          <NavButton area="settings" label="Settings" icon="cog-outline" selected={area === "settings"} compact={!expanded} onSelect={onSelect} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create another venue"
            onPress={() => onSelect("create-venue")}
            style={({ pressed }) => [styles.newVenue, !expanded && styles.newVenueCompact, pressed && styles.navPressed]}
          >
            <MaterialCommunityIcons name="plus" size={21} color={colors.coral} />
            {expanded ? <Text style={styles.newVenueText}>Create another venue</Text> : null}
          </Pressable>
        </View>
      </View>

      <View style={styles.stage}>
        <View style={styles.contextBar}>
          <View style={styles.serviceStatus}><View style={styles.liveDot} /><Text style={styles.serviceStatusText}>Venue online</Text></View>
          <View style={styles.contextActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Notifications" style={styles.iconButton}>
              <MaterialCommunityIcons name="bell-outline" size={21} color={colors.ink} />
              <View style={styles.notificationDot} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Account menu" style={styles.accountButton}>
              <View style={styles.avatar}><Text style={styles.avatarText}>MA</Text></View>
              {expanded ? <Text style={styles.accountName}>Mina</Text> : null}
              <MaterialCommunityIcons name="chevron-down" size={18} color={colors.inkMuted} />
            </Pressable>
          </View>
        </View>
        <View style={styles.stageContent}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabletShell: { flex: 1, flexDirection: "row", backgroundColor: colors.paper },
  rail: { width: 232, backgroundColor: colors.night, paddingHorizontal: 14, paddingTop: 18, paddingBottom: 16 },
  railCompact: { width: 88, paddingHorizontal: 10 },
  brand: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 10 },
  brandCompact: { justifyContent: "center", paddingHorizontal: 0 },
  brandText: { color: colors.white, fontSize: 17, lineHeight: 22, fontWeight: "800", letterSpacing: -0.3 },
  venue: { minHeight: 68, marginTop: 13, marginBottom: 18, borderRadius: 15, backgroundColor: colors.nightRaised, borderWidth: 1, borderColor: colors.nightBorder, padding: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  venueCompact: { justifyContent: "center", padding: 8 },
  venueMark: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.coral, alignItems: "center", justifyContent: "center" },
  venueMarkText: { color: colors.night, fontSize: 12, lineHeight: 15, fontWeight: "900" },
  venueCopy: { flex: 1, minWidth: 0 },
  venueName: { color: colors.white, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  venueMeta: { color: "#CDAFBB", fontSize: 11, lineHeight: 15, marginTop: 2 },
  nav: { gap: 5 },
  navButton: { minHeight: 48, borderRadius: 13, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 11, position: "relative" },
  navButtonCompact: { paddingHorizontal: 0, justifyContent: "center" },
  navButtonSelected: { backgroundColor: colors.pink },
  navPressed: { opacity: 0.7 },
  navLabel: { color: "#CDAFBB", fontSize: 14, lineHeight: 18, fontWeight: "600" },
  navLabelSelected: { color: colors.white, fontWeight: "800" },
  count: { marginLeft: "auto", minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: 12, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  countCompact: { position: "absolute", right: 5, top: 4, minWidth: 19, height: 19 },
  countText: { color: colors.pinkDark, fontSize: 10, fontWeight: "900" },
  railFooter: { marginTop: "auto", gap: 7 },
  newVenue: { minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: colors.nightBorder, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  newVenueCompact: { justifyContent: "center", paddingHorizontal: 0 },
  newVenueText: { color: colors.coral, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  stage: { flex: 1 },
  contextBar: { height: 64, paddingHorizontal: 26, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.paper },
  serviceStatus: { flexDirection: "row", alignItems: "center", gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  serviceStatusText: { color: colors.inkMuted, fontSize: 13, lineHeight: 17, fontWeight: "600" },
  contextActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconButton: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", position: "relative" },
  notificationDot: { position: "absolute", top: 10, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.pink, borderWidth: 2, borderColor: colors.paper },
  accountButton: { minHeight: 48, borderRadius: 14, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 7 },
  avatar: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.pinkSoft, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.pinkDark, fontSize: 12, fontWeight: "900" },
  accountName: { color: colors.ink, fontSize: 14, lineHeight: 18, fontWeight: "700" },
  stageContent: { flex: 1 },
  phoneShell: { flex: 1, backgroundColor: colors.paper },
  phoneHeader: { minHeight: 63, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.night, borderBottomWidth: 1, borderBottomColor: colors.nightBorder },
  phoneVenue: { flexDirection: "row", alignItems: "center", gap: 10 },
  phoneVenueName: { color: colors.white, fontSize: 14, lineHeight: 18, fontWeight: "800" },
  phoneVenueMeta: { color: "#CDAFBB", fontSize: 11, lineHeight: 14, marginTop: 1 },
  phoneContent: { flex: 1 },
  phoneBar: { minHeight: 68, flexDirection: "row", alignItems: "center", justifyContent: "space-around", backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 4, paddingTop: 5 },
  phoneNavItem: { flex: 1, minHeight: 58, alignItems: "center", justifyContent: "center", gap: 2, position: "relative" },
  phoneNavLabel: { color: colors.inkMuted, fontSize: 10, lineHeight: 13, fontWeight: "700" },
  phoneNavLabelActive: { color: colors.pinkDark },
  phoneCount: { position: "absolute", top: 1, right: "22%", minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.pink, alignItems: "center", justifyContent: "center" },
  phoneCountText: { color: colors.white, fontSize: 9, fontWeight: "900" },
});
