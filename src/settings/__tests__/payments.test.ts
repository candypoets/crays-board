/// <reference types="jest" />

import { interpretPaymentStatus } from "../payments";

describe("interpretPaymentStatus", () => {
  it("maps configured:false payloads to Not configured (including the 503 shape)", () => {
    expect(interpretPaymentStatus(503, { connected: false, configured: false }).state).toBe("not_configured");
    expect(interpretPaymentStatus(200, { connected: false, configured: false }).state).toBe("not_configured");
  });

  it("maps a missing route to Not configured", () => {
    expect(interpretPaymentStatus(404, null).state).toBe("not_configured");
  });

  it("maps transport and unexpected server failures to unavailable, never configured", () => {
    expect(interpretPaymentStatus(500, null).state).toBe("unavailable");
    expect(interpretPaymentStatus(502, { error: "boom" }).state).toBe("unavailable");
    expect(interpretPaymentStatus(200, "garbage").state).toBe("unavailable");
  });

  it("maps configured-but-not-connected to onboarding", () => {
    expect(interpretPaymentStatus(200, { configured: true, connected: false }).state).toBe("onboarding");
  });

  it("maps connected accounts with disabled rails to restricted", () => {
    expect(
      interpretPaymentStatus(200, { configured: true, connected: true, chargesEnabled: false, payoutsEnabled: true })
        .state,
    ).toBe("restricted");
    expect(
      interpretPaymentStatus(200, { configured: true, connected: true, chargesEnabled: true, payoutsEnabled: false })
        .state,
    ).toBe("restricted");
  });

  it("maps a fully enabled account to active", () => {
    expect(
      interpretPaymentStatus(200, { configured: true, connected: true, chargesEnabled: true, payoutsEnabled: true })
        .state,
    ).toBe("active");
  });
});
