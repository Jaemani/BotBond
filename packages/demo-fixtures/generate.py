"""Generate BotBondEvent fixtures conforming to docs/03-contracts.md.

Amounts are atomic units of a 6-decimal USDC-like mint.
  1_000 atomic   = 0.001 USDC  (per data call)
  200_000        = 0.20  USDC  (usage cap)
  1_000_000      = 1.00  USDC  (refundable bond)
  300_000        = 0.30  USDC  (max penalty ceiling)
  250_000        = 0.25  USDC  (signed reservation-expiry penalty)
"""
import hashlib
import json
import pathlib
from datetime import datetime, timedelta, timezone

OUT = pathlib.Path(__file__).parent
T0 = datetime(2026, 8, 21, 10, 0, 0, tzinfo=timezone.utc)

CALL_COST = 1_000
USAGE_CAP = 200_000
BOND = 1_000_000
MAX_PENALTY = 300_000
EXPIRY_PENALTY = 250_000

POLICY = {
    "version": "botbond-policy/v1",
    "policyId": "pol_demo_laptop_comparison",
    "merchantId": "demo-commerce",
    "agentWallet": "AgntWa11etDemo11111111111111111111111111111",
    "purpose": "Compare the demo catalog's laptop price and stock; hold one unit for 60s.",
    "allowedOperations": [
        {"method": "GET", "pathTemplate": "/products",
         "allowedResponseFields": ["id", "name", "price", "stock", "shipping"], "maxCalls": 1},
        {"method": "GET", "pathTemplate": "/products/{id}/inventory",
         "allowedResponseFields": ["stock", "updatedAt"], "maxCalls": 2},
        {"method": "POST", "pathTemplate": "/reservations",
         "allowedResponseFields": ["productId", "quantity", "expiresAt"], "maxCalls": 1},
    ],
    "constraints": {
        "maxTotalCalls": 5,
        "maxRequestsPerMinute": 30,
        "expiresAt": "2026-08-21T10:05:00Z",
        "usageCapAtomic": str(USAGE_CAP),
        "bondAmountAtomic": str(BOND),
        "maxPenaltyAtomic": str(MAX_PENALTY),
    },
    "bondedActions": [
        {"operationId": "reserve-inventory", "maxActive": 1,
         "ttlSeconds": 60, "expiryPenaltyAtomic": str(EXPIRY_PENALTY)}
    ],
    "settlement": {
        "validClose": "REFUND_BOND",
        "scopeViolation": "BOUNDED_PENALTY_AND_REFUND_REMAINDER",
        "expiry": "RECLAIM_AFTER_GRACE_PERIOD",
    },
    "catalogVersion": "merchant-catalog/v1",
}

