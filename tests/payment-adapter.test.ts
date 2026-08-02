/**
 * CappedSessionPaymentAdapter 테스트 — docs/09 PaymentAdapter 계약:
 * stable envelope, activation 규칙(usageLimitAtomic), cap 상한 정산, credential 불투명성.
 * 체인 불필요 (validator 없이 단독 실행 가능).
 */
import { assert } from "chai";
import { CappedSessionPaymentAdapter } from "../packages/payment-client/src/payment-adapter";

const SECRET = "local-slice-shared-secret";

describe("CappedSessionPaymentAdapter (docs/09 계약)", () => {
  it("createChallenge: CONFIRMED envelope + cap 에코 + 세션 단위 idempotent", async () => {
    const adapter = new CappedSessionPaymentAdapter({ hmacSecret: SECRET });
    const r1 = await adapter.createChallenge({ sessionId: "ses_1", usageCapAtomic: "200000" });
    assert.equal(r1.status, "CONFIRMED");
    assert.equal(r1.retryable, false);
    assert.equal(r1.usageCapAtomic, "200000");
    assert.isString(r1.challenge);
    assert.equal(r1.providerReference, "challenge:ses_1");

    const r2 = await adapter.createChallenge({ sessionId: "ses_1", usageCapAtomic: "200000" });
    assert.equal(r2.challenge, r1.challenge, "같은 세션 재요청은 같은 challenge");
  });

  it("createChallenge: float/음수/빈 금액은 AMOUNT_INVALID", async () => {
    const adapter = new CappedSessionPaymentAdapter({ hmacSecret: SECRET });
    for (const bad of ["1.5", "-3", "", "01", "1e6"]) {
      const r = await adapter.createChallenge({ sessionId: "ses_bad", usageCapAtomic: bad });
      assert.equal(r.status, "FAILED");
      assert.equal(r.failureCode, "AMOUNT_INVALID");
      assert.equal(r.retryable, false);
    }
  });

  it("verifyCredential: 발급 credential은 CONFIRMED + usageLimitAtomic (activation 규칙 충족)", async () => {
    const adapter = new CappedSessionPaymentAdapter({ hmacSecret: SECRET });
    const ch = await adapter.createChallenge({ sessionId: "ses_2", usageCapAtomic: "200000" });
    const cred = adapter.issueCredential("ses_2", "200000");
    const v = await adapter.verifyCredential({
      sessionId: "ses_2",
      credential: cred,
      challenge: ch.challenge,
    });
    assert.equal(v.status, "CONFIRMED");
    assert.equal(v.usageLimitAtomic, "200000");
    // gateway activation: usageLimitAtomic >= usageCapAtomic
    assert.isTrue(BigInt(v.usageLimitAtomic!) >= 200000n);
  });

  it("verifyCredential: 서명 위조·타 세션 credential 거부, 결과에 credential 원문 미노출", async () => {
    const adapter = new CappedSessionPaymentAdapter({ hmacSecret: SECRET });
    const cred = adapter.issueCredential("ses_3", "200000");

    const tampered = await adapter.verifyCredential({
      sessionId: "ses_3",
      credential: cred.slice(0, -2) + "00",
    });
    assert.equal(tampered.status, "FAILED");
    assert.equal(tampered.failureCode, "CREDENTIAL_INVALID");

    const wrongSession = await adapter.verifyCredential({ sessionId: "ses_other", credential: cred });
    assert.equal(wrongSession.status, "FAILED");
    assert.equal(wrongSession.failureCode, "CREDENTIAL_SESSION_MISMATCH");

    // credential 불투명성: 어떤 결과에도 원문이 포함되지 않는다 (docs/09 규칙 4)
    for (const r of [tampered, wrongSession]) {
      assert.notInclude(JSON.stringify(r), cred.slice(0, 24));
    }
  });

  it("verifyCredential: challenge cap보다 낮은 한도의 credential은 거부", async () => {
    const adapter = new CappedSessionPaymentAdapter({ hmacSecret: SECRET });
    const ch = await adapter.createChallenge({ sessionId: "ses_4", usageCapAtomic: "200000" });
    const lowCred = adapter.issueCredential("ses_4", "100000");
    const v = await adapter.verifyCredential({
      sessionId: "ses_4",
      credential: lowCred,
      challenge: ch.challenge,
    });
    assert.equal(v.status, "FAILED");
    assert.equal(v.failureCode, "CREDENTIAL_INVALID");
  });

  it("getUsageSettlement: 정확 과금 (calls x unit) — docs/03 receipt 예시 재현", async () => {
    const adapter = new CappedSessionPaymentAdapter({ hmacSecret: SECRET, unitPriceAtomic: "1000" });
    const r = await adapter.getUsageSettlement({
      sessionId: "ses_5",
      calls: 20,
      usageCapAtomic: "200000",
    });
    assert.equal(r.status, "CONFIRMED");
    assert.equal(r.usageChargedAtomic, "20000"); // docs/03 §3 receipt 예시와 동일
  });

  it("getUsageSettlement: cap 초과분은 cap으로 상한 (bounded by cap)", async () => {
    const adapter = new CappedSessionPaymentAdapter({ hmacSecret: SECRET, unitPriceAtomic: "1000" });
    const r = await adapter.getUsageSettlement({
      sessionId: "ses_6",
      calls: 999,
      usageCapAtomic: "200000",
    });
    assert.equal(r.status, "CONFIRMED");
    assert.equal(r.usageChargedAtomic, "200000");
  });

  it("getUsageSettlement: 비정수·음수 calls는 USAGE_INPUT_INVALID", async () => {
    const adapter = new CappedSessionPaymentAdapter({ hmacSecret: SECRET });
    for (const bad of [-1, 1.5, NaN]) {
      const r = await adapter.getUsageSettlement({
        sessionId: "ses_7",
        calls: bad,
        usageCapAtomic: "200000",
      });
      assert.equal(r.status, "FAILED");
      assert.equal(r.failureCode, "USAGE_INPUT_INVALID");
    }
  });
});
