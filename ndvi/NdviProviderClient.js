export class NdviProviderClient {
  async searchScenes() {
    throw new Error('searchScenes must be implemented by NDVI provider');
  }

  async generateLayer() {
    throw new Error('generateLayer must be implemented by NDVI provider');
  }
}

export class CopernicusNdviProviderClient extends NdviProviderClient {
  constructor({ catalogClient, processClient } = {}) {
    super();
    this.catalogClient = catalogClient;
    this.processClient = processClient;
  }

  async searchScenes(params) {
    const scenes = await this.catalogClient.searchSentinelScenes(params);
    return scenes.map((scene) => ({
      ...scene,
      provider: 'copernicus_dataspace',
      provider_used: 'copernicus_dataspace',
      source: scene.source || 'sentinel-2-l2a',
      processing_engine: 'copernicus_stac',
    }));
  }

  async generateLayer(params) {
    const layer = await this.processClient.generateNdviLayer(params);
    return {
      ...layer,
      provider: 'copernicus_dataspace',
      provider_used: 'copernicus_dataspace',
      source: layer?.source || 'sentinel-2-l2a',
      processing_engine: layer?.processing_engine || 'copernicus_process_api',
    };
  }
}

export class GeeNdviProviderClient extends NdviProviderClient {
  isImplemented() {
    return false;
  }

  async searchScenes() {
    throw providerNotImplemented();
  }

  async generateLayer() {
    throw providerNotImplemented();
  }
}

export function providerNotImplemented() {
  const error = new Error('Google Earth Engine NDVI provider is not implemented in this backend.');
  error.code = 'NDVI_PROVIDER_NOT_IMPLEMENTED';
  error.status = 501;
  error.provider = 'google_earth_engine';
  return error;
}

export function selectNdviProvider({ mode = process.env.NDVI_PROVIDER, geeClient, copernicusClient } = {}) {
  const requested = String(mode || 'copernicus').toLowerCase();
  if (requested === 'gee') {
    if (!geeClient?.isImplemented?.()) throw providerNotImplemented();
    return { client: geeClient, fallbackUsed: false, requested, provider: 'google_earth_engine' };
  }
  if (requested === 'auto') {
    if (geeClient?.isImplemented?.()) {
      return { client: geeClient, fallbackUsed: false, requested, provider: 'google_earth_engine' };
    }
    return { client: copernicusClient, fallbackUsed: true, requested, provider: 'copernicus_dataspace' };
  }
  return { client: copernicusClient, fallbackUsed: false, requested, provider: 'copernicus_dataspace' };
}
