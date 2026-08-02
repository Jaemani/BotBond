import { describe, expect, it } from "vitest";
import { createSettlementEvidence, verifySettlementEvidence } from "../src/settlement-evidence.js";

describe("settlement authorization evidence", () => {
  it("signs canonical evidence and rejects tampering", () => {
    const evidence = createSettlementEvidence({
      sessionId: "ses_evidence",
      policyHash: "sha256:policy",
      reservationId: "res_evidence",
      outcome: "EXPIRED_RESERVATION",
      usageChargedAtomic: "3000",
      penaltyAtomic: "200000",
      bondRefundedAtomic: "800000",
      nonce: "expiry:res_evidence",
      issuedAt: "2026-08-02T12:01:00.000Z",
      authority: "gateway-test",
    }, "test-secret");
    expect(verifySettlementEvidence(evidence, "test-secret")).toBe(true);
    expect(verifySettlementEvidence({ ...evidence, penaltyAtomic: "300000" }, "test-secret")).toBe(false);
  });
});
