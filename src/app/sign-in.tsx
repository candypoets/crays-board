import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getActivePubkey, installStaffIdentity } from "@/account/account";
import { Button, Field, ScreenTitle } from "@/components/ui";
import { colors } from "@/theme/colors";
import { useVenue } from "@/venue/VenueContext";

const RELAY_PATTERN = /^wss?:\/\/\S+$/;
const SERVICE_PATTERN = /^https?:\/\/\S+$/;

/**
 * ENTRY-02 sign-in: import an existing staff identity (nsec) or bootstrap a
 * venue from a manually entered service/relay address. The nsec is validated
 * and installed through the native signer boundary; it is never logged or put
 * into route state.
 */
export default function SignInRoute() {
  const router = useRouter();
  const { setVenue } = useVenue();

  const [nsec, setNsec] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const [relayUrl, setRelayUrl] = useState("");
  const [serviceUrl, setServiceUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);

  const importAccount = () => {
    if (importing) return;
    setImportError(null);
    const candidate = nsec.trim();
    if (!candidate.startsWith("nsec1")) {
      setImportError("Enter a valid Nostr secret key (nsec1…).");
      return;
    }
    setImporting(true);
    void (async () => {
      await installStaffIdentity(candidate);
      router.replace("/venue-selection" as never);
    })().catch((cause: unknown) => {
      setImportError(cause instanceof Error ? cause.message : String(cause));
      setImporting(false);
    });
  };

  const openServiceAddress = () => {
    if (connecting) return;
    setServiceError(null);
    const relay = relayUrl.trim();
    const service = serviceUrl.trim();
    if (!RELAY_PATTERN.test(relay)) {
      setServiceError("The relay address must be a ws:// or wss:// URL.");
      return;
    }
    if (!SERVICE_PATTERN.test(service)) {
      setServiceError("The service address must be an http:// or https:// URL.");
      return;
    }
    setConnecting(true);
    void (async () => {
      const pubkey = await getActivePubkey();
      if (!pubkey) {
        throw new Error("Import an account key above before entering a service address.");
      }
      setVenue({ relayUrl: relay, serviceUrl: service, pubkey });
      router.replace("/orders");
    })().catch((cause: unknown) => {
      setServiceError(cause instanceof Error ? cause.message : String(cause));
      setConnecting(false);
    });
  };

  return (
    <SafeAreaView testID="sign-in-screen" style={styles.screen} edges={["top", "right", "bottom", "left"]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
        <ScreenTitle
          title="Sign in"
          description="Use an existing Nostr identity, then open a venue by its service address."
        />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Import account key</Text>
          <Field
            testID="nsec-input"
            label="Account key (nsec)"
            hint="Stored in secure device storage only."
            value={nsec}
            onChangeText={setNsec}
            placeholder="nsec1…"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          {importError ? <Text style={styles.error}>{importError}</Text> : null}
          <Button
            testID="import-account-button"
            label={importing ? "Importing…" : "Import account"}
            disabled={importing}
            onPress={importAccount}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Enter service address</Text>
          <Field
            testID="relay-url-input"
            label="Relay address"
            value={relayUrl}
            onChangeText={setRelayUrl}
            placeholder="wss://relay.example.com"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Field
            testID="service-url-input"
            label="Service address"
            value={serviceUrl}
            onChangeText={setServiceUrl}
            placeholder="https://service.example.com"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {serviceError ? <Text style={styles.error}>{serviceError}</Text> : null}
          <Button
            testID="service-continue-button"
            label={connecting ? "Opening…" : "Open venue"}
            disabled={connecting}
            onPress={openServiceAddress}
          />
        </View>

        <Button testID="sign-in-back" label="Back" tone="quiet" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  scroll: { flex: 1 },
  container: { padding: 24, gap: 26, maxWidth: 560, width: "100%", alignSelf: "center" },
  section: { gap: 14 },
  sectionTitle: { color: colors.ink, fontSize: 17, lineHeight: 22, fontWeight: "800" },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
});
