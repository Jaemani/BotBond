# Product Specification

## 1. 제품 정의

### 문제

API·데이터 서비스 운영자는 알 수 없는 자동화 클라이언트를 열어두면 남용 위험이 있고, 전부 차단하면 새로 만들어진 정상 에이전트까지 잃는다. 기존 API key는 가입, 계약, 발급, 월 청구가 필요하고 일회성·롱테일 에이전트 접근에 마찰이 크다.

### 해결

BotBond는 미등록 에이전트가 다음을 제시하면 시간 제한이 있는 API 세션을 발급한다.

- 자연어 목적
- 최대 호출량과 비용
- 필요한 endpoint와 데이터 필드
- 세션 만료시간
- pay.sh 사용료 한도
- 환불 가능한 Solana 보증금

Gemini가 자연어를 정책으로 컴파일하고, Gateway가 정책을 결정론적으로 집행한다. 일반 데이터 호출은 pay.sh로 과금한다. 희소 재고 예약처럼 merchant에게 기회비용을 발생시키는 action에는 bond를 걸고, 정상 해제·구매 시 반환하며 객관적인 예약 방치 시에만 사전 서명한 상한 내 비용을 정산한다.

### 최초 사용자

- **공급 측:** 외부 에이전트 호출을 받고 싶은 API·데이터·커머스 서비스 운영자
- **수요 측:** HTTP 헤더, 지갑, pay.sh 호출을 제어할 수 있는 개발자 운영 자율 에이전트
- **비사용자:** 학습 크롤러, stealth crawler, 임의 browser agent, 검색 API 사용자

## 2. 한 문장 피치

> BotBond lets unknown AI agents earn scoped API access by declaring intent and locking a refundable on-chain bond.

한국어:

> BotBond는 처음 보는 AI 에이전트도 사용 목적을 선언하고 환불 가능한 보증금을 걸면, 계정이나 API 키 없이 제한된 API 접근권을 얻도록 합니다.

## 3. 핵심 사용자 여정

### 정상 세션

1. 구매 에이전트가 상품 가격·재고 비교 작업을 받는다.
2. 보호 API가 `agent-access` discovery 문서를 제공한다.
3. 에이전트가 자연어 목적과 예산을 제출한다.
4. Intent Compiler가 후보 정책을 생성한다.
5. Merchant Policy Validator가 지원 범위와 가격을 확정한다.
6. 양측이 동일한 정책 해시에 동의한다.
7. 에이전트가 pay.sh 세션과 Solana bond를 개설한다.
8. Gateway가 scoped session token을 발급한다.
9. 에이전트가 허용된 상품·가격·재고 endpoint를 호출한다.
10. 최적 상품 1개를 60초 예약하고, 구매하거나 명시적으로 해제한다.
11. 사용료가 정산되고 bond가 반환된다.

### 위반 세션

1. 동일한 `가격 비교 + 최대 1개 예약` 정책으로 세션을 연다.
2. 에이전트가 허용되지 않은 `/seller-contacts`를 요청하면 Gateway가 호출 전에 차단하고 bond는 차감하지 않는다.
3. 에이전트가 허용된 상품 1개를 실제 예약한 뒤 세션을 방치한다.
4. 예약 TTL이 만료되면 재고가 자동 복구되고, 정책에 명시된 예약 비용만 bond에서 정산된다.
5. 호출 이벤트, 예약 상태, 정책 해시, 정산 영수증, 트랜잭션이 화면에 남는다.

## 4. 제품 원칙

1. **AI proposes; code disposes.** AI는 정책을 제안하고 코드는 집행한다.
2. **Blocked attempts are not slashable.** 사전 차단된 시도나 결과가 마음에 들지 않는다는 이유로 bond를 차감하지 않는다.
3. **No hidden authority.** 누가 어떤 근거로 정산했는지 화면과 영수증에 남긴다.
4. **Bond is not usage balance.** 사용료와 담보를 UX·코드·회계에서 분리한다.
5. **Official lane, not bypass.** 운영자가 명시적으로 연 agent endpoint에서만 동작한다.

