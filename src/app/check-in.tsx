import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { signActiveEvent } from "@/account/account";
import { Badge, Button, EmptyState, Field, Panel, ScreenTitle } from "@/components/ui";
import { useCheckIn } from "@/check-in/useCheckIn";
import {
  REJECTION_MESSAGE,
  validatePresentation,
  type RejectionReason,
} from "@/check-in/presentation";
import { buildOrderStatus } from "@/nostr/protocol";
import { publishEvent } from "@/nostr/publish";
import { useBreakpoint } from "@/shell/breakpoint";
import { colors } from "@/theme/colors";
import { useVenue } from "@/venue/VenueContext";

type SubmitState =
  | { phase: "idle" }
  | { phase: "publishing" }
  | { phase: "accepted"; holderPubkey: string }
  | { phase: "rejected"; reason: RejectionReason }
  | { phase: "error"; message: string };

function formatStart(start?: number): string {
  if (!start) return "Scheduled event";
  return `Starts ${new Date(start * 1000).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function SummaryPanel({ expected, checkedIn }: { expected: number; checkedIn: number }) {
  return (
    <Panel style={styles.summary}>
      <View style={styles.stat}>
        <Text testID="check-in-expected-count" style={styles.statValue}>
          {expected}
        </Text>
        <Text style={styles.statLabel}>expected</Text>
      </View>
      <View style={styles.statDivider} />
      <View style={styles.stat}>
        <Text testID="check-in-checked-in-count" style={styles.statValue}>
          {checkedIn}
        </Text>
        <Text style={styles.statLabel}>checked in</Text>
      </View>
      <Text testID="check-in-progress" style={styles.progress}>
        {checkedIn} of {expected} checked in
      </Text>
    </Panel>
  );
}

function ResultPanel({ submit }: { submit: SubmitState }) {
  if (submit.phase === "accepted") {
    return (
      <Panel testID="check-in-result-success" style={[styles.result, styles.resultSuccess]}>
        <Badge label="Entry accepted" tone="success" />
        <Text style={styles.resultText}>Guest {submit.holderPubkey.slice(0, 12)}… · Ticket valid · 1 use</Text>
      </Panel>
    );
  }
  if (submit.phase === "rejected") {
    return (
      <Panel testID="check-in-result-error" style={[styles.result, styles.resultError]}>
        <Badge label="Entry rejected" tone="danger" />
        <Text style={styles.resultText}>{REJECTION_MESSAGE[submit.reason]}</Text>
      </Panel>
    );
  }
  if (submit.phase === "error") {
    return (
      <Panel testID="check-in-result-error" style={[styles.result, styles.resultError]}>
        <Badge label="Not confirmed" tone="warning" />
        <Text style={styles.resultText}>{submit.message}</Text>
      </Panel>
    );
  }
  return null;
}

function ScannerPanel() {
  const [requested, setRequested] = useState(false);
  return (
    <Panel style={styles.scanner}>
      <Text style={styles.scannerTitle}>Scanner</Text>
      {requested ? (
        <View testID="check-in-camera-unavailable" style={styles.cameraNotice}>
          <Text style={styles.cameraNoticeTitle}>Camera not available in this build</Text>
          <Text style={styles.cameraNoticeBody}>
            This development build ships without the camera scanner. Use manual code entry to check guests in.
          </Text>
        </View>
      ) : (
        <>
          <Text style={styles.scannerBody}>
            Camera access is requested only when the scanner opens, and only to scan guest passes.
          </Text>
          <Button
            testID="check-in-scan-button"
            label="Scan guest pass"
            tone="secondary"
            onPress={() => setRequested(true)}
          />
        </>
      )}
    </Panel>
  );
}

function CheckInSubscription({ onRetry }: { onRetry: () => void }) {
  const { venue } = useVenue();
  const checkIn = useCheckIn();
  const breakpoint = useBreakpoint();
  const [code, setCode] = useState("");
  const [submit, setSubmit] = useState<SubmitState>({ phase: "idle" });
  // Locally fulfilled awards whose relay echo has not arrived yet (§8.4).
  const [locallyFulfilled, setLocallyFulfilled] = useState<ReadonlySet<string>>(new Set());
  // EVENT-12: synchronous in-flight guard so a double-submit cannot publish
  // a second fulfillment before React commits the "publishing" state.
  const inFlight = useRef(false);

  const submitCode = () => {
    if (!venue || inFlight.current || !checkIn.trust || !checkIn.event) return;
    const raw = code.trim();
    if (!raw) return;
    inFlight.current = true;
    const eventAddress = checkIn.event.address;

    const result = validatePresentation(raw, {
      eventAddress,
      venueRelayUrl: venue.relayUrl,
      awards: checkIn.awards,
      statuses: checkIn.statuses,
      revocations: checkIn.revocations,
      trust: checkIn.trust,
      now: Math.floor(Date.now() / 1000),
      locallyFulfilledAwardIds: locallyFulfilled,
    });

    if (!result.ok) {
      // Every rejection class produces a specific reason and zero writes.
      setSubmit({ phase: "rejected", reason: result.reason });
      setCode("");
      inFlight.current = false;
      return;
    }

    setSubmit({ phase: "publishing" });
    void (async () => {
      // NIP-97: exactly one fulfilled event-context status, confirmed only
      // after an affirmative relay acknowledgement.
      const template = buildOrderStatus({
        awardId: result.award.id,
        definitionAddress: result.award.definitionAddress,
        holderPubkey: result.award.holderPubkey,
        status: "fulfilled",
        context: { type: "event", eventCoordinate: eventAddress },
      });
      const signed = await signActiveEvent(template);
      await publishEvent(signed, [venue.relayUrl], "check_in_status");
      if (__DEV__) {
        console.log(
          `[crays-board-check-in-status]${JSON.stringify({
            id: signed.id,
            e: result.award.id,
            status: "fulfilled",
            context: "event",
          })}`,
        );
      }
      setLocallyFulfilled((current) => new Set(current).add(result.award.id));
      setSubmit({ phase: "accepted", holderPubkey: result.award.holderPubkey });
      setCode("");
    })()
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        setSubmit({ phase: "error", message });
      })
      .finally(() => {
        inFlight.current = false;
      });
  };

  const manualEntry = (
    <Panel style={styles.entry}>
      <Field
        label="Manual code entry"
        hint="Paste or type the guest's presentation code."
        testID="check-in-code-input"
        value={code}
        onChangeText={setCode}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        placeholder='{"kind":27236,…}'
      />
      <Button
        testID="check-in-submit"
        label={submit.phase === "publishing" ? "Checking in…" : "Check in guest"}
        onPress={submitCode}
        disabled={submit.phase === "publishing" || code.trim().length === 0}
      />
    </Panel>
  );

  if (checkIn.status === "error") {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="lan-disconnect"
          title="Cannot reach this venue"
          description={checkIn.error ?? "The venue relay or service did not answer."}
          action={<Button label="Try again" tone="secondary" onPress={onRetry} />}
        />
      </View>
    );
  }

  if (checkIn.status === "loading") {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Connecting to the venue relay…</Text>
      </View>
    );
  }

  if (!checkIn.event) {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="calendar-blank-outline"
          title="No upcoming event"
          description="There is no scheduled event to check guests in for."
        />
      </View>
    );
  }

  const header = (
    <View style={styles.eventHeader}>
      <Text testID="check-in-event-title" style={styles.eventTitle}>
        {checkIn.event.title ?? "Event"}
      </Text>
      <Text style={styles.eventMeta}>{formatStart(checkIn.event.start)}</Text>
    </View>
  );
  const summary = <SummaryPanel expected={checkIn.expected} checkedIn={checkIn.checkedIn} />;
  const result = <ResultPanel submit={submit} />;

  if (breakpoint === "tablet") {
    return (
      <View style={styles.columns}>
        <View style={styles.columnLeft}>
          <ScannerPanel />
        </View>
        <View style={styles.columnRight}>
          <View style={styles.pinnedContext}>
            {header}
            {summary}
          </View>
          <View style={styles.resultSlot}>
            <ScrollView style={styles.resultSlotScroll} contentContainerStyle={styles.resultSlotContent}>
              {result}
            </ScrollView>
          </View>
          <ScrollView style={styles.columnRightBody} contentContainerStyle={styles.columnContent}>
            {manualEntry}
          </ScrollView>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.single} contentContainerStyle={styles.columnContent}>
      {header}
      {summary}
      {result}
      {manualEntry}
      <ScannerPanel />
    </ScrollView>
  );
}

export default function CheckInRoute() {
  const router = useRouter();
  const { venue, restoring } = useVenue();
  const [retryKey, setRetryKey] = useState(0);
  const breakpoint = useBreakpoint();

  return (
    <SafeAreaView testID="check-in-screen" style={styles.screen} edges={["top", "right", "bottom", "left"]}>
      <View style={[styles.container, breakpoint === "phone" && styles.containerPhone]}>
        <ScreenTitle
          title="Event check-in"
          description={venue ? "Validate entry against the connected venue." : "No venue selected"}
          action={<Button label="Back" tone="quiet" compact onPress={() => router.back()} />}
        />
        {restoring ? (
          <View style={styles.center}>
            <Text style={styles.loadingText}>Restoring the venue…</Text>
          </View>
        ) : !venue ? (
          <EmptyState
            icon="store-off-outline"
            title="No venue selected"
            description="Select a venue before checking guests in."
            action={<Button label="Back to welcome" tone="secondary" onPress={() => router.replace("/")} />}
          />
        ) : (
          <CheckInSubscription key={retryKey} onRetry={() => setRetryKey((key) => key + 1)} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, padding: 24, maxWidth: 1080, width: "100%", alignSelf: "center" },
  containerPhone: { paddingHorizontal: 16, paddingTop: 18 },
  center: { flex: 1, justifyContent: "center" },
  loadingText: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, textAlign: "center" },
  columns: { flex: 1, flexDirection: "row", gap: 20, minWidth: 0 },
  columnLeft: { flex: 1.1, minWidth: 0 },
  columnRight: { flex: 1, minWidth: 0, gap: 16 },
  pinnedContext: { gap: 16, flexShrink: 0 },
  resultSlot: { height: 104, flexShrink: 0 },
  resultSlotScroll: { flex: 1 },
  resultSlotContent: { flexGrow: 1 },
  columnRightBody: { flex: 1, minHeight: 0 },
  single: { flex: 1 },
  columnContent: { gap: 16, paddingBottom: 32 },
  eventHeader: { gap: 2 },
  eventTitle: { color: colors.ink, fontSize: 22, lineHeight: 28, fontWeight: "800" },
  eventMeta: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  summary: { flexDirection: "row", alignItems: "center", gap: 20, flexWrap: "wrap" },
  stat: { alignItems: "center", minWidth: 88 },
  statValue: { color: colors.ink, fontSize: 30, lineHeight: 36, fontWeight: "800" },
  statLabel: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  statDivider: { width: 1, alignSelf: "stretch", backgroundColor: colors.border },
  progress: { flex: 1, color: colors.inkMuted, fontSize: 13, lineHeight: 18, textAlign: "right" },
  result: { gap: 8 },
  resultSuccess: { backgroundColor: colors.successSoft, borderColor: colors.success },
  resultError: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  resultText: { color: colors.ink, fontSize: 14, lineHeight: 20 },
  entry: { gap: 14 },
  scanner: { gap: 12, flex: 1 },
  scannerTitle: { color: colors.ink, fontSize: 17, lineHeight: 23, fontWeight: "800" },
  scannerBody: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  cameraNotice: {
    gap: 8,
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  cameraNoticeTitle: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "800" },
  cameraNoticeBody: { color: colors.inkMuted, fontSize: 13, lineHeight: 19 },
});
