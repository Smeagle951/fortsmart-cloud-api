#!/usr/bin/env bash
# FortSmart Cloud API - preparacao VM Ubuntu Oracle Cloud
# Uso: sudo bash deploy/oracle-cloud/01_install_server.sh
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
echo "==> Atualizando pacotes..."
apt-get update -y
apt-get upgrade -y
echo "==> Dependencias basicas..."
apt-get install -y ca-certificates curl gnupg lsb-release ufw git unzip jq
echo "==> Docker Engine..."
install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi
ARCH="$(dpkg --print-architecture)"
CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${CODENAME} stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
systemctl start docker
if [[ -n "${SUDO_USER:-}" ]]; then usermod -aG docker "${SUDO_USER}"; fi
apt-get install -y nginx certbot python3-certbot-nginx
systemctl enable nginx
systemctl start nginx
docker --version
docker compose version
nginx -v
certbot --version
echo "Concluido."
