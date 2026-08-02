# CCR-001 — Executable Backend Supporting Types

Requester: Role B — Agent Intelligence & GCP Backend  
Affected contract: `docs/03-contracts.md` sections 1–4  
Decision: Accepted for Role B integration baseline (2026-08-02)

## Current limitation

Document defines core `AccessPolicy`, catalog, event, and receipt examples, but executable slice also needs stable adapter results, reservation states, compiler validation metadata, merchant maxima, and transaction status semantics. `scopeViolation` literal may imply denied HTTP requests trigger settlement, conflicting with invariant that blocked requests have zero penalty.

## Proposed additive changes

1. `MerchantCapabilityCatalog` optional maxima:
   - `maxTotalCalls`, `maxRequestsPerMinute`, `maxSessionTtlSeconds`
   - `maxUsageCapAtomic`, `maxBondAmountAtomic`, `maxPenaltyAtomic`
   - `defaultExpiryPenaltyAtomic`
2. `SessionState`: documented state literals.
3. `ReservationState`: `ACTIVE | RELEASED | CONSUMED | EXPIRED`.
4. Adapter result envelope:
   - `status: PENDING | CONFIRMED | FAILED`
   - `retryable`, optional `providerReference`, optional `failureCode`
   - fake responses carry exact `FAKE_ADAPTER_FIXTURE` marker.
5. Compiler response metadata:
   - excluded permissions
   - validation status, repair count, clamp list, compiler mode
   - fake responses carry exact `FAKE_COMPILER_FIXTURE` marker.
6. Receipt transaction entries expose only stable domain kind/status/reference, never provider SDK objects.
7. Clarify `scopeViolation` is not triggered by a denied request. MVP settlement trigger is objectively expired reservation only.

## Breaking impact

None for existing required fields. Optional catalog additions are additive. Clarification narrows behavior to already documented safety invariant.

## Migration

Role A may consume existing `BotBondEvent` unchanged. Role C implements adapter interfaces from `packages/contracts/src/index.ts`; real result mapping replaces fake markers without changing Gateway domain logic.
