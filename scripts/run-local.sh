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

# 读取 .env 中的配置项；文件不存在或未设置时返回空。
env_value() {
  [ -f "$ROOT_DIR/.env" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\(.*\)$/\1/p" "$ROOT_DIR/.env" | tail -n 1
}

# 本地启动时不会执行 docker 的入口脚本，初始账号需在此创建。
# ensure-user 是幂等的：账号已存在时保持原密码，不会覆盖已修改过的密码。
ensure_user() {
  role="$1"
  username="$(env_value "JIAXIU_$(printf '%s' "$role" | tr '[:lower:]' '[:upper:]')_USERNAME")"
  password="$(env_value "JIAXIU_$(printf '%s' "$role" | tr '[:lower:]' '[:upper:]')_INITIAL_PASSWORD")"

  if [ -z "$username" ] || [ -z "$password" ]; then
    echo "跳过 $role 账号初始化：.env 未配置对应的用户名或初始密码。" >&2
    return 0
  fi

  printf '%s\n' "$password" | (cd apps/api && uv run python -m app.cli ensure-user \
    --username "$username" --role "$role" --password-stdin)
}

cd "$ROOT_DIR"
uv sync --project apps/api --frozen
corepack pnpm install --frozen-lockfile

ensure_user admin
ensure_user contributor

(
  cd apps/api
  exec uv run -- uvicorn app.main:app --reload --host 0.0.0.0 --port "${JIAXIU_API_PORT:-8000}"
) &
API_PID=$!

corepack pnpm --dir apps/web dev --host 0.0.0.0 --port "${JIAXIU_WEB_DEV_PORT:-5173}" &
WEB_PID=$!

wait "$API_PID" "$WEB_PID"
