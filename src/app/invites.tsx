import { useRef, useState } from "react";
import { Clipboard, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { Badge, Button, EmptyState, Panel, ScreenTitle } from "@/components/ui";
import { createInvite, type CreatedInvite } from "@/invites/createInvite";
import {
  CLAIM_EXPIRY_OPTIONS,
  MAX_REDEMPTION_OPTIONS,
  MEMBERSHIP_DURATION_OPTIONS,
  durationLabel,
  expiryLabel,
  inviteLogMarker,
  type InviteConfig,
} from "@/invites/invites";
import { AppShell } from "@/shell/AppShell";
import { useBreakpoint } from "@/shell/breakpoint";
import { colors } from "@/theme/colors";
import { useVenue } from "@/venue/VenueContext";

const ADMIN_PERMISSIONS = ["posts", "media", "events", "store", "invites", "moderation", "settings"];

type CreationState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "done"; invite: CreatedInvite; config: InviteConfig }
  | { phase: "error"; message: string };

type OptionRow = { id: string; label: string };

function OptionField({
  label,
  hint,
  testID,
  valueLabel,
  options,
  optionTestID,
  disabled,
  onSelect,
}: {
  label: string;
  hint: string;
  testID: string;
  valueLabel: string;
  options: OptionRow[];
  optionTestID: (option: OptionRow) => string;
  disabled: boolean;
  onSelect: (option: OptionRow) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${valueLabel}`}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.select, disabled && styles.disabled]}
      >
        <Text style={styles.selectValue}>{valueLabel}</Text>
        <MaterialCommunityIcons name="chevron-down" size={20} color={colors.inkMuted} />
      </Pressable>
      <Text style={styles.fieldHint}>{hint}</Text>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{label}</Text>
            {options.map((option) => (
              <Pressable
                key={option.id}
                testID={optionTestID(option)}
                accessibilityRole="button"
                onPress={() => {
                  onSelect(option);
                  setOpen(false);
                }}
                style={styles.modalOption}
              >
                <Text style={styles.modalOptionLabel}>{option.label}</Text>
                {option.label === valueLabel ? (
                  <MaterialCommunityIcons name="check" size={18} color={colors.pink} />
                ) : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function ResultPanel({ state, venueHost, onShare, onCopy, copied }: {
  state: CreationState;
  venueHost: string;
  onShare: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  if (state.phase !== "done") {
    return (
      <Panel style={styles.resultPanel}>
        <EmptyState
          icon={state.phase === "creating" ? "qrcode-scan" : "qrcode"}
          title={state.phase === "creating" ? "Creating invite…" : "No invite yet"}
          description={
            state.phase === "creating"
              ? "Asking the venue service to sign a fresh invite. This takes a moment."
              : "Configure the terms and create an invite to get a QR code and share link."
          }
        />
      </Panel>
    );
  }

  const { invite, config } = state;
  const membershipBadge =
    config.membershipDurationSeconds === null
      ? "Permanent membership"
      : `${durationLabel(config.membershipDurationSeconds)} membership`;

  return (
    <Panel testID="invite-result-panel" style={styles.resultPanel}>
      <Text style={styles.resultTitle}>Invite ready</Text>
      <View style={styles.venueRow}>
        <View style={styles.venueBadge}>
          <MaterialCommunityIcons name="storefront-outline" size={20} color={colors.paper} />
        </View>
        <View style={styles.venueCopy}>
          <Text style={styles.venueName}>{venueHost}</Text>
          <Text style={styles.venueMeta}>Invite signed by this venue&rsquo;s service</Text>
        </View>
      </View>
      <View
        testID="invite-qr"
        collapsable={false}
        accessible
        accessibilityRole="image"
        accessibilityLabel="Invite QR code"
        style={styles.qrFrame}
      >
        <QRCode value={invite.redeemUrl} size={176} color={colors.night} backgroundColor={colors.white} />
      </View>
      <View style={styles.badgeRow}>
        <Badge label={`Valid for ${expiryLabel(config.claimExpirySeconds)}`} tone="success" />
        <Badge label={`${invite.response.maxRedemptions} uses`} tone="pink" />
        <Badge label={membershipBadge} tone="info" />
      </View>
      <Text style={styles.expiryText}>
        Claim by {new Date(invite.response.expiresAt * 1000).toLocaleString()}
      </Text>
      <View style={styles.resultActions}>
        <Button testID="invite-share-button" label="Share invite" icon="share-variant" onPress={onShare} compact />
        <Button
          testID="invite-copy-button"
          label={copied ? "Copied" : "Copy link"}
          icon="link-variant"
          tone="secondary"
          onPress={onCopy}
          compact
        />
      </View>
      <View style={styles.warningRow}>
        <MaterialCommunityIcons name="alert-outline" size={18} color={colors.warning} />
        <Text style={styles.warningText}>
          Anyone with this link can join {venueHost} under the configured terms. Share only with people you trust.
        </Text>
      </View>
    </Panel>
  );
}

function InvitesWorkspace() {
  const { venue } = useVenue();
  const breakpoint = useBreakpoint();
  const phone = breakpoint === "phone";

  const [expirySeconds, setExpirySeconds] = useState(86_400);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(2_592_000);
  const [maxRedemptions, setMaxRedemptions] = useState(1);
  const [state, setState] = useState<CreationState>({ phase: "idle" });
  const [copied, setCopied] = useState(false);
  // INVITE-03: synchronous in-flight guard — a double-tap can deliver both
  // presses before React commits state, so the ref is set in the handler.
  const inFlight = useRef(false);

  if (!venue) return null;

  const config: InviteConfig = {
    claimExpirySeconds: expirySeconds,
    membershipDurationSeconds: durationSeconds,
    maxRedemptions,
  };
  const venueHost = venue.relayUrl.replace(/^wss?:\/\//, "");

  const create = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setCopied(false);
    setState({ phase: "creating" });
    void createInvite(venue, config)
      .then((invite) => {
        // The raw token never leaves this flow: the marker carries unsigned
        // claims only (see inviteLogMarker).
        if (__DEV__) {
          console.log(`[crays-board-invite]${JSON.stringify(inviteLogMarker(invite.response, venue.serviceUrl))}`);
        }
        setState({ phase: "done", invite, config });
      })
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        setState({ phase: "error", message });
      })
      .finally(() => {
        inFlight.current = false;
      });
  };

  const share = () => {
    if (state.phase !== "done") return;
    void Share.share({ message: state.invite.redeemUrl }).catch(() => {});
  };

  const copy = () => {
    if (state.phase !== "done") return;
    Clipboard.setString(state.invite.redeemUrl);
    setCopied(true);
  };

  const creating = state.phase === "creating";
  const createButton = (
    <View style={styles.createArea}>
      <Button
        testID="invite-create-button"
        label={creating ? "Creating…" : state.phase === "error" ? "Retry" : "Create secure invite"}
        icon="lock-outline"
        onPress={create}
        disabled={creating}
      />
      {state.phase === "error" ? <Text style={styles.errorText}>{state.message}</Text> : null}
    </View>
  );

  const configPanel = (
    <Panel style={styles.configPanel}>
      <Text style={styles.panelTitle}>Create a community invite</Text>
      <OptionField
        label="Claim link expires"
        hint="After this, the link will no longer be valid."
        testID="invite-expiry-field"
        valueLabel={expiryLabel(expirySeconds)}
        options={CLAIM_EXPIRY_OPTIONS.map((option) => ({ id: option.id, label: option.label }))}
        optionTestID={(option) => `invite-option-expiry-${option.id}`}
        disabled={creating}
        onSelect={(option) => {
          const match = CLAIM_EXPIRY_OPTIONS.find((entry) => entry.id === option.id);
          if (match) setExpirySeconds(match.seconds);
        }}
      />
      <OptionField
        label="Membership duration"
        hint="The length of access for each accepted invite."
        testID="invite-duration-field"
        valueLabel={durationLabel(durationSeconds)}
        options={MEMBERSHIP_DURATION_OPTIONS.map((option) => ({ id: option.id, label: option.label }))}
        optionTestID={(option) => `invite-option-duration-${option.id}`}
        disabled={creating}
        onSelect={(option) => {
          const match = MEMBERSHIP_DURATION_OPTIONS.find((entry) => entry.id === option.id);
          if (match) setDurationSeconds(match.seconds);
        }}
      />
      <OptionField
        label="Maximum redemptions"
        hint="The maximum number of times this invite can be used."
        testID="invite-redemptions-field"
        valueLabel={String(maxRedemptions)}
        options={MAX_REDEMPTION_OPTIONS.map((count) => ({ id: String(count), label: String(count) }))}
        optionTestID={(option) => `invite-option-redemptions-${option.id}`}
        disabled={creating}
        onSelect={(option) => setMaxRedemptions(Number(option.id))}
      />
      {!phone ? createButton : null}
    </Panel>
  );

  const resultPanel = (
    <ResultPanel state={state} venueHost={venueHost} onShare={share} onCopy={copy} copied={copied} />
  );

  return (
    <View style={styles.workspace}>
      {phone ? (
        <>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {configPanel}
            {resultPanel}
          </ScrollView>
          <View style={styles.stickyFooter}>{createButton}</View>
        </>
      ) : (
        <View style={styles.scrollRow}>
          <ScrollView style={styles.column} contentContainerStyle={styles.columnContent}>
            {configPanel}
          </ScrollView>
          <ScrollView style={styles.column} contentContainerStyle={styles.columnContent}>
            {resultPanel}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

export default function InvitesRoute() {
  const router = useRouter();
  const { venue, restoring } = useVenue();
  const breakpoint = useBreakpoint();

  return (
    <SafeAreaView testID="invites-screen" style={styles.screen} edges={["top", "right", "bottom", "left"]}>
      <AppShell active="invites" permissions={ADMIN_PERMISSIONS}>
        <View style={[styles.container, breakpoint === "phone" && styles.containerPhone]}>
          <ScreenTitle
            title="Invites"
            description={
              venue
                ? "Bring trusted people into this venue with a clear role from the start."
                : "No venue selected"
            }
          />
          {restoring ? (
            <View style={styles.center}>
              <Text style={styles.loadingText}>Restoring the venue…</Text>
            </View>
          ) : !venue ? (
            <EmptyState
              icon="store-off-outline"
              title="No venue selected"
              description="Select a venue before creating invites."
              action={<Button label="Back to welcome" tone="secondary" onPress={() => router.replace("/")} />}
            />
          ) : (
            <InvitesWorkspace />
          )}
        </View>
      </AppShell>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, minHeight: 0, padding: 24, maxWidth: 1180, width: "100%", alignSelf: "center" },
  containerPhone: { paddingHorizontal: 16, paddingTop: 18 },
  workspace: { flex: 1, minHeight: 0 },
  scroll: { flex: 1 },
  scrollContent: { gap: 16, paddingBottom: 32 },
  scrollRow: { flex: 1, flexDirection: "row", alignItems: "stretch", gap: 20, minHeight: 0 },
  column: { flex: 1, minWidth: 0, minHeight: 0 },
  columnContent: { paddingBottom: 32 },
  center: { flex: 1, justifyContent: "center" },
  loadingText: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, textAlign: "center" },
  configPanel: { gap: 18 },
  panelTitle: { color: colors.ink, fontSize: 18, lineHeight: 24, fontWeight: "800" },
  field: { gap: 7 },
  fieldLabel: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  fieldHint: { color: colors.inkMuted, fontSize: 12, lineHeight: 17 },
  select: {
    minHeight: 50,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  selectValue: { color: colors.ink, fontSize: 15 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(22, 10, 17, 0.45)", justifyContent: "center", padding: 32 },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 4,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  modalTitle: { color: colors.inkMuted, fontSize: 13, fontWeight: "700", marginBottom: 8, paddingHorizontal: 8 },
  modalOption: {
    minHeight: 48,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  modalOptionLabel: { color: colors.ink, fontSize: 15 },
  createArea: { gap: 8, marginTop: 6 },
  stickyFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.paper,
    paddingTop: 12,
  },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  resultPanel: { gap: 14 },
  resultTitle: { color: colors.ink, fontSize: 18, lineHeight: 24, fontWeight: "800" },
  venueRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  venueBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.night,
    alignItems: "center",
    justifyContent: "center",
  },
  venueCopy: { flex: 1, gap: 2 },
  venueName: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  venueMeta: { color: colors.inkMuted, fontSize: 12 },
  qrFrame: {
    alignSelf: "center",
    padding: 16,
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  expiryText: { color: colors.inkMuted, fontSize: 13, textAlign: "center" },
  resultActions: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center" },
  warningRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: colors.warningSoft,
    borderRadius: 12,
    padding: 12,
  },
  warningText: { flex: 1, color: colors.warning, fontSize: 13, lineHeight: 18 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.42 },
});
