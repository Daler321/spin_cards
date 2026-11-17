#!/bin/sh
# Server-side control of the production stack. Lives in /opt/spincards next to compose.yml.
#   ./spincards.sh init <domain>   create .env with generated secrets
#   ./spincards.sh deploy [tag]    start a loaded release (default: the last shipped); migrations run on start;
#                                  on success old release images are pruned (the previous one stays for rollback)
#   ./spincards.sh rollback        go back to the previous release (code only: migrations stay)
#   ./spincards.sh ps | logs [service] | restart [service] | down
#   ./spincards.sh backup          dump the database now (backups/manual)
#   ./spincards.sh restore-check   restore the newest daily dump into a scratch DB and verify it
#   ./spincards.sh restore <file>  replace the database with a dump (stops the game meanwhile)
#   ./spincards.sh config-defaults activate the release's default game config (replaces admin edits)
#   ./spincards.sh prune           delete images of old releases (keeps the current and previous)
set -eu
cd "$(dirname "$0")"

compose() {
  docker compose --env-file .env --env-file release.env -f compose.yml "$@"
}

secret() {
  # URL- and shell-safe: letters and digits only.
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48
}

need_env() {
  [ -f .env ] || { echo "no .env: run ./spincards.sh init <domain> first" >&2; exit 1; }
  if grep -q '__generate__' .env; then
    echo ".env still has __generate__ placeholders" >&2
    exit 1
  fi
  for key in DOMAIN TELEGRAM_BOT_TOKEN; do
    grep -q "^$key=." .env || { echo ".env: $key is empty" >&2; exit 1; }
  done
}

current_tag() {
  sed -n 's/^TAG=//p' release.env 2>/dev/null || true
}

# Deletes release images except the current and previous ones (rollback needs the previous).
prune_images() {
  keep_current=$(current_tag)
  keep_previous=$(cat previous.tag 2>/dev/null || true)
  docker images --format '{{.Repository}}:{{.Tag}}' | grep '^spincards-' | while read -r ref; do
    tag=${ref##*:}
    [ "$tag" = "$keep_current" ] || [ "$tag" = "$keep_previous" ] ||
      docker rmi "$ref" >/dev/null || echo "kept $ref: still in use" >&2
  done
  docker image prune -f >/dev/null
}

cmd=${1:-help}
[ $# -gt 0 ] && shift

case "$cmd" in
  init)
    domain=${1:?usage: ./spincards.sh init <domain>}
    [ -f .env ] && { echo ".env already exists" >&2; exit 1; }
    umask 077
    sed "s/^DOMAIN=.*/DOMAIN=$domain/" env.example >.env
    while grep -q '__generate__' .env; do
      sed -i "0,/__generate__/s//$(secret)/" .env
    done
    echo "created .env for $domain: set TELEGRAM_BOT_TOKEN and ADMIN_OWNER_PASSWORD in it"
    ;;
  deploy)
    tag=${1:-$(cat shipped.tag 2>/dev/null || true)}
    [ -n "$tag" ] || { echo "usage: ./spincards.sh deploy <tag> (nothing shipped yet)" >&2; exit 1; }
    need_env
    for image in api bot web admin; do
      docker image inspect "spincards-$image:$tag" >/dev/null 2>&1 ||
        { echo "image spincards-$image:$tag is not loaded (make ship)" >&2; exit 1; }
    done
    previous=$(current_tag)
    if [ -n "$previous" ] && [ "$previous" != "$tag" ]; then
      echo "$previous" >previous.tag
    fi
    printf 'TAG=%s\n' "$tag" >release.env
    # The worker (uid 1000) writes database dumps here.
    mkdir -p backups && chown 1000:1000 backups
    if compose up -d --remove-orphans --wait --wait-timeout 300; then
      # Caddy runs with its admin API off: a changed Caddyfile needs a proxy restart.
      sum=$(sha256sum Caddyfile | cut -d' ' -f1)
      if [ "$sum" != "$(cat .caddyfile.sha 2>/dev/null || true)" ]; then
        compose restart proxy && echo "$sum" >.caddyfile.sha
      fi
      echo "release $tag is up"
      prune_images || echo "pruning old images failed; ./spincards.sh prune retries" >&2
    else
      compose ps
      compose logs --tail 50 api worker bot
      echo "release $tag did not become healthy; ./spincards.sh rollback goes back" >&2
      exit 1
    fi
    ;;
  rollback)
    [ -f previous.tag ] || { echo "no previous release" >&2; exit 1; }
    exec "$0" deploy "$(cat previous.tag)"
    ;;
  ps) compose ps ;;
  logs) compose logs --tail 200 -f "$@" ;;
  restart) compose restart "$@" ;;
  down) compose down ;;
  config-defaults)
    printf 'Replace the active game config with the defaults of this release? Type yes: '
    read -r answer
    [ "$answer" = "yes" ] || exit 1
    compose exec api node dist/seed/config-defaults-cli.js
    ;;
  backup) compose exec worker node dist/ops/cli.js backup ;;
  restore-check) compose exec worker node dist/ops/cli.js restore-check ;;
  restore)
    file=${1:?usage: ./spincards.sh restore backups/daily/<file>.dump}
    [ -f "$file" ] || { echo "no such file: $file" >&2; exit 1; }
    case "$file" in backups/*) ;; *) echo "the dump must be inside ./backups" >&2; exit 1 ;; esac
    printf 'Replace the database with %s? The game stops meanwhile. Type yes: ' "$file"
    read -r answer
    [ "$answer" = "yes" ] || exit 1
    compose stop api worker bot
    compose run --rm --no-deps worker node dist/ops/cli.js restore "/$file"
    compose up -d --wait api worker bot
    ;;
  prune) prune_images ;;
  *)
    sed -n '2,13p' "$0"
    ;;
esac
