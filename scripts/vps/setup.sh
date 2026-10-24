#!/usr/bin/env bash
# One-time VPS setup for Kaduna Kulture (Ubuntu 22.04/24.04 or Debian 12).
# Run as root on the fresh server:
#   curl -fsSL <raw url of this file> | bash -s -- <git repo url>
#   or: bash setup.sh <git repo url>
set -euo pipefail
REPO="${1:?usage: setup.sh <git repo url>}"
DIR=/opt/kulture

echo "==> packages"
apt-get update -q
apt-get install -y -q ca-certificates curl git ufw

if ! command -v docker >/dev/null; then
  echo "==> docker"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> swap (the frontend build needs ~3 GB of memory)"
if ! swapon --show | grep -q .; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> firewall: ssh + http + https only"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> code"
if [ ! -d "$DIR/.git" ]; then git clone "$REPO" "$DIR"; fi
cd "$DIR"

if [ ! -f .env ]; then
  cp infra/env.production.example .env
  gen() { openssl rand -base64 64 | tr -d '\n/+=' | cut -c1-48; }
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(gen)|" .env
  sed -i "s|^KK_JWT_SECRET=.*|KK_JWT_SECRET=$(gen)|" .env
  sed -i "s|^KK_ADMIN_TOKEN=.*|KK_ADMIN_TOKEN=$(gen)|" .env
  chmod 600 .env
  echo "==> wrote .env with fresh random secrets (edit it for DeepSeek / Lightning)"
fi

echo "==> nightly database backup at 03:15"
chmod +x scripts/vps/*.sh
( crontab -l 2>/dev/null | grep -v kulture-backup ; echo "15 3 * * * $DIR/scripts/vps/backup.sh >> /var/log/kulture-backup.log 2>&1 # kulture-backup" ) | crontab -

echo "==> first deploy"
scripts/vps/update.sh
