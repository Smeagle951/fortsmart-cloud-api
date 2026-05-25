# Auditoria de migracao - FortSmart Cloud API

**Repositorio:** `backend/fortsmart-cloud-api` (standalone: github.com/Smeagle951/fortsmart-cloud-api)
**Data:** 2026-05-25
**Objetivo:** Migrar apenas o **host** (Railway -> Oracle Cloud). Neon, R2, Vercel, dominio e contratos permanecem iguais.

---

## 1. Arquivo principal da API

| Papel | Caminho |
|-------|---------|
| Entrada dev | `src/server.ts` |
| Entrada producao | `dist/server.js` |
| Montagem Express | `src/app.ts` |

Escuta `0.0.0.0` na porta `PORT` (padrao 3000). Migrações no boot via `dist/db/migrate.js` (salvo `DISABLE_BOOT_MIGRATIONS=1`).

---

## 2. Comandos

| Ambiente | Comando |
|----------|---------|
| Build | `npm run build` (tsc + copy-migrations) |
| Start producao | `npm run start` -> `node dist/server.js` |
| Railway | `npm run start` (railway.json) |
| Docker CMD | `npm run start` |
| Node | >= 20 |

---

## 3. Docker

| Item | Status |
|------|--------|
| Dockerfile | Sim (multi-stage Node 20 bookworm-slim, ARM64) |
| docker-compose.yml | **Nao** |
| .dockerignore | Sim (atualizado) |

---

## 4. Variaveis de ambiente

### Obrigatorias
- `DATABASE_URL` - Neon PostgreSQL
- `API_KEY_PEPPER` - hash API keys

### Recomendadas
- `PORT` (3000), `NODE_ENV=production`
- R2: `R2_*` ou `FORTSMART_S3_*` (bucket, keys, endpoint, public URL)

### Opcionais
- `DATABASE_SSL`, `DISABLE_BOOT_MIGRATIONS`, `DRY_RUN`, `PUBLIC_API_URL`
- NDVI: `CDSE_*`, `SENTINEL_*`, `NDVI_PUBLIC_BASE_URL`
- Railway only: `RAILWAY_GIT_COMMIT_SHA`

---

## 5. Rotas criticas (todas encontradas)

| Metodo | Rota | Arquivo |
|--------|------|---------|
| GET | /health | health.routes.ts |
| POST | /auth/api-key/validate | auth.routes.ts |
| POST | /sync/base/push | syncBase.routes.ts |
| POST | /sync/monitoring-report/push | syncOperational.routes.ts |
| POST | /sync/planting/push | syncOperational.routes.ts |
| POST | /sync/plant-stand/push | syncOperational.routes.ts |
| POST | /sync/phenology/push | syncOperational.routes.ts |
| POST | /sync/geo-export/push | syncOperational.routes.ts |
| POST | /sync/monitoring-report/image | monitoringMedia.routes.ts |
| POST | /sync/planting/image | plantingMedia.routes.ts |
| GET | /windows/base/:farmId | windowsBase.routes.ts |
| GET | /windows/monitoring/:farmId | windowsOperational.routes.ts |
| GET | /windows/planting/:farmId | windowsOperational.routes.ts |
| GET | /windows/phenology/:farmId | windowsOperational.routes.ts |
| GET | /windows/geo/:farmId | windowsOperational.routes.ts |

`capabilities_version`: **3**. Alias: `GET /ping`.

---

## 6. Arquivos principais

`src/server.ts`, `src/app.ts`, `src/routes/*`, `src/services/*`, `src/db/*`, `ndvi/*`, `Dockerfile`, `railway.json`, `.env.example`.

---

## 7. Riscos

| Risco | Mitigacao |
|-------|-----------|
| Pepper diferente | Copiar valor exato do Railway |
| Neon TLS | `DATABASE_SSL=1` |
| DNS | Apontar api.fortsmart-agro.com.br antes de desligar Railway |
| Multipart 25MB | client_max_body_size no nginx |
| ARM64 | node:20-bookworm-slim multi-arch |
| Monorepo desatualizado | Deploy repo standalone |

---

## 8. Docker Oracle Cloud

```bash
docker build -t fortsmart-api .
docker run -d --name fortsmart-api --restart unless-stopped --env-file .env -p 3000:3000 fortsmart-api
curl -s http://localhost:3000/health
docker logs -f fortsmart-api
```

Resposta /health esperada: `success: true`, `capabilities_version: 3`.

---

*Auditoria sem alteracao de rotas, JSON ou regras de negocio.*