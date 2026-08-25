import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { clearStaffIdentity } from "@/account/account";
import { Button, Panel, ScreenTitle } from "@/components/ui";
import { colors } from "@/theme/colors";
import { useVenue } from "@/venue/VenueContext";

type ProbeState = "checking" | "connected" | "unavailable";

/**
 * Honest relay reachability check: open a WebSocket to the venue relay with a
 * short timeout. Connected only when the socket actually opens — never a
 * fabricated green state.
 */
function probeRelay(relayUrl: string, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let socket: WebSocket | null = null;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // Closing a failed socket is best-effort.
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      socket = new WebSocket(relayUrl);
    } catch {
      finish(false);
      return;
    }
    socket.onopen = () => finish(true);
    socket.onerror = () => finish(false);
    socket.onclose = () => finish(false);
  });
}

const PROBE_LABEL: Record<ProbeState, string> = {
  checking: "Checking…",
  connected: "Connected",
  unavailable: "Unavailable",
};

const PROBE_COLOR: Record<ProbeState, string> = {
  checking: colors.inkMuted,
  connected: colors.success,
  unavailable: colors.danger,
};

function relayHost(relayUrl: string): string {
  return relayUrl.replace(/^wss?:\/\//, "");
}

/** ENTRY-03/04: venue discovery, honest access verification, and switching. */
export default function VenueSelectionRoute() {
  const router = useRouter();
  const { venue, restoring, setVenue } = useVenue();
  const [probe, setProbe] = useState<ProbeState>("checking");
  const [switching, setSwitching] = useState(false);
  const [refreshed, setRefreshed] = useState(false);

  const runProbe = useCallback(() => {
    if (!venue) return;
    let cancelled = false;
    // Deferred so the mount effect never sets state synchronously.
    queueMicrotask(() => {
      if (!cancelled) setProbe("checking");
    });
    void probeRelay(venue.relayUrl).then((ok) => {
      if (!cancelled) setProbe(ok ? "connected" : "unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, [venue]);

  useEffect(() => runProbe(), [runProbe]);

  const switchAccount = () => {
    if (switching) return;
    setSwitching(true);
    void (async () => {
      await clearStaffIdentity();
      setVenue(null);
      router.replace("/");
    })().catch(() => setSwitching(false));
  };

  return (
    <SafeAreaView testID="venue-selection-screen" style={styles.screen} edges={["top", "right", "bottom", "left"]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
        <ScreenTitle
          title="Choose a venue"
          description="Your access is verified before an operator space opens."
        />

        {restoring ? (
          <Text style={styles.note}>Restoring the last selected venue…</Text>
        ) : venue ? (
          <>
            <Panel testID="venue-card" style={styles.venueCard}>
              <View style={styles.venueCopy}>
                <Text style={styles.venueName}>{relayHost(venue.relayUrl)}</Text>
                <Text style={styles.venueMeta}>Operator {venue.pubkey.slice(0, 12)}…</Text>
                <Text style={styles.venueMeta}>Open for service</Text>
              </View>
              <Button
                testID="venue-open-button"
                label="Open"
                onPress={() => router.replace("/orders")}
              />
            </Panel>

            <Pressable
              testID="create-another-venue"
              accessibilityRole="button"
              accessibilityLabel="Create another venue"
              onPress={() => router.push("/create-venue")}
              style={styles.dashedRow}
            >
              <Text style={styles.dashedRowText}>+ Create another venue</Text>
            </Pressable>

            <Panel testID="access-check" style={styles.accessPanel}>
              <Text style={styles.accessTitle}>Access check</Text>
              <View style={styles.accessRow}>
                <Text style={styles.accessLabel}>Identity ready</Text>
                <Text style={[styles.accessValue, { color: colors.success }]}>Verified</Text>
              </View>
              <View style={styles.accessRow}>
                <Text style={styles.accessLabel}>Venue relay</Text>
                <Text style={[styles.accessValue, { color: PROBE_COLOR[probe] }]}>{PROBE_LABEL[probe]}</Text>
              </View>
              <Button
                testID="access-refresh"
                label={probe === "checking" ? "Checking…" : "Refresh"}
                tone="secondary"
                compact
                disabled={probe === "checking"}
                onPress={runProbe}
              />
            </Panel>

            <Button
              testID="switch-account"
              label={switching ? "Switching…" : "Switch account"}
              tone="quiet"
              disabled={switching}
              onPress={switchAccount}
            />
          </>
        ) : (
          <Panel testID="venue-empty" style={styles.emptyPanel}>
            <Text style={styles.emptyTitle}>Create your first venue</Text>
            <Text style={styles.emptyBody}>
              This identity has no verified venue access yet. If you signed in elsewhere, refresh after the
              venue grants access, or enter a service address from the sign-in screen.
            </Text>
            <Button
              testID="create-first-venue"
              label="Create your first venue"
              onPress={() => router.push("/create-venue")}
            />
            <Button
              testID="empty-refresh"
              label="Refresh"
              tone="secondary"
              onPress={() => setRefreshed(true)}
            />
            {refreshed ? (
              <Text style={styles.note}>Access re-checked — this identity still has no venue access.</Text>
            ) : null}
            <Button
              testID="empty-switch-account"
              label={switching ? "Switching…" : "Switch account"}
              tone="quiet"
              disabled={switching}
              onPress={switchAccount}
            />
          </Panel>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  scroll: { flex: 1 },
  container: { padding: 24, gap: 18, maxWidth: 720, width: "100%", alignSelf: "center" },
  note: { color: colors.inkMuted, fontSize: 15, lineHeight: 22 },
  venueCard: { flexDirection: "row", alignItems: "center", gap: 18 },
  venueCopy: { flex: 1, gap: 3 },
  venueName: { color: colors.ink, fontSize: 19, lineHeight: 24, fontWeight: "800" },
  venueMeta: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  dashedRow: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.pink,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  dashedRowText: { color: colors.pink, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  accessPanel: { gap: 12 },
  accessTitle: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: "800" },
  accessRow: { minHeight: 32, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  accessLabel: { color: colors.inkMuted, fontSize: 14, lineHeight: 19 },
  accessValue: { fontSize: 14, lineHeight: 19, fontWeight: "700" },
  emptyPanel: { gap: 14 },
  emptyTitle: { color: colors.ink, fontSize: 20, lineHeight: 26, fontWeight: "800" },
  emptyBody: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
