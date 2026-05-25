# Deploy FortSmart Cloud API no Render

## Comandos

| Fase | Comando |
|------|---------|
| Build | `npm ci` + `npm run build` (Dockerfile) |
| Start | `npm run start` → `node dist/server.js` |
| Health | `GET /health` |

```bash
docker build -t fortsmart-api .
docker run --rm -p 3000:3000 --env-file .env fortsmart-api
curl -s http://localhost:3000/health
```

## Passos

1. **Render** → New Web Service → GitHub `fortsmart-cloud-api` (raiz ou `backend/fortsmart-cloud-api` no monorepo)
2. **Environment** = Docker, `Dockerfile` na raiz do serviço
3. Variáveis: `ENV_MIGRATION_CHECKLIST.md`
4. Validar `https://<service>.onrender.com/health` ou custom domain
5. Custom domain `api.fortsmart-agro.com.br` + CNAME Cloudflare
6. `bash tests/render/smoke-test.sh`
7. Testar Mobile e Desktop

## Rotas críticas

- `GET /health`
- `POST /sync/base/push`, `/sync/monitoring-report/push`, `/sync/planting/push`
- `GET /windows/base/:farmId`, `/windows/monitoring/:farmId`, `/windows/planting/:farmId`
- NDVI: `POST /api/soil-sampling/ndvi/plots/:plotId/scenes/search`, `POST .../generate`, `GET .../status`

## Critérios

- [ ] `docker build -t fortsmart-api .`
- [ ] `/health` com `database: "ok"` e `capabilities_version: 4`
- [ ] Smoke verde
- [ ] Mobile + Desktop OK