## 5. MVP 기능 우선순위

### P0 — 반드시 실제 동작

- `/.well-known/agent-access` discovery
- 자연어 intent 입력과 구조화 정책 생성
- 정책 JSON 검증 및 정책 해시 생성
- pay.sh를 통한 실제 유료 호출 또는 capped session
- Solana devnet bond open
- scoped token 발급
- endpoint/field/call/rate/expiry/spend 집행
- 최대 1개의 60초 inventory reservation과 release/consume/expire
- 정상 close와 bond refund
- 범위 위반 차단은 무차감, 예약 방치는 bounded settlement
- 실시간 상태 UI 및 Explorer 링크
- demo reset/smoke test

### P1 — 시간이 남으면

- Merchant가 정책 템플릿을 편집하는 화면
- Gemini가 과도한 권한을 줄이는 협상 한 번 수행
- Cloudflare 경로 예외를 모사한 `403 → 402 agent lane` 비교
- BigQuery 기반 세션 분석
- 서로 다른 두 vertical fixture

### P2 — 로드맵

- Web Bot Auth 또는 기타 signed-agent identity
- AP2 Intent Mandate와 정식 호환
- dispute/challenge window
- 다중 독립 verifier
- Cloudflare Worker/Vercel middleware 배포 패키지
- production-grade key management

## 6. 비기능 요구사항

- 데모 시작부터 정상 정산까지 90초 이내
- 각 API 호출의 policy decision이 500ms 이내. Gemini는 세션 개설 시에만 사용
- 같은 fixture로 10회 반복했을 때 동일한 정책 JSON과 결과
- 온체인 transaction 실패 시 UI가 성공으로 표시하지 않음
- private key, pay.sh credential, GCP secret은 브라우저 bundle과 로그에 노출되지 않음
- 모든 상태는 `CREATED → POLICY_READY → PAYMENT_READY → (BONDED if required) → ACTIVE → CLOSED | VIOLATED | EXPIRED` 중 하나

## 7. 성공 지표

### 해커톤

- 심사위원이 20초 안에 `API key 없는 조건부 접근`을 설명할 수 있다.
- 라이브 데모에서 pay.sh 결제와 Solana bond transaction을 확인한다.
- AI를 제거했을 때 자연어 목적을 다양한 API 권한으로 변환하는 제품 경험이 사라진다.
- 블록체인을 제거했을 때 상대방을 신뢰하지 않고 bond를 잠그고 반환하는 기능이 약화된다.

### 시장 검증

- API 공급자 3명 이상이 `미등록 agent lane`의 필요 또는 현재 onboarding 마찰을 확인한다.
- agent builder 3명 이상이 1~5 USDC의 환불 가능 bond를 걸 의향을 밝힌다.
- 둘 중 한쪽이 전혀 확인되지 않으면 발표에서 시장 검증을 과장하지 않고 `protocol prototype`으로 표현한다.

## 8. 핵심 리스크

| 리스크 | 징후 | 완화 |
|---|---|---|
| API key로 충분 | 인터뷰에서 일회성 agent 수요 없음 | 웹3·pay.sh 공급자에 타깃 한정 |
| Gemini가 장식 | 정책이 고정 if문과 동일 | 두 종류 이상의 자연어 intent와 최소권한 축소 시연 |
| 운영자 임의 차감 | 판정 근거가 자연어뿐 | 결정적 위반만 집행, max penalty 강제 |
| bond가 pay.sh와 중복 | 조회와 차단만 존재 | 희소 예약·비싼 작업 같은 사후 의무 action에만 bond 사용 |
| pay.sh 세션 SDK 제약 | MPP 반복 호출 spike 실패 | pay.sh 고정 charge를 호출별 사용료로 사용, 내부 cap 유지 |
| devnet 불안정 | tx confirmation 지연 | preflight, retry, transaction 상태 표시, 녹화 백업 |
| 범위가 너무 큼 | 5일차에도 E2E 없음 | P1/P2 제거, mock protected API 유지 |
