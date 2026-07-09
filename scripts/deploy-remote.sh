#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOY_PATH:?DEPLOY_PATH env var must be set}"

cd "$DEPLOY_PATH"

npm ci
npx prisma migrate deploy
npm run build

UNIT_DIR="$HOME/.config/systemd/user"
UNIT_PATH="$UNIT_DIR/drillup.service"

mkdir -p "$UNIT_DIR"

sed "s|__DEPLOY_PATH__|$DEPLOY_PATH|g" "$DEPLOY_PATH/deploy/drillup.service" > "$UNIT_PATH"
systemctl --user daemon-reload
systemctl --user enable drillup

systemctl --user restart drillup
systemctl --user status drillup --no-pager
