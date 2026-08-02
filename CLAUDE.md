# BotBond — 해커톤 프로젝트 (역할 C 워크스페이스)

구글 클라우드 X 솔라나 AI Agentic 해커톤 제출 프로젝트. 이 저장소에서 사용자는 **역할 C (Payment Protocol & Solana Owner)** 를 담당한다.

## 진실의 원천

- 제품·아키텍처·계약·일정: `docs/00`~`docs/06` (팀 합의 문서 — 임의 수정 금지)
- **크로스팀 계약은 `docs/03-contracts.md`가 유일 기준.** 계약이 부족하면 코드를 고치지 말고 `docs/ccr/CCR-NNN.md` 작성 후 팀 합의.
- 결정 변경은 `docs/00-decision-log.md` 형식(D-NNN, Reversed by 표기)을 따른다.

## 역할 C 소유 경계

- 소유: `programs/botbond/**`, `packages/payment-client/**`, devnet 배포 스크립트(`scripts/`), `docs/c/**`
- 불가침: `apps/web`(A 소유), `apps/gateway`·`services/intent-agent`·`packages/contracts`(B 소유)
- 공유 스키마(03 문서의 policy/event/program 계약)는 3인 합의 없이 변경 금지

## 핵심 불변식 (코드보다 우선)

- 범위 밖 호출 차단은 **무차감** — bond 정산 사유가 아님
- 객관적 reservation expiry만 `penalty <= max_penalty` 내 제한 정산
- `max_penalty <= bond_amount` 강제, 이중 정산 거부, open 후 policy hash 불변
- pay.sh가 제공하지 않는 기능을 제공한다고 표현하지 않음 (spike로 검증된 것만 VERIFIED)

## 문서화 규칙 (팀 공유용)

- 매 작업 후 `docs/c/PROGRESS.md`에 `Claim / Evidence / Limit` 한 줄 추가 (발표 deck의 기술 근거가 됨)
- pay.sh 검증 결과는 `docs/c/paysh-spike.md`의 VERIFIED/NOT VERIFIED 표 갱신
- 온체인 증거(program ID, tx, Explorer 링크)는 `docs/c/solana-evidence.md`에 즉시 기록

## 환경

- 지갑: agent 데모용 = 사용자 Phantom `ZStxNf7d5RPEuojP1iu8FqPYJixamn5NxR57cTbjtPU` (devnet SOL 보유, 서명은 사용자만)
- 배포/과금용 CLI 키페어: `~/.config/solana/id.json` (`BCvDRgFChtunjJ2mnGnBF9HGRvZm2wTSPgNWJxvCg6Hb`)
- 클러스터: devnet (`solana config get`)
- 실자금·메인넷 작업 없음. devnet 한정.

## 일정 (2026)

- **8/3 (월) 23:59 KST 최종 제출 마감** — 프로덕트 소개서 + GitHub Repo + 데모영상 필수, 온체인 실행 증빙 포함
- 8/7 파이널리스트 발표 → 멘토링 주간 → 8/21 오프라인 Demo Day (docs/04의 D0~D14 플랜은 8/21 기준)
