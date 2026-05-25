#!/usr/bin/env bash
# export CERTBOT_EMAIL=admin@example.com && sudo bash deploy/oracle-cloud/04_ssl_certbot.sh
set -euo pipefail
DOMAIN="${FORTSMART_API_DOMAIN:-api.fortsmart-agro.com.br}"
EMAIL="${CERTBOT_EMAIL:-}"
if [[ -z "${EMAIL}" ]]; then echo "ERRO: export CERTBOT_EMAIL"; exit 1; fi
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${EMAIL}" --redirect
certbot renew --dry-run
curl -sfI "https://${DOMAIN}/health" | head -n 5 || echo "AVISO: verifique DNS"
echo "SSL: https://${DOMAIN}"
