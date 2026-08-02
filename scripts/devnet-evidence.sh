#!/bin/bash
# devnet 배포 + 온체인 증빙 원샷 스크립트 (역할 C).
# 전제: ~/.config/solana/id.json에 devnet SOL >= 3 (Phantom에서 이체 또는 airdrop).
# 사용: bash scripts/devnet-evidence.sh
set -euo pipefail
cd "$(dirname "$0")/.."

RPC="https://api.devnet.solana.com"
KEYPAIR="$HOME/.config/solana/id.json"
PROGRAM_ID="$(solana address -k target/deploy/botbond-keypair.json)"

BAL_LAMPORTS=$(solana balance -u "$RPC" -k "$KEYPAIR" --lamports | awk '{print $1}')
if [ "$BAL_LAMPORTS" -lt 3000000000 ]; then
  echo "중단: CLI 키페어 devnet 잔고 부족 ($BAL_LAMPORTS lamports < 3 SOL)."
  echo "Phantom에서 $(solana address -k "$KEYPAIR") 로 5 SOL 이체 후 재실행."
  exit 1
fi

if ! solana program show "$PROGRAM_ID" -u "$RPC" >/dev/null 2>&1; then
  echo "== 프로그램 devnet 배포 =="
  solana program deploy target/deploy/botbond.so \
    --program-id target/deploy/botbond-keypair.json -u "$RPC" -k "$KEYPAIR"
else
  echo "== 프로그램 이미 배포됨: $PROGRAM_ID =="
fi
solana program show "$PROGRAM_ID" -u "$RPC" | head -6

echo "== 증빙 시나리오 실행 (open→close 전액환불 / replay 거부 / open→penalty 정산) =="
ANCHOR_PROVIDER_URL="$RPC" ANCHOR_WALLET="$KEYPAIR" BOTBOND_CLUSTER=devnet \
  ./node_modules/.bin/ts-mocha -p ./tsconfig.json -t 1000000 scripts/devnet-scenario.ts

echo "== 완료. docs/c/solana-evidence.md 확인 =="
