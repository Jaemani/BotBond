# Interfaces and Contracts

이 문서가 병렬 개발의 기준이다. 각 담당자는 다른 모듈 내부를 추측하지 않고 여기의 타입과 상태만 사용한다.

## 1. 공통 정책 스키마

```ts
export type AccessPolicy = {
  version: "botbond-policy/v1";
  policyId: string;
  merchantId: string;
  agentWallet: string;
  purpose: string;
  allowedOperations: Array<{
    method: "GET" | "POST";
    pathTemplate: string;
    allowedResponseFields: string[];
    maxCalls: number;
  }>;
  constraints: {
    maxTotalCalls: number;
    maxRequestsPerMinute: number;
    expiresAt: string;
    usageCapAtomic: string;
    bondAmountAtomic: string;
    maxPenaltyAtomic: string;
  };
  bondedActions: Array<{
    operationId: string;
    maxActive: number;
    ttlSeconds: number;
    expiryPenaltyAtomic: string;
  }>;
  settlement: {
    validClose: "REFUND_BOND";
    scopeViolation: "BOUNDED_PENALTY_AND_REFUND_REMAINDER";
    expiry: "RECLAIM_AFTER_GRACE_PERIOD";
  };
  catalogVersion: string;
};
```

### Canonicalization

- key ordering이 안정적인 canonical JSON을 사용한다.
- hash는 `sha256(canonical_json_bytes)`다.
- UI, Gateway, Solana client가 동일 fixture에 대해 같은 hash를 생성하는 contract test를 둔다.

## 2. Merchant Capability Catalog

```json
{
  "version": "merchant-catalog/v1",
  "merchantId": "demo-commerce",
  "operations": [
    {
      "id": "search-products",
      "method": "GET",
      "pathTemplate": "/products",
      "fields": ["id", "name", "price", "stock", "shipping"],
      "maxCalls": 10,
      "riskTier": "LOW"
    },
    {
      "id": "get-inventory",
      "method": "GET",
      "pathTemplate": "/products/{id}/inventory",
      "fields": ["stock", "updatedAt"],
      "maxCalls": 25,
      "riskTier": "LOW"
    },
    {
      "id": "reserve-inventory",
      "method": "POST",
      "pathTemplate": "/reservations",
      "fields": ["productId", "quantity", "expiresAt"],
      "maxCalls": 1,
      "riskTier": "BONDED"
    }
  ],
  "forbiddenPaths": ["/seller-contacts", "/users", "/admin"]
}
```

Intent Compiler는 이 목록 밖의 operation을 만들 수 없다.

## 3. Gateway API

### `GET /.well-known/agent-access`

응답:

```json
{
  "protocol": "botbond/v1",
  "intentEndpoint": "/v1/intents",
  "sessionEndpoint": "/v1/sessions",
  "catalogUrl": "/v1/catalog",
  "payment": {"provider": "pay.sh", "mode": "SPIKE_DEPENDENT"},
  "bond": {"network": "solana-devnet", "programId": "TBD"}
}
```

### `POST /v1/intents`

요청:

```json
{
  "agentWallet": "...",
  "task": "Compare 20 laptops under 1.5M KRW using price and stock only.",
  "budget": {"usageCapAtomic": "200000", "bondCapAtomic": "1000000"}
}
```

응답:

```json
{
  "intentId": "int_...",
  "policy": {},
  "policyHash": "sha256:...",
  "explanation": ["Price and stock are required", "Seller contacts excluded"],
  "paymentTerms": {},
  "bondTerms": {}
}
```

### `POST /v1/sessions`

요청:

```json
{
  "intentId": "int_...",
  "policyHash": "sha256:...",
  "paymentCredential": "opaque-pay-sh-value",
  "bondAccount": "solana-pda-address"
}
```

응답:

```json
{
  "sessionId": "ses_...",
  "token": "short-lived-scoped-token",
  "expiresAt": "2026-08-01T10:05:00Z",
  "eventStream": "/v1/sessions/ses_.../events"
}
```

### `ANY /v1/access/{sessionId}/*`

Gateway가 token, policy, usage를 검사하고 보호 API로 proxy한다.

### `POST /v1/sessions/{sessionId}/close`

