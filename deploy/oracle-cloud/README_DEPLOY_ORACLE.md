# Deploy FortSmart Cloud API — Oracle Cloud

Guia para VM Ubuntu 22.04/24.04 ARM64 (Ampere) com Docker + Nginx + SSL.
Sem segredos neste repositório.

## 1. Criar VM (OCI)

- Image: Ubuntu aarch64
- Shape: VM.Standard.A1.Flex (1 OCPU, 6 GB RAM mín.)
- VCN com IP público IPv4
- Chave SSH salva localmente

## 2. Security List — portas

| Porta | Uso |
|-------|-----|
| 22 | SSH |
| 80 | HTTP / Certbot |
| 443 | HTTPS API |

Opcional na VM: sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable

## 3. SSH e clone

ssh ubuntu@SEU_IP
git clone https://github.com/Smeagle951/fortsmart-cloud-api.git
cd fortsmart-cloud-api

## 4. Arquivo .env

cp .env.example .env
nano .env

Copie variáveis do Railway usando ENV_MIGRATION_CHECKLIST.md na raiz.
API_KEY_PEPPER deve ser idêntico ao Railway.

## 5. Scripts (ordem)

sudo bash deploy/oracle-cloud/01_install_server.sh
# logout/login se adicionado ao grupo docker
bash deploy/oracle-cloud/02_deploy_app.sh
sudo bash deploy/oracle-cloud/03_nginx_config.sh
export CERTBOT_EMAIL=admin@fortsmart-agro.com.br
sudo bash deploy/oracle-cloud/04_ssl_certbot.sh

## 6. DNS Cloudflare

Registro A ou CNAME: api.fortsmart-agro.com.br → IP público da VM.
Propague DNS antes do Certbot (passo 5).

## 7. Testar

curl -s https://api.fortsmart-agro.com.br/health
docker logs -f fortsmart-api
docker restart fortsmart-api

Esperado: success true, capabilities_version 3.

## 8. Atualizar código

git pull && bash deploy/oracle-cloud/02_deploy_app.sh

## 9. Desligar Railway

Somente após HTTPS estável e apps sincronizando 24–48h.

## Docker no Windows (dev)

docker não estava no PATH. Use Docker Desktop ou execute build/run na VM Ubuntu.
Comandos: docker build -t fortsmart-api . && docker run -d --name fortsmart-api --restart unless-stopped --env-file .env -p 3000:3000 fortsmart-api
