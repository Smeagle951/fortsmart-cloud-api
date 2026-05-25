# Checklist de variáveis — Railway → Render

Use ao copiar variáveis do Railway para **Render → Environment**.

| Risco | Significado |
|-------|-------------|
| **Crítico** | Sync/windows/auth quebram |
| **Alto** | Imagens/storage indisponíveis |
| **Médio** | NDVI ou migrations degradados |
| **Baixo** | Observabilidade |

## Obrigatórias

| Variável | Obrigatória | Onde usada | Risco se faltar |
|----------|-------------|------------|-----------------|
| `DATABASE_URL` | Sim | `src/db/pool.ts`, migrations, sync, windows | **Crítico** |
| `API_KEY_PEPPER` | Sim | `src/utils/hashApiKey.ts` | **Crítico** se mudar |
| `DATABASE_SSL` | Condicional | `src/db/pool.ts` | **Alto** em Neon — `DATABASE_SSL=1` |
| `NODE_ENV` | Recomendado | `src/server.ts`, NDVI | **Médio** |
| `PORT` | Não | `src/server.ts` | **Baixo** (Render injeta) |

## R2

| Migração | Código | Risco |
|----------|--------|-------|
| `R2_ACCESS_KEY_ID` | `R2_ACCESS_KEY_ID` / `FORTSMART_S3_ACCESS_KEY` | **Alto** |
| `R2_SECRET_ACCESS_KEY` | `R2_SECRET_ACCESS_KEY` / `FORTSMART_S3_SECRET_KEY` | **Alto** |
| `R2_BUCKET` | **`R2_BUCKET_NAME`** | **Alto** |
| `R2_ENDPOINT` | `R2_ENDPOINT` / `R2_ACCOUNT_ID` | **Alto** |
| `R2_PUBLIC_URL` | **`R2_PUBLIC_BASE_URL`** | **Alto** |

## Não usadas

| Variável | Notas |
|----------|-------|
| `JWT_SECRET` | Auth = API key Bearer |
| `CORS_ORIGIN` | `cors()` aberto em `app.ts` |

## Opcionais

`DRY_RUN`, `DISABLE_BOOT_MIGRATIONS`, `PUBLIC_API_URL`, `CDSE_*`, `SENTINEL_*`, `NDVI_*`.

## Validação

1. `GET /health` → `database: "ok"`, `r2: "ok"` (se imagens)
2. Pepper e DB **idênticos** ao Railway
3. `bash tests/render/smoke-test.sh`
