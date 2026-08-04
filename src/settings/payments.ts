/**
 * Payments status surface (PAYMENT-01, PRD §8.9). This slice is read-only and
 * honest: it reports the payment-service status for the selected venue and
 * never infers a connected account from anything but the service answer.
 * There is no Stripe onboarding handoff here yet.
 */
export type PaymentStatusState = "not_configured" | "onboarding" | "restricted" | "active" | "unavailable";

export type PaymentStatus = {
  state: PaymentStatusState;
  detail: string;
};

const FETCH_TIMEOUT_MS = 8_000;

/**
 * Maps one service answer to a display state. `configured: false` (including
 * the service's 503 with that payload) and a missing route both mean the
 * venue has no payment account — the honest "Not configured". A transport or
 * unexpected server failure is "unavailable", never "not configured".
 */
export function interpretPaymentStatus(httpStatus: number, body: unknown): PaymentStatus {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (record?.configured === false) {
    return { state: "not_configured", detail: "No payment account is configured for this venue." };
  }
  if (httpStatus === 404) {
    return { state: "not_configured", detail: "This venue service has no payments configured." };
  }
  if (httpStatus < 200 || httpStatus >= 300 || !record) {
    return { state: "unavailable", detail: "The payment service did not answer." };
  }
  if (record.connected !== true) {
    return { state: "onboarding", detail: "Payment onboarding has not been completed." };
  }
  if (record.chargesEnabled === false || record.payoutsEnabled === false) {
    return { state: "restricted", detail: "The payment account has requirements due." };
  }
  return { state: "active", detail: "Payments are active for this venue." };
}

export async function fetchPaymentStatus(serviceUrl: string): Promise<PaymentStatus> {
  const endpoint = `${serviceUrl.replace(/\/+$/, "")}/api/stripe/connect?action=status`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, { headers: { accept: "application/json" }, signal: controller.signal });
    const body: unknown = await response.json().catch(() => null);
    return interpretPaymentStatus(response.status, body);
  } catch {
    return { state: "unavailable", detail: "The payment service did not answer." };
  } finally {
    clearTimeout(timeout);
  }
}
