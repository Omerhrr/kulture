#!/usr/bin/env bash
# Frontend check inside WSL: run nuxt's typecheck (vue-tsc) and fail on errors.
set -euo pipefail
cd "$(dirname "$0")/../frontend"
if [ ! -d "node_modules" ]; then
  echo "node_modules missing - run 'npm ci' first" >&2
  exit 3
fi
npx nuxi typecheck
