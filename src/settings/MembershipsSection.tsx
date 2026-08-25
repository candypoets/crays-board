import { useRef, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { signActiveEvent } from "@/account/account";
import { Badge, Button, EmptyState, Field, Panel } from "@/components/ui";
import { publishEvent } from "@/nostr/publish";
import { colors } from "@/theme/colors";
import { useVenue } from "@/venue/VenueContext";

import type { MembershipPlan } from "./fold";
import {
  buildMembershipDefinition,
  MEMBERSHIP_PERIODS,
  validateMembershipDraft,
  type Availability,
  type MembershipPeriod,
} from "./protocol";

const PERIOD_LABEL: Record<MembershipPeriod, string> = {
  "one-time": "One-time",
  monthly: "Monthly",
  yearly: "Yearly",
};

const AVAILABILITY_TONE: Record<Availability, "success" | "warning" | "neutral"> = {
  available: "success",
  unavailable: "warning",
  archived: "neutral",
};

type MutationState = { phase: "publishing" } | { phase: "error"; message: string };

/**
 * Membership plan list and in-place editor (MEMBER-01/02). Every mutation
 * republishes the definition at its stable d and is confirmed only after an
 * affirmative relay acknowledgement; availability flips publish the same d
 * with the flipped availability tag.
 */
export function MembershipsSection({ memberships, loaded }: { memberships: MembershipPlan[]; loaded: boolean }) {
  const { venue } = useVenue();
  const [mutations, setMutations] = useState<Record<string, MutationState>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());

  const publishUpdate = (plan: MembershipPlan, next: Omit<MembershipPlan, "address" | "id" | "authorPubkey" | "createdAt">) => {
    if (!venue || inFlight.current.has(plan.address)) return;
    inFlight.current.add(plan.address);
    setMutations((current) => ({ ...current, [plan.address]: { phase: "publishing" } }));
    void (async () => {
      const template = buildMembershipDefinition(next);
      const signed = await signActiveEvent(template);
      await publishEvent(signed, [venue.relayUrl], "membership_definition");
      if (__DEV__) {
        console.log(
          `[crays-board-membership]${JSON.stringify({ id: signed.id, d: next.d, availability: next.availability })}`,
        );
      }
      setMutations((current) => {
        const rest = { ...current };
        delete rest[plan.address];
        return rest;
      });
      setEditing((current) => (current === plan.address ? null : current));
    })()
      .catch((cause: unknown) => {
        setMutations((current) => ({
          ...current,
          [plan.address]: { phase: "error", message: cause instanceof Error ? cause.message : String(cause) },
        }));
      })
      .finally(() => {
        inFlight.current.delete(plan.address);
      });
  };

  const toggleAvailability = (plan: MembershipPlan) => {
    // The Switch shows projection truth; the flip publishes the same d with
    // the opposite availability and the projection follows the relay echo.
    const availability: Availability = plan.availability === "available" ? "unavailable" : "available";
    publishUpdate(plan, { ...plan, availability });
  };

  if (!loaded) {
    return <Text style={styles.loading}>Loading membership plans…</Text>;
  }

  if (memberships.length === 0) {
    return (
      <EmptyState
        icon="card-account-details-outline"
        title="No membership plans"
        description="One-time, monthly, and yearly plans published for this venue appear here."
      />
    );
  }

  return (
    <View style={styles.list}>
      {memberships.map((plan) => {
        const mutation = mutations[plan.address];
        const publishing = mutation?.phase === "publishing";
        const available = plan.availability === "available";
        return (
          <Panel key={plan.address} testID={`settings-membership-card-${plan.d}`} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitle}>
                <Text style={styles.planName}>{plan.name}</Text>
                <Text style={styles.planMeta}>
                  {PERIOD_LABEL[plan.period]} · {plan.price} {plan.currency}
                </Text>
              </View>
              <Badge label={plan.availability} tone={AVAILABILITY_TONE[plan.availability]} />
            </View>
            {plan.description ? <Text style={styles.planDescription}>{plan.description}</Text> : null}
            <View style={styles.cardActions}>
              <View style={styles.toggleGroup}>
                <Text style={styles.toggleLabel}>{publishing ? "Updating…" : available ? "Available" : "Unavailable"}</Text>
                <Switch
                  testID={`settings-membership-toggle-${plan.d}`}
                  accessibilityLabel={`${plan.name} availability`}
                  value={available}
                  disabled={publishing}
                  onValueChange={() => toggleAvailability(plan)}
                  trackColor={{ false: colors.borderStrong, true: colors.pinkSoft }}
                  thumbColor={available ? colors.pink : colors.white}
                />
              </View>
              <Button
                testID={`settings-membership-edit-${plan.d}`}
                label={editing === plan.address ? "Close editor" : "Edit"}
                tone="secondary"
                compact
                onPress={() => setEditing((current) => (current === plan.address ? null : plan.address))}
              />
            </View>
            {mutation?.phase === "error" ? <Text style={styles.errorText}>{mutation.message}</Text> : null}
            {editing === plan.address ? (
              <MembershipEditor
                plan={plan}
                publishing={publishing}
                onSave={(next) => publishUpdate(plan, next)}
              />
            ) : null}
          </Panel>
        );
      })}
    </View>
  );
}

