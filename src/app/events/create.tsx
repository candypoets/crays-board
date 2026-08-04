import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { signActiveEvent } from "@/account/account";
import { Button, Field, Panel, ScreenTitle } from "@/components/ui";
import {
  EVENT_CATEGORIES,
  emptyDraft,
  formatSchedule,
  hasErrors,
  localTimezoneName,
  newEventIdentifier,
  validateDetails,
  validateSchedule,
  type DraftErrors,
  type EventDraft,
} from "@/events/draft";
import { buildCalendarEvent, calendarEventAddress } from "@/events/protocol";
import { publishEvent } from "@/nostr/publish";
import { AppShell } from "@/shell/AppShell";
import { colors } from "@/theme/colors";
import { useVenue } from "@/venue/VenueContext";

/** Owner/admin persona for this slice (matches the QA seed identity). */
const ADMIN_PERMISSIONS = ["posts", "media", "events", "store", "invites", "moderation", "settings"];

type PublishState = { phase: "idle" } | { phase: "publishing" } | { phase: "error"; message: string };

const STEP_TITLES = ["Details", "Schedule & place", "Admission"] as const;

function StepIndicator({ step }: { step: number }) {
  return (
    <View style={styles.steps}>
      {STEP_TITLES.map((title, index) => {
        const isActive = index === step;
        const isDone = index < step;
        return (
          <View key={title} style={styles.stepItem}>
            <View style={[styles.stepDot, (isActive || isDone) && styles.stepDotActive]}>
              <Text style={[styles.stepDotLabel, (isActive || isDone) && styles.stepDotLabelActive]}>
                {index + 1}
              </Text>
            </View>
            <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]}>{title}</Text>
          </View>
        );
      })}
    </View>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <Text style={styles.fieldError}>{message}</Text>;
}

