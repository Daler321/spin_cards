#!/bin/sh
# Copies a built release to the server and starts it. Nothing is built on the server.
# After a successful deploy, local images of older releases are deleted (dev :latest images stay).
# Usage: infra/scripts/ship.sh user@host [tag]   (tag defaults to the last `make release`)
#   DIR=/opt/spincards  remote folder
set -eu
cd "$(dirname "$0")/../.."

host=${1:?usage: make ship HOST=user@server}
tag=${2:-$(cat infra/.release-tag 2>/dev/null || true)}
[ -n "$tag" ] || { echo "no release: run make release first" >&2; exit 1; }
dir=${DIR:-/opt/spincards}

images=""
for app in api bot web admin; do
  docker image inspect "spincards-$app:$tag" >/dev/null || exit 1
  images="$images spincards-$app:$tag"
done

echo "== bundle -> $host:$dir"
# shellcheck disable=SC2029 # $dir is meant to expand locally
ssh "$host" "mkdir -p '$dir'"
scp -q deploy/compose.yml deploy/env.example deploy/spincards.sh infra/caddy/Caddyfile "$host:$dir/"
# shellcheck disable=SC2029
ssh "$host" "chmod +x '$dir/spincards.sh'"

echo "== images ($tag) -> $host"
# One archive: layers shared by the images travel once.
# shellcheck disable=SC2086 # word splitting of the image list is intended
docker save $images | gzip -1 | ssh "$host" 'gunzip | docker load'

# shellcheck disable=SC2029
ssh "$host" "echo '$tag' >'$dir/shipped.tag'"
# shellcheck disable=SC2029
if ! ssh "$host" "test -f '$dir/.env'"; then
  echo "images are loaded; the server has no .env yet (docs/deploy.md, step 2):"
  echo "  ssh $host"
  echo "  cd $dir && ./spincards.sh init <domain> && nano .env && ./spincards.sh deploy"
  exit 0
fi

echo "== deploy"
# shellcheck disable=SC2029
ssh "$host" "'$dir/spincards.sh' deploy '$tag'"

echo "== local: delete release images other than $tag"
docker images --format '{{.Repository}}:{{.Tag}}' |
  grep -E '^spincards-(api|bot|web|admin):[0-9a-f]{12}(-dirty)?$' | while read -r ref; do
    [ "${ref##*:}" = "$tag" ] || docker rmi "$ref" >/dev/null || echo "kept $ref: still in use" >&2
  done
