import "../../global.css";
import "@/polyfills/text-encoding";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState, type PropsWithChildren } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BrandMark } from "@/components/BrandMark";
import { getNostrRuntime } from "@/nostr/manager";
import { colors } from "@/theme/colors";
import { VenueProvider } from "@/venue/VenueContext";

function RuntimeGate({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReady = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        getNostrRuntime();
        setReady(true);
      }, 500);
    };

    if (AppState.currentState === "active") scheduleReady();
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") scheduleReady();
      else {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = null;
      }
    });

    return () => {
      subscription.remove();
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, []);

  if (!ready) {
    return (
      <View style={styles.gate} testID="runtime-gate">
        <BrandMark size={56} />
        <Text style={styles.gateTitle}>crays board</Text>
        <Text style={styles.gateHint}>Waking the room</Text>
      </View>
    );
  }

  return children;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <RuntimeGate>
        <VenueProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.night } }} />
        </VenueProvider>
      </RuntimeGate>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  gate: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.night },
  gateTitle: { color: colors.white, fontSize: 22, lineHeight: 28, fontWeight: "800", letterSpacing: 0.5, marginTop: 16 },
  gateHint: { color: colors.inkFaint, fontSize: 12, lineHeight: 16, fontWeight: "700", textTransform: "uppercase", letterSpacing: 3, marginTop: 10 },
});
