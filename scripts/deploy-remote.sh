#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOY_PATH:?DEPLOY_PATH env var must be set}"

cd "$DEPLOY_PATH"

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
