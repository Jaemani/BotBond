# Decision Log

이 문서는 팀이 같은 논쟁을 반복하지 않도록 결정과 변경 이유만 기록한다. 구현 세부사항은 다른 명세에 둔다.

## D-001: 제품 범위

- **결정:** BotBond는 범용 봇 방어가 아니라 `agent-native API onboarding gateway`다.
- **이유:** 비협조적 봇은 보증금을 걸지 않는다. WAF가 비공식 경로를 차단하고, BotBond는 공식 접근이 필요한 정상 에이전트에게 열린다.
- **영향:** 데모 대상은 일반 웹페이지가 아니라 구조화된 커머스 API다.

## D-002: AI의 권한

- **결정:** Gemini는 자연어 목적을 정책으로 컴파일하고 설명하지만, 세션 중단·금전 차감의 최종 판정자는 아니다.
- **이유:** 비결정적인 모델 출력에 재산권을 직접 연결하면 오판·재현성·분쟁 문제가 생긴다.
- **영향:** 실제 집행은 endpoint, field, rate, call count, expiry, spend cap 같은 서명된 정책으로 수행한다.

## D-003: pay.sh와 bond의 분리

- **상태:** Reversed by D-008
- **기존 결정:** pay.sh는 API 사용료와 반복 호출 한도를 담당하고, 별도 Solana 프로그램은 보증금을 담당한다.
- **이유:** pay.sh/MPP의 capped session을 조건부 몰수 기능으로 과장하지 않는다.
- **영향:** 데모 화면에서도 `Usage balance`와 `Refundable bond`를 별도 항목으로 표시한다.

## D-004: 차감 범위

- **결정:** 운영자가 보증금 전액을 임의로 가져갈 수 없다. 범위 밖 호출 시도는 차단만 하고, 이미 생성된 재고·작업 슬롯 예약을 만료시킨 것처럼 객관적인 사후 의무 위반에만 `max_penalty` 안에서 정산한다.
- **이유:** 판매자가 애매한 정책으로 보증금을 수취하는 역인센티브를 막고, pay.sh 사용료와 bond의 역할을 분리한다.
- **영향:** 프로그램이 `penalty <= max_penalty`를 강제하고 정산 영수증 해시를 저장한다.

## D-005: 평판

- **결정:** 온체인 평판과 위반 시 다음 세션 보증금 자동 상승은 MVP에서 제외한다.
- **이유:** 새 지갑으로 이력을 초기화할 수 있어 Sybil 방어 주장이 약하다.
- **영향:** 보증금은 요청 범위, 데이터 민감도, 최대 호출량에 따라 계산한다.

## D-006: 데모 vertical

- **결정:** 노트북 가격·재고 비교와 60초 재고 예약을 제공하는 mock commerce API를 사용한다.
- **이유:** pay.sh는 데이터 호출, bond는 희소 재고 예약을 담당해 두 결제 수단의 필연성을 20초 안에 구분할 수 있다.
- **대체 후보:** 여행 재고, 공급자 카탈로그. 인터페이스는 vertical 교체가 가능하도록 유지한다.

## D-007: Bond utility gate

- **결정:** 단순 조회 권한에는 별도 bond를 요구하지 않는다. merchant에게 회수 가능한 비용·기회비용을 발생시키는 action에만 bond를 요구한다.
- **이유:** 모든 요청이 선불 과금되고 범위 위반도 사전 차단된다면 별도 bond는 경제적으로 중복이다.
- **영향:** `GET price/stock`은 pay.sh, `POST reservation`은 pay.sh + bond로 구분한다. 이 차이가 데모에서 보이지 않으면 제품 가설 실패로 본다.

## D-008: pay.sh fallback와 세션 상한 집행

