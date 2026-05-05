# FortSmart Cloud API

API Node.js (Express + TypeScript + `pg`) para sincronização do módulo base com o app Flutter. Deploy típico: **Railway** + **Neon** (PostgreSQL). O backend legado em `backend/` (Express + Prisma) permanece separado.

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `DATABASE_URL` | sim | Connection string PostgreSQL |
| `API_KEY_PEPPER` | sim | Segredo usado no hash SHA-256 da API key |
| `PORT` | não | Padrão `3000` |
| `DRY_RUN` | não | Se `1`, `POST /sync/base/push` faz rollback após processar (útil para debug) |

## Migrações no Neon / `psql`

Se aparecer no log algo como `Extension "pgcrypto" already exists, skipping`, trata-se de um **aviso** (NOTICE) do Postgres, não de um erro — a migração pode ter concluído normalmente. O ficheiro `001_base_cloud_sync.sql` não depende de `pgcrypto` em PG 13+ (`gen_random_uuid()` nativo).

## Scripts

```bash
npm install
npm run migrate   # aplica SQL em src/db/migrations/ (tabela schema_migrations)
npm run build
npm run start     # node dist/server.js
npm run dev       # tsx src/server.ts
```

## Criar uma API key (primeira vez)

1. Gere uma chave opaca (ex.: `fs_live_fortsmart_teste_001`).
2. Com o **mesmo** `API_KEY_PEPPER` do Railway/servidor, gere o hash:

```bash
cd backend/fortsmart-cloud-api
API_KEY_PEPPER=seu_pepper npm run hash-api-key -- fs_live_fortsmart_teste_001
```

(O script `scripts/generate-api-key-hash.js` replica `src/utils/hashApiKey.ts`. PowerShell: `$env:API_KEY_PEPPER="..."` antes do comando.)

3. Insira no Postgres (`farm_id` **NULL** até ao primeiro push):

```sql
INSERT INTO api_keys (key_hash, key_prefix, name, farm_id, is_active)
VALUES ('<hash_hex>', '<primeiros 12 chars da chave>', 'Dispositivo demo', NULL, true);
```

O **`farm_cloud_id`** (UUID para `GET /windows/base/:farmId`) só existe na resposta do primeiro `POST /sync/base/push` bem-sucedido — ver `docs/BASE_CLOUD_SYNC.md`.

## Endpoints

- `GET /health` — `{ "success": true, "status": "ok" }`
- `POST /auth/api-key/validate` — header `Authorization: Bearer <key>`, body JSON `{ "farm_id": "<uuid ou local_id>", "device_id": "..." }`. Se a chave ainda não tiver fazenda: `connected: false` e mensagem explicando a primeira sync.
- `POST /sync/base/push` — Bearer obrigatório; payload alinhado ao Flutter (`device_id`, `farm_local_id`, `farm`, `seasons`, `crops`, `plots`, `subareas`). Query opcional `?dryRun=true` (ou `DRY_RUN=1`) valida e faz rollback.
- `GET /windows/base/:farmId` — Bearer obrigatório; `:farmId` é o **UUID** da fazenda na nuvem; deve coincidir com a fazenda vinculada à chave.

## Ordem de testes (Neon → Railway → migrate → chave → API → Flutter)

Checklist completa com exemplos `curl` está em **`docs/BASE_CLOUD_SYNC.md`** (secção *Teste ponta a ponta — ordem obrigatória*).

Resumo:

1. Neon + `DATABASE_URL` e `API_KEY_PEPPER` no Railway (ou `.env` local).
2. `npm run migrate`.
3. `INSERT` em `api_keys` com `key_hash` = SHA-256(chave + pepper) — **obrigatório** antes de qualquer Bearer.
4. `GET /health` → `POST /auth/api-key/validate` → `POST /sync/base/push` (Postman/curl primeiro, depois Flutter).
5. `GET /windows/base/<farm_cloud_id>` (UUID devolvido no push).

Próximo módulo sugerido no app: **Plantio Cloud Sync** (sobre a base já sincronizada).

## Segurança

Todas as operações de dados usam a fazenda resolvida pela API key (e, após o primeiro push, o vínculo `api_keys.farm_id`). Não confie apenas no `farm_local_id` do body sem essa correlação.
