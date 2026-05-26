import * as NdviResponseMapper from './ndviResponse.mapper.js';

const DEFAULT_STAC_CATALOG_URL = 'https://stac.dataspace.copernicus.eu/v1/search';

function normalizeCatalogUrl(rawUrl) {
  const value = (rawUrl || DEFAULT_STAC_CATALOG_URL).trim();
  // URLs legadas (SH catalog antigo ou path incorreto) → STAC CDSE (funciona com CDSE OAuth ou público).
  if (
    value.includes('/api/v1/catalog') ||
    value.includes('sh.dataspace.copernicus.eu/catalog')
  ) {
    console.warn(
      `⚠️ [NDVI] SENTINEL_CATALOG_URL legado (${value}) — usando STAC CDSE ${DEFAULT_STAC_CATALOG_URL}`,
    );
    return DEFAULT_STAC_CATALOG_URL;
  }
  return value;
}

function isPublicStacCatalog(url) {
  return url.includes('stac.dataspace.copernicus.eu');
}

/**
 * Busca cenas Sentinel-2 L2A via catálogo Copernicus (STAC CDSE ou Sentinel Hub Catalog).
 */
class SentinelCatalogClient {
  constructor({
    authClient,
    catalogUrl = process.env.SENTINEL_CATALOG_URL,
    enableDevMock = false,
    fetchImpl = global.fetch,
  } = {}) {
    this.authClient = authClient;
    this.catalogUrl = normalizeCatalogUrl(catalogUrl);
    this.isPublicStac = isPublicStacCatalog(this.catalogUrl);
    this.enableDevMock = enableDevMock;
    this.fetchImpl = fetchImpl;
  }

  polygonToBbox(polygon) {
    const ring = polygon?.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length < 3) return null;

    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;

    for (const point of ring) {
      const lng = Number(point[0]);
      const lat = Number(point[1]);
      if (Number.isNaN(lng) || Number.isNaN(lat)) continue;
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    }

    if (!Number.isFinite(minLng)) return null;
    return [minLng, minLat, maxLng, maxLat];
  }

  async searchSentinelScenes({
    polygon,
    startDate,
    endDate,
    maxCloud = 20,
  }) {
    const needsAuth = !this.isPublicStac;
    if (
      this.enableDevMock ||
      (needsAuth && !this.authClient?.isConfigured())
    ) {
      return this._mockScenes({ startDate, endDate, maxCloud });
    }

    const bbox = this.polygonToBbox(polygon);
    if (!bbox) {
      const err = new Error('Polígono inválido para busca NDVI');
      err.code = 'plot_polygon_missing';
      err.status = 400;
      throw err;
    }

    const token = needsAuth ? await this.authClient.getCdseAccessToken() : null;
    const datetime = `${startDate}T00:00:00Z/${endDate}T23:59:59Z`;

    const cloudLimit = Number(maxCloud);
    const baseBody = {
      collections: ['sentinel-2-l2a'],
      datetime,
      bbox,
      limit: 50,
    };

    const started = Date.now();
    let response;
    let json = {};
    const attempts = [];

    if (Number.isFinite(cloudLimit)) {
      attempts.push({
        ...baseBody,
        filter: `eo:cloud_cover < ${cloudLimit}`,
        'filter-lang': 'cql2-text',
      });
    }
    attempts.push(baseBody);

    for (let i = 0; i < attempts.length; i++) {
      const body = attempts[i];
      try {
        response = await this._catalogPost(token, body);
      } catch (error) {
        const err = new Error('Timeout ao consultar catálogo Sentinel');
        err.code = 'copernicus_timeout';
        err.status = 504;
        err.cause = error;
        throw err;
      }

      const rawText = await response.text();
      try {
        json = rawText ? JSON.parse(rawText) : {};
      } catch {
        json = { raw: rawText?.slice(0, 500) };
      }
      if (response.ok) break;

      const retryable =
        i < attempts.length - 1 && (response.status === 400 || response.status === 422);
      console.warn(
        `⚠️ [NDVI][Catalog] tentativa ${i + 1} status=${response.status} ` +
          `filter=${Boolean(body.filter)} body=${JSON.stringify(json).slice(0, 300)}`,
      );
      if (!retryable) break;
    }

    const elapsedMs = Date.now() - started;
    console.log(
      `ℹ️ [NDVI][Catalog] status=${response.status} elapsedMs=${elapsedMs} ` +
        `bbox=${bbox.join(',')}`,
    );

    if (!response.ok) {
      const detailText =
        typeof json?.description === 'string'
          ? json.description
          : typeof json?.message === 'string'
            ? json.message
            : JSON.stringify(json).slice(0, 200);
      console.error(
        `❌ [NDVI][Catalog] erro status=${response.status} url=${this.catalogUrl} ${detailText}`,
      );
      const err = new Error('Erro ao consultar imagens Sentinel no Copernicus');
      err.code = 'copernicus_error';
      err.status = 502;
      err.details = json;
      throw err;
    }

    const features = json.features || json.results || [];
    let scenes = NdviResponseMapper.mapScenes(features);

    if (Number.isFinite(cloudLimit)) {
      scenes = scenes.filter(
        (s) =>
          s.cloud_coverage == null || Number(s.cloud_coverage) < cloudLimit,
      );
    }

    console.log(`✅ [NDVI][Catalog] scenes=${scenes.length} (raw)`);
    return scenes;
  }

  async _catalogPost(token, body) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/geo+json, application/json',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return this.fetchImpl(this.catalogUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
  }

  _mockScenes({ startDate, endDate, maxCloud }) {
    const baseDate = new Date(endDate || new Date().toISOString().slice(0, 10));
    const scenes = [0, 5, 10, 15, 20].map((days, idx) => {
      const imageDate = new Date(baseDate);
      imageDate.setDate(baseDate.getDate() - days);
      return {
        scene_id: `mock-scene-${imageDate.toISOString().slice(0, 10)}`,
        id: `mock-scene-${imageDate.toISOString().slice(0, 10)}`,
        source: 'sentinel_2_l2a',
        image_date: imageDate.toISOString().slice(0, 10),
        cloud_coverage: Math.min(maxCloud ?? 20, 5 + idx * 3),
        resolution_m: 10,
        ndvi_mean: null,
        status: 'metadata_only',
        thumbnail_url: null,
      };
    });

    return scenes.filter((s) => {
      const date = new Date(s.image_date);
      const sDate = new Date(startDate);
      const eDate = new Date(endDate);
      return date >= sDate && date <= eDate;
    });
  }
}

export default SentinelCatalogClient;
