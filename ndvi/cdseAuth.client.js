/**
 * OAuth2 client_credentials para Copernicus Data Space (CDSE).
 * Nunca expõe o token ao app Flutter.
 */
class CdseAuthClient {
  constructor({
    clientId = process.env.CDSE_CLIENT_ID,
    clientSecret = process.env.CDSE_CLIENT_SECRET,
    tokenUrl = process.env.CDSE_TOKEN_URL ||
      'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
    fetchImpl = global.fetch,
  } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.tokenUrl = tokenUrl;
    this.fetchImpl = fetchImpl;
    this._cachedToken = null;
    this._expiresAtMs = 0;
  }

  isConfigured() {
    return Boolean(this.clientId && this.clientSecret && this.tokenUrl);
  }

  async getCdseAccessToken() {
    if (!this.isConfigured()) {
      const err = new Error('CDSE não configurado no servidor (CDSE_CLIENT_ID/SECRET)');
      err.code = 'cdse_not_configured';
      err.status = 503;
      throw err;
    }

    const now = Date.now();
    if (this._cachedToken && now < this._expiresAtMs - 30_000) {
      return this._cachedToken;
    }

    const body = new URLSearchParams();
    body.set('grant_type', 'client_credentials');
    body.set('client_id', this.clientId);
    body.set('client_secret', this.clientSecret);

    const started = Date.now();
    let response;
    try {
      response = await this.fetchImpl(this.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      const err = new Error('Timeout ao obter token Copernicus');
      err.code = 'copernicus_timeout';
      err.status = 504;
      err.cause = error;
      throw err;
    }

    const elapsedMs = Date.now() - started;
    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(
        `❌ [NDVI][CDSE] token status=${response.status} elapsedMs=${elapsedMs}`,
      );
      const err = new Error('Falha ao autenticar no Copernicus Data Space');
      err.code = 'copernicus_error';
      err.status = 502;
      throw err;
    }

    const token = json.access_token;
    if (!token) {
      const err = new Error('Resposta CDSE sem access_token');
      err.code = 'copernicus_error';
      err.status = 502;
      throw err;
    }

    const expiresIn = Number(json.expires_in || 3600);
    this._cachedToken = token;
    this._expiresAtMs = now + expiresIn * 1000;
    console.log(`✅ [NDVI][CDSE] token obtido elapsedMs=${elapsedMs}`);
    return token;
  }
}

module.exports = CdseAuthClient;
