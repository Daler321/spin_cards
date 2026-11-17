#!/bin/sh
# Runs migrations and seeds before the API starts (only the api service sets RUN_MIGRATIONS).
set -e
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  pnpm run --silent migrate
  if [ "${NODE_ENV:-development}" = "production" ]; then
    pnpm run --silent seed:prod
  else
    pnpm run --silent seed
  fi
fi
exec "$@"
