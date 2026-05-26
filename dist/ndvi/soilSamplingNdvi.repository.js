import { randomUUID } from 'node:crypto';

class SoilSamplingNdviRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async ensureSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS soil_ndvi_layers (
        id TEXT PRIMARY KEY,
        scene_id TEXT,
        farm_id TEXT NOT NULL,
        plot_id TEXT NOT NULL,
        campaign_id TEXT,
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
        status TEXT DEFAULT 'available',
        is_active BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await this._migrateLegacyColumns();

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
      'CREATE INDEX IF NOT EXISTS idx_soil_ndvi_layers_scene_id ON soil_ndvi_layers(scene_id)',
    );
    await this.pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_soil_ndvi_campaign_active ON soil_ndvi_layers(campaign_id) WHERE is_active = true',
    );
  }

  async _migrateLegacyColumns() {
    const alters = [
      'ALTER TABLE soil_ndvi_layers ADD COLUMN IF NOT EXISTS scene_id TEXT',
      'ALTER TABLE soil_ndvi_layers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT \'available\'',
      `ALTER TABLE soil_ndvi_layers ALTER COLUMN id TYPE TEXT USING id::text`,
      `ALTER TABLE soil_ndvi_layers ALTER COLUMN farm_id TYPE TEXT USING farm_id::text`,
      `ALTER TABLE soil_ndvi_layers ALTER COLUMN plot_id TYPE TEXT USING plot_id::text`,
      `ALTER TABLE soil_ndvi_layers ALTER COLUMN campaign_id TYPE TEXT USING campaign_id::text`,
    ];

    for (const sql of alters) {
      try {
        await this.pool.query(sql);
      } catch (error) {
        const msg = String(error.message || '');
        if (
          msg.includes('does not exist') ||
          msg.includes('already exists') ||
          msg.includes('cannot cast')
        ) {
          continue;
        }
        console.warn(`⚠️ [NDVI] migrate skip: ${msg.slice(0, 120)}`);
      }
    }
  }

  async listByPlot({ farmId, plotId }) {
    const result = await this.pool.query(
      `SELECT *
         FROM soil_ndvi_layers
        WHERE farm_id = $1
          AND plot_id = $2
        ORDER BY image_date DESC`,
      [String(farmId), String(plotId)],
    );
    return result.rows;
  }

  async findRecentCache({ farmId, plotId, imageDate, sceneId, maxCloud }) {
    if (sceneId) {
      const byScene = await this.pool.query(
        `SELECT *
           FROM soil_ndvi_layers
          WHERE farm_id = $1
            AND plot_id = $2
            AND scene_id = $3
          ORDER BY updated_at DESC
          LIMIT 1`,
        [String(farmId), String(plotId), String(sceneId)],
      );
      if (byScene.rows[0]) return byScene.rows[0];
    }

    const result = await this.pool.query(
      `SELECT *
         FROM soil_ndvi_layers
        WHERE farm_id = $1
          AND plot_id = $2
          AND image_date::date = $3::date
          AND ($4::numeric IS NULL OR cloud_coverage <= $4::numeric)
        ORDER BY updated_at DESC
        LIMIT 1`,
      [String(farmId), String(plotId), imageDate, maxCloud ?? null],
    );
    return result.rows[0] || null;
  }

  async getById(layerId) {
    const result = await this.pool.query(
      'SELECT * FROM soil_ndvi_layers WHERE id = $1 LIMIT 1',
      [String(layerId)],
    );
    return result.rows[0] || null;
  }

  async markLayerFailed(layerId) {
    await this.pool.query(
      `UPDATE soil_ndvi_layers SET status = 'failed', updated_at = NOW() WHERE id = $1`,
      [String(layerId)],
    );
  }

  _sanitizePreviewUrl(url) {
    if (url == null) return null;
    const text = String(url);
    if (!text.trim()) return null;
    // Evita gravar data URLs enormes no Postgres (causa comum de falha no generate).
    if (text.startsWith('data:') && text.length > 32_000) {
      console.warn(
        `⚠️ [NDVI] preview_url data URL omitida (${text.length} chars) — use R2/S3`,
      );
      return null;
    }
    if (text.length > 16_384) {
      console.warn(`⚠️ [NDVI] preview_url truncada (${text.length} chars)`);
      return `${text.slice(0, 16_384)}`;
    }
    return text;
  }

  async upsertLayer(data) {
    const id = data.id ? String(data.id) : randomUUID();
    const values = [
      id,
      data.scene_id ? String(data.scene_id) : null,
      String(data.farm_id),
      String(data.plot_id),
      data.campaign_id != null ? String(data.campaign_id) : null,
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
      this._sanitizePreviewUrl(data.preview_url),
      data.tile_url ?? null,
      data.raster_url ?? null,
      data.status ?? null,
      !!data.is_active,
    ];

    const result = await this.pool.query(
      `INSERT INTO soil_ndvi_layers (
          id, scene_id, farm_id, plot_id, campaign_id, source, image_date,
          cloud_coverage, resolution_m, ndvi_mean, ndvi_min, ndvi_max,
          very_low_percent, low_percent, medium_percent, high_percent,
          preview_url, tile_url, raster_url, status, is_active, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12,
          $13, $14, $15, $16,
          $17, $18, $19, $20, $21, NOW(), NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          scene_id = EXCLUDED.scene_id,
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
          status = EXCLUDED.status,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()
        RETURNING *`,
      values,
    );

    const row = result.rows[0];
    if (!row?.id) {
      throw new Error('upsertLayer não retornou id');
    }
    return row;
  }

  async deactivateByCampaign(campaignId) {
    await this.pool.query(
      `UPDATE soil_ndvi_layers
          SET is_active = false,
              updated_at = NOW()
        WHERE campaign_id = $1`,
      [String(campaignId)],
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
      [String(campaignId), String(farmId), String(plotId), String(layerId)],
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
      [String(campaignId), String(farmId), String(plotId)],
    );
    return result.rows[0] || null;
  }
}

export default SoilSamplingNdviRepository;
