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
./node_modules/.bin/prisma migrate deploy
npm run build

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
