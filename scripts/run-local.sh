#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
API_PID=""
WEB_PID=""

cleanup() {
  [ -z "$API_PID" ] || kill "$API_PID" 2>/dev/null || true
  [ -z "$WEB_PID" ] || kill "$WEB_PID" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

cd "$ROOT_DIR"
uv sync --project apps/api --frozen
corepack pnpm install --frozen-lockfile

(
  cd apps/api
  exec uv run -- uvicorn app.main:app --reload --host 0.0.0.0 --port "${JIAXIU_API_PORT:-8000}"
) &
API_PID=$!

corepack pnpm --dir apps/web dev --host 0.0.0.0 --port "${JIAXIU_WEB_DEV_PORT:-5173}" &
WEB_PID=$!

wait "$API_PID" "$WEB_PID"
