#!/bin/sh
set -eu

: "${JIAXIU_ADMIN_USERNAME:?必须设置管理员账号名。}"
: "${JIAXIU_ADMIN_INITIAL_PASSWORD:?必须设置管理员初始密码。}"
: "${JIAXIU_CONTRIBUTOR_USERNAME:?必须设置投稿者账号名。}"
: "${JIAXIU_CONTRIBUTOR_INITIAL_PASSWORD:?必须设置投稿者初始密码。}"

if [ "$JIAXIU_ADMIN_INITIAL_PASSWORD" = "CHANGE_ME_ADMIN_PASSWORD" ]; then
  echo "管理员初始密码仍为示例值，API 拒绝启动。" >&2
  exit 2
fi
if [ "$JIAXIU_CONTRIBUTOR_INITIAL_PASSWORD" = "CHANGE_ME_CONTRIBUTOR_PASSWORD" ]; then
  echo "投稿者初始密码仍为示例值，API 拒绝启动。" >&2
  exit 2
fi

printf '%s\n' "$JIAXIU_ADMIN_INITIAL_PASSWORD" \
  | /opt/jiaxiu-venv/bin/python -m app.cli ensure-user \
      --username "$JIAXIU_ADMIN_USERNAME" --role admin --password-stdin
printf '%s\n' "$JIAXIU_CONTRIBUTOR_INITIAL_PASSWORD" \
  | /opt/jiaxiu-venv/bin/python -m app.cli ensure-user \
      --username "$JIAXIU_CONTRIBUTOR_USERNAME" --role contributor --password-stdin

exec /opt/jiaxiu-venv/bin/python -m uvicorn app.main:app \
  --app-dir /workspace/apps/api --host 0.0.0.0 --port 8000 \
  --proxy-headers --forwarded-allow-ips="*"