# The visual fixture has its own policy, so the displayed hash must be derived
# from that exact policy rather than copied from an unrelated golden fixture.
POLICY_HASH = "sha256:" + hashlib.sha256(
    json.dumps(POLICY, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
).hexdigest()

EXCLUDED = [
    {"path": "/seller-contacts", "reason": "Not required by the stated purpose"},
    {"path": "/users", "reason": "Outside merchant catalog"},
]


class Seq:
    def __init__(self, session_id, trace_id):
        self.session_id = session_id
        self.trace_id = trace_id
        self.events = []
        self.t = T0
        self.n = 0

    def add(self, type_, data, gap_ms=400):
        self.t += timedelta(milliseconds=gap_ms)
        self.n += 1
        self.events.append({
            "eventId": f"evt_{self.session_id[4:]}_{self.n:03d}",
            "sessionId": self.session_id,
            "occurredAt": self.t.isoformat().replace("+00:00", "Z"),
            "type": type_,
            "data": data,
            "traceId": self.trace_id,
        })

    def dump(self, name, title, summary, outcome, story):
        payload = {
            "fixtureVersion": "botbond-fixture/v1",
            "name": name,
            "title": title,
            "summary": summary,
            "expectedOutcome": outcome,
            "story": story,
            "sessionId": self.session_id,
            "policyHash": POLICY_HASH,
            "events": self.events,
        }
        (OUT / f"{name}.json").write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        return len(self.events)


def opening(s, *, discovery=True):
    """Shared prologue: discovery -> intent -> policy -> payment -> bond -> active."""
    if discovery:
        s.add("REQUEST_DENIED", {
            "phase": "PRE_SESSION",
            "method": "GET", "path": "/products",
            "httpStatus": 403,
            "reason": "UNKNOWN_AUTOMATED_CLIENT",
            "reasonText": "No session. Unknown automated client.",
            "discoveryHint": "/.well-known/agent-access",
            "bondDeltaAtomic": "0",
            "protectedDataExposed": False,
        }, gap_ms=0)

    s.add("INTENT_RECEIVED", {
        "intentId": "int_7bd21c",
        "task": "등록된 노트북의 가격과 재고를 비교하고, 가장 좋은 상품 하나를 60초만 예약해줘. 판매자 연락처는 필요 없어.",
        "taskEn": "Compare the catalog laptops' price and stock, then hold the best one for 60 seconds. Seller contacts are not needed.",
        "budget": {"usageCapAtomic": str(USAGE_CAP), "bondCapAtomic": str(BOND)},
        "agentWallet": POLICY["agentWallet"],
    }, gap_ms=600)

    s.add("POLICY_COMPILED", {
        "policy": POLICY,
        "policyHash": POLICY_HASH,
        "excludedOperations": EXCLUDED,
        "excludedPermissions": [item["path"] for item in EXCLUDED],
        "fixtureMarker": "FAKE_COMPILER_FIXTURE",
        "explanation": [
            "Price and stock fields are required to compare the catalog items.",
            "Seller contacts are excluded — the stated purpose does not need them.",
            "One reservation, 60 seconds, because the agent asked to hold a single unit.",
        ],
        "compiler": {"model": "gemini-2.5-flash", "latencyMs": 1180, "repairAttempts": 0},
    }, gap_ms=1200)

    s.add("PAYMENT_VERIFIED", {
        "provider": "pay.sh",
        "mode": "PAY_PER_USE_BOUNDED",
        "status": "CONFIRMED",
        "fixtureMarker": "FAKE_ADAPTER_FIXTURE",
        "usageCapAtomic": str(USAGE_CAP),
        "perCallAtomic": str(CALL_COST),
        "credentialRef": "psh_cred_4f19ab",
    }, gap_ms=900)

    s.add("BOND_OPENED", {
        "bondAmountAtomic": str(BOND),
        "maxPenaltyAtomic": str(MAX_PENALTY),
        "fixtureMarker": "FAKE_ADAPTER_FIXTURE",
        "policyHash": POLICY_HASH,
        "bondAccount": "BondPDA9xQm4vK2rT7hN3wL8sC1yF6dE5aZ0bJ4uH",
        "transaction": {
            "signature": "5KpXn2Qw8RtY3vB6mA9cD4fG7hJ1kL0sN5pT8xZ2eW4rU7iO3yV6bM1nQ9aS2dF5gH",
            "status": "CONFIRMED",
            "cluster": "devnet",
            "slot": 328_114_902,
        },
    }, gap_ms=1400)

    s.add("SESSION_ACTIVATED", {
        "expiresAt": POLICY["constraints"]["expiresAt"],
        "maxTotalCalls": POLICY["constraints"]["maxTotalCalls"],
        "tokenRef": "ses_token_...redacted",
    }, gap_ms=500)


def allowed_calls(s, product_ids, *, include_search=True, start_index=1):
    """Replay the two real products exposed by DemoCommerceApi, not invented IDs."""
    i = start_index
    calls = []
    if include_search:
        calls.append(("/products", "search-products", ["id", "name", "price", "stock", "shipping"]))
    calls.extend((f"/products/{product_id}/inventory", "get-inventory", ["stock", "updatedAt"])
                 for product_id in product_ids)
    for path, op, fields in calls:
        s.add("REQUEST_ALLOWED", {
            "method": "GET",
            "path": path,
            "operationId": op,
            "returnedFields": fields,
            "callIndex": i,
            "maxTotalCalls": 25,
            "chargedAtomic": str(CALL_COST),
            "usageSpentAtomic": str(CALL_COST * i),
            "usageCapAtomic": str(USAGE_CAP),
            "bondDeltaAtomic": "0",
        }, gap_ms=180)
        i += 1
    return i


# ---------------------------------------------------------------- scenario 1
def scenario_normal():
    s = Seq("ses_normal_01", "trace_a1b2c3")
    opening(s)
    allowed_calls(s, ["lap-1", "lap-2"])

    s.add("RESERVATION_CREATED", {
        "reservationId": "rsv_0091",
        "productId": "lap-1",
        "quantity": 1,
        "ttlSeconds": 60,
        "expiresAt": "2026-08-21T10:01:38Z",
        "bondedAction": True,
        "chargedAtomic": "0",
        "usageSpentAtomic": str(CALL_COST * 3),
        "bondDeltaAtomic": "0",
        "inventoryBefore": 2,
        "inventoryAfter": 1,
        "note": "Bond confirmed before the bonded action was permitted.",
    }, gap_ms=700)

    s.add("RESERVATION_RELEASED", {
        "reservationId": "rsv_0091",
        "productId": "lap-1",
        "releasedBy": "AGENT",
        "heldMs": 21_400,
        "inventoryRestored": True,
        "inventoryBefore": 1,
        "inventoryAfter": 2,
        "bondDeltaAtomic": "0",
    }, gap_ms=2100)

    s.add("USAGE_SETTLED", {
        "provider": "pay.sh",
        "fixtureMarker": "FAKE_ADAPTER_FIXTURE",
        "calls": 3,
        "usageChargedAtomic": str(CALL_COST * 3),
        "usageCapAtomic": str(USAGE_CAP),
        "settlementRef": "psh_settle_c81d20",
    }, gap_ms=800)

    s.add("BOND_REFUNDED", {
        "refundedAtomic": str(BOND),
        "fixtureMarker": "FAKE_ADAPTER_FIXTURE",
        "penaltyAtomic": "0",
        "reason": "VALID_CLOSE",
        "transaction": {
            "signature": "3QmY7wR1tX9bV4nZ6cK2fD8gJ5hL0sA3pN7eT1uI4oM6yB2vC9rW5aS8dF1gH3jK7",
            "status": "CONFIRMED",
            "cluster": "devnet",
            "slot": 328_115_744,
        },
    }, gap_ms=1300)

    s.add("SESSION_CLOSED", {
        "outcome": "CLOSED",
        "calls": 3,
        "usageChargedAtomic": str(CALL_COST * 3),
        "bondRefundedAtomic": str(BOND),
        "penaltyAtomic": "0",
        "receiptHash": "sha256:1a4d7e0b3c96f28d5a0e7b4c1f8a2d69e3b0c5f7a9d2e4b6c8f1a3d5e7b9c0f24",
    }, gap_ms=400)

    return s.dump(
        "01-normal-session",
        "계정 없이 제한된 구매",
        "실제 demo catalog의 두 SKU를 비교하고, 하나를 잠시 예약한 뒤 스스로 해제한다.",
        {"outcome": "CLOSED", "usageChargedAtomic": "3000",
         "penaltyAtomic": "0", "bondRefundedAtomic": str(BOND)},
        {
            "question": "API key나 사전 계정 없이도 새 에이전트가 제한된 구매 조사를 시작할 수 있는가?",
            "merchantOutcome": "두 SKU만 조회되고, 예약을 풀자 재고와 1.00 USDC 보증금이 모두 돌아온다.",
            "beats": [
                {"eventType": "POLICY_COMPILED", "title": "목적이 계약이 됨", "detail": "가격·재고·한 번의 예약만 서명됐다."},
                {"eventType": "SESSION_ACTIVATED", "title": "짧은 유료 세션", "detail": "호출 비용과 보증금의 역할이 분리된다."},
                {"eventType": "RESERVATION_RELEASED", "title": "재고를 즉시 돌려줌", "detail": "lap-1 재고가 1에서 2로 복구된다."},
                {"eventType": "BOND_REFUNDED", "title": "정상 완료는 전액 반환", "detail": "사용료 0.003 USDC만 정산되고 bond 1.00은 반환된다."},
            ],
        },
    )


# ---------------------------------------------------------------- scenario 2
def scenario_denied():
    s = Seq("ses_denied_02", "trace_d4e5f6")
    opening(s)
    next_index = allowed_calls(s, ["lap-1"])

    s.add("REQUEST_DENIED", {
        "phase": "IN_SESSION",
        "method": "GET",
        "path": "/seller-contacts",
        "httpStatus": 403,
        "reason": "PATH_OUTSIDE_SIGNED_POLICY",
        "reasonText": "Path is outside the signed policy. The request never reached the protected API.",
        "policyHash": POLICY_HASH,
        "reachedUpstream": False,
        "protectedDataExposed": False,
        "chargedAtomic": "0",
        "bondDeltaAtomic": "0",
        "penaltyAtomic": "0",
        "highlight": "BLOCKED_IS_NOT_SLASHABLE",
    }, gap_ms=900)

    s.add("REQUEST_DENIED", {
        "phase": "IN_SESSION",
        "method": "GET",
        "path": "/products/lap-2/reviews",
        "httpStatus": 403,
        "reason": "FIELD_OUTSIDE_SIGNED_POLICY",
        "reasonText": "Review bodies are not in the agreed field set.",
        "policyHash": POLICY_HASH,
        "reachedUpstream": False,
        "protectedDataExposed": False,
        "chargedAtomic": "0",
        "bondDeltaAtomic": "0",
        "penaltyAtomic": "0",
        "highlight": "BLOCKED_IS_NOT_SLASHABLE",
    }, gap_ms=700)

    allowed_calls(s, ["lap-2"], include_search=False, start_index=next_index)

    s.add("USAGE_SETTLED", {
        "provider": "pay.sh",
        "fixtureMarker": "FAKE_ADAPTER_FIXTURE",
        "calls": 3,
        "usageChargedAtomic": str(CALL_COST * 3),
        "usageCapAtomic": str(USAGE_CAP),
        "settlementRef": "psh_settle_9a02ef",
        "note": "Denied requests were never charged.",
    }, gap_ms=800)

    s.add("BOND_REFUNDED", {
        "refundedAtomic": str(BOND),
        "fixtureMarker": "FAKE_ADAPTER_FIXTURE",
        "penaltyAtomic": "0",
        "reason": "VALID_CLOSE_AFTER_DENIED_ATTEMPTS",
        "transaction": {
            "signature": "8FhK3nP6qW9zA2vC5rT1yU4iO7eD0sG3bM6xL9jN2kQ5wR8tY1uI4oP7aS0dF3gH6",
            "status": "CONFIRMED",
            "cluster": "devnet",
            "slot": 328_116_215,
        },
    }, gap_ms=1200)

    s.add("SESSION_CLOSED", {
        "outcome": "CLOSED",
        "calls": 3,
        "deniedAttempts": 2,
        "usageChargedAtomic": str(CALL_COST * 3),
        "bondRefundedAtomic": str(BOND),
        "penaltyAtomic": "0",
        "receiptHash": "sha256:6b2f9d0a4c71e38b5f0d2a7c9e14b6d83a5c0f2e7b9d4a1c6e8f0b3d5a7c9e12",
    }, gap_ms=400)

    return s.dump(
        "02-scope-denied",
        "범위는 막고, 정상 작업은 계속",
        "판매자 연락처와 리뷰 본문을 요구하지만 protected API 전에 차단된다. 이후 허용된 재고 조회는 계속된다.",
        {"outcome": "CLOSED", "usageChargedAtomic": "3000",
         "penaltyAtomic": "0", "bondRefundedAtomic": str(BOND)},
        {
            "question": "에이전트가 목적 밖 데이터를 요구하면, 유효한 구매 작업까지 중단해야 하는가?",
            "merchantOutcome": "민감한 seller contact는 0건 노출되고, 허용된 재고 조회는 계속되며 bond는 움직이지 않는다.",
            "beats": [
                {"eventType": "SESSION_ACTIVATED", "title": "유효한 범위부터 허용", "detail": "가격과 재고만 계약에 들어 있다."},
                {"eventType": "REQUEST_DENIED", "title": "보호 API 앞에서 차단", "detail": "seller contact와 review body는 upstream에 도달하지 않는다."},
                {"eventType": "USAGE_SETTLED", "title": "차단 요청은 청구하지 않음", "detail": "3건의 허용 호출만 사용료가 된다."},
                {"eventType": "BOND_REFUNDED", "title": "차단은 처벌이 아님", "detail": "penalty 0, bond 1.00 USDC 전액 반환."},
            ],
        },
    )


# ---------------------------------------------------------------- scenario 3
def scenario_abandoned():
    s = Seq("ses_abandon_03", "trace_g7h8i9")
    opening(s)
    allowed_calls(s, ["lap-1", "lap-2"])

    s.add("RESERVATION_CREATED", {
        "reservationId": "rsv_0134",
        "productId": "lap-2",
        "quantity": 1,
        "ttlSeconds": 60,
        "expiresAt": "2026-08-21T10:01:22Z",
        "bondedAction": True,
        "chargedAtomic": "0",
        "usageSpentAtomic": str(CALL_COST * 3),
        "bondDeltaAtomic": "0",
        "inventoryBefore": 1,
        "inventoryAfter": 0,
        "signedExpiryPenaltyAtomic": str(EXPIRY_PENALTY),
    }, gap_ms=700)

    for remaining in (45, 30, 15, 5):
        s.add("RESERVATION_CREATED", {
            "reservationId": "rsv_0134",
            "tick": True,
            "secondsRemaining": remaining,
            "bondDeltaAtomic": "0",
        }, gap_ms=1000)

    s.add("RESERVATION_EXPIRED", {
        "reservationId": "rsv_0134",
        "productId": "lap-2",
        "ttlSeconds": 60,
        "inventoryRestored": True,
        "inventoryBefore": 0,
        "inventoryAfter": 1,
        "detectedBy": "DETERMINISTIC_TTL_TIMER",
        "signedExpiryPenaltyAtomic": str(EXPIRY_PENALTY),
        "reasonText": "The reservation was never released or consumed. Inventory was held for the full TTL.",
    }, gap_ms=1500)

    s.add("USAGE_SETTLED", {
        "provider": "pay.sh",
        "fixtureMarker": "FAKE_ADAPTER_FIXTURE",
        "calls": 3,
        "usageChargedAtomic": str(CALL_COST * 3),
        "usageCapAtomic": str(USAGE_CAP),
        "settlementRef": "psh_settle_2d77ba",
    }, gap_ms=700)

    s.add("PENALTY_SETTLED", {
        "penaltyAtomic": str(EXPIRY_PENALTY),
        "fixtureMarker": "FAKE_ADAPTER_FIXTURE",
        "maxPenaltyAtomic": str(MAX_PENALTY),
        "cause": "RESERVATION_EXPIRED",
        "causeIsObjective": True,
        "receiptHash": "sha256:c30a5e81b7d29f4c6a0e3b5d7f9a1c2e4b6d8f0a3c5e7b9d1f3a5c7e9b0d2f46",
        "transaction": {
            "signature": "2NcV5bX8mQ1wE4rT7yU0iO3pA6sD9fG2hJ5kL8zC1vB4nM7qW0eR3tY6uI9oP2aS5",
            "status": "CONFIRMED",
            "cluster": "devnet",
            "slot": 328_117_063,
        },
        "note": "Bounded by the signed max_penalty. The program rejects anything above it.",
    }, gap_ms=1400)

    s.add("BOND_REFUNDED", {
        "refundedAtomic": str(BOND - EXPIRY_PENALTY),
        "penaltyAtomic": str(EXPIRY_PENALTY),
        "reason": "REMAINDER_AFTER_BOUNDED_SETTLEMENT",
        "transaction": {
            "signature": "2NcV5bX8mQ1wE4rT7yU0iO3pA6sD9fG2hJ5kL8zC1vB4nM7qW0eR3tY6uI9oP2aS5",
            "status": "CONFIRMED",
            "cluster": "devnet",
            "slot": 328_117_063,
        },
    }, gap_ms=300)

    s.add("SESSION_CLOSED", {
        "outcome": "VIOLATED",
        "calls": 3,
        "usageChargedAtomic": str(CALL_COST * 3),
        "bondRefundedAtomic": str(BOND - EXPIRY_PENALTY),
        "penaltyAtomic": str(EXPIRY_PENALTY),
        "receiptHash": "sha256:e17b3d5a9c0f2e4b6d8a1c3e5f7b9d0a2c4e6f8b1d3a5c7e9f0b2d4a6c8e1f30",
    }, gap_ms=400)

    return s.dump(
        "03-abandoned-reservation",
        "마지막 재고 회수와 제한 정산",
        "마지막 한 대를 60초 동안 잡아두고 떠난다. TTL 만료 후 재고는 복구되고 사전 서명된 한도 안에서만 정산된다.",
        {"outcome": "VIOLATED", "usageChargedAtomic": "3000",
         "penaltyAtomic": str(EXPIRY_PENALTY),
         "bondRefundedAtomic": str(BOND - EXPIRY_PENALTY)},
        {
            "question": "희소 재고를 점유한 에이전트가 사라지면, merchant는 어떻게 회수하고 agent는 어디까지 책임지는가?",
            "merchantOutcome": "마지막 NovaBook Air 재고가 0에서 1로 복구된다. 벌점은 의도 추정이 아니라 만료라는 객관적 사실에만 붙는다.",
            "beats": [
                {"eventType": "RESERVATION_CREATED", "title": "마지막 한 대를 hold", "detail": "lap-2 재고가 1에서 0이 된다. bond는 이미 확인됐다."},
                {"eventType": "RESERVATION_EXPIRED", "title": "TTL이 객관적으로 만료", "detail": "사람이나 LLM의 판단 없이 재고가 0에서 1로 복구된다."},
                {"eventType": "PENALTY_SETTLED", "title": "서명된 상한만 정산", "detail": "0.25 USDC만 분리되고, max penalty 0.30을 넘을 수 없다."},
                {"eventType": "BOND_REFUNDED", "title": "나머지는 반환", "detail": "0.75 USDC가 agent에게 자동 반환된다."},
            ],
        },
    )


if __name__ == "__main__":
    for fn in (scenario_normal, scenario_denied, scenario_abandoned):
        print(f"{fn.__name__}: {fn()} events")
    index = {
        "fixtureVersion": "botbond-fixture/v1",
        "scenarios": [
            {"id": "01-normal-session", "label": "계정 없이 제한된 구매", "outcome": "CLOSED"},
            {"id": "02-scope-denied", "label": "범위는 막고, 정상 작업은 계속", "outcome": "CLOSED"},
            {"id": "03-abandoned-reservation", "label": "마지막 재고 회수와 제한 정산", "outcome": "VIOLATED"},
        ],
    }
    (OUT / "index.json").write_text(
        json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print("index.json written")
