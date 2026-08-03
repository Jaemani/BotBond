#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
JAVA_BIN="${JAVA_HOME:+$JAVA_HOME/bin/java}"

if [[ -z "${JAVA_HOME:-}" ]]; then
  if command -v /usr/libexec/java_home >/dev/null 2>&1; then
    JAVA_HOME="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
  fi

  if [[ -z "${JAVA_HOME:-}" ]] && command -v brew >/dev/null 2>&1; then
    BREW_JAVA_HOME="$(brew --prefix openjdk@21 2>/dev/null || true)"
    if [[ -n "$BREW_JAVA_HOME" ]]; then
      JAVA_HOME="$BREW_JAVA_HOME"
    fi
  fi

  JAVA_BIN="${JAVA_HOME:+$JAVA_HOME/bin/java}"
fi

if [[ -z "$JAVA_BIN" || ! -x "$JAVA_BIN" ]]; then
  echo "Firestore emulator requires Java 21. Set JAVA_HOME to a Java 21 installation." >&2
  exit 1
fi

JAVA_MAJOR="$($JAVA_BIN -version 2>&1 | awk -F'[\".]' '/version/ { print $2; exit }')"
if [[ ! "$JAVA_MAJOR" =~ ^[0-9]+$ ]] || (( JAVA_MAJOR < 21 )); then
  echo "Firestore emulator requires Java 21 or newer; found $JAVA_MAJOR at $JAVA_BIN." >&2
  exit 1
fi

export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

cd "$ROOT_DIR"
npm exec firebase-tools -- emulators:exec --only firestore --project botbond-test \
  "npm run test --workspace @botbond/gateway -- --run test/firestore-repository.test.ts"
