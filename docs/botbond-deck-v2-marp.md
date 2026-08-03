---
marp: true
size: 16:9
paginate: true
title: BotBond — Bonded Agent Access
description: Google Cloud x Solana AI Agentic Hackathon
style: |
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap');
  section { font-family: Inter, 'Noto Sans KR', sans-serif; background: #f7f7f3; color: #151a17; padding: 50px 64px; font-size: 22px; }
  section::after { color: #69736d; font-size: 14px; }
  h1 { font-size: 48px; line-height: 1.08; letter-spacing: -2px; margin: 8px 0 22px; }
  h2 { font-size: 34px; letter-spacing: -1px; margin: 4px 0 22px; }
  h3 { font-size: 22px; margin: 8px 0; }
  p, li { line-height: 1.45; }
  strong { color: #065f46; }
  code { background: #e9eee9; color: #16382b; border-radius: 6px; padding: 2px 6px; }
  pre { background: #111a16; color: #d5f7e7; border-radius: 14px; padding: 20px; font-size: 18px; }
  table { width: 100%; font-size: 19px; }
  th { background: #183f31; color: white; }
  td, th { padding: 11px 13px; }
  blockquote { border-left: 5px solid #10b981; background: #eaf7f0; margin: 24px 0; padding: 14px 22px; }
  .kicker { color: #08795b; font-size: 17px; font-weight: 800; letter-spacing: 1.2px; }
  .muted { color: #637069; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
  .card { background: white; border: 1px solid #dbe2dc; border-radius: 16px; padding: 20px; }
  .routes { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .routes .card { padding: 14px 18px; }
  .routes h3 { margin: 0 0 6px; }
  .routes p { margin: 0; font-size: 16px; }
  .hero { background: #10271f; color: white; }
  .hero strong { color: #5ee5ad; }
  .hero .muted { color: #aebfb7; }
  .truth-live { color: #08795b; font-weight: 800; }
  .truth-sandbox { color: #a15c00; font-weight: 800; }
  .truth-demo { color: #9f3030; font-weight: 800; }
---

<!-- _class: hero -->

<span class="kicker">BOTBOND · BONDED AGENT ACCESS</span>

# 처음 보는 AI 에이전트도<br/>가입 없이 필요한 API만 쓸 수 있어야 합니다

BotBond는 공급자가 직접 설치하는 에이전트 접근 게이트웨이입니다. 에이전트가 할 일을 설명하면, 공급자는 그 작업에 필요한 API 권한·호출 한도·비용을 정해 즉시 세션을 엽니다.

예약이나 주문처럼 나중에 책임이 생기는 작업은 환불 가능한 온체인 담보로 관리합니다.

<span class="muted">Permissionless agent onboarding for structured APIs · Google Cloud × Solana</span>

---

<span class="kicker">01 · TARGET & PROBLEM</span>

# API key만으로는 일회성 에이전트를 받기 어렵습니다

<div class="grid3">
<div class="card"><h3>공급자</h3><p>가격·재고·견적·예약 API<br/>MCP와 전문 데이터 공급자</p></div>
<div class="card"><h3>에이전트</h3><p>HTTP/MCP 요청과 지갑을 제어하는 구매·조달·여행·운영 에이전트</p></div>
<div class="card"><h3>오늘의 선택지</h3><p>알 수 없는 자동화를 막거나, 가입·심사·계약을 거친 뒤 장기 API key를 발급</p></div>
</div>

한 번의 가격 비교나 재고 확인을 하려는 에이전트에게 장기 계정은 과합니다. 반대로 공급자는 아무 에이전트에게나 API를 열 수 없습니다.

> BotBond는 이 사이에 있는 **짧고 제한적인 공식 접근 경로**입니다.

제외 대상: 학습 크롤러, 은폐형 악성 봇, 임의 사이트 우회, 운영자가 통합하지 않은 웹페이지

---

<span class="kicker">02 · THE GAP</span>

# 기존 보안과 결제 사이에 빈 자리가 있습니다

| 방식 | 잘하는 일 | 남는 공백 |
|---|---|---|
| Cloudflare / WAF | 비협조적 트래픽 차단 | 협조적인 미등록 에이전트의 온보딩 |
| API key | 장기 고객 인증·청구 | 일회성 접근의 가입·심사 비용 |
| Rate limit | 호출량 통제 | 자연어 목적과 endpoint 의미 |
| pay-per-use | 데이터 사용료 | 예약 등 사후 의무의 담보 |
| Web Bot Auth | 알려진 에이전트의 신원 확인 | 미등록 에이전트가 즉시 책임을 보일 방법 |

BotBond는 WAF나 API key를 대체하지 않습니다. 장기 고객은 API key를 쓰고, 비협조적 트래픽은 WAF가 막습니다. BotBond는 그 사이에서 처음 보는 에이전트에게 필요한 만큼만 접근권을 발급합니다.

---

<span class="kicker">03 · PRODUCT SURFACES</span>

# 제품은 네 가지 경로에서 작동합니다

<div class="grid2">
<div class="card"><h3><code>/shop</code> Customer Shop</h3><p>사람은 평소처럼 상품을 보고 구매합니다. 일반 고객 흐름에는 BotBond가 나타나지 않습니다.</p></div>
<div class="card"><h3><code>/agent</code> External Agent</h3><p>처음 보는 에이전트는 거부 응답에서 공식 진입점을 발견하고, 작업·권한·담보 조건을 확인합니다.</p></div>
<div class="card"><h3><code>/merchant</code> Merchant Ops</h3><p>운영자는 허용 범위, 세션 상태, 예약, 반환·정산 내역을 봅니다.</p></div>
<div class="card"><h3><code>/integrate</code> Developer Setup</h3><p>공급자는 discovery 문서와 예제로 자신의 에이전트 또는 API를 연결합니다.</p></div>
</div>

<span class="muted">Overview는 이 네 경로와 작동 원리를 소개하는 시작 화면입니다.</span>

---

<span class="kicker">04 · DEPLOYMENT</span>

# 일반 API는 닫아두고 에이전트 경로만 따로 엽니다

<div class="grid2">
<div class="card"><h3>일반 자동화 요청</h3><pre>Agent
  → Cloudflare / WAF
    → 기존 정책 또는 차단</pre><p>운영자는 기존 보안 정책을 그대로 유지합니다.</p></div>
<div class="card"><h3>운영자가 연 에이전트 경로</h3><pre>Agent
  → WAF allowlisted path
    → BotBond Gateway
  → Scoped Origin API</pre><p>작업과 조건에 동의한 에이전트만 이 경로로 들어옵니다.</p></div>
</div>

WAF를 건너뛰면 공급자는 기존 보안 정책과 접근 통제권을 잃습니다. BotBond가 차단을 풀어 주면 악성 자동화도 같은 문을 사용할 수 있습니다. 그래서 BotBond는 WAF 뒤에서, 운영자가 허용한 경로에만 붙습니다. 이 경로에서는 처음 보는 에이전트도 정해진 조건으로 세션을 열 수 있습니다.

일반 웹/API는 계속 닫아두고, <code>/.well-known/agent-access</code>와 범위가 제한된 에이전트 API만 별도 정책으로 엽니다.

데모의 최초 403은 **BShop edge policy 재현**이며 실제 Cloudflare zone 이벤트가 아닙니다.

---

<span class="kicker">05 · INTENT COMPILER</span>

# 에이전트는 API 구조 대신 할 일을 설명합니다

<div class="grid2">
<div><h3>에이전트의 작업 요청</h3><blockquote>1,500 이하 노트북의 가격과 재고를 비교하고 마지막 한 대를 예약한 뒤 해제해줘. 판매자 연락처와 리뷰는 필요 없어.</blockquote></div>
<div><h3>공급자 정책 초안</h3><pre>{
  "allowed": [
    "GET /products",
    "GET /products/{id}/inventory",
    "POST /reservations",
    "POST /reservations/{id}/release"
  ],
  "max_calls": 25,
  "reservation_ttl": "60s"
}</pre></div>
</div>

같은 가격·재고 비교라도 상점마다 endpoint와 field 이름이 다릅니다. 에이전트가 API 구조를 직접 추측하면 공급자 문서를 매번 학습해야 하고, 넓은 권한을 요구하기 쉽습니다. BotBond는 에이전트의 작업 설명과 공급자가 제공한 API catalog를 맞춰, 그 작업에 필요한 범위만 담은 정책 초안을 만듭니다.

Gemini는 정책 초안을 만들고, Gateway가 endpoint·field·rate·TTL을 결정론적으로 집행합니다. 세션이 시작된 뒤 AI가 권한을 넓히거나 돈을 정산하지 않습니다.

---

<span class="kicker">06 · REQUEST OUTCOMES</span>

# 세션 안에서는 약속한 범위만 실행됩니다

| 시도 | 결과 | Origin 도달 | 담보 변화 |
|---|---|---:|---:|
| session 없이 재고 조회 | Edge policy `403` | 아니오 | 없음 |
| 허용된 가격·재고 조회 | Gateway `200` | 예, 허용 field만 | 없음 |
| seller contacts 요청 | Scope `403` | 아니오 | 없음 |
| 예약 후 정상 해제 | Session close | 예 | 전액 반환 |
| 예약 후 TTL 방치 | Objective expiry | 예약만 도달 | 0.25 제한 정산 |

**차단은 몰수가 아닙니다.** 실제 비용을 만든 bonded action의 객관적 위반만 사전에 서명한 상한 안에서 정산합니다.

---

<span class="kicker">07 · ARCHITECTURE</span>

# 요청부터 정산까지 역할을 나눴습니다

<pre>Sponsored Browser Agent ── HMAC demo bridge ─┐
                                               ├─ BotBond Gateway · Cloud Run
Own-wallet Agent CLI ── pay.sh x402 sandbox ──┘    ├─ Vertex AI Gemini → policy
                                                     ├─ Firestore → session + evidence
                                                     ├─ deterministic guard → scope / rate / TTL
                                                     ├─ BShop Origin API → price / inventory
                                                     └─ Solana devnet → bond / refund / settlement</pre>

브라우저는 Firestore·서명 키에 직접 접근하지 않습니다. **pay.sh 결제는 own-wallet CLI만 수행**하며, browser는 HMAC demo bridge를 명시적으로 표시합니다. Solana settlement는 confirmed transaction만 Explorer에 연결합니다.

---

<span class="kicker">08 · IMPLEMENTATION TRUTH</span>

# 지금 동작하는 범위와 데모 경계

| 구성 | 상태 | 검증 증거 |
|---|---|---|
| Vertex AI Gemini | <span class="truth-live">LIVE</span> | 실행마다 새 policy와 hash |
| Cloud Run + Firestore | <span class="truth-live">LIVE</span> | public API, session state, events |
| Solana bond program | <span class="truth-live">LIVE DEVNET</span> | open + refund/settlement tx |
| pay.sh per-call rail | <span class="truth-sandbox">HOSTED SANDBOX</span> | 실제 `402 → pay → 200` |
| Browser session activation | <span class="truth-demo">DEMO BRIDGE</span> | HMAC credential, pay.sh verifier 아님 |
| Cloudflare zone/WAF | <span class="truth-demo">NOT INTEGRATED</span> | BShop Gateway가 403 정책만 재현 |

온체인 자산은 **devnet test mint**이며 실제 USDC가 아닙니다.

---

<span class="kicker">09 · 3-MINUTE DEMO</span>

# 3분 영상에서 제품 흐름을 보여줍니다

<div class="grid2">
<div class="card"><h3>1. 사람의 쇼핑</h3><p><code>/shop</code>에서 일반 고객은 기존처럼 상품을 보고 구매합니다. BotBond는 이 경로를 바꾸지 않습니다.</p></div>
<div class="card"><h3>2. 에이전트의 첫 요청</h3><p><code>/agent</code>에서 미등록 에이전트가 일반 API를 요청해 <code>403</code>을 받고, discovery 문서에서 공식 에이전트 경로를 찾습니다.</p></div>
<div class="card"><h3>3. 제한된 세션</h3><p>에이전트가 작업을 설명하면 policy·담보 조건이 제시됩니다. browser flow는 새 Solana devnet bond와 scoped <code>200</code>, private <code>403</code>을 보여줍니다.</p></div>
<div class="card"><h3>4. 정산과 외부 에이전트</h3><p>정상 종료는 반환, 예약 방치는 제한 정산으로 끝납니다. 별도 terminal에서는 own-wallet 에이전트가 pay.sh sandbox의 <code>402 → payment → 200</code>을 실행합니다.</p></div>
</div>

영상의 browser flow와 own-wallet pay.sh flow는 서로 다른 실행 경로로 표시합니다. 하나의 세션처럼 편집하지 않습니다.

---

<span class="kicker">10 · REPRODUCIBLE SUBMISSION</span>

# 심사위원이 직접 확인할 수 있습니다

<div class="grid2">
<div class="card"><h3>라이브 제품</h3><p><code>botbond-bshop.vercel.app</code></p><p>Shop · Agent · Merchant · Integrate</p></div>
<div class="card"><h3>내 지갑으로 실행</h3><pre>npm run example:external-agent -- \
  --gateway https://... \
  --wallet ~/.config/solana/id.json</pre></div>
</div>

제출물: 발표 PDF · 재현 가능한 GitHub/README · 3분 실제 온체인 영상 · 심사 기간 접근 가능한 endpoint

Program: <code>EG9r…KaRKR</code> · asset: devnet test mint, not USDC

> 처음 보는 에이전트에게 필요한 것은 즉시 신뢰가 아니라, 범위가 분명하고 정산 규칙이 정해진 접근권입니다.
