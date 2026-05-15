# FortSmart Cloud API

API Node/Express para sincronização mobile/desktop → PostgreSQL (Neon) + object storage (imagens).

## Deploy Railway (`api.fortsmart-agro.com.br`)

### Repositório correto (recomendado)

Ligue o serviço Railway ao repositório **standalone**:

- **GitHub:** https://github.com/Smeagle951/fortsmart-cloud-api  
- **Branch:** `main`  
- **Root Directory:** *(vazio — raiz do repo)*  
- **Builder:** Dockerfile (definido em `railway.json`)

Não use o monorepo `FortSmart-Agro` para este serviço, a menos que o submodule `backend/fortsmart-cloud-api` esteja atualizado (ver abaixo).

### Passos

1. Variáveis obrigatórias: `DATABASE_URL`, `API_KEY_PEPPER`, credenciais R2/S3 se usar upload de imagens (ver `.env.example`).
2. **Settings → Build:** Builder = **Dockerfile**; apague comandos customizados antigos (`npm ci` só).
3. **Redeploy** após push em `fortsmart-cloud-api`.
4. Confirme a versão publicada:

```bash
curl.exe -s https://api.fortsmart-agro.com.br/health
```

Resposta esperada (versão nova):

```json
{
  "success": true,
  "status": "ok",
  "capabilities_version": 2,
  "routes": {
    "monitoring_report_image": "POST /sync/monitoring-report/image",
    "planting_image": "POST /sync/planting/image",
    "sync_diagnostics": "GET /sync/diagnostics/:farmId"
  }
}
```

Se `capabilities_version` **não existir** ou for `< 2`, o host ainda está com build antigo.

## Testar rotas de imagem (após deploy)

Sem ficheiro → **401** (sem API key) ou **400** (campo `file` obrigatório). **Não** deve ser `Cannot POST`.

```bash
curl.exe -s -w "\nHTTP:%{http_code}\n" -X POST "https://api.fortsmart-agro.com.br/sync/monitoring-report/image"
curl.exe -s -w "\nHTTP:%{http_code}\n" -X POST "https://api.fortsmart-agro.com.br/sync/planting/image"
```

Push JSON (rota antiga — deve dar **401**, não 404):

```bash
curl.exe -s -w "\nHTTP:%{http_code}\n" -X POST "https://api.fortsmart-agro.com.br/sync/monitoring-report/push" -H "Content-Type: application/json" -d "{}"
```

## App mobile

URL base na integração: `https://api.fortsmart-agro.com.br` (sem `:8000`, sem `railway.internal`).

Se usar o domínio do site Next como base, configure na Vercel:

`FORTSMART_CLOUD_API_PROXY_TARGET=https://api.fortsmart-agro.com.br`

e faça redeploy do `fortsmart_report`.

## Desenvolvimento local

```bash
cd backend/fortsmart-cloud-api
npm ci
npm run build
npm run migrate
npm run dev
```
