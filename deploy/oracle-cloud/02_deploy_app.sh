#!/usr/bin/env bash
# Uso (raiz repo): bash deploy/oracle-cloud/02_deploy_app.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"
IMAGE_NAME=fortsmart-api
CONTAINER_NAME=fortsmart-api
ENV_FILE="${REPO_ROOT}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERRO: ${ENV_FILE} nao encontrado"
  exit 1
fi
docker stop "${CONTAINER_NAME}" 2>/dev/null || true
docker rm "${CONTAINER_NAME}" 2>/dev/null || true
docker build -t "${IMAGE_NAME}" .
docker run -d --name "${CONTAINER_NAME}" --restart unless-stopped --env-file "${ENV_FILE}" -p 3000:3000 "${IMAGE_NAME}"
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3000/health >/dev/null 2>&1; then break; fi
  sleep 1
  if [[ "${i}" -eq 30 ]]; then docker logs --tail 80 "${CONTAINER_NAME}"; exit 1; fi
done
curl -s http://127.0.0.1:3000/health
docker logs --tail 40 "${CONTAINER_NAME}"
docker ps --filter "name=${CONTAINER_NAME}"