- **상태:** Accepted (2026-08-03), pitch wording superseded by D-015
- **결정:** `pay.sh x402로 per-call 과금, 세션 상한은 BotBond bond가 담보`. gateway가 호출 전 정책 cap을 결정적으로 검사하고, payment adapter가 실제 usage 정산을 cap 이하로 제한하며, bond는 객관적 예약 만료만 정산한다.
- **근거:** pay.sh sandbox가 per-call rail은 입증했지만 capped-session/조건부 몰수 rail은 입증하지 못했다. 검증되지 않은 기능을 제품 주장으로 쓰지 않는다.
- **영향:** D-003의 “pay.sh가 반복 호출 한도 담당” 부분을 뒤집는다. Usage와 refundable bond는 계속 별도 표시한다.
- **검증 결과:** gateway cap tests, `CappedSessionPaymentAdapter` tests, bond conservation local-validator tests.

## D-009: 실어댑터 HMAC 키 경계

- **상태:** Accepted (2026-08-03)
- **결정:** `BOTBOND_PAYMENT_SECRET`은 challenge/credential HMAC 전용, `BOTBOND_EVIDENCE_SECRET`은 settlement evidence HMAC 전용이다. `ADAPTER_MODE=solana`에서는 두 값 모두 필수이며 fallback 값을 허용하지 않는다. fake mode와 테스트만 명시적 test-only 값을 주입할 수 있다.
- **근거:** 키 목적을 분리하고 실모드가 개발 기본값으로 조용히 작동하는 것을 막는다.
- **영향:** 값은 저장소에 커밋하지 않는다. gateway, expiry worker, Solana adapter가 `BOTBOND_EVIDENCE_SECRET` 이름을 공유한다.
- **검증 결과:** environment factory fail-closed test와 settlement evidence tests.

## D-010: 결제 credential의 session binding

- **상태:** Accepted (2026-08-03)
- **결정:** 실제 payment credential을 쓰는 클라이언트는 `ses_` 접두사의 8~128자 session ID를 먼저 생성하고 credential을 그 ID에 바인딩한 뒤 `POST /v1/sessions`에 같은 `sessionId`를 보낸다. gateway는 형식과 중복을 검사한다. 기존 fake flow는 sessionId를 생략하고 gateway 생성 ID를 유지한다.
- **근거:** `CappedSessionPaymentAdapter`의 replay 방지 binding을 약화하지 않으면서 별도 pre-session API와 서버 상태를 추가하지 않는 최소 변경이다.
- **영향:** session creation fingerprint에 sessionId, challenge, credential이 포함된다. session-bound challenge가 있으면 함께 검증한다.
- **검증 결과:** payment adapter mismatch tests와 combined gateway/payment tests.

## D-011: 정산 트랜잭션 확정 규칙

- **상태:** Accepted (2026-08-03)
- **결정:** bond close/expiry 요청이 provider reference와 `PENDING`을 반환하면 gateway와 expiry worker가 1초 간격, 최대 5회 `getTransactionStatus()`를 호출한다. `CONFIRMED` 전에 repository/session finalization을 하지 않는다.
- **근거:** Solana 제출 성공과 최종 확정은 다르다. 미확정 상태에서 receipt를 발행하면 UI·DB·chain 상태가 갈라진다.
- **영향:** 제한 횟수 뒤에도 PENDING이면 retryable 응답을 반환하고 idempotency claim을 해제한다.
- **검증 결과:** settlement polling unit tests와 on-chain transaction status tests.

## D-012: payment-client package boundary와 단일 단가

- **상태:** Accepted (2026-08-03)
- **결정:** Gateway는 Role C source file을 직접 import하지 않고 `@botbond/payment-client`의 ESM build/export만 사용한다. `DEFAULT_UNIT_PRICE_ATOMIC = "1000"`을 contracts package의 단일 source로 사용한다.
- **근거:** source import는 gateway build output에 다른 workspace source/test를 포함시키고 runtime export와 build graph를 불일치시켰다. event accounting과 payment settlement의 단가도 분리되면 영수증 parity가 깨진다.
- **영향:** contracts → payment-client → gateway 순으로 build한다. Docker build와 root verify도 같은 순서를 사용한다.
- **검증 결과:** clean package builds, gateway runtime syntax check, unit-price payment/gateway tests.

## D-013: payment challenge와 실패한 pre-activation session

