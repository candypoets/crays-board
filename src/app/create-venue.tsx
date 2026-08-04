import { useRouter } from "expo-router";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CreateVenueWizard } from "@/create-venue/CreateVenueWizard";
import { colors } from "@/theme/colors";

/**
 * Create Venue onboarding route (PRD §8.2). The wizard creates nothing until
 * the deliberate step-4 submission; after success the new venue is selected
 * and Open venue lands on the board home. The old non-functional prototype
 * remains reachable only inside the /board demo shell.
 */
export default function CreateVenueRoute() {
  const router = useRouter();

  return (
    <SafeAreaView testID="create-venue-screen" style={styles.screen} edges={["top", "right", "bottom", "left"]}>
      <CreateVenueWizard onExit={() => router.back()} onOpenVenue={() => router.replace("/home")} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
});