function DetailsStep({
  draft,
  errors,
  onChange,
}: {
  draft: EventDraft;
  errors: DraftErrors;
  onChange: (patch: Partial<EventDraft>) => void;
}) {
  return (
    <View style={styles.stepBody} testID="event-create-step-details">
      <Field
        testID="event-field-title"
        label="Event title"
        value={draft.title}
        onChangeText={(title) => onChange({ title })}
        placeholder="Sunday listening room"
      />
      <FieldError message={errors.title} />
      <Field
        testID="event-field-summary"
        label="Summary"
        value={draft.summary}
        onChangeText={(summary) => onChange({ summary })}
        placeholder="What should guests expect?"
        hint={`${draft.summary.trim().length} / 200`}
        multiline
      />
      <FieldError message={errors.summary} />
      <Text style={styles.groupLabel}>Category</Text>
      <View style={styles.chips}>
        {EVENT_CATEGORIES.map((category) => {
          const isActive = draft.category === category;
          const slug = category.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          return (
            <Pressable
              key={category}
              testID={`event-category-${slug}`}
              onPress={() => onChange({ category })}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              style={[styles.chip, isActive && styles.chipActive]}
            >
              <Text style={[styles.chipLabel, isActive && styles.chipLabelActive]}>{category}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ScheduleStep({
  draft,
  errors,
  onChange,
}: {
  draft: EventDraft;
  errors: DraftErrors;
  onChange: (patch: Partial<EventDraft>) => void;
}) {
  return (
    <View style={styles.stepBody} testID="event-create-step-schedule">
      <Field
        testID="event-field-date"
        label="Date"
        value={draft.date}
        onChangeText={(date) => onChange({ date })}
        placeholder="2027-01-15"
        hint="YYYY-MM-DD"
        autoCapitalize="none"
      />
      <FieldError message={errors.date} />
      <View style={styles.timeRow}>
        <View style={styles.timeField}>
          <Field
            testID="event-field-start"
            label="Start"
            value={draft.startTime}
            onChangeText={(startTime) => onChange({ startTime })}
            placeholder="18:00"
            autoCapitalize="none"
          />
          <FieldError message={errors.startTime} />
        </View>
        <View style={styles.timeField}>
          <Field
            testID="event-field-end"
            label="End"
            value={draft.endTime}
            onChangeText={(endTime) => onChange({ endTime })}
            placeholder="20:00"
            autoCapitalize="none"
          />
          <FieldError message={errors.endTime} />
        </View>
      </View>
      <Field
        testID="event-field-capacity"
        label="Capacity (optional)"
        value={draft.capacity}
        onChangeText={(capacity) => onChange({ capacity })}
        placeholder="60"
        hint="Maximum number of guests; leave empty for unlimited."
        keyboardType="number-pad"
      />
      <FieldError message={errors.capacity} />
      <Text style={styles.timezoneNote}>All times are in {localTimezoneName()}.</Text>
    </View>
  );
}

function AdmissionOption({
  testID,
  title,
  description,
  selected,
  disabled,
  onPress,
}: {
  testID: string;
  title: string;
  description: string;
  selected: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }}
      style={[styles.admission, selected && styles.admissionSelected, disabled && styles.admissionDisabled]}
    >
      <View style={[styles.radio, selected && styles.radioSelected]} />
      <View style={styles.admissionCopy}>
        <Text style={styles.admissionTitle}>{title}</Text>
        <Text style={styles.admissionDescription}>{description}</Text>
      </View>
    </Pressable>
  );
}

function AdmissionStep({
  draft,
  schedule,
  publish,
  onPublish,
}: {
  draft: EventDraft;
  schedule: { start: number; end: number };
  publish: PublishState;
  onPublish: () => void;
}) {
  return (
    <View style={styles.stepBody} testID="event-create-step-admission">
      <AdmissionOption
        testID="event-admission-open"
        title="Open & free"
        description="Anyone can attend. No ticket required."
        selected
        onPress={() => {}}
      />
      <AdmissionOption
        testID="event-admission-restricted"
        title="Restricted access"
        description="Only selected roles or memberships. Arrives in a later slice."
        selected={false}
        disabled
      />
      <AdmissionOption
        testID="event-admission-paid"
        title="Paid entry"
        description="Guests buy a ticket. Arrives in a later slice."
        selected={false}
        disabled
      />
      <Panel style={styles.review}>
        <Text style={styles.reviewTitle}>{draft.title.trim()}</Text>
        <Text style={styles.reviewMeta}>{formatSchedule(schedule.start, schedule.end)}</Text>
        <Text style={styles.reviewMeta}>Times in {localTimezoneName()}</Text>
        <Text style={styles.reviewMeta}>
          {draft.capacity.trim() ? `Capacity ${draft.capacity.trim()}` : "Unlimited capacity"} · {draft.category}
        </Text>
      </Panel>
      {publish.phase === "error" ? <Text style={styles.fieldError}>{publish.message}</Text> : null}
      <Button
        testID="event-publish-button"
        label={publish.phase === "publishing" ? "Publishing…" : publish.phase === "error" ? "Retry publish" : "Publish event"}
        onPress={onPublish}
        disabled={publish.phase === "publishing"}
      />
    </View>
  );
}

export default function EventCreateRoute() {
  const router = useRouter();
  const { venue } = useVenue();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<EventDraft>(emptyDraft);
  // One stable `d` per draft: a retry after an ack timeout republishes the
  // same addressable event instead of multiplying events (EVENT-04).
  const [identifier] = useState(newEventIdentifier);
  const [schedule, setSchedule] = useState<{ start: number; end: number } | null>(null);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [publish, setPublish] = useState<PublishState>({ phase: "idle" });
  // Repeat-tap guard: both presses of a double-tap can land before React
  // commits the publishing state, so React state alone cannot stop a second
  // publish; the ref is updated in the same handler.
  const publishing = useRef(false);

  const patchDraft = (patch: Partial<EventDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setErrors({});
  };

  const continueFromDetails = () => {
    const next = validateDetails(draft);
    setErrors(next);
    if (!hasErrors(next)) setStep(1);
  };

  const continueFromSchedule = () => {
    const result = validateSchedule(draft);
    setErrors(result.errors);
    if (!hasErrors(result.errors) && result.start !== undefined && result.end !== undefined) {
      setSchedule({ start: result.start, end: result.end });
      setStep(2);
    }
  };

  const publishDraft = () => {
    if (!venue || !schedule || publishing.current) return;
    publishing.current = true;
    setPublish({ phase: "publishing" });
    void (async () => {
      // Exactly one kind 31923 per deliberate publish, confirmed only after an
      // affirmative relay acknowledgement; local intent is never shown as
      // confirmed state before that (EVENT-04, venue-commerce-nip §6.8).
      const template = buildCalendarEvent({
        identifier,
        title: draft.title,
        summary: draft.summary,
        start: schedule.start,
        end: schedule.end,
      });
      const signed = await signActiveEvent(template);
      await publishEvent(signed, [venue.relayUrl], "event_publish");
      if (__DEV__) {
        console.log(
          `[crays-board-event-published]${JSON.stringify({
            id: signed.id,
            a: calendarEventAddress(signed.pubkey, identifier),
            title: draft.title.trim(),
          })}`,
        );
      }
      router.back();
    })().catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      setPublish({ phase: "error", message });
    }).finally(() => {
      publishing.current = false;
    });
  };

  return (
    <AppShell active="events" permissions={ADMIN_PERMISSIONS}>
      <View testID="event-create-screen" style={styles.screen}>
        <View style={styles.container}>
          <ScreenTitle title="Create event" description="Tell the community what is happening." />
          <StepIndicator step={step} />
          <ScrollView style={styles.form} contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
            {step === 0 ? <DetailsStep draft={draft} errors={errors} onChange={patchDraft} /> : null}
            {step === 1 ? <ScheduleStep draft={draft} errors={errors} onChange={patchDraft} /> : null}
            {step === 2 && schedule ? (
              <AdmissionStep draft={draft} schedule={schedule} publish={publish} onPublish={publishDraft} />
            ) : null}
            {/* Actions live inside the scroll content: as a pinned sibling
                after the ScrollView they intermittently failed to mount on
                cold sessions (empty footer), which the device QA gate caught. */}
            <View style={styles.footer}>
              {step > 0 ? (
                <Button testID="event-create-back" label="Back" tone="secondary" onPress={() => setStep(step - 1)} />
              ) : (
                <Button testID="event-create-cancel" label="Cancel" tone="secondary" onPress={() => router.back()} />
              )}
              {step === 0 ? <Button testID="event-create-continue" label="Continue" onPress={continueFromDetails} /> : null}
              {step === 1 ? <Button testID="event-create-continue" label="Continue" onPress={continueFromSchedule} /> : null}
            </View>
          </ScrollView>
        </View>
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, padding: 24, maxWidth: 720, width: "100%", alignSelf: "center" },
  steps: { flexDirection: "row", gap: 18, marginBottom: 20 },
  stepItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceWarm,
  },
  stepDotActive: { backgroundColor: colors.pink },
  stepDotLabel: { color: colors.inkMuted, fontSize: 13, fontWeight: "800" },
  stepDotLabelActive: { color: colors.white },
  stepLabel: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  stepLabelActive: { color: colors.ink },
  form: { flex: 1 },
  formContent: { paddingBottom: 24 },
  stepBody: { gap: 14 },
  groupLabel: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.surfaceWarm,
  },
  chipActive: { backgroundColor: colors.pinkSoft },
  chipLabel: { color: colors.inkMuted, fontSize: 14, fontWeight: "700" },
  chipLabelActive: { color: colors.pinkDark },
  fieldError: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  timeRow: { flexDirection: "row", gap: 12 },
  timeField: { flex: 1, gap: 7 },
  timezoneNote: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  admission: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  admissionSelected: { borderColor: colors.pink, backgroundColor: colors.pinkSoft },
  admissionDisabled: { opacity: 0.5 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  radioSelected: { borderColor: colors.pink, backgroundColor: colors.pink },
  admissionCopy: { flex: 1, gap: 2 },
  admissionTitle: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "700" },
  admissionDescription: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  review: { gap: 6 },
  reviewTitle: { color: colors.ink, fontSize: 17, lineHeight: 23, fontWeight: "800" },
  reviewMeta: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
