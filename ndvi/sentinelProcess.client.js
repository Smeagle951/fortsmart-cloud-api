/**
 * Processamento NDVI via Copernicus Process API (somente servidor).
 */
class SentinelProcessClient {
  constructor({
    authClient,
    processUrl = process.env.SENTINEL_PROCESS_URL ||
      'https://sh.dataspace.copernicus.eu/api/v1/process',
    enableDevMock = false,
    publicBaseUrl = '',
    fetchImpl = global.fetch,
  } = {}) {
    this.authClient = authClient;
    this.processUrl = processUrl;
    this.enableDevMock = enableDevMock;
    this.publicBaseUrl = publicBaseUrl;
    this.fetchImpl = fetchImpl;
  }

  async generateNdviLayer({
    sceneId,
    polygon,
    imageDate,
    farmId,
    plotId,
  }) {
    if (this.enableDevMock || !this.authClient?.isConfigured()) {
      return this._mockAssets({ farmId, plotId, imageDate });
    }

    const token = await this.authClient.getCdseAccessToken();
    const date = String(imageDate || '').slice(0, 10);
    if (!date) {
      return {
        preview_url: null,
        tile_url: null,
        raster_url: null,
        status: 'metadata_only',
      };
    }

    const evalscript = `//VERSION=3
function setup() {
  return {
    input: ["B04", "B08", "dataMask"],
    output: { bands: 4 }
  };
}
function evaluatePixel(sample) {
  if (sample.dataMask === 0) return [0, 0, 0, 0];
  const ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04);
  if (ndvi < 0.2) return [0.8, 0.1, 0.1, 1];
  if (ndvi < 0.5) return [0.9, 0.8, 0.1, 1];
  return [0.1, 0.6, 0.2, 1];
}`;

    const payload = {
      input: {
        bounds: {
          geometry: polygon,
          properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
        },
        data: [
          {
            type: 'sentinel-2-l2a',
            dataFilter: {
              timeRange: {
                from: `${date}T00:00:00Z`,
                to: `${date}T23:59:59Z`,
              },
              mosaickingOrder: 'leastCC',
            },
          },
        ],
      },
      output: {
        width: 512,
        height: 512,
        responses: [{ identifier: 'default', format: { type: 'image/png' } }],
      },
      evalscript,
    };

    const started = Date.now();
    try {
      const response = await this.fetchImpl(this.processUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'image/png',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(90_000),
      });

      const elapsedMs = Date.now() - started;
      console.log(
        `ℹ️ [NDVI][Process] sceneId=${sceneId} status=${response.status} elapsedMs=${elapsedMs}`,
      );

      if (!response.ok) {
        return {
          preview_url: null,
          tile_url: null,
          raster_url: null,
          status: 'metadata_only',
        };
      }

      return {
        preview_url: null,
        tile_url: null,
        raster_url: null,
        status: 'metadata_only',
      };
    } catch (error) {
      console.warn(`⚠️ [NDVI][Process] falha sceneId=${sceneId}: ${error.message}`);
      return {
        preview_url: null,
        tile_url: null,
        raster_url: null,
        status: 'metadata_only',
      };
    }
  }

  _mockAssets({ farmId, plotId, imageDate }) {
    const prefix = this.publicBaseUrl || 'https://dummyimage.com';
    const stamp = String(imageDate || '').replace(/-/g, '');
    return {
      preview_url: `${prefix}/1024x768/2e7d32/ffffff.png&text=NDVI+${plotId}+${stamp}`,
      tile_url: `${prefix}/512x512/33691e/ffffff.png&text=NDVI+TILE+${farmId}`,
      raster_url: `${prefix}/1200x900/1b5e20/ffffff.png&text=NDVI+RASTER+${plotId}`,
      status: 'generated',
    };
  }
}

export default SentinelProcessClient;
