import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrandMark } from "@/components/BrandMark";
import { colors } from "@/theme/colors";
import type { IconName } from "@/types/domain";

const secondaryPaths: { label: string; icon: IconName }[] = [
  { label: "Import account", icon: "upload-outline" },
  { label: "Scan staff access", icon: "qrcode-scan" },
  { label: "Enter service address", icon: "web" },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const tablet = width >= 900;

  const brandPanel = (
    <View style={[styles.brandPanel, !tablet && styles.brandPanelPhone]}>
      <View style={styles.brandRow}>
        <BrandMark size={tablet ? 34 : 26} />
        <Text style={[styles.brandName, !tablet && styles.brandNamePhone]}>crays board</Text>
      </View>
      {tablet ? (
        <Text style={styles.tagline}>
          Run the room.{"\n"}Grow the community.
        </Text>
      ) : null}
    </View>
  );

  const content = (
    <ScrollView
      style={styles.contentScroll}
      contentContainerStyle={[styles.content, tablet && styles.contentTablet]}
    >
      <Text style={styles.title}>Welcome to Crays Board</Text>
      <Text style={styles.subtitle}>Create a venue or sign in with a trusted staff identity.</Text>

      <Pressable
        testID="create-venue-button"
        accessibilityRole="button"
        accessibilityLabel="Create venue"
        onPress={() => router.push("/create-venue")}
        style={styles.primaryCard}
      >
        <View style={styles.primaryIconTile}>
          <MaterialCommunityIcons name="store-outline" size={28} color={colors.white} />
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.primaryLabel}>Create venue</Text>
          <Text style={styles.primaryHint}>Start a new hospitality space and become its first owner.</Text>
        </View>
      </Pressable>

      <Pressable
        testID="sign-in-button"
        accessibilityRole="button"
        accessibilityLabel="Sign in"
        onPress={() => router.push("/sign-in")}
        style={styles.secondaryCard}
      >
        <View style={styles.secondaryIconTile}>
          <MaterialCommunityIcons name="account-outline" size={28} color={colors.ink} />
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.secondaryLabel}>Sign in</Text>
          <Text style={styles.secondaryHint}>Use an existing Nostr identity or approved signer.</Text>
        </View>
      </Pressable>

      <View style={styles.pathsRow}>
        {secondaryPaths.map((path) => (
          <Pressable
            key={path.label}
            accessibilityRole="button"
            accessibilityLabel={path.label}
            onPress={() => router.push("/sign-in")}
            style={styles.pathButton}
          >
            <MaterialCommunityIcons name={path.icon} size={24} color={colors.ink} />
            <Text style={styles.pathLabel}>{path.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.trustRow}>
        <MaterialCommunityIcons name="shield-check-outline" size={18} color={colors.pink} />
        <Text style={styles.trustText}>Your private key stays in secure device storage.</Text>
      </View>

      <View style={styles.trustRow}>
        <MaterialCommunityIcons name="tablet-cellphone" size={18} color={colors.inkMuted} />
        <Text style={styles.deviceText}>Works on iPad, Android tablets, and phones.</Text>
      </View>
    </ScrollView>
  );

  return (
    <SafeAreaView testID="welcome-screen" style={styles.screen} edges={["top", "right", "bottom", "left"]}>
      {tablet ? (
        <View style={styles.splitRow}>
          {brandPanel}
          {content}
        </View>
      ) : (
        <View style={styles.phoneColumn}>
          {brandPanel}
          {content}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.night },
  splitRow: { flex: 1, flexDirection: "row" },
  phoneColumn: { flex: 1 },
  brandPanel: {
    width: "42%",
    backgroundColor: colors.night,
    padding: 48,
    justifyContent: "space-between",
  },
  brandPanelPhone: { width: "100%", paddingHorizontal: 24, paddingVertical: 20 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  brandName: { color: colors.white, fontSize: 20, lineHeight: 26, fontWeight: "800" },
  brandNamePhone: { fontSize: 16, lineHeight: 21 },
  tagline: { color: colors.white, fontSize: 36, lineHeight: 44, fontWeight: "800", letterSpacing: -0.5 },
  contentScroll: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 28, gap: 16 },
  contentTablet: { flexGrow: 1, justifyContent: "center", padding: 48, maxWidth: 620, width: "100%", alignSelf: "center" },
  title: { color: colors.ink, fontSize: 30, lineHeight: 36, fontWeight: "800", letterSpacing: -0.7 },
  subtitle: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, marginBottom: 12 },
  primaryCard: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    backgroundColor: colors.pink,
    borderRadius: 16,
    padding: 18,
  },
  primaryIconTile: {
    width: 60,
    height: 60,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardCopy: { flex: 1, gap: 4 },
  primaryLabel: { color: colors.white, fontSize: 19, lineHeight: 24, fontWeight: "800" },
  primaryHint: { color: "rgba(255, 255, 255, 0.85)", fontSize: 14, lineHeight: 19 },
  secondaryCard: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 16,
    padding: 18,
  },
  secondaryIconTile: {
    width: 60,
    height: 60,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryLabel: { color: colors.ink, fontSize: 19, lineHeight: 24, fontWeight: "800" },
  secondaryHint: { color: colors.inkMuted, fontSize: 14, lineHeight: 19 },
  pathsRow: { flexDirection: "row", gap: 12 },
  pathButton: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  pathLabel: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: "700", textAlign: "center" },
  trustRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  trustText: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  deviceText: { color: colors.inkFaint, fontSize: 13, lineHeight: 18 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
