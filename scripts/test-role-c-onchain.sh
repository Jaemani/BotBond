#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WALLET_PATH="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"

for tool in anchor solana rustup; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing $tool. Install local on-chain test tools with: brew install anchor solana rustup" >&2
    exit 1
  fi
done

if [[ ! -x "$HOME/.cargo/bin/cargo-build-sbf" ]] && ! command -v cargo-build-sbf >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    RUSTUP_HINT="PATH=\"$(brew --prefix rustup)/bin:\$PATH\" cargo install cargo-build-sbf --locked"
  else
    RUSTUP_HINT="cargo install cargo-build-sbf --locked"
  fi
  echo "Missing cargo-build-sbf. Install it with: $RUSTUP_HINT" >&2
  exit 1
fi

if [[ ! -f "$WALLET_PATH" ]]; then
  mkdir -p "$(dirname "$WALLET_PATH")"
  solana-keygen new --no-bip39-passphrase --silent --force --outfile "$WALLET_PATH"
  echo "Created local-only Solana wallet at $WALLET_PATH"
fi

export ANCHOR_WALLET="$WALLET_PATH"
if command -v brew >/dev/null 2>&1; then
  RUSTUP_BIN="$(brew --prefix rustup 2>/dev/null || true)/bin"
  if [[ -x "$RUSTUP_BIN/cargo" ]]; then
    export PATH="$RUSTUP_BIN:$HOME/.cargo/bin:$PATH"
  fi
fi

cd "$ROOT_DIR"
npm run build --workspace @botbond/contracts
npm run build --workspace @botbond/payment-client
anchor build --ignore-keys
anchor test --skip-build --validator legacy
