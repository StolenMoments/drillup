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

systemctl --user restart drillup
systemctl --user status drillup --no-pager
