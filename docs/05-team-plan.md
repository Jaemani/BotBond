# Three-Person Team Plan

세 역할은 기술 스택보다 **최종 책임 영역**으로 선택한다. 모두 Claude Pro와 Antigravity를 사용할 수 있지만, 한 파일을 세 사람이 동시에 생성하지 않는다.

## 역할 A — Product Experience & Demo Director

### 적합한 사람

- 사용자 흐름과 화면 완성도에 강함
- 발표·스토리·리허설을 끝까지 책임질 수 있음
- Next.js 프론트엔드를 빠르게 구현할 수 있음

### 책임

- 제품 메시지와 UX 구조
- Antigravity + Claude를 활용한 Next.js 구현
- event contract 기반 live dashboard
- 정책 diff, usage/bond 분리, reservation lifecycle, transaction 상태 UX
- 발표자료, 3분 대본, 데모 조작, 영상 백업
- 인터뷰 및 리허설 피드백 정리

### 산출물

- `apps/web`
- 화면 상태표와 wireframe
- 발표 deck outline
- 3분/90초 데모 스크립트
- 최종 demo runbook

### 완료 기준

- backend fixture만으로 모든 화면 상태 표현
- 실제 SSE 연결 후 코드 수정 최소화
- 사용료와 bond를 혼동하지 않는 UI
- 비개발자 테스트에서 20초 내 제품 이해

### 하지 않는 일

- Gateway가 해야 할 정책 판정을 프론트에 복제하지 않음
- fake transaction을 live처럼 표시하지 않음

## 역할 B — Agent Intelligence & GCP Backend Owner

### 적합한 사람

- API·상태 머신·클라우드 배포에 강함
- Gemini/ADK structured output을 다룰 수 있음
- 여러 서비스 통합과 관측성을 책임질 수 있음

### 책임

- Agent Access Gateway
- Intent Compiler와 eval fixture
- policy engine, state machine, scoped token
- Firestore, Cloud Logging/Trace
- SSE event stream
- protected commerce API fixture
- reservation create/release/consume/expire 상태 머신
- Cloud Run 배포와 E2E orchestration

### 산출물

- `apps/gateway`
- `services/intent-agent`
- `packages/contracts`
- GCP 배포 설정
- API 문서와 smoke test

### 완료 기준

- catalog 밖 권한 생성 실패
- 동일 fixture의 policy output 안정성
- payment 확인 전 ACTIVE 불가; bond가 필요한 policy는 bonded action 실행 전 bond 확인 필수
- forbidden path가 upstream에 도달하지 않음
- 모든 상태 전이가 traceId로 조회 가능

### 하지 않는 일

- Gemini 결과로 직접 penalty 실행하지 않음
- pay.sh나 Solana 내부 구현을 gateway domain에 하드코딩하지 않음

## 역할 C — Payment Protocol & Solana Owner

### 적합한 사람

- Solana/Anchor/Rust 또는 결제 프로토콜에 강함
- transaction 실패와 idempotency를 꼼꼼히 처리함
- 기술 사실을 발표 가능한 증거로 정리할 수 있음

### 책임

- pay.sh SDK/MPP capability spike
- Gateway용 pay.sh adapter interface와 실제 구현
- Anchor bond program
- SPL token escrow, PDA, open/refund/bounded settle/reclaim
- TypeScript client SDK
- devnet deploy와 Explorer evidence
- program/unit/integration tests

### 산출물

- `programs/botbond`
- `packages/payment-client` 또는 gateway adapter
- program ID, IDL, deployment record
- transaction fixture와 test report
- 실패 시 fallback 결정 자료

### 완료 기준

- open/refund/violation/reclaim tests 통과
- 단순 차단은 무차감이고 reservation expiry만 제한 정산됨
- max penalty 초과와 이중 settlement 실패
- 실제 pay.sh 결제 증거
- UI가 사용할 안정된 transaction/receipt 응답

### 하지 않는 일

- pay.sh가 제공하지 않는 기능을 제공한다고 표현하지 않음
- production custody나 탈중앙 dispute를 구현했다고 주장하지 않음

## 역할 선택 방법

각 팀원이 다음 항목을 1–5점으로 자기 평가한다.

| 역량 | A | B | C |
|---|---:|---:|---:|
| UI/UX·발표 | ×3 | ×1 | ×1 |
| Next.js | ×2 | ×1 | ×1 |
| API·상태머신 | ×1 | ×3 | ×2 |
| Gemini/ADK | ×1 | ×3 | ×1 |
| GCP 배포 | ×1 | ×3 | ×2 |
| Solana/Anchor | ×1 | ×1 | ×3 |
| 결제·보안 사고 | ×1 | ×2 | ×3 |
| 운영·디버깅 | ×2 | ×3 | ×3 |