정상 close 또는 위반 후 finalization을 시작하고 receipt를 반환한다.

### `GET /v1/sessions/{sessionId}/receipt`

```json
{
  "sessionId": "ses_...",
  "outcome": "CLOSED",
  "policyHash": "sha256:...",
  "calls": 20,
  "usageChargedAtomic": "20000",
  "bondRefundedAtomic": "1000000",
  "penaltyAtomic": "0",
  "transactions": [],
  "receiptHash": "sha256:..."
}
```

## 4. Event 계약

모든 컴포넌트는 다음 envelope를 사용한다.

```ts
type BotBondEvent = {
  eventId: string;
  sessionId: string;
  occurredAt: string;
  type:
    | "INTENT_RECEIVED"
    | "POLICY_COMPILED"
    | "PAYMENT_VERIFIED"
    | "BOND_OPENED"
    | "SESSION_ACTIVATED"
    | "REQUEST_ALLOWED"
    | "REQUEST_DENIED"
    | "RESERVATION_CREATED"
    | "RESERVATION_RELEASED"
    | "RESERVATION_CONSUMED"
    | "RESERVATION_EXPIRED"
    | "USAGE_SETTLED"
    | "BOND_REFUNDED"
    | "PENALTY_SETTLED"
    | "SESSION_CLOSED";
  data: Record<string, unknown>;
  traceId: string;
};
```

프론트엔드는 이 event 계약만으로 타임라인을 구현한다. 백엔드 내부 로그 형식에 의존하지 않는다.

## 5. Solana Program 계약

### PDA

```text
BondSession PDA seeds = ["bond", agent_pubkey, policy_hash, session_nonce]
```

### Account

```rust
pub struct BondSession {
    pub agent: Pubkey,
    pub merchant: Pubkey,
    pub settlement_authority: Pubkey,
    pub mint: Pubkey,
    pub policy_hash: [u8; 32],
    pub receipt_hash: [u8; 32],
    pub bond_amount: u64,
    pub max_penalty: u64,
    pub settled_penalty: u64,
    pub expires_at: i64,
    pub status: u8,
    pub bump: u8,
}
```

### Instructions

#### `open_bond`

- agent signer 필요
- policy hash, merchant, mint, amount, max penalty, expiry 저장
- agent ATA에서 escrow ATA로 전송
- `max_penalty <= bond_amount`

#### `close_valid`

- reservation이 없거나 release/consume된 authorized settlement receipt 필요
- penalty는 0
- bond 전액 agent 반환
- settled flag 설정

#### `settle_violation`

- 만료된 reservation을 포함한 receipt hash와 authority signature 필요
- `penalty <= max_penalty`
- penalty를 merchant 또는 지정 settlement vault로 전송
- 나머지를 agent 반환
- 중복 settlement 금지

#### `reclaim_expired`

- expiry + grace period 이후 agent 호출 가능
- 아직 settled되지 않았으면 전액 agent 반환

### Events

- `BondOpened`
- `BondRefunded`
- `ViolationSettled`
- `BondReclaimed`

## 6. Mock 경계

병렬 개발을 위해 다음 mock을 첫날 제공한다.

- frontend용 SSE event fixture
- gateway용 Intent Compiler response fixture
- gateway용 pay.sh verification interface와 fake adapter
- frontend/gateway용 Solana transaction fixture
- chain 담당자용 고정 `policy.json`

Mock은 최종 데모에서 실제 구현으로 교체해야 하며, 화면에 mock 결과를 live transaction처럼 표시하지 않는다.

## 7. Contract tests

1. 동일 policy fixture의 TS/Python/Rust hash 일치
2. compiler가 catalog 밖 endpoint를 생성하면 실패
3. `maxPenalty > bondAmount` transaction 실패
4. 정상 close 후 두 번째 settlement 실패
5. forbidden path가 protected API에 전달되지 않음
6. forbidden path 시도만으로 penalty가 발생하지 않음
7. active reservation을 release하면 bond 전액 반환
8. reservation TTL expiry 시 정의된 상한만 정산
9. expiry 이후 token 거부
10. pay.sh 검증 실패 상태에서 session ACTIVE 전이 불가
11. bond confirmation 전 bonded action 실행 불가
