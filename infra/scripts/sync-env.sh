#!/bin/sh
# Creates missing .env files from .env.example and appends keys added to the example later.
# Existing values are never changed, except the `__generate__` placeholder, which becomes a random secret.
set -eu

for example in "$@"; do
  target="${example%.example}"
  if [ ! -f "$target" ]; then
    cp "$example" "$target"
    echo "created $target"
  else
    grep -E '^[A-Z_][A-Z0-9_]*=' "$example" | while IFS= read -r line; do
      key="${line%%=*}"
      if ! grep -qE "^${key}=" "$target"; then
        printf '%s\n' "$line" >> "$target"
        echo "added $key to $target"
      fi
    done
  fi
  if grep -q '=__generate__$' "$target"; then
    secret=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
    sed -i.bak "s/=__generate__$/=${secret}/" "$target" && rm -f "$target.bak"
    echo "generated secrets in $target"
  fi
done
