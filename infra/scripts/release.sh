#!/bin/sh
# Builds production images for the server's platform, tagged with the commit: spincards-<app>:<tag>.
# Usage: infra/scripts/release.sh [platform]   (default linux/amd64; FORCE=1 allows a dirty tree)
set -eu
cd "$(dirname "$0")/../.."

platform=${1:-linux/amd64}
if [ -n "$(git status --porcelain)" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "uncommitted changes: commit first (or FORCE=1 for a test build)" >&2
  exit 1
fi
tag=$(git rev-parse --short=12 HEAD)
[ -n "$(git status --porcelain)" ] && tag="$tag-dirty"

for app in api bot web admin; do
  echo "== spincards-$app:$tag ($platform)"
  docker buildx build --platform "$platform" --target runtime \
    -f "apps/$app/Dockerfile" -t "spincards-$app:$tag" --load .
done
echo "$tag" >infra/.release-tag
echo "built release $tag; next: make ship HOST=user@server"
