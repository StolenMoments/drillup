#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOY_PATH:?DEPLOY_PATH env var must be set}"

cd "$DEPLOY_PATH"

if [ ! -f .env ]; then
  echo "Missing .env at DEPLOY_PATH: $DEPLOY_PATH/.env" >&2
  exit 1
fi

missing_env=0
for key in DB_HOST DB_USER DB_PASSWORD DB_NAME APP_PASSWORD SESSION_SECRET; do
  if ! grep -Eq "^${key}=" .env; then
    echo "Missing required key in .env: $key" >&2
    missing_env=1
  fi
done
if [ "$missing_env" -ne 0 ]; then
  exit 1
fi

# 진행 중인 AI 생성 job이 끝날 때까지 대기한 뒤 빌드를 시작한다.
# (빌드가 .next를 덮어쓰면 구서버가 청크를 못 찾을 수 있어 대기를 빌드 앞에 둔다.)
node scripts/wait-for-generation-drain.mjs

NODE_ENV=development NPM_CONFIG_PRODUCTION=false npm ci --include=dev --ignore-scripts
./node_modules/.bin/prisma generate
if ! ./node_modules/.bin/prisma migrate deploy; then
  echo "choice hardening migration 실패 기록을 rolled back으로 표시한 뒤 재시도합니다."
  ./node_modules/.bin/prisma migrate resolve --rolled-back 20260715000000_add_choice_hardening_job
  ./node_modules/.bin/prisma migrate deploy
fi

if ! command -v bwrap >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y bubblewrap
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y bubblewrap
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y bubblewrap
  else
    echo "AI_SANDBOX_UNAVAILABLE: no supported package manager found for bubblewrap" >&2
    exit 1
  fi
fi
node scripts/ai-sandbox-preflight.mjs

npm run build

SMOKE_HEAD_BEFORE="$(git rev-parse HEAD)"
SMOKE_STATUS_BEFORE="$(git status --porcelain=v1 --untracked-files=all)"
./node_modules/.bin/tsx scripts/ai-engine-smoke.ts
SMOKE_HEAD_AFTER="$(git rev-parse HEAD)"
SMOKE_STATUS_AFTER="$(git status --porcelain=v1 --untracked-files=all)"
if [ "$SMOKE_HEAD_BEFORE" != "$SMOKE_HEAD_AFTER" ] || [ "$SMOKE_STATUS_BEFORE" != "$SMOKE_STATUS_AFTER" ]; then
  echo "AI smoke test changed repository HEAD or working tree" >&2
  exit 1
fi

UNIT_DIR="$HOME/.config/systemd/user"
UNIT_PATH="$UNIT_DIR/drillup.service"

mkdir -p "$UNIT_DIR"

NPM_BIN="$(command -v npm)"
sed -e "s|__DEPLOY_PATH__|$DEPLOY_PATH|g" -e "s|__NPM_BIN__|$NPM_BIN|g" "$DEPLOY_PATH/deploy/drillup.service" > "$UNIT_PATH"
systemctl --user daemon-reload
systemctl --user enable drillup

# 빌드 중 새로 시작한 job이 있으면 재시작 전에 한 번 더 대기한다.
node scripts/wait-for-generation-drain.mjs

systemctl --user restart drillup
systemctl --user status drillup --no-pager
