import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { installStaffIdentity, nsecToPubkey } from "@/account/account";
import { Button } from "@/components/ui";
import { colors } from "@/theme/colors";
import { useVenue } from "@/venue/VenueContext";

const RELAY_PATTERN = /^wss?:\/\//;
const SERVICE_PATTERN = /^https?:\/\//;

/**
 * Dev-only QA seed route (`craysboard://qa-seed?relay=…&service=…&nsec=…`).
 * Installs the staff signer from the deep link, selects the venue at that
 * relay, then remains subscription-free until the saved Agent Device flow
 * opens qa-handoff. Never present in release builds — production identity
 * enters through the sign-in surfaces only.
 */
function QaSeed() {
  const router = useRouter();
  const { setVenue } = useVenue();
  const params = useLocalSearchParams<{ relay?: string; service?: string; nsec?: string }>();
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      const relay = typeof params.relay === "string" ? params.relay : "";
      const service = typeof params.service === "string" ? params.service : "";
      const nsec = typeof params.nsec === "string" ? params.nsec : "";

      if (!RELAY_PATTERN.test(relay)) throw new Error("The seed link is missing a valid ws:// or wss:// relay URL.");
      if (!SERVICE_PATTERN.test(service)) throw new Error("The seed link is missing a valid http:// or https:// service URL.");
      if (!nsec.startsWith("nsec1")) throw new Error("The seed link is missing a valid staff nsec.");
      // Validates the bech32 payload and derives the public identity; the
      // secret itself is never logged or put into route state.
      const pubkey = nsecToPubkey(nsec);

      await installStaffIdentity(nsec);
      setVenue({ relayUrl: relay, serviceUrl: service, pubkey });
      console.log(`[crays-board-venue]${JSON.stringify({ relay, admin: pubkey })}`);
      setReady(true);
    })().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView testID="qa-seed-screen" style={styles.screen} edges={["top", "right", "bottom", "left"]}>
      <View style={styles.content}>
        <Text style={styles.title}>{error ? "Seed failed" : ready ? "Venue ready" : "Preparing the venue…"}</Text>
        <Text style={styles.body}>
          {error ?? (ready ? "The test journey can now open its target screen." : "Installing the staff key and selecting the venue relay.")}
        </Text>
        {error ? <Button label="Back" tone="secondary" onPress={() => router.back()} /> : null}
      </View>
    </SafeAreaView>
  );
}

function QaSeedUnavailable() {
  const router = useRouter();
  return (
    <SafeAreaView testID="qa-seed-unavailable" style={styles.screen} edges={["top", "right", "bottom", "left"]}>
      <View style={styles.content}>
        <Text style={styles.title}>Not found</Text>
        <Text style={styles.body}>This route only exists in development builds.</Text>
        <Button label="Back" tone="secondary" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

export default function QaSeedRoute() {
  if (!__DEV__) return <QaSeedUnavailable />;
  return <QaSeed />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { flex: 1, justifyContent: "center", padding: 28, gap: 18, maxWidth: 520, width: "100%", alignSelf: "center" },
  title: { color: colors.ink, fontSize: 30, lineHeight: 36, fontWeight: "800", letterSpacing: -0.7 },
  body: { color: colors.inkMuted, fontSize: 15, lineHeight: 22 },
});
