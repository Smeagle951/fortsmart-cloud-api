class CopernicusStacClient {
  constructor({ enableDevMock = false } = {}) {
    this.enableDevMock = enableDevMock;
  }

  async searchScenes({ startDate, endDate, maxCloud }) {
    if (!this.enableDevMock) {
      throw new Error('Copernicus STAC não configurado neste ambiente');
    }

    const baseDate = new Date(endDate || new Date().toISOString().slice(0, 10));
    const scenes = [0, 5, 10, 15, 20].map((days, idx) => {
      const imageDate = new Date(baseDate);
      imageDate.setDate(baseDate.getDate() - days);
      return {
        id: `mock-scene-${imageDate.toISOString().slice(0, 10)}`,
        source: 'sentinel_2_l2a',
        image_date: imageDate.toISOString().slice(0, 10),
        cloud_coverage: Math.min(maxCloud ?? 20, 5 + idx * 3),
        resolution_m: 10,
        ndvi_mean: 0.55 + (idx * 0.015),
        ndvi_min: 0.14,
        ndvi_max: 0.92,
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

module.exports = CopernicusStacClient;
