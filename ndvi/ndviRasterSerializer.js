/**
 * Serialização binária do raster interno (internal_grid_v1).
 * Bandas em Float32/Uint8; metadados compactos; corpo gzip.
 */
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const RASTER_SCHEMA_VERSION = 'internal_grid_v1';
export const RASTER_SCHEMA_NUM = 1;
const MAGIC = Buffer.from('FSNDIG01');

const BAND_ORDER = ['ndvi', 'ndre', 'savi', 'ndmi', 'bsi'];

export function serializeInternalGridDocument(doc) {
  const width = Number(doc.width);
  const height = Number(doc.height);
  if (!width || !height) throw new Error('internal_grid: width/height obrigatórios');

  const meta = {
    schema_version: doc.schema_version || RASTER_SCHEMA_VERSION,
    created_at: doc.created_at || new Date().toISOString(),
    plot_id: doc.plot_id ?? null,
    scene_id: doc.scene_id ?? null,
    source: doc.source || 'sentinel-2-l2a',
    provider: doc.provider || 'copernicus_dataspace',
    resolution_m: doc.resolution_m ?? 10,
    width,
    height,
    bounds: doc.bounds ?? null,
    crs: doc.crs || 'EPSG:4326',
    nodata: doc.nodata ?? -9999,
    metadata: doc.metadata || {},
  };

  const metaBuf = Buffer.from(JSON.stringify(meta), 'utf8');
  const parts = [MAGIC, Buffer.alloc(4)];
  parts[1].writeUInt32LE(metaBuf.length, 0);
  parts.push(metaBuf);

  const cellCount = width * height;
  for (const name of BAND_ORDER) {
    const arr = doc.bands?.[name];
    if (!arr || arr.length !== cellCount) {
      throw new Error(`internal_grid: banda ${name} inválida`);
    }
    parts.push(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
  }

  const valid = doc.bands?.valid_mask;
  if (!valid || valid.length !== cellCount) {
    throw new Error('internal_grid: valid_mask inválida');
  }
  parts.push(Buffer.from(valid.buffer, valid.byteOffset, valid.byteLength));

  const raw = Buffer.concat(parts);
  const compressed = gzipSync(raw);
  const checksum = createHash('sha256').update(compressed).digest('hex');

  return {
    buffer: compressed,
    checksum,
    sizeBytes: compressed.length,
    schemaVersion: RASTER_SCHEMA_NUM,
    width,
    height,
  };
}

export function deserializeInternalGridBuffer(buffer) {
  if (!buffer?.length) return null;
  let raw;
  try {
    raw = gunzipSync(buffer);
  } catch {
    return null;
  }
  if (raw.length < 12 || !raw.subarray(0, 8).equals(MAGIC)) return null;

  const metaLen = raw.readUInt32LE(8);
  if (raw.length < 12 + metaLen) return null;

  let meta;
  try {
    meta = JSON.parse(raw.subarray(12, 12 + metaLen).toString('utf8'));
  } catch {
    return null;
  }

  const width = Number(meta.width);
  const height = Number(meta.height);
  const cellCount = width * height;
  if (!cellCount) return null;

  let offset = 12 + metaLen;
  const bands = {};

  for (const name of BAND_ORDER) {
    const byteLen = cellCount * 4;
    if (offset + byteLen > raw.length) return null;
    bands[name] = new Float32Array(
      raw.buffer,
      raw.byteOffset + offset,
      cellCount,
    );
    offset += byteLen;
  }

  if (offset + cellCount > raw.length) return null;
  bands.valid_mask = new Uint8Array(
    raw.buffer,
    raw.byteOffset + offset,
    cellCount,
  );

  return {
    ...meta,
    bands,
    checksum: createHash('sha256').update(buffer).digest('hex'),
  };
}

export function gridDocumentFromStatsGrid({
  plotId,
  sceneId,
  bounds,
  statsGrid,
  indicesPixels = null,
  metadata = {},
}) {
  const { values, width, height } = statsGrid || {};
  if (!values?.length || !width || !height) return null;

  const cellCount = width * height;
  const ndvi = new Float32Array(cellCount);
  const ndre = new Float32Array(cellCount);
  const savi = new Float32Array(cellCount);
  const ndmi = new Float32Array(cellCount);
  const bsi = new Float32Array(cellCount);
  const valid_mask = new Uint8Array(cellCount);
  const nodata = -9999;

  for (let i = 0; i < cellCount; i += 1) {
    const v = values[i];
    if (v == null || !Number.isFinite(Number(v))) {
      ndvi[i] = nodata;
      ndre[i] = nodata;
      savi[i] = nodata;
      ndmi[i] = nodata;
      bsi[i] = nodata;
      valid_mask[i] = 0;
      continue;
    }
    ndvi[i] = Number(v);
    valid_mask[i] = 1;
    const idx = indicesPixels?.[i];
    ndre[i] = Number.isFinite(idx?.ndre) ? idx.ndre : nodata;
    savi[i] = Number.isFinite(idx?.savi) ? idx.savi : nodata;
    ndmi[i] = Number.isFinite(idx?.ndmi) ? idx.ndmi : nodata;
    bsi[i] = Number.isFinite(idx?.bsi) ? idx.bsi : nodata;
  }

  return {
    schema_version: RASTER_SCHEMA_VERSION,
    plot_id: plotId,
    scene_id: sceneId,
    width,
    height,
    bounds,
    crs: 'EPSG:4326',
    nodata,
    bands: { ndvi, ndre, savi, ndmi, bsi, valid_mask },
    metadata,
  };
}
