-- Metadados de imagem na nuvem (sem BLOB): URL temporária + chave no object storage + expiração.
ALTER TABLE monitoring_images
  ADD COLUMN IF NOT EXISTS cloud_storage_key TEXT;

ALTER TABLE monitoring_images
  ADD COLUMN IF NOT EXISTS cloud_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_monitoring_images_cloud_expires
  ON monitoring_images (farm_id, cloud_expires_at)
  WHERE cloud_expires_at IS NOT NULL AND deleted_at IS NULL;
