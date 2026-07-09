#!/usr/bin/env bash
set -euo pipefail

: "${DEPLOY_PATH:?DEPLOY_PATH env var must be set}"

cd "$DEPLOY_PATH"

npm ci
echo "DEBUG pwd=$(pwd)"
echo "DEBUG env-file-cat-A:"; cat -A .env | head -8
node -e "require('dotenv').config(); console.log('DEBUG DB_HOST=[' + process.env.DB_HOST + '] len=' + (process.env.DB_HOST||'').length); console.log('DEBUG DB_USER=[' + process.env.DB_USER + ']'); console.log('DEBUG DB_NAME=[' + process.env.DB_NAME + ']'); console.log('DEBUG DB_PASSWORD_set=' + (process.env.DB_PASSWORD !== undefined));"
cat -A prisma.config.ts | tail -10
./node_modules/.bin/prisma migrate deploy
./node_modules/.bin/prisma generate
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
