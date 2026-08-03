# BotBond 제출 문안

## 1) 문제 정의 (Problem Statement)

실시간 가격·재고·견적을 다루는 서비스에는 외부 AI 에이전트도 잠재 고객입니다. 그러나 처음 보는 에이전트에게 곧바로 API를 열기는 어렵습니다. 기존 API key 발급에는 회원가입, 심사, 계약, 결제수단 등록이 뒤따르고, WAF나 CAPTCHA는 신원을 확인할 수 없는 자동화 요청을 일괄 차단합니다. 공급자 입장에서는 API를 열면 남용과 인프라 비용을 감수해야 하고, 닫으면 구매·조달·예약처럼 시간이 중요한 정상 수요를 놓치게 됩니다.

이 문제는 에이전트가 사람보다 빠르게 여러 서비스를 탐색하고 거래하는 환경에서 더 커집니다. 일회성 작업을 수행하려는 정상 에이전트에게 며칠이 걸리는 API key 발급 절차는 맞지 않습니다. 반대로 단순한 호출 제한만으로는 에이전트가 무엇을 하려는지, 어느 범위까지 허용해야 하는지 알기 어렵습니다.

BotBond의 가설은 명확합니다. 기존 계정이나 평판이 없는 에이전트라도 작업 목적과 사용 범위, 예산을 서명하고 환불 가능한 보증금을 걸 수 있다면, 공급자는 제한된 API 접근권을 즉시 발급할 수 있습니다. 정상 사용에는 보증금을 돌려주고, 실제 비용을 만든 위반에는 사전에 합의한 한도만 정산합니다. 신원을 먼저 믿는 대신 책임질 조건을 먼저 합의하는 방식입니다.

## 2) 솔루션 요약 (Solution Overview)

BotBond는 공급자가 직접 설치하는 보증금 기반 agent-access gateway입니다. Cloudflare나 WAF를 우회하지 않으며, 운영자가 허용한 `/.well-known/agent-access`와 `/agent-api/*` 경로에서만 작동합니다. 일반 자동화 요청은 기존 보안 정책으로 막고, 협조적인 미등록 에이전트에게만 공식 접근 절차를 제공합니다.

에이전트는 먼저 “가격과 재고를 확인하고 상품 한 개를 예약한다”와 같은 작업 목적, 지갑, 예산을 제출합니다. Gemini는 이 요청을 공급자의 API catalog와 대조해 허용 endpoint와 field, 최대 호출 수, 요청 속도, 유효시간, 비용 상한이 담긴 최소 권한 정책으로 바꿉니다. 에이전트는 정책과 보증금 조건을 검토한 뒤 자기 지갑으로 서명합니다.

서명이 끝나면 BotBond의 Solana 프로그램이 정책 hash와 연결된 bond-open 트랜잭션을 실행합니다. 세션이 열리는 동안 Gateway는 호출 범위와 속도, TTL을 결정론적으로 검사합니다. 허용된 요청만 Origin API에 전달되며, 범위를 벗어난 요청은 데이터에 닿기 전에 차단됩니다. 이때 단순 차단만으로 보증금을 차감하지는 않습니다.

정상적으로 작업을 마치면 에이전트가 bond-refund 트랜잭션에 서명해 보증금을 돌려받습니다. 예약한 희소 재고를 TTL까지 방치하는 등 객관적인 위반으로 공급자 비용이 발생하면, Solana 프로그램은 사전에 서명한 상한만 공급자에게 정산하고 나머지를 반환합니다. 금액을 움직이는 기준은 Gemini의 판단이 아니라 정책 hash와 결정론적 규칙입니다.

현재 데모에서는 own-wallet 에이전트가 Solana devnet에서 실제 bond open과 refund·제한 정산 트랜잭션을 생성합니다. 온체인 자산은 USDC가 아닌 devnet SPL test mint입니다. pay.sh 연동은 별도의 hosted sandbox에서 실제 `402 → payment → scoped 200` 흐름으로 검증하며, 브라우저 데모 경로와 같은 결제 세션으로 표현하지 않습니다.

## 주요 기술 스택

- **AI / Cloud:** Vertex AI Gemini (Intent Compiler), Google Cloud Run, Google Cloud Firestore
- **Blockchain / Payment:** Solana devnet, Anchor/Rust bond program, SPL Token (devnet test mint), pay.sh hosted x402 sandbox
- **Frontend:** Next.js 15, React 19, TypeScript, Vercel
- **Backend / API:** Node.js·TypeScript Fastify Gateway, Python 3.12 FastAPI Intent Compiler, Server-Sent Events
- **Development / Test:** Firebase Firestore Emulator, Vitest, Pytest, Playwright

Firebase Auth와 Firebase Hosting, Google ADK, 실제 USDC, pay.sh MPP 반복 세션은 현재 구현 범위에 포함되지 않습니다.
