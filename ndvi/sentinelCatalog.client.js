const NdviResponseMapper = require('./ndviResponse.mapper');

/**
 * Busca cenas Sentinel-2 L2A via catálogo Copernicus (servidor → CDSE).
 */
class SentinelCatalogClient {
  constructor({
    authClient,
    catalogUrl = process.env.SENTINEL_CATALOG_URL ||
      'https://sh.dataspace.copernicus.eu/api/v1/catalog/search',
    enableDevMock = false,
    fetchImpl = global.fetch,
  } = {}) {
    this.authClient = authClient;
    this.catalogUrl = catalogUrl;
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
    if (this.enableDevMock || !this.authClient?.isConfigured()) {
      return this._mockScenes({ startDate, endDate, maxCloud });
    }

    const bbox = this.polygonToBbox(polygon);
    if (!bbox) {
      const err = new Error('Polígono inválido para busca NDVI');
      err.code = 'plot_polygon_missing';
      err.status = 400;
      throw err;
    }

    const token = await this.authClient.getCdseAccessToken();
    const datetime = `${startDate}T00:00:00Z/${endDate}T23:59:59Z`;

    const body = {
      collections: ['sentinel-2-l2a'],
      datetime,
      bbox,
      limit: 50,
      filter: {
        op: 'lt',
        args: [{ property: 'eo:cloud_cover' }, Number(maxCloud)],
      },
    };

    if (polygon?.type === 'Polygon' && polygon.coordinates) {
      body.intersects = polygon;
    }

    const started = Date.now();
    let response;
    try {
      response = await this.fetchImpl(this.catalogUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (error) {
      const err = new Error('Timeout ao consultar catálogo Sentinel');
      err.code = 'copernicus_timeout';
      err.status = 504;
      err.cause = error;
      throw err;
    }

    const elapsedMs = Date.now() - started;
    const json = await response.json().catch(() => ({}));

    console.log(
      `ℹ️ [NDVI][Catalog] status=${response.status} elapsedMs=${elapsedMs} ` +
        `bbox=${bbox.join(',')}`,
    );

    if (!response.ok) {
      const err = new Error('Erro ao consultar imagens Sentinel no Copernicus');
      err.code = 'copernicus_error';
      err.status = 502;
      err.details = json;
      throw err;
    }

    const features = json.features || json.results || [];
    const scenes = NdviResponseMapper.mapScenes(features);

    scenes.sort((a, b) => {
      const cloudA = Number(a.cloud_coverage ?? 999);
      const cloudB = Number(b.cloud_coverage ?? 999);
      if (cloudA !== cloudB) return cloudA - cloudB;
      return String(b.image_date).localeCompare(String(a.image_date));
    });

    console.log(`✅ [NDVI][Catalog] scenes=${scenes.length}`);
    return scenes;
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
        status: 'available',
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

module.exports = SentinelCatalogClient;
