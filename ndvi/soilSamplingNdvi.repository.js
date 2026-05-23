import { randomUUID } from 'node:crypto';

class SoilSamplingNdviRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async ensureSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS soil_ndvi_layers (
        id UUID PRIMARY KEY,
        farm_id UUID NOT NULL,
        plot_id UUID NOT NULL,
        campaign_id UUID,
        source TEXT NOT NULL,
        image_date TIMESTAMP NOT NULL,
        cloud_coverage NUMERIC,
        resolution_m NUMERIC,
        ndvi_mean NUMERIC,
        ndvi_min NUMERIC,
        ndvi_max NUMERIC,
        very_low_percent NUMERIC,
        low_percent NUMERIC,
        medium_percent NUMERIC,
        high_percent NUMERIC,
        preview_url TEXT,
        tile_url TEXT,
        raster_url TEXT,
        is_active BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await this.pool.query(
      'CREATE INDEX IF NOT EXISTS idx_soil_ndvi_layers_farm_id ON soil_ndvi_layers(farm_id)',
    );
    await this.pool.query(
      'CREATE INDEX IF NOT EXISTS idx_soil_ndvi_layers_plot_id ON soil_ndvi_layers(plot_id)',
    );
    await this.pool.query(
      'CREATE INDEX IF NOT EXISTS idx_soil_ndvi_layers_campaign_id ON soil_ndvi_layers(campaign_id)',
    );
    await this.pool.query(
      'CREATE INDEX IF NOT EXISTS idx_soil_ndvi_layers_image_date ON soil_ndvi_layers(image_date)',
    );
    await this.pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_soil_ndvi_campaign_active ON soil_ndvi_layers(campaign_id) WHERE is_active = true',
    );
  }

  async listByPlot({ farmId, plotId }) {
    const result = await this.pool.query(
      `SELECT *
         FROM soil_ndvi_layers
        WHERE farm_id = $1
          AND plot_id = $2
        ORDER BY image_date DESC`,
      [farmId, plotId],
    );
    return result.rows;
  }

  async findRecentCache({ farmId, plotId, imageDate, maxCloud }) {
    const result = await this.pool.query(
      `SELECT *
         FROM soil_ndvi_layers
        WHERE farm_id = $1
          AND plot_id = $2
          AND image_date::date = $3::date
          AND ($4::numeric IS NULL OR cloud_coverage <= $4::numeric)
        ORDER BY updated_at DESC
        LIMIT 1`,
      [farmId, plotId, imageDate, maxCloud ?? null],
    );
    return result.rows[0] || null;
  }

  async getById(layerId) {
    const result = await this.pool.query(
      'SELECT * FROM soil_ndvi_layers WHERE id = $1 LIMIT 1',
      [layerId],
    );
    return result.rows[0] || null;
  }

  async upsertLayer(data) {
    const id = data.id || randomUUID();
    const values = [
      id,
      data.farm_id,
      data.plot_id,
      data.campaign_id || null,
      data.source,
      data.image_date,
      data.cloud_coverage ?? null,
      data.resolution_m ?? null,
      data.ndvi_mean ?? null,
      data.ndvi_min ?? null,
      data.ndvi_max ?? null,
      data.very_low_percent ?? null,
      data.low_percent ?? null,
      data.medium_percent ?? null,
      data.high_percent ?? null,
      data.preview_url ?? null,
      data.tile_url ?? null,
      data.raster_url ?? null,
      !!data.is_active,
    ];

    const result = await this.pool.query(
      `INSERT INTO soil_ndvi_layers (
          id, farm_id, plot_id, campaign_id, source, image_date,
          cloud_coverage, resolution_m, ndvi_mean, ndvi_min, ndvi_max,
          very_low_percent, low_percent, medium_percent, high_percent,
          preview_url, tile_url, raster_url, is_active, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15,
          $16, $17, $18, $19, NOW(), NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          farm_id = EXCLUDED.farm_id,
          plot_id = EXCLUDED.plot_id,
          campaign_id = EXCLUDED.campaign_id,
          source = EXCLUDED.source,
          image_date = EXCLUDED.image_date,
          cloud_coverage = EXCLUDED.cloud_coverage,
          resolution_m = EXCLUDED.resolution_m,
          ndvi_mean = EXCLUDED.ndvi_mean,
          ndvi_min = EXCLUDED.ndvi_min,
          ndvi_max = EXCLUDED.ndvi_max,
          very_low_percent = EXCLUDED.very_low_percent,
          low_percent = EXCLUDED.low_percent,
          medium_percent = EXCLUDED.medium_percent,
          high_percent = EXCLUDED.high_percent,
          preview_url = EXCLUDED.preview_url,
          tile_url = EXCLUDED.tile_url,
          raster_url = EXCLUDED.raster_url,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()
        RETURNING *`,
      values,
    );

    return result.rows[0];
  }

  async deactivateByCampaign(campaignId) {
    await this.pool.query(
      `UPDATE soil_ndvi_layers
          SET is_active = false,
              updated_at = NOW()
        WHERE campaign_id = $1`,
      [campaignId],
    );
  }

  async setActiveLayer({ campaignId, layerId, farmId, plotId }) {
    await this.deactivateByCampaign(campaignId);
    const result = await this.pool.query(
      `UPDATE soil_ndvi_layers
          SET campaign_id = $1,
              farm_id = $2,
              plot_id = $3,
              is_active = true,
              updated_at = NOW()
        WHERE id = $4
        RETURNING *`,
      [campaignId, farmId, plotId, layerId],
    );
    return result.rows[0] || null;
  }

  async getActiveByCampaign({ campaignId, farmId, plotId }) {
    const result = await this.pool.query(
      `SELECT *
         FROM soil_ndvi_layers
        WHERE campaign_id = $1
          AND farm_id = $2
          AND plot_id = $3
          AND is_active = true
        ORDER BY updated_at DESC
        LIMIT 1`,
      [campaignId, farmId, plotId],
    );
    return result.rows[0] || null;
  }
}

export default SoilSamplingNdviRepository;
