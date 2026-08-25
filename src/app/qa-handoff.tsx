import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandMark } from "@/components/BrandMark";
import { colors } from "@/theme/colors";
import { useVenue } from "@/venue/VenueContext";

const TARGETS = new Set([
  "home",
  "orders",
  "menu",
  "events",
  "check-in",
  "people",
  "invites",
  "settings",
  "venue-selection",
]);

/**
 * Gives Agent Device an explicit `open` step without stacking a live Board
 * screen. The runner first seeds identity + venue on qa-seed; this route waits
 * for that context and replaces only itself with the requested test surface.
 */
export default function QaHandoffRoute() {
  const router = useRouter();
  const { venue, restoring } = useVenue();
  const { target: rawTarget } = useLocalSearchParams<{ target?: string }>();
  const target = typeof rawTarget === "string" && TARGETS.has(rawTarget) ? rawTarget : "";

  useEffect(() => {
    if (!__DEV__ || restoring || !venue || !target) return;
    router.replace(`/${target}` as never);
  }, [restoring, router, target, venue]);

  return (
    <SafeAreaView testID="qa-handoff-screen" style={styles.screen} edges={["top", "right", "bottom", "left"]}>
      <View style={styles.content}>
        <BrandMark size={48} />
        <Text style={styles.title}>{__DEV__ && target ? "Opening test surface…" : "Not found"}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  title: { color: colors.ink, fontSize: 20, lineHeight: 26, fontWeight: "800" },
});
