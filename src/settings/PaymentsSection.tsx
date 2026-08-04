import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button, Panel } from "@/components/ui";
import { colors } from "@/theme/colors";
import { useVenue } from "@/venue/VenueContext";

import { fetchPaymentStatus, type PaymentStatus } from "./payments";

const STATE_LABEL: Record<PaymentStatus["state"], string> = {
  not_configured: "Not configured",
  onboarding: "Onboarding required",
  restricted: "Requirements due",
  active: "Active",
  unavailable: "Status unavailable",
};

/**
 * Payments status surface (PAYMENT-01). Read-only in this slice: it reports
 * the payment-service truth for the selected venue and offers no Stripe
 * handoff yet. An unanswered service is "Status unavailable", never a fake
 * connected or configured state.
 */
export function PaymentsSection() {
  const { venue } = useVenue();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; status: PaymentStatus } | null>(null);

  const key = `${venue?.serviceUrl ?? "none"}:${retry}`;
  const status = result?.key === key ? result.status : null;

  useEffect(() => {
    if (!venue) return;
    let cancelled = false;
    void fetchPaymentStatus(venue.serviceUrl).then((paymentStatus) => {
      if (!cancelled) setResult({ key, status: paymentStatus });
    });
    return () => {
      cancelled = true;
    };
  }, [venue, key]);

  return (
    <Panel testID="payments-status" style={styles.panel}>
      <Text style={styles.title}>Payments</Text>
      {!status ? (
        <Text style={styles.body}>Checking the payment service…</Text>
      ) : (
        <View style={styles.statusBlock}>
          <Text style={[styles.stateLabel, status.state === "active" ? styles.stateActive : styles.stateMuted]}>
            {STATE_LABEL[status.state]}
          </Text>
          <Text style={styles.body}>{status.detail}</Text>
          <Text style={styles.hint}>
            Payment onboarding and the Stripe dashboard open from this surface in a later slice. Business, card, and
            bank details always stay with Stripe.
          </Text>
          {status.state === "unavailable" ? (
            <Button label="Try again" tone="secondary" compact onPress={() => setRetry((count) => count + 1)} />
          ) : null}
        </View>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 12 },
  title: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: "800" },
  statusBlock: { gap: 10, alignItems: "flex-start" },
  stateLabel: { fontSize: 20, lineHeight: 25, fontWeight: "800" },
  stateActive: { color: colors.success },
  stateMuted: { color: colors.inkMuted },
  body: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
});
