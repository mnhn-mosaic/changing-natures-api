#!/bin/sh

set -e

if [ "$1" = "pm2-runtime" ] || [ "$1" = "pm2-dev" ]; then
  if [ "$NODE_ENV" != 'production' ]; then
    pnpm install
  fi
fi

exec "$@"
