#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${FORTSMART_API_BASE:-http://127.0.0.1:3000}"
BASE_URL="${BASE_URL%/}"
FARM_ID="${FARM_CLOUD_ID:-00000000-0000-4000-8000-000000000001}"
PASS=0
FAIL=0
red() { printf '\033[0;31m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
assert_http() {
  local method="$1" path="$2" expected="$3" body="${4:-}" extra_headers="${5:-}"
  local url="${BASE_URL}${path}" code
  if [[ -n "$body" ]]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$url" -H "Content-Type: application/json" ${extra_headers:+-H "$extra_headers"} -d "$body")
  else
    code=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$url" ${extra_headers:+-H "$extra_headers"})
  fi
  if [[ "$code" == "$expected" ]]; then green "OK  $method $path -> HTTP $code"; PASS=$((PASS+1)); else red "FAIL $method $path -> HTTP $code (expected $expected)"; FAIL=$((FAIL+1)); fi
}
echo "=== FortSmart smoke === Base: $BASE_URL"
health_json=$(curl -s "${BASE_URL}/health")
echo "$health_json" | grep -q '"success":true' && green "OK /health success" && PASS=$((PASS+1)) || { red "FAIL /health success"; FAIL=$((FAIL+1)); }
echo "$health_json" | grep -q '"service":"fortsmart-cloud-api"' && green "OK /health service" && PASS=$((PASS+1)) || { red "FAIL /health service"; FAIL=$((FAIL+1)); }
assert_http POST "/sync/base/push" 401 '{}'
assert_http POST "/sync/monitoring-report/push" 401 '{}'
assert_http POST "/sync/planting/push" 401 '{}'
assert_http GET "/windows/base/${FARM_ID}" 401
assert_http GET "/windows/monitoring/${FARM_ID}" 401
assert_http GET "/windows/planting/${FARM_ID}" 401
assert_http POST "/sync/monitoring-report/image" 401
assert_http POST "/sync/planting/image" 401
code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/ping")
[[ "$code" == "200" ]] && green "OK GET /ping" && PASS=$((PASS+1)) || { red "FAIL GET /ping HTTP $code"; FAIL=$((FAIL+1)); }
echo "=== ${PASS} ok, ${FAIL} fail ==="
exit $([[ "$FAIL" -eq 0 ]] && echo 0 || echo 1)