#!/usr/bin/env bash
# Deploy the latest code: pull, rebuild, restart. Safe to run any time -
# the database lives in a Docker volume and migrations run at startup.
#   ssh root@<vps> /opt/kulture/scripts/vps/update.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

git pull --ff-only
docker compose build --pull
docker compose up -d --remove-orphans
docker image prune -f >/dev/null

echo "==> waiting for the backend"
for i in $(seq 1 60); do
  if docker compose exec -T backend python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health/ready')" 2>/dev/null; then
    echo "==> live: https://$(grep ^KK_DOMAIN= .env | cut -d= -f2)"
    docker compose ps
    exit 0
  fi
  sleep 2
done
echo "!! backend did not become ready - recent logs:"
docker compose logs --tail=80 backend
exit 1
