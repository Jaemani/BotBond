/**
 * canonical policy hash 테스트 — docs/03 §1 Canonicalization.
 * 체인 불필요. golden fixture 패리티는 병합 후 GOLDEN 블록 주석 해제로 확정.
 */
import { assert } from "chai";
import { canonicalJson, canonicalPolicyHash } from "../packages/payment-client/src/policy-hash";
import golden from "../packages/contracts/fixtures/golden-policy.json";

// docs/03 §1 AccessPolicy 형태의 자체 fixture (golden 아님 — 구조 검증용)
const samplePolicy = {
  version: "botbond-policy/v1",
  policyId: "pol_demo_1",
  merchantId: "demo-commerce",
  agentWallet: "DemoAgentWallet1111111111111111111111111111",
  purpose: "Compare laptops and reserve one",
  allowedOperations: [
    {
      method: "GET",
      pathTemplate: "/products",
      allowedResponseFields: ["id", "name", "price", "stock", "shipping"],
      maxCalls: 30,
    },
  ],
  constraints: {
    maxTotalCalls: 40,
    maxRequestsPerMinute: 30,
    expiresAt: "2026-08-03T00:00:00Z",
    usageCapAtomic: "200000",
    bondAmountAtomic: "1000000",
    maxPenaltyAtomic: "500000",
  },
  bondedActions: [
    { operationId: "reserve-item", maxActive: 1, ttlSeconds: 60, expiryPenaltyAtomic: "300000" },
  ],
  settlement: {
    validClose: "REFUND_BOND",
    scopeViolation: "BOUNDED_PENALTY_AND_REFUND_REMAINDER",
    expiry: "RECLAIM_AFTER_GRACE_PERIOD",
  },
  catalogVersion: "merchant-catalog/v1@1",
};

describe("canonical policy hash (docs/03 Canonicalization)", () => {
  it("중첩 key 순서와 무관하게 같은 hash", () => {
    const reordered = JSON.parse(
      JSON.stringify({
        catalogVersion: samplePolicy.catalogVersion,
        settlement: {
          expiry: samplePolicy.settlement.expiry,
          validClose: samplePolicy.settlement.validClose,
          scopeViolation: samplePolicy.settlement.scopeViolation,
        },
        bondedActions: samplePolicy.bondedActions,
        constraints: {
          maxPenaltyAtomic: samplePolicy.constraints.maxPenaltyAtomic,
          bondAmountAtomic: samplePolicy.constraints.bondAmountAtomic,
          usageCapAtomic: samplePolicy.constraints.usageCapAtomic,
          expiresAt: samplePolicy.constraints.expiresAt,
          maxRequestsPerMinute: samplePolicy.constraints.maxRequestsPerMinute,
          maxTotalCalls: samplePolicy.constraints.maxTotalCalls,
        },
        allowedOperations: samplePolicy.allowedOperations,
        purpose: samplePolicy.purpose,
        agentWallet: samplePolicy.agentWallet,
        merchantId: samplePolicy.merchantId,
        policyId: samplePolicy.policyId,
        version: samplePolicy.version,
      })
    );
    assert.equal(canonicalPolicyHash(reordered), canonicalPolicyHash(samplePolicy));
  });

  it("배열 순서는 의미 있음 (순서 바뀌면 다른 hash)", () => {
    const swapped = JSON.parse(JSON.stringify(samplePolicy));
    swapped.allowedOperations[0].allowedResponseFields = ["name", "id", "price", "stock", "shipping"];
    assert.notEqual(canonicalPolicyHash(swapped), canonicalPolicyHash(samplePolicy));
  });

  it("값 1글자 변경도 hash 변경", () => {
    const mutated = JSON.parse(JSON.stringify(samplePolicy));
    mutated.constraints.usageCapAtomic = "200001";
    assert.notEqual(canonicalPolicyHash(mutated), canonicalPolicyHash(samplePolicy));
  });

  it("canonical 형식: 공백 없음·key 정렬·sha256: 접두", () => {
    const c = canonicalJson({ b: 1, a: [{ d: null, c: "x" }] });
    assert.equal(c, '{"a":[{"c":"x","d":null}],"b":1}');
    assert.match(canonicalPolicyHash(samplePolicy), /^sha256:[0-9a-f]{64}$/);
  });

  it("golden policy fixture 패리티", () => {
    assert.equal(
      canonicalPolicyHash(golden),
      "sha256:0fa81a98b90a317baf33b20bd55401cf63f27f9a1dc7e5cb439237f564605ed6"
    );
  });
});
