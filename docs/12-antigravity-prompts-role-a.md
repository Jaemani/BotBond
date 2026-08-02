# Antigravity Prompts — Role A

`apps/web`은 이미 빌드가 통과하는 상태로 존재한다. 아래 프롬프트는 그 위에
쌓는 작업이다. 저장소 전체를 던지지 말고, 각 프롬프트에 명시된 파일만 컨텍스트로
넣는다.

## 공통 프리앰블

모든 프롬프트 앞에 붙인다.

```text
You own apps/web/** only. The cross-team source of truth is
docs/03-contracts.md and docs/07-ui-state-matrix.md.

Hard rules:
- The frontend never decides allow/deny. It only renders BotBondEvent data.
- Do not add a rule that infers a verdict from a path or field name.
- Usage (pay.sh, spent) and Bond (Solana, refundable) must stay visually
  distinct in colour, shape, and axis. Never render them as two identical bars.
- On REQUEST_DENIED the bond visual must not animate at all.
- Do not present fixture data as live chain data. The DEV FIXTURE badge stays
  until real SSE is wired.
- If an event or field you need is missing, stop and write a CCR in
  docs/00-decision-log.md instead of inventing it.

Finish every task with: commands run, what you verified, known limits.
```

## A-1 — 트랜잭션 3상태 완성

```text
Task:
Add PENDING and FAILED transaction states to the Money panel.

Context files:
- apps/web/lib/types.ts
- apps/web/components/Panels.tsx
- apps/web/app/globals.css
- packages/demo-fixtures/generate.py

Do:
1. In generate.py, emit BOND_OPENED twice for scenario 01: first with
   status PENDING, then the same signature with status CONFIRMED.
2. Add a fourth fixture 04-chain-failure.json where the refund transaction
   returns status FAILED with a reason field.
3. Ensure the reducer updates an existing tx in place by signature rather
   than appending a duplicate row.
4. PENDING shows a subtle pulse; FAILED shows the reason inline and the
   session must NOT display as settled.

Acceptance:
- npx tsc --noEmit passes
- npm run build passes
- Scenario 04 never shows a success state anywhere on screen
```

## A-2 — 20초 이해도 테스트 하네스

```text
Task:
Add a /comprehension route that runs the 20-second judge test.

Context files:
- apps/web/app/page.tsx
- docs/04-demo-validation.md (Gate 6)

Do:
1. Show scenario 02 auto-played at 2x with no controls.
2. After 20 seconds, freeze and show four questions with free-text inputs:
   - Who locked money, and why?
   - What did pay.sh do? What did Solana do?
   - What did the AI do?
   - Why is this different from an API key?
3. Store answers in component state only. No backend, no storage APIs.
4. Print a copyable summary for the team log.

Acceptance:
- Works with keyboard only
- No localStorage or sessionStorage anywhere
```

## A-3 — 실제 SSE 연결

```text
Task:
Replace the fixture player with a live SSE source, keeping fixture mode
available behind a toggle.

Context files:
- apps/web/lib/usePlayer.ts
- apps/web/lib/reducer.ts
- docs/03-contracts.md section 3 and 4

Do:
1. Add lib/useLiveSession.ts that opens EventSource against
   /v1/sessions/{sessionId}/events and feeds the SAME applyEvent reducer.
2. The reducer must not change. If it has to change, that is a CCR.
3. Fixture mode keeps the DEV FIXTURE badge. Live mode replaces it with the
   gateway base URL and the session id.
4. On connection loss show an explicit disconnected state. Never freeze on
   the last good frame as if it were current.

Acceptance:
- Switching modes does not require reloading the page
- The same three scenarios render identically from fixtures and from a live
  gateway replaying the same events
```

## A-4 — 발표 모드

```text
Task:
Add a presenter mode for the demo day projector.

Context files:
- apps/web/app/page.tsx
- apps/web/app/globals.css
- docs/04-demo-validation.md section 1

Do:
1. Key `p` toggles presenter mode: larger type, higher contrast, controls
   hidden except a progress bar.
2. Keys 1/2/3 switch scenarios. Space plays and pauses. `r` resets.
3. Add a fixed caption line that shows the current demo beat, driven by the
   event type, matching the 3-minute script beats in 04-demo-validation.md.
4. Respect prefers-reduced-motion.

Acceptance:
- Readable at 1920x1080 from the back of a room
- No control needs a mouse during the 3-minute run
```
