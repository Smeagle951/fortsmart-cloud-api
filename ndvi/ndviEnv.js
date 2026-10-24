/**
 * Configuração NDVI.
 *
 * GEE é o provider padrão. Copernicus Data Space é contingência explícita
 * para falhas técnicas recuperáveis; credencial inválida não faz fallback.
 */
function normalizeProvider(value, fallback = 'gee') {
  const provider = String(value || fallback).trim().toLowerCase();
  if (provider === 'google_earth_engine') return 'gee';
  if (provider === 'earth_engine') return 'gee';
  if (provider === 'auto') return 'auto';
  if (provider === 'gee') return 'gee';
  return 'copernicus';
}

export function getNdviProviderStatus() {
  const ndviProvider = normalizeProvider(process.env.NDVI_PROVIDER);
  const packageProvider = normalizeProvider(
    process.env.NDVI_PACKAGE_PROVIDER ||
      process.env.NDVI_LAYER_PACKAGE_PROVIDER ||
      ndviProvider,
  );

  const geeUsageAllowed =
    process.env.GEE_ALLOW_USAGE !== 'false' &&
    (ndviProvider === 'gee' ||
      ndviProvider === 'auto' ||
      packageProvider === 'gee' ||
      packageProvider === 'auto');
  const geeEnabled = geeUsageAllowed && process.env.GEE_ENABLED !== 'false';
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

  // GEE-first: credenciais continuam obrigatórias e exclusivas do servidor.
  const geePrimary = geeEnabled && geeConfigured;
  const geePrimaryForGenerate = geePrimary && ndviProvider === 'gee';
  const geePackagePreferred =
    geeEnabled &&
    geeConfigured &&
    (packageProvider === 'gee' || packageProvider === 'auto');
  const activeProvider = geePrimaryForGenerate
    ? 'google_earth_engine'
    : 'copernicus_dataspace';

  return {
    ndvi_provider: ndviProvider,
    package_provider: packageProvider,
    active_provider: activeProvider,
    gee_enabled: geeEnabled,
    gee_hidden: !geeUsageAllowed,
    gee_usage_allowed: geeUsageAllowed,
    gee_configured: geeConfigured,
    gee_credentials_source: geeJsonConfigured ? 'service_account_json' : (geeKeyConfigured ? 'env_key' : 'none'),
    gee_primary: geePrimaryForGenerate,
    gee_package_preferred: geePackagePreferred,
    gee_engine_requested: geePrimaryForGenerate || geePackagePreferred,
    copernicus_configured: cdseConfigured,
    storage_configured: storageConfigured,
    /** Provider efetivamente usado pelo cloud-api (GEE quando primary). */
    cloud_api_uses: geePrimaryForGenerate ? activeProvider : 'copernicus_dataspace',
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
  if (status.ndvi_provider !== 'gee' && !status.gee_enabled) return status;

  if (status.ndvi_provider === 'gee' && !status.gee_usage_allowed) {
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
