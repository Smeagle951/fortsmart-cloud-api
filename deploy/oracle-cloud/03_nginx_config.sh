#!/usr/bin/env bash
# Uso: sudo bash deploy/oracle-cloud/03_nginx_config.sh
set -euo pipefail
DOMAIN="${FORTSMART_API_DOMAIN:-api.fortsmart-agro.com.br}"
AVAILABLE=/etc/nginx/sites-available/fortsmart-api
ENABLED=/etc/nginx/sites-enabled/fortsmart-api
cat > "${AVAILABLE}" <<'NGINX_EOF'
limit_req_zone $binary_remote_addr zone=fortsmart_api_limit:10m rate=30r/s;
server {
    listen 80;
    listen [::]:80;
    server_name DOMAIN_PLACEHOLDER;
    client_max_body_size 30m;
    location / {
        limit_req zone=fortsmart_api_limit burst=60 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
NGINX_EOF
sed -i "s/DOMAIN_PLACEHOLDER/${DOMAIN}/g" "${AVAILABLE}"
ln -sf "${AVAILABLE}" "${ENABLED}"
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t
systemctl reload nginx
echo "Nginx OK: ${DOMAIN}"