- **상태:** Accepted (2026-08-03)
- **결정:** 공개 `POST /v1/payment-challenges`는 client-generated session ID에 challenge와 policy usage cap을 바인딩한다. 실제 credential은 외부 payment rail이 반환하며 gateway의 test helper를 공개하지 않는다. session creation이 ACTIVE 전에 실패하면 CREATED/POLICY_READY/PAYMENT_READY/BONDED record와 초기 events를 제거하고 idempotency claim을 해제한다.
- **근거:** challenge 발급과 credential 검증 경계를 명확히 하고, payment/bond transient failure 뒤 동일 session ID retry가 `SESSION_ID_EXISTS`로 영구 차단되는 것을 막는다.
- **영향:** repository는 atomic create와 pre-activation conditional delete를 제공한다. Firestore rollback은 session record와 해당 session의 초기 events를 같은 transaction에서 삭제한다. ACTIVE 이후 record는 이 rollback으로 삭제할 수 없다.
- **검증 결과:** public challenge wording/binding test, client-generated session retry test, Firestore atomic-create/conditional-delete/event-cleanup tests.

## D-014: settlement mutual exclusion과 restart identity

- **상태:** Accepted (2026-08-03)
- **결정:** close와 reservation expiry는 `ACTIVE → SETTLING → terminal` transition으로 상호 배제한다. 실패 시 `SETTLING → ACTIVE`로 rollback한다. persistent `bondReference`를 adapter에 전달하고, restart recovery 시 on-chain policy hash, evidence hash, amount를 다시 검증한다. request counter reservation은 repository transaction 안에서 expected session state를 검사한다.
- **근거:** close/expiry/request concurrency가 동일 bond와 call budget을 경쟁할 때 handler-level state check만으로는 stale authorization race를 막지 못한다.
- **영향:** settlement evidence는 canonical payload hash와 HMAC 모두 검증한다. settlement attempt는 outcome별 stable ID를 사용하고 evidence body/hash, provider reference, started/updated time, terminal status를 저장한다. Firestore conditional create가 concurrent retry에서 첫 evidence identity를 보존한다. nonce claim은 nonce hash별 Firestore 문서로 저장되어 동일 evidence의 idempotent 재시도만 허용하고 다른 evidence의 cross-instance replay를 거부한다. settlement lock은 30초 durable lease를 기록하며, lease가 끝난 `SETTLING` session은 같은 stable attempt/evidence로 close 또는 expiry를 재개한다. journal update는 transaction에서 terminal `CONFIRMED` 역행과 provider-reference 변경을 거부한다.
- **검증 결과:** gateway settlement-lock/stale-close tests, background stale-expiry recovery test, request-state transaction tests, canonical evidence tamper tests, durable cross-instance nonce replay tests, close/worker journal tests, Firestore concurrent attempt-create/update/lease-claim tests, local-validator restart recovery tests.

## D-015: usage cap과 bond 피치 경계 정정

- **상태:** Accepted (2026-08-03)
- **결정:** pay.sh는 검증된 x402 per-call rail로만 설명하고, 세션 usage cap은 Gateway 사전검사와 PaymentAdapter의 bounded settlement가 집행한다고 표현한다. Solana bond는 예약처럼 merchant 기회비용을 발생시키는 bonded action만 담보한다. live pay.sh credential 검증이 붙기 전 HMAC credential bridge는 `FAKE_ADAPTER_FIXTURE`를 반드시 노출한다.
- **근거:** read-only 정책은 D-007에 따라 bond 없이 ACTIVE가 될 수 있으므로 “세션 상한은 bond가 담보”라는 문구는 사실과 다르다. sandbox rail 검증과 Gateway credential integration도 서로 다른 증거다.
- **영향:** discovery와 payment challenge 문구를 정정한다. 실제 Solana reference는 계속 Explorer 증거로 사용할 수 있지만 같은 세션의 payment bridge는 fixture로 표시한다.
- **검증 결과:** Gateway discovery/challenge tests, fixture-marker adapter test, Role A reducer fake-link test.

## 변경 규칙

새 결정은 아래 형식으로 추가한다.

```text
## D-NNN: 제목
- 상태: Proposed | Accepted | Reversed
- 결정:
- 근거:
- 영향:
- 검증 결과:
```

이미 합의된 결정을 바꾸려면 기존 항목을 삭제하지 말고 `Reversed by D-NNN`을 기록한다.
