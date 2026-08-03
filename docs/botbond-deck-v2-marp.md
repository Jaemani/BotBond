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
  .hero { background: #10271f; color: white; }
  .hero strong { color: #5ee5ad; }
  .hero .muted { color: #aebfb7; }
  .truth-live { color: #08795b; font-weight: 800; }
  .truth-sandbox { color: #a15c00; font-weight: 800; }
  .truth-demo { color: #9f3030; font-weight: 800; }
---

<!-- _class: hero -->

<span class="kicker">BOTBOND · BONDED AGENT ACCESS</span>

# API keys were built for organizations, not autonomous agents.

BotBond는 처음 보는 외부 에이전트에게도 **목적·범위·비용이 제한된 API 세션**을 즉시 발급하는 merchant-installed gateway입니다.

환불 가능한 온체인 담보가 예약 같은 사후 의무를 보증합니다.

<span class="muted">Permissionless agent onboarding for structured APIs · Google Cloud × Solana</span>

---

<span class="kicker">01 · TARGET & PROBLEM</span>

# 정상적인 미등록 에이전트가 쓸 공식 경로가 없다

<div class="grid3">
<div class="card"><h3>공급자</h3><p>가격·재고·견적·예약 API<br/>MCP와 전문 데이터 공급자</p></div>
<div class="card"><h3>에이전트</h3><p>HTTP/MCP 요청과 wallet을 제어하는 구매·조달·여행·운영 agent</p></div>
<div class="card"><h3>현재 선택지</h3><p>unknown automation을 차단하거나 가입·심사·계약 후 장기 API key 발급</p></div>
</div>

> BotBond의 경쟁자는 CAPTCHA가 아니라 **API key 발급 절차**입니다.

제외 대상: 학습 크롤러, 은폐형 악성 봇, 임의 사이트 우회, 운영자가 통합하지 않은 웹페이지

---

<span class="kicker">02 · THE GAP</span>

# 기존 도구가 남긴 한 칸

| 방식 | 잘하는 일 | 남는 공백 |
|---|---|---|
| Cloudflare / WAF | 비협조적 트래픽 차단 | 협조적인 unknown agent onboarding |
| API key | 장기 고객 인증·청구 | 일회성 접근의 가입·심사 비용 |
| Rate limit | 호출량 통제 | 자연어 목적과 endpoint 의미 |
| pay-per-use | 데이터 사용료 | 예약 등 사후 의무의 담보 |
| Web Bot Auth | 알려진 agent identity | 미등록 agent의 즉시 책임 증명 |

**Web Bot Auth proves identity. BotBond makes bounded behavior economically accountable.**

---

<span class="kicker">03 · PRODUCT SURFACES</span>

# 한 화면짜리 대시보드가 아니라, 실제 제품의 네 경로

<div class="grid2">
<div class="card"><h3><code>/shop</code> Customer Shop</h3><p>사람의 일반 쇼핑 경로. BotBond UI가 개입하지 않습니다.</p></div>
<div class="card"><h3><code>/agent</code> External Agent</h3><p>403 → discovery → intent → policy → bond → scoped session</p></div>
<div class="card"><h3><code>/merchant</code> Merchant Ops</h3><p>재고, 허용/차단 요청, refund/penalty, Explorer 증거</p></div>
<div class="card"><h3><code>/integrate</code> Developer Setup</h3><p>공개 discovery와 자기 wallet으로 실행하는 agent 예제</p></div>
</div>

사용자·에이전트·운영자·개발자의 목적과 정보가 서로 섞이지 않습니다.

---

<span class="kicker">04 · DEPLOYMENT</span>

# Cloudflare를 우회하지 않는다

<div class="grid2">
<div class="card"><h3>일반 자동화 요청</h3><pre>Agent
  → Cloudflare / WAF
    → 기존 정책 또는 차단</pre><p>비협조적 자동화는 계속 차단합니다.</p></div>
<div class="card"><h3>운영자가 연 agent route</h3><pre>Agent
  → WAF allowlisted path
    → BotBond Gateway
      → Scoped Origin API</pre><p>협조적인 미등록 agent만 조건부로 온보딩합니다.</p></div>
</div>

공개 경로: <code>/.well-known/agent-access</code> · <code>/v1/intents</code> · <code>/v1/sessions</code> · <code>/v1/access/*</code>

데모의 최초 403은 **BShop edge policy 재현**이며 실제 Cloudflare zone 이벤트가 아닙니다.

---

<span class="kicker">05 · INTENT COMPILER</span>

# 자연어가 최소 권한 계약이 된다

<div class="grid2">
<div><h3>Agent request</h3><blockquote>1,500 이하 노트북의 가격과 재고를 비교하고 마지막 한 대를 예약한 뒤 해제해줘. 판매자 연락처와 리뷰는 필요 없어.</blockquote></div>
<div><h3>Gemini + merchant catalog</h3><pre>{
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

Gemini는 정책을 **제안**하고, Gateway가 endpoint·field·rate·TTL을 결정론적으로 집행합니다. AI는 돈을 가져갈 권한이 없습니다.

---

<span class="kicker">06 · REQUEST OUTCOMES</span>

# 요청이 어디서 멈췄는지 증명한다

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

# 네 기술이 서로 다른 책임을 가진다

<pre>External Agent
  ├─ pay.sh x402 sandbox gate ── per-call usage payment
  └─ BotBond Gateway · Cloud Run
       ├─ Vertex AI Gemini ───── intent → merchant-specific policy
       ├─ Firestore ──────────── session + ordered evidence
       ├─ deterministic guard ── scope / calls / rate / TTL
       ├─ BShop Origin API ───── price / inventory / reservation
       └─ Solana devnet program  bond open / refund / bounded settlement</pre>

브라우저는 Firestore·서명 키에 직접 접근하지 않습니다. Solana settlement는 confirmed transaction만 Explorer에 연결합니다.

---

<span class="kicker">08 · IMPLEMENTATION TRUTH</span>

# 실제와 재현을 한 표에서 구분한다

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

# 하나의 연속 실행으로 증명한다

1. `/shop`에서 사람의 정상 구매 경로와 live inventory 확인
2. `/agent`에서 unknown automation `403` 및 official discovery 확인
3. 자연어 intent → Gemini policy → policy hash 확인
4. 새 Solana devnet bond open signature 생성
5. 허용 호출 `200`, private endpoint `403`, origin 도달 여부 비교
6. 정상 해제는 전액 refund / 방치는 TTL 뒤 0.25 bounded settlement
7. 같은 session의 receipt와 Explorer transaction 확인

영상은 고정 fixture가 아니라 녹화 중 생성된 session ID와 signature를 사용합니다.

---

<span class="kicker">10 · REPRODUCIBLE SUBMISSION</span>

# 누구나 같은 경로를 실행할 수 있다

<div class="grid2">
<div class="card"><h3>Public product</h3><p><code>botbond-bshop.vercel.app</code></p><p>Shop · Agent · Merchant · Integrate</p></div>
<div class="card"><h3>Bring your own agent</h3><pre>npm run example:external-agent -- \
  --gateway https://... \
  --wallet ~/.config/solana/id.json</pre></div>
</div>

제출물: 발표 PDF · 재현 가능한 GitHub/README · 3분 실제 온체인 영상 · 심사 기간 접근 가능한 endpoint

> Unknown agents do not need instant trust. They need bounded access and enforceable accountability.
