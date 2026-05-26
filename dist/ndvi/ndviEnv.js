/**
 * Configuração NDVI (Copernicus no cloud-api; GEE opcional só para diagnóstico).
 */
export function getNdviProviderStatus() {
  const ndviProvider = String(process.env.NDVI_PROVIDER || 'copernicus')
    .trim()
    .toLowerCase();

  const geeEnabled = process.env.GEE_ENABLED === 'true';
  const geeProjectId = String(process.env.GEE_PROJECT_ID || '').trim();
  const geeClientEmail = String(process.env.GEE_CLIENT_EMAIL || '').trim();
  const geePrivateKey = String(
    process.env.GEE_PRIVATE_KEY || process.env.GEE_PRIVATE_KEY_B64 || '',
  ).trim();

  const geeConfigured = Boolean(geeProjectId && geeClientEmail && geePrivateKey);

  const cdseConfigured = Boolean(
    process.env.CDSE_CLIENT_ID && process.env.CDSE_CLIENT_SECRET,
  );

  const storageConfigured = Boolean(
    (process.env.FORTSMART_S3_BUCKET || process.env.R2_BUCKET_NAME) &&
      (process.env.FORTSMART_S3_PUBLIC_BASE_URL ||
        process.env.R2_PUBLIC_BASE_URL ||
        process.env.NDVI_PUBLIC_BASE_URL),
  );

  const activeProvider =
    ndviProvider === 'gee' && geeConfigured && geeEnabled
      ? 'google_earth_engine'
      : 'copernicus_dataspace';

  return {
    ndvi_provider: ndviProvider,
    active_provider: activeProvider,
    gee_enabled: geeEnabled,
    gee_configured: geeConfigured,
    copernicus_configured: cdseConfigured,
    storage_configured: storageConfigured,
    /** Cloud-api processa NDVI via Copernicus Process API. */
    cloud_api_uses: 'copernicus_dataspace',
  };
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

  if (!status.gee_configured) {
    const err = new Error(
      'Google Earth Engine solicitado, mas GEE_PROJECT_ID, GEE_CLIENT_EMAIL e GEE_PRIVATE_KEY não estão configurados.',
    );
    err.code = 'gee_not_configured';
    err.status = 503;
    throw err;
  }
  return status;
}
