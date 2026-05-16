-- Compatibilidade operacional: historicamente o cloud id da fazenda é `farms.id`.
-- Esta coluna expõe o mesmo valor como `farm_cloud_id` para consultas/admin e integrações.

ALTER TABLE farms
  ADD COLUMN IF NOT EXISTS farm_cloud_id TEXT;

UPDATE farms
SET farm_cloud_id = id::text
WHERE farm_cloud_id IS NULL OR BTRIM(farm_cloud_id) = '';

CREATE OR REPLACE FUNCTION set_farms_farm_cloud_id()
RETURNS trigger AS $$
BEGIN
  IF NEW.farm_cloud_id IS NULL OR BTRIM(NEW.farm_cloud_id) = '' THEN
    NEW.farm_cloud_id := NEW.id::text;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_farms_farm_cloud_id ON farms;

CREATE TRIGGER trg_set_farms_farm_cloud_id
BEFORE INSERT OR UPDATE ON farms
FOR EACH ROW
EXECUTE FUNCTION set_farms_farm_cloud_id();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'farms_farm_cloud_id_unique'
  ) THEN
    ALTER TABLE farms
      ADD CONSTRAINT farms_farm_cloud_id_unique UNIQUE (farm_cloud_id);
  END IF;
END;
$$;
