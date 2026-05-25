# FortSmart Cloud API

API Node/Express para sincronização mobile/desktop → PostgreSQL (Neon) + object storage (Cloudflare R2).

**Produção:** [Render](https://render.com) — `https://api.fortsmart-agro.com.br` (custom domain + Cloudflare).

## Deploy Render

| Recurso | Caminho |
|---------|---------|
| Guia passo a passo | `RENDER_DEPLOY.md` |
| Variáveis de ambiente | `ENV_MIGRATION_CHECKLIST.md` |
| Blueprint | `render.yaml` |
| Smoke test | `tests/render/smoke-test.sh` |

### Repositório

- **GitHub:** https://github.com/Smeagle951/fortsmart-cloud-api  
- **Branch:** `main`  
- **Root Directory:** *(vazio — raiz do repo)*  
- **Environment:** Docker (`Dockerfile` na raiz)

No monorepo `FortSmart-Agro`, use o submodule `backend/fortsmart-cloud-api` e faça bump após push no repo standalone.

### Passos

1. **Render** → Web Service → conectar o repositório acima.
2. **Environment** = Docker; health check `GET /health`.
3. Variáveis obrigatórias: `DATABASE_URL`, `DATABASE_SSL=1` (Neon), `API_KEY_PEPPER`, R2/S3 se usar imagens (ver `.env.example`).
4. **Manual Deploy** após push em `main`.
5. Validar:

```bash
curl.exe -s https://api.fortsmart-agro.com.br/health
```

Resposta esperada (build atual):

```json
{
  "success": true,
  "status": "ok",
  "capabilities_version": 4,
  "database": "ok",
  "r2": "ok",
  "ndvi_scenes_search": "POST /api/soil-sampling/ndvi/plots/:plotId/scenes/search",
  "ndvi_layers": "GET /api/soil-sampling/ndvi/plots/:plotId/layers",
  "ndvi_generate": "POST /api/soil-sampling/ndvi/plots/:plotId/generate",
  "ndvi_status": "GET /api/soil-sampling/ndvi/status"
}
```

Se `capabilities_version` **&lt; 4** ou `database: "error"`, o deploy ou as variáveis no Render ainda estão incorretos.

### Build local

```bash
docker build -t fortsmart-api .
docker run --rm -p 3000:3000 --env-file .env fortsmart-api
curl -s http://localhost:3000/health
bash tests/render/smoke-test.sh
```

### NDVI (Copernicus via servidor)

Variáveis no **Render** → Environment:

`CDSE_CLIENT_ID`, `CDSE_CLIENT_SECRET`, `CDSE_TOKEN_URL`, `SENTINEL_CATALOG_URL`, `SENTINEL_PROCESS_URL` (ver `.env.example`).

```bash
curl.exe -s "https://api.fortsmart-agro.com.br/api/soil-sampling/ndvi/status"
curl.exe -s "https://api.fortsmart-agro.com.br/api/soil-sampling/ndvi/copernicus/test-token"
```

### Gerar camada NDVI (`generate`)

O app mobile usa **POST** com polígono GeoJSON no corpo — igual ao `scenes/search`.

```powershell
curl.exe -s "https://api.fortsmart-agro.com.br/api/soil-sampling/ndvi/status"

curl.exe -i -X POST "https://api.fortsmart-agro.com.br/api/soil-sampling/ndvi/plots/<PLOT_ID>/generate" ^
  -H "Authorization: Bearer %API_KEY%" ^
  -H "Content-Type: application/json" ^
  -d "{\"farm_id\":\"<FARM_ID>\",\"campaign_id\":\"16\",\"scene_id\":\"<SCENE_ID>\",\"image_date\":\"2026-05-25\",\"polygon\":{\"type\":\"Polygon\",\"coordinates\":[[...]]}}"
```

Sucesso: **HTTP 200/201** + `{"success":true,"layer":{...}}`.

**Nota:** `scenes/search` não exige Postgres; `generate` grava em `soil_ndvi_layers`. Com banco indisponível, o servidor pode retornar camada efêmera (sem persistência) se o processamento Copernicus tiver sucesso.

Script: `scripts/curl-ndvi-generate.example.ps1`

### R2 no Render

```bash
# Gera .local/render-r2-vars.txt para colar no painel Render
$env:R2_ACCESS_KEY_ID = '...'
$env:R2_SECRET_ACCESS_KEY = '...'
node scripts/finalize-r2-render-vars.mjs
```

## Testar rotas de imagem (após deploy)

```bash
curl.exe -s -w "\nHTTP:%{http_code}\n" -X POST "https://api.fortsmart-agro.com.br/sync/monitoring-report/image"
curl.exe -s -w "\nHTTP:%{http_code}\n" -X POST "https://api.fortsmart-agro.com.br/sync/planting/image"
```

## App mobile

URL base na integração: `https://api.fortsmart-agro.com.br` (sem `:8000`, sem hosts internos de PaaS).

Se o site Next fizer proxy, na Vercel:

`FORTSMART_CLOUD_API_PROXY_TARGET=https://api.fortsmart-agro.com.br`

## Desenvolvimento local

```bash
cd backend/fortsmart-cloud-api
npm ci
npm run build
npm run migrate
npm run dev
```
