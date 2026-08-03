#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv"
PYTHON_BIN="${PYTHON:-python3}"

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    echo "Missing Python 3.12 or newer." >&2
    exit 1
  fi

  PYTHON_VERSION="$($PYTHON_BIN -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  if ! "$PYTHON_BIN" -c 'import sys; raise SystemExit(sys.version_info < (3, 12))'; then
    echo "Intent agent requires Python 3.12 or newer; found $PYTHON_VERSION." >&2
    exit 1
  fi

  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

if ! "$VENV_DIR/bin/python" -c 'import fastapi, httpx, pydantic, pytest, pytest_asyncio' >/dev/null 2>&1; then
  "$VENV_DIR/bin/python" -m pip install -e "$ROOT_DIR/services/intent-agent[test]"
fi

cd "$ROOT_DIR"
exec "$VENV_DIR/bin/python" -m pytest services/intent-agent/tests
