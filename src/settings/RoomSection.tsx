import { StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { Badge, EmptyState, Panel } from "@/components/ui";
import { colors } from "@/theme/colors";

import type { RoomManifest } from "./fold";
import type { RelayReachability } from "./useSettingsData";

function formatAge(createdAt: number, now: number): string {
  const seconds = Math.max(0, now - createdAt);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function shortKey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
}

/**
 * Room & gateway status (ROOM-01/02). The manifest panel projects only the
 * signed life.crays/room/v1 contract from relay truth; relay reachability
 * comes from the subscription connection status; gateway hardware health is a
 * separate concern that is never inferred from relay records — with no direct
 * telemetry this slice shows exactly "Status unavailable".
 */
export function RoomSection({
  room,
  loaded,
  relayReachable,
  now,
}: {
  room: RoomManifest | null;
  loaded: boolean;
  relayReachable: RelayReachability;
  now: number;
}) {

  if (!loaded) {
    return <Text style={styles.loading}>Loading the room manifest…</Text>;
  }

  return (
    <View style={styles.stack}>
      {room ? (
        <Panel testID="room-manifest" style={styles.panel}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{room.name}</Text>
            <Badge label={room.open ? "Open" : "Closed"} tone={room.open ? "success" : "neutral"} />
          </View>
          <View style={styles.rows}>
            <InfoRow label="Last update" value={formatAge(room.createdAt, now)} />
            <InfoRow
              label="Capabilities"
              value={room.capabilities.length ? room.capabilities.join(", ") : "None advertised"}
            />
            <InfoRow
              label="Advertised badge issuer"
              value={room.advertisedIssuer ? shortKey(room.advertisedIssuer) : "Not advertised"}
            />
            <InfoRow label="Operator" value={shortKey(room.operatorPubkey)} />
          </View>
        </Panel>
      ) : (
        <Panel style={styles.panel} padded={false}>
          <EmptyState
            icon="floor-plan"
            title="No room manifest"
            description="A signed room manifest published for this venue appears here with its freshness and capabilities."
          />
        </Panel>
      )}

      <Panel testID="room-relay-status" style={styles.panel}>
        <Text style={styles.sectionTitle}>Relay reachability</Text>
        <Text style={styles.body}>
          {relayReachable === "connected"
            ? "Connected to the venue relay."
            : relayReachable === "unreachable"
              ? "The venue relay is unreachable."
              : "Checking the venue relay…"}
        </Text>
      </Panel>

      <Panel testID="room-gateway-status" style={styles.panel}>
        <Text style={styles.sectionTitle}>Gateway hardware</Text>
        {/* ROOM-02: hardware health never comes from relay records. */}
        <Text style={styles.gatewayStatus}>Status unavailable</Text>
        <Text style={styles.body}>No direct hardware telemetry is configured for this venue.</Text>
      </Panel>

      <Panel testID="room-qr-fallback" style={styles.panel}>
        <Text style={styles.sectionTitle}>QR fallback</Text>
        <View style={styles.qrPlaceholder}>
          <MaterialCommunityIcons name="qrcode" size={40} color={colors.inkFaint} />
        </View>
        <Text style={styles.body}>
          If the gateway is offline, staff and members can still scan to connect. The printable QR arrives with the
          hardware contract.
        </Text>
      </Panel>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, paddingVertical: 24 },
  stack: { gap: 14 },
  panel: { gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  title: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: "800", flex: 1 },
  sectionTitle: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  rows: { gap: 8 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", gap: 16 },
  infoLabel: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  infoValue: { color: colors.ink, fontSize: 13, lineHeight: 18, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  body: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  gatewayStatus: { color: colors.inkMuted, fontSize: 18, lineHeight: 23, fontWeight: "800" },
  qrPlaceholder: {
    alignSelf: "flex-start",
    width: 96,
    height: 96,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceWarm,
  },
});
