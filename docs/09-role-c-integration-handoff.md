# Role C Integration Handoff

## Source-of-truth interfaces

```text
packages/contracts/src/index.ts
packages/contracts/src/adapter-contract.ts
packages/contracts/test/adapter-contract.test.ts
```

Provider SDK objects must not cross adapter boundary.

## PaymentAdapter

```ts
interface PaymentAdapter {
  createChallenge(input: {
    sessionId: string;
    usageCapAtomic: string;
  }): Promise<PaymentChallengeResult>;

  verifyCredential(input: {
    sessionId: string;
    credential: string;
    challenge?: string;
  }): Promise<PaymentVerificationResult>;

  getUsageSettlement(input: {
    sessionId: string;
    calls: number;
    usageCapAtomic: string;
  }): Promise<UsageSettlementResult>;
}
```

Gateway activation rules:

1. `status` must be `CONFIRMED`.
2. `usageLimitAtomic` must exist.
3. `usageLimitAtomic >= AccessPolicy.constraints.usageCapAtomic`.
4. Credential stays opaque and is never logged.

## BondAdapter

```ts
interface BondAdapter {
  verifyOpenBond(input: {
    sessionId: string;
    bondAccount: string;
    policyHash: string;
    amountAtomic: string;
    maxPenaltyAtomic: string;
  }): Promise<BondVerificationResult>;

  requestValidClose(input: {
    sessionId: string;
    policyHash: string;
    amountAtomic: string;
    evidence?: SettlementAuthorizationEvidence;
  }): Promise<BondSettlementResult>;

  requestExpiredReservationSettlement(input: {
    sessionId: string;
    policyHash: string;
    penaltyAtomic: string;
    maxPenaltyAtomic: string;
    bondAmountAtomic: string;
    reservationId: string;
    evidence?: SettlementAuthorizationEvidence;
  }): Promise<BondSettlementResult>;

  getTransactionStatus(input: {
    providerReference: string;
  }): Promise<AdapterResult>;
}
```

Gateway produces `SettlementAuthorizationEvidence` containing canonical evidence hash, authority, nonce, issuedAt, outcome, usage, penalty, refund, policy hash, and reservation ID. Local slice signs with HMAC; production signer must come from Secret Manager/KMS. Role C must bind and verify evidence hash/nonce at chain boundary and reject replay.

Gateway settlement rules:

- Denied HTTP request never calls BondAdapter settlement.
- Valid close requires full refund and zero penalty.
- Expiry settlement only follows objectively expired reservation.
- `penaltyAtomic <= maxPenaltyAtomic <= bondAmountAtomic`.
- `bondRefundedAtomic + penaltyAtomic == bondAmountAtomic`.
- Non-confirmed settlement cannot produce success receipt.
- Calls must be idempotent by stable session/reservation identity.

## Stable result envelope

```ts
{
  status: "PENDING" | "CONFIRMED" | "FAILED";
  retryable: boolean;
  providerReference?: string;
  failureCode?: string;
}
```

Additional stable amounts are atomic decimal strings. Never return floating point amounts.

## Contract harness

Real adapters must pass:

```ts
runPaymentAdapterContract(...)
runBondAdapterContract(...)
assertAdapterContract(report.checks)
```

The harness checks:

- stable status envelope
- payment cap coverage
- usage settlement bounded by cap
- bond amount and max penalty match policy
- valid close full refund
- expiry settlement boundedness
- bond conservation
- transaction status envelope

## Fake/live evidence

Real adapters must omit:

```text
fixtureMarker: "FAKE_ADAPTER_FIXTURE"
```

`providerReference` must be stable enough for transaction polling and receipt retrieval. Role C supplies UI-safe Explorer URL derivation separately; Gateway stores only stable reference.

## Required Role C delivery

1. Actual pay.sh-supported payment mode and exact pitch wording.
2. Real PaymentAdapter implementation.
3. Real BondAdapter implementation.
4. Stable failure code table and retry semantics.
5. Confirmation/finality rules.
6. Program ID, network, IDL, and transaction reference format.
7. Real adapter contract-test output.
8. At least one payment and devnet open/refund evidence.
9. Replay/double-settlement evidence.

## Golden policy

```text
packages/contracts/fixtures/golden-policy.json
packages/contracts/fixtures/golden-policy.sha256
```

Expected hash:

```text
sha256:120cece73bb7e5229db531c96d82b9d210a419ac9a901a34ccf72b136d346feb
```