function MembershipEditor({
  plan,
  publishing,
  onSave,
}: {
  plan: MembershipPlan;
  publishing: boolean;
  onSave: (next: Omit<MembershipPlan, "address" | "id" | "authorPubkey" | "createdAt">) => void;
}) {
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description);
  const [price, setPrice] = useState(plan.price);
  const [currency, setCurrency] = useState(plan.currency);
  const [period, setPeriod] = useState<MembershipPeriod>(plan.period);

  const draft = { d: plan.d, name, description, period, price, currency, availability: plan.availability };
  const validationError = validateMembershipDraft(draft);

  return (
    <View style={styles.editor}>
      <Field label="Name" testID="settings-membership-name" value={name} onChangeText={setName} />
      <Field
        label="Description"
        testID="settings-membership-description"
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <View style={styles.row}>
        <View style={styles.rowItem}>
          <Field
            label="Price"
            testID="settings-membership-price"
            value={price}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={styles.rowItem}>
          <Field
            label="Currency"
            testID="settings-membership-currency"
            value={currency}
            onChangeText={setCurrency}
            autoCapitalize="characters"
            maxLength={3}
          />
        </View>
      </View>
      <Text style={styles.periodLabel}>Billing period</Text>
      <View style={styles.periodRow}>
        {MEMBERSHIP_PERIODS.map((option) => (
          <Pressable
            key={option}
            testID={`settings-membership-period-${option}`}
            accessibilityRole="button"
            accessibilityState={{ selected: period === option }}
            onPress={() => setPeriod(option)}
            style={[styles.periodChip, period === option && styles.periodChipActive]}
          >
            <Text style={[styles.periodChipText, period === option && styles.periodChipTextActive]}>
              {PERIOD_LABEL[option]}
            </Text>
          </Pressable>
        ))}
      </View>
      {validationError ? <Text style={styles.errorText}>{validationError}</Text> : null}
      <View style={styles.editorActions}>
        <Button
          testID="settings-membership-save"
          label={publishing ? "Saving…" : "Save membership"}
          onPress={() => onSave(draft)}
          disabled={publishing || validationError !== null}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, paddingVertical: 24 },
  list: { gap: 14 },
  card: { gap: 10 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  cardTitle: { flex: 1, gap: 2 },
  planName: { color: colors.ink, fontSize: 17, lineHeight: 22, fontWeight: "800" },
  planMeta: { color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  planDescription: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  cardActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14, minHeight: 48 },
  toggleGroup: { flexDirection: "row", alignItems: "center", gap: 10 },
  toggleLabel: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  editor: { gap: 14, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14 },
  row: { flexDirection: "row", gap: 12 },
  rowItem: { flex: 1 },
  periodLabel: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  periodRow: { flexDirection: "row", gap: 8 },
  periodChip: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
  },
  periodChipActive: { backgroundColor: colors.pink, borderColor: colors.pink },
  periodChipText: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  periodChipTextActive: { color: colors.white },
  editorActions: { flexDirection: "row", justifyContent: "flex-end" },
});
