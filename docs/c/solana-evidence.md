# Solana 온체인 증거 — 역할 C

심사기준 "실제 구동 여부(실행 로그·이력 기반 확인)" 대응 문서. 모든 devnet 배포·트랜잭션을 여기에 기록한다.

## Program

| 항목 | 값 |
|---|---|
| Program ID | `HoamYxgGuZoQerLGthZK8K4vLKTvEraZ4o7N8fkjk4bc` |
| Explorer | https://explorer.solana.com/address/HoamYxgGuZoQerLGthZK8K4vLKTvEraZ4o7N8fkjk4bc?cluster=devnet |
| 클러스터 | devnet |
| Anchor 버전 | 1.1.2 (avm) / TS 클라이언트 `@coral-xyz/anchor` 0.32.1 |
| IDL | `packages/payment-client/idl/botbond.json` (tracked runtime asset), `target/idl/botbond.json` (Anchor build output) |
| 배포 tx | `5eCzLUn1UJa7SxfQT1n5oLz6fhsxVbxDAoQ3EL3MG2npzWBfWZkJTis6Fq1iUAoKXhHZYPkHunobTND1vKpSJwyo` (slot 480678232, 2026-08-02 21:20 KST) |
| Upgrade authority | `BCvDRgFChtunjJ2mnGnBF9HGRvZm2wTSPgNWJxvCg6Hb` |
| 데모 SPL mint | `5FeWpV8Zj9XZPSCisNcNw2VeWda2GajPhJiku4BoxAHP` (decimals 6) |

## 지갑

| 역할 | 주소 | 비고 |
|---|---|---|
| Agent (데모) | `ZStxNf7d5RPEuojP1iu8FqPYJixamn5NxR57cTbjtPU` | 사용자 Phantom, devnet SOL 보유 |
| 배포/settlement authority | `BCvDRgFChtunjJ2mnGnBF9HGRvZm2wTSPgNWJxvCg6Hb` | CLI 키페어 |

## 트랜잭션 로그

재현 명령: `bash scripts/devnet-evidence.sh` (시나리오: `scripts/devnet-scenario.ts`)
Explorer 링크 형식 (A 핸드오프용): `https://explorer.solana.com/tx/<SIGNATURE>?cluster=devnet`
(스크립트가 실행마다 아래 표 끝에 행을 자동 append — 표를 파일 끝에 유지할 것)

| 일시(KST) | Instruction | Tx | Explorer | 비고 |
|---|---|---|---|---|
| 2026-08-02 21:21 KST | open_bond (#1) | `3SYJPbqBTQ9cWmGjc2ci…` | https://explorer.solana.com/tx/3SYJPbqBTQ9cWmGjc2cit36iNaZ4fmexMxH1K1LHr9K9VwKZUUMKAd39HH6UqmdH8K3Rgnh7FeymByFNMvqeoaRu?cluster=devnet | bond=1000000 escrow, session=5dPmcEq1… |
| 2026-08-02 21:21 KST | close_valid (#1) | `4H6hKLDy2L3CRKUrgFYF…` | https://explorer.solana.com/tx/4H6hKLDy2L3CRKUrgFYFGYXeAmUh3Qs6nqEAHN2eJwKfSrjqYL6Ydd4Wo9KWANrawYtXCudgENypuakTdwHektdg?cluster=devnet | full refund 1000000, receipt=evidence hash |
| 2026-08-02 21:21 KST | (replay 시도 #1) | — | — | 이중정산 거부: `SETTLEMENT_CONFLICT` (온체인 status 게이트, tx 미발생) |
| 2026-08-02 21:21 KST | open_bond (#2) | `gZYKhMgKijzWruYVoQjt…` | https://explorer.solana.com/tx/gZYKhMgKijzWruYVoQjtjPme6GGdCYwwCWWm9AAS6q3RR1D41b5cvySWizxiFESKEjsKR6L9EXVKW5TuE46wPcg?cluster=devnet | bond=1000000 escrow, session=Gt1hYMJT… |
| 2026-08-02 21:22 KST | settle_violation (#2) | `nJ8rQSoxv2ZvJyHvoWe4…` | https://explorer.solana.com/tx/nJ8rQSoxv2ZvJyHvoWe45Pe2VM4ZNhZzbedGGPc92jYd6zH1sHRAyC6Fga4iab9RJMfygcRXLN8xtpgVQ1F9Y4d?cluster=devnet | penalty=300000 → merchant, refund=700000 → agent (보존식 성립) |
