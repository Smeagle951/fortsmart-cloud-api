# Checklist de variáveis — Railway → Oracle Cloud

Repositório: fortsmart-cloud-api | Sem segredos reais.

## Esperado vs código real

| Esperado | Nome real | Nota |
|----------|-----------|------|
| R2_BUCKET | R2_BUCKET_NAME | objectStorage.service.ts |
| R2_PUBLIC_URL | R2_PUBLIC_BASE_URL | idem |
| JWT_SECRET | não usado | API_KEY_PEPPER |
| CORS_ORIGIN | não usado | cors() aberto em app.ts |

## Servidor

| Variável | Obrig. | Módulo | Risco | Exemplo |
|----------|--------|--------|-------|---------|
| NODE_ENV | Rec. | server.ts | logs/mock | production |
| PORT | Opc. | server.ts | default 3000 | 3000 |
| PUBLIC_API_URL | Opc. | pairing.service.ts | URL default | https://api.fortsmart-agro.com.br |
| RAILWAY_GIT_COMMIT_SHA | Opc. | health.routes.ts | metadado | abc1234 |
| DISABLE_BOOT_MIGRATIONS | Opc. | server.ts | sem migrate boot | 1 |
| DRY_RUN | Opc. | syncBase.routes.ts | rollback push | 1 |

## Banco Neon

| Variável | Obrig. | Módulo | Risco | Exemplo |
|----------|--------|--------|-------|---------|
| DATABASE_URL | Sim | pool.ts | sync falha | postgresql://user:***@ep-xxx.neon.tech/db |
| DATABASE_SSL | Opc. | pool.ts | TLS Neon | 1 |
| URL_DO_BANCO_DE_DADOS | Opc. | scripts | só migrate manual | = DATABASE_URL |
| POSTGRES_URL | Opc. | scripts | só migrate manual | = DATABASE_URL |

## Auth / API Key

| Variável | Obrig. | Módulo | Risco | Exemplo |
|----------|--------|--------|-------|---------|
| API_KEY_PEPPER | Sim | hashApiKey.ts | CRÍTICO se ≠ Railway | pepper-*** |
| JWT_SECRET | Não | — | sem efeito | — |

## R2 / imagens

| Variável | Obrig. | Módulo | Risco | Exemplo |
|----------|--------|--------|-------|---------|
| R2_BUCKET_NAME | Rec.* | objectStorage | upload falha | fortsmart-media |
| R2_ACCESS_KEY_ID | Rec.* | idem | upload falha | a1b2*** |
| R2_SECRET_ACCESS_KEY | Rec.* | idem | upload falha | secret*** |
| R2_ENDPOINT | Rec.* | idem | S3 off | https://ID.r2.cloudflarestorage.com |
| R2_PUBLIC_BASE_URL | Rec.* | idem | URLs quebradas | https://pub-xxx.r2.dev |
| R2_ACCOUNT_ID | Opc. | idem | monta endpoint | cf-id |
| FORTSMART_S3_* | Opc. | idem | aliases R2 | ver .env.example |

*Rec. = obrigatório se usar upload de imagens.

## CORS / domínios

CORS_ORIGIN não usado. Configure R2 (scripts/r2-cors.json) e Nginx.

## Logs / debug

NDVI_DEV_MOCK (ndvi), FORTSMART_API_BASE/KEY/FARM_CLOUD_ID (só scripts).

## NDVI

CDSE_CLIENT_ID, CDSE_CLIENT_SECRET, CDSE_TOKEN_URL, SENTINEL_CATALOG_URL, SENTINEL_PROCESS_URL, NDVI_PUBLIC_BASE_URL.

## Checklist cópia

- DATABASE_URL, API_KEY_PEPPER (idênticos)
- R2_BUCKET_NAME, R2_PUBLIC_BASE_URL (nomes corretos)
- NODE_ENV=production, PORT=3000
- Ignorar JWT_SECRET, CORS_ORIGIN
