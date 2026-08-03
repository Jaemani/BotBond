# 소개서·3분 영상 보완안

현재 `botbond-deck.pdf`의 핵심 포지셔닝은 유지한다. 특히 3장의 대안 비교와 4장의 WAF 뒤 도입 구조는 맞다. 아래 세 가지만 보강하면 소개서와 실제 제품이 같은 주장을 하게 된다.

## 소개서 보강

### 3장 — Cloudflare와의 관계를 한 문장으로 고정

> Cloudflare blocks uncooperative automation. BotBond onboards cooperative unknown agents through a merchant-approved API lane.

“Cloudflare 대비”를 가격·기능 경쟁표로 만들지 않는다. 서로 다른 계층임을 명시한다.

- 일반 경로: WAF 정책 유지
- agent-access 경로: 운영자가 명시적으로 allowlist
- Gateway 뒤: signed scope에 포함된 origin operation만 접근

### 6장 — 공개 참여 경로 추가

아키텍처 그림에 두 client를 분리한다.

```text
Sponsored demo agent → public runner → fresh devnet transaction
External agent       → discovery + own wallet → Gateway
```

전자는 누구나 웹에서 체험하기 위한 경로다. 후자는 API가 실제 외부 클라이언트에 열려 있음을 증명한다.

### 7장 — 고정 Explorer 링크 대신 “매번 달라지는 signature”를 증명

영상에서는 화면의 실행 버튼을 누르기 전 Explorer 링크가 비어 있어야 한다. 실행 후 다음 두 링크가 새로 생기고 서로 달라야 한다.

1. Bond locked
2. Bond returned 또는 bounded settlement

영상과 PDF에 넣는 최신 실행 증거는 보조 자료다. 실제 데모의 핵심은 녹화 중 새 signature가 생성되는 장면이다.

## 3분 영상 흐름

영상은 연극이나 상황극이 아니라 제품 사용과 기술 증거만 보여준다.

### 0:00–0:25 — 문제와 설치 위치

- BShop의 일반 상품 화면
- unknown automated client의 `403`
- 응답의 `/.well-known/agent-access`
- 한 문장: “WAF를 우회하지 않고, 운영자가 연 API 경로에서만 동작합니다.”

### 0:25–1:05 — 계약 생성

- Agent API에서 자연어 목적 제출
- Gemini가 endpoint·field·call·TTL 정책으로 컴파일
- seller contacts가 제외된 것과 policy hash 확인
- 사용료 cap과 refundable bond를 분리해 설명

### 1:05–2:20 — 실제 실행

- `Run a fresh devnet session`
- 새 bond open signature와 Explorer 확인
- 허용된 상품·재고 호출 200
- seller contacts 호출 403, origin 미도달, penalty 0
- 예약 생성으로 BShop 재고 1→0
- 정상 흐름은 release 후 refund, 위반 흐름은 TTL 후 0.25 bounded settlement 중 하나를 본 시연으로 선택

### 2:20–2:45 — 운영자 결과

- Merchant Ops에서 동일 session의 inventory, request log, usage, penalty/refund 확인
- settlement signature를 Explorer에서 확인
- open signature와 다른 새 트랜잭션임을 보여준다.

### 2:45–3:00 — 외부 참여와 경계

- Integrate 화면의 discovery URL과 한 줄 CLI
- “누구나 자기 devnet 지갑으로 재현 가능”
- “Solana는 live devnet, usage credential은 현재 labelled demo bridge”를 짧게 명시

## 촬영 체크

- 영상 시작 전에 fixture replay가 아니라 `PUBLIC DEVNET AGENT` 상태인지 확인
- 브라우저 개발자도구를 주인공으로 만들지 말고 제품 화면의 request log와 Explorer를 사용
- session ID, policy hash, 두 signature가 같은 실행에 속하는지 확인
- 성공/차단/정산을 전부 보여주되 차단만으로 bond가 움직이지 않는 장면을 포함
- 60초 TTL이 길면 정상 refund를 본 시연으로 쓰고, bounded settlement는 별도 짧은 증거 클립 또는 최신 실제 이력으로 보충