가중합이 가장 높은 역할을 우선 선택하되, 역할 C가 비면 온체인 구현 경험이 가장 높은 사람이 C를 맡는다.

## 추천 배분

사용자가 온체인·GCP·Agentic AI 경로를 보장할 수 있다면 다음 두 방식이 현실적이다.

### 안 1 — 사용자가 역할 C

- 사용자: Payment Protocol & Solana
- 팀원 1: Agent Intelligence & GCP Backend
- 팀원 2: Product Experience & Demo

장점: 심사에서 가장 위험한 실제 결제·온체인 증거를 사용자가 직접 통제한다.

### 안 2 — 사용자가 역할 B

- 사용자: Agent Intelligence & GCP Backend
- 팀원 1: Payment Protocol & Solana
- 팀원 2: Product Experience & Demo

장점: 제품 전체 orchestration과 GCP/AI 설득력을 사용자가 통제한다. 단, 팀원 1이 Anchor 경험이 충분해야 한다.

## Claude/Antigravity 작업 규칙

### 공통 입력 패키지

모든 작업 프롬프트에는 다음만 공통으로 넣는다.

1. `README.md`
2. `docs/03-contracts.md`
3. 자기 역할 문서와 대상 디렉터리
4. 해당 작업의 acceptance criteria

전체 저장소를 매번 Claude에게 던지지 않는다. 계약을 기준으로 필요한 범위만 제공한다.

### 프롬프트 템플릿

```text
You own <component and directory>.
The cross-team source of truth is docs/03-contracts.md.
Do not change shared contracts or another owner's directory.

Task:
<one bounded task>

Acceptance criteria:
- ...
- ...

Required checks:
- tests
- typecheck/lint
- observable error states

If the contract is insufficient, stop and write a Contract Change Request.
Do not silently invent a field or protocol behavior.
```

### Contract Change Request

```text
CCR-NNN
Requester:
Affected contract:
Current limitation:
Proposed change:
Breaking impact:
Migration:
Decision: Accepted | Rejected | Deferred
```

## 협업 리듬

### 매일 20분

1. 실제로 동작한 증거 1개
2. 오늘 막는 위험 1개
3. contract change 필요 여부
4. 다음 integration checkpoint

진척률 대신 transaction, test, endpoint, 화면 URL을 보여준다.

### Merge 규칙

- component owner 1명 + 다른 역할 reviewer 1명
- shared contract 변경은 3명 확인
- mock을 실제 구현으로 교체할 때 contract test 필수
- demo branch에는 실험 기능 직접 merge 금지
- D13 이후 기능 추가 금지

## 문서화 전략

### Source of truth

| 정보 | 파일 |
|---|---|
| 제품 범위·요구사항 | `01-product-spec.md` |
| 시스템 구조·trust boundary | `02-architecture.md` |
| API·schema·event·program | `03-contracts.md` |
| 데모·일정·검증 | `04-demo-validation.md` |
| 역할·협업 | `05-team-plan.md` |
| 바뀐 결정과 이유 | `00-decision-log.md` |

같은 내용을 여러 파일에 복제하지 않는다. 링크로 참조한다.

### 반드시 남길 증거

- pay.sh 실제 request/settlement 식별 정보
- Solana program ID와 transaction links
- Vertex AI model/config와 eval 결과
- Cloud Run revision과 demo endpoint
- policy fixture와 hash
- 정상/위반 E2E test 결과
- 사용자 인터뷰 요약과 원문 구분

### 발표 자료로 자동 전환할 기록

각 담당자는 매일 다음 형식으로 한 줄을 남긴다.

```text
Claim: 우리가 증명한 것
Evidence: URL / tx / test / screenshot
Limit: 아직 증명하지 않은 것
```

이 기록이 최종 deck의 기술 근거가 된다.

## 역할 간 handoff

### A가 B에게

- 필요한 event type과 UI state 목록
- 오류 메시지와 loading 요구사항

### B가 A에게

- OpenAPI 또는 endpoint examples
- SSE event fixture
- live demo reset endpoint/script

### B가 C에게

- canonical policy hash
- expected program instruction payload
- settlement receipt schema

### C가 B에게

- IDL, program ID, client methods
- transaction confirmation/error model
- pay.sh adapter result type

### C가 A에게

- Explorer URL 형식
- pending/confirmed/failed 상태 fixture

## 최종 공동 책임

역할과 무관하게 세 명 모두 다음 질문에 답할 수 있어야 한다.

1. 왜 pay.sh인가?
2. 왜 Solana인가?
3. AI가 규칙 엔진과 다른 일을 어디서 하는가?
4. 악성 봇이 bond를 걸지 않으면 어떻게 되는가?
5. 중앙화된 trust assumption은 무엇인가?
