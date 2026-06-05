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

/**
 * Cliente GEE. O pipeline real (Earth Engine) é injetado via `engine`.
 * Sem engine injetado, comporta-se como não implementado — o manager faz
 * fallback para Copernicus (apenas ndvi_contrast). Isso mantém produção
 * funcionando enquanto o engine GEE ainda não foi portado/instalado.
 */
export class GeeNdviProviderClient extends NdviProviderClient {
  constructor({ engine = null } = {}) {
    super();
    this.engine = engine;
  }

  /** GEE só está pronto quando o engine real foi injetado. */
  isImplemented() {
    return Boolean(this.engine);
  }

  async searchScenes(params) {
    if (!this.engine) throw providerNotImplemented();
    const scenes = await this.engine.searchGeeScenes(params);
    return (scenes || []).map((scene) => ({
      ...scene,
      provider: 'google_earth_engine',
      provider_used: 'google_earth_engine',
      source: scene.source || 'gee_sentinel_2_l2a',
      processing_engine: 'google_earth_engine',
    }));
  }

  async generateLayer(params) {
    if (!this.engine) throw providerNotImplemented();
    const layer = await this.engine.generateGeeNdviLayer(params);
    return {
      ...layer,
      provider: 'google_earth_engine',
      provider_used: 'google_earth_engine',
      source: layer?.source || 'gee_sentinel_2_l2a',
      processing_engine: 'google_earth_engine',
    };
  }
}

/**
 * Orquestra Copernicus-first.
 * GEE fica dormente por padrão para evitar custo acidental. Só usa GEE com
 * opt-in explícito: NDVI_PROVIDER=gee + GEE_ALLOW_USAGE=true.
 */
export class NdviProviderManager {
  constructor({ geeClient, copernicusClient } = {}) {
    this.geeClient = geeClient;
    this.copernicusClient = copernicusClient;
  }

  _geeReady() {
    return (
      process.env.NDVI_PROVIDER === 'gee' &&
      process.env.GEE_ALLOW_USAGE === 'true' &&
      Boolean(this.geeClient?.isImplemented?.())
    );
  }

  async searchScenes(params) {
    if (this._geeReady()) {
      try {
        const scenes = await this.geeClient.searchScenes(params);
        return { provider: 'google_earth_engine', fallbackUsed: false, scenes };
      } catch (error) {
        console.warn(
          `⚠️ [NDVI] GEE searchScenes falhou, fallback Copernicus: ${error?.message || error}`,
        );
      }
    }
    const scenes = await this.copernicusClient.searchScenes(params);
    return {
      provider: 'copernicus_dataspace',
      fallbackUsed: this._geeReady(),
      scenes,
    };
  }

  async generateLayer(params) {
    const requestedVisualMode = params?.visualMode || params?.visual_mode || 'ndvi_contrast';

    if (this._geeReady()) {
      try {
        const layer = await this.geeClient.generateLayer(params);
        return { provider: 'google_earth_engine', fallbackUsed: false, layer };
      } catch (error) {
        // Modos avançados não têm fallback Copernicus — propaga 422.
        if (requestedVisualMode !== 'ndvi_contrast') {
          throw unsupportedVisualMode(requestedVisualMode, error);
        }
        console.warn(
          `⚠️ [NDVI] GEE generate (ndvi_contrast) falhou, fallback Copernicus: ${error?.message || error}`,
        );
      }
    } else if (requestedVisualMode !== 'ndvi_contrast') {
      // GEE indisponível e modo avançado pedido sem raster persistido:
      // o gate de modo já barra antes, mas aqui é a última linha de defesa.
      throw unsupportedVisualMode(requestedVisualMode);
    }

    const layer = await this.copernicusClient.generateLayer(params);
    return {
      provider: 'copernicus_dataspace',
      fallbackUsed: this._geeReady(),
      layer,
    };
  }
}

export function unsupportedVisualMode(visualMode, cause = null) {
  const error = new Error(
    `Modo "${visualMode}" exige Google Earth Engine, que não está disponível no momento.`,
  );
  error.code = 'unsupported_visual_mode';
  error.status = 422;
  error.provider = 'google_earth_engine';
  if (cause?.message) error.cause = cause.message;
  return error;
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
    if (process.env.GEE_ALLOW_USAGE !== 'true') throw geeDisabledByPolicy();
    if (!geeClient?.isImplemented?.()) throw providerNotImplemented();
    return { client: geeClient, fallbackUsed: false, requested, provider: 'google_earth_engine' };
  }
  if (requested === 'auto') {
    if (process.env.GEE_ALLOW_USAGE === 'true' && geeClient?.isImplemented?.()) {
      return { client: geeClient, fallbackUsed: false, requested, provider: 'google_earth_engine' };
    }
    return { client: copernicusClient, fallbackUsed: false, requested, provider: 'copernicus_dataspace' };
  }
  return { client: copernicusClient, fallbackUsed: false, requested, provider: 'copernicus_dataspace' };
}

export function geeDisabledByPolicy() {
  const error = new Error(
    'Google Earth Engine está desativado por política. Provider NDVI ativo: Copernicus Data Space.',
  );
  error.code = 'GEE_DISABLED_BY_POLICY';
  error.status = 503;
  error.provider = 'copernicus_dataspace';
  return error;
}
