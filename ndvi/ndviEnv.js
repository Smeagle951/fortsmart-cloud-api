/**
 * Configuração NDVI (Copernicus no cloud-api; GEE opcional só para diagnóstico).
 */
export function getNdviProviderStatus() {
  const ndviProvider = String(process.env.NDVI_PROVIDER || 'copernicus')
    .trim()
    .toLowerCase();

  const geeUsageAllowed =
    ndviProvider === 'gee' && process.env.GEE_ALLOW_USAGE === 'true';
  const geeEnabled = process.env.GEE_ENABLED === 'true' && geeUsageAllowed;
  const geeServiceAccountJson = String(
    process.env.GEE_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      '',
  ).trim();
  const geeProjectId = String(process.env.GEE_PROJECT_ID || '').trim();
  const geeClientEmail = String(process.env.GEE_CLIENT_EMAIL || '').trim();
  const geePrivateKey = String(
    process.env.GEE_PRIVATE_KEY || process.env.GEE_PRIVATE_KEY_B64 || '',
  ).trim();

  const geeJsonConfigured = Boolean(geeServiceAccountJson);
  const geeKeyConfigured = Boolean(geeClientEmail && geePrivateKey);
  const geeConfigured = geeJsonConfigured || geeKeyConfigured;

  const cdseConfigured = Boolean(
    process.env.CDSE_CLIENT_ID && process.env.CDSE_CLIENT_SECRET,
  );

  const storageConfigured = Boolean(
    (process.env.FORTSMART_S3_BUCKET || process.env.R2_BUCKET_NAME) &&
      (process.env.FORTSMART_S3_PUBLIC_BASE_URL ||
        process.env.R2_PUBLIC_BASE_URL ||
        process.env.NDVI_PUBLIC_BASE_URL),
  );

  // Copernicus-first: GEE fica dormente por padrão para evitar custo acidental.
  // Mesmo que GEE_ENABLED esteja true no ambiente antigo, só usa GEE se houver
  // opt-in explícito: NDVI_PROVIDER=gee + GEE_ALLOW_USAGE=true.
  const geePrimary = geeEnabled && geeConfigured;
  const activeProvider = geePrimary
    ? 'google_earth_engine'
    : 'copernicus_dataspace';

  return {
    ndvi_provider: ndviProvider,
    active_provider: activeProvider,
    gee_enabled: geeEnabled,
    gee_hidden: !geeUsageAllowed,
    gee_usage_allowed: geeUsageAllowed,
    gee_configured: geeConfigured,
    gee_credentials_source: geeJsonConfigured ? 'service_account_json' : (geeKeyConfigured ? 'env_key' : 'none'),
    gee_primary: geePrimary,
    copernicus_configured: cdseConfigured,
    storage_configured: storageConfigured,
    /** Provider efetivamente usado pelo cloud-api (GEE quando primary). */
    cloud_api_uses: activeProvider,
  };
}

/** GEE é o provider principal apenas com opt-in explícito. */
export function isGeePrimary() {
  return getNdviProviderStatus().gee_primary;
}

export function assertCopernicusReady(authClient) {
  if (authClient?.isConfigured?.()) return;
  const err = new Error(
    'Serviço NDVI indisponível: configure CDSE_CLIENT_ID e CDSE_CLIENT_SECRET no servidor.',
  );
  err.code = 'cdse_not_configured';
  err.status = 503;
  throw err;
}

export function assertGeeIfRequired() {
  const status = getNdviProviderStatus();
  if (process.env.NDVI_PROVIDER !== 'gee' && !status.gee_enabled) return status;

  if (process.env.NDVI_PROVIDER === 'gee' && process.env.GEE_ALLOW_USAGE !== 'true') {
    const err = new Error(
      'Google Earth Engine está desativado por política. Use Copernicus Data Space como provider NDVI.',
    );
    err.code = 'gee_disabled_by_policy';
    err.status = 503;
    throw err;
  }

  if (!status.gee_configured) {
    const err = new Error(
      'Google Earth Engine solicitado, mas GEE_SERVICE_ACCOUNT_JSON ou GEE_CLIENT_EMAIL/GEE_PRIVATE_KEY não estão configurados.',
    );
    err.code = 'gee_not_configured';
    err.status = 503;
    throw err;
  }
  return status;
}
