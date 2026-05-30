/**
 * Persistência do raster interno NDVI (R2 ou cache local em dev).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { decodeClassChannel } from './ndviAgronomicCore.js';
import {
  gridDocumentFromStatsGrid,
  serializeInternalGridDocument,
  deserializeInternalGridBuffer,
  RASTER_SCHEMA_NUM,
} from './ndviRasterSerializer.js';

const CACHE_DIR = path.join(process.cwd(), '.ndvi-raster-cache');

export function buildStorageKey({ plotId, sceneId, schemaVersion = RASTER_SCHEMA_NUM }) {
  const pid = String(plotId || 'plot').trim();
  const sid = String(sceneId || 'scene').trim();
  const ver = Number(schemaVersion) || RASTER_SCHEMA_NUM;
  return `ndvi/internal-grid/${pid}/${sid}/grid_v${ver}.bin`;
}

function envFirst(...names) {
  for (const name of names) {
    const v = String(process.env[name] ?? '').trim();
    if (v) return v;
  }
  return '';
}

function isS3Configured() {
  return Boolean(
    envFirst('FORTSMART_S3_BUCKET', 'R2_BUCKET_NAME') &&
      envFirst('FORTSMART_S3_ACCESS_KEY', 'FORTSMART_S3_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID') &&
      envFirst('FORTSMART_S3_SECRET_KEY', 'FORTSMART_S3_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY'),
  );
}

function localCachePath(storageKey) {
  const safe = storageKey.replace(/[^a-zA-Z0-9/._-]/g, '_');
  return path.join(CACHE_DIR, safe);
}

function readFullGridsFromPackedPngs(primaryBuffer, indicesBuffer) {
  if (!primaryBuffer?.length) return null;
  let png;
  try {
    png = PNG.sync.read(primaryBuffer);
  } catch {
    return null;
  }
  const { width, height, data } = png;
  const cellCount = width * height;
  const ndviValues = new Array(cellCount).fill(null);
  const indexByCell = new Array(cellCount).fill(null);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (width * y + x) << 2;
      const a = data[i + 3];
      const idx = y * width + x;
      if (a < 40) continue;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const ndvi = r * 2 - 1;
      const classId = decodeClassChannel(Math.round(g * 255));
      const ndre = b * 2 - 1;
      if (classId > 0 && Number.isFinite(ndvi)) {
        ndviValues[idx] = ndvi;
        indexByCell[idx] = { ndre, valid: true };
      }
    }
  }

  if (indicesBuffer?.length) {
    let idxPng;
    try {
      idxPng = PNG.sync.read(indicesBuffer);
    } catch {
      return { values: ndviValues, width, height, indexByCell };
    }
    const idata = idxPng.data;
    const iw = idxPng.width;
    const ih = idxPng.height;
    for (let y = 0; y < Math.min(height, ih); y += 1) {
      for (let x = 0; x < Math.min(width, iw); x += 1) {
        const i = (iw * y + x) << 2;
        const a = idata[i + 3];
        if (a < 40) continue;
        const cell = y * width + x;
        const savi = idata[i] / 255 * 2 - 1;
        const bsi = idata[i + 1] / 255 * 2 - 1;
        const ndmi = idata[i + 2] / 255 * 2 - 1;
        indexByCell[cell] = {
          ...(indexByCell[cell] || {}),
          savi,
          bsi,
          ndmi,
          valid: true,
        };
      }
    }
  }

  return { values: ndviValues, width, height, indexByCell };
}

export function buildInternalGridDocument({
  plotId,
  sceneId,
  bounds,
  statsGrid,
  primaryBuffer,
  indicesBuffer,
  metadata = {},
}) {
  let grid = statsGrid;
  let indexByCell = null;
  if (primaryBuffer) {
    const full = readFullGridsFromPackedPngs(primaryBuffer, indicesBuffer);
    if (full) {
      grid = { values: full.values, width: full.width, height: full.height };
      indexByCell = full.indexByCell;
    }
  }
  return gridDocumentFromStatsGrid({
    plotId,
    sceneId,
    bounds,
    statsGrid: grid,
    indicesPixels: indexByCell,
    metadata,
  });
}

export async function storeInternalGrid({
  plotId,
  sceneId,
  schemaVersion = RASTER_SCHEMA_NUM,
  document,
  metadata = {},
}) {
  const storageKey = buildStorageKey({ plotId, sceneId, schemaVersion });
  const started = Date.now();
  const serialized = serializeInternalGridDocument(document);
  const durationMs = Date.now() - started;

  if (isS3Configured()) {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const bucket = envFirst('FORTSMART_S3_BUCKET', 'R2_BUCKET_NAME');
    const endpoint = envFirst('FORTSMART_S3_ENDPOINT', 'R2_ENDPOINT');
    const region = envFirst('FORTSMART_S3_REGION', 'R2_REGION', 'AWS_REGION') || 'auto';
    const client = new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId: envFirst('FORTSMART_S3_ACCESS_KEY', 'FORTSMART_S3_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID'),
        secretAccessKey: envFirst(
          'FORTSMART_S3_SECRET_KEY',
          'FORTSMART_S3_SECRET_ACCESS_KEY',
          'R2_SECRET_ACCESS_KEY',
        ),
      },
      forcePathStyle: true,
    });
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        Body: serialized.buffer,
        ContentType: 'application/octet-stream',
        Metadata: {
          'x-ndvi-schema': String(schemaVersion),
          'x-ndvi-checksum': serialized.checksum,
        },
      }),
    );
    const publicBase = envFirst('FORTSMART_S3_PUBLIC_BASE_URL', 'R2_PUBLIC_BASE_URL', 'NDVI_PUBLIC_BASE_URL').replace(
      /\/+$/,
      '',
    );
    const rasterUrl = publicBase
      ? `${publicBase}/${storageKey.split('/').map(encodeURIComponent).join('/')}`
      : null;
    console.log('[NDVI_RASTER_STORE]', {
      sceneId,
      storageKey,
      sizeBytes: serialized.sizeBytes,
      bands: 'ndvi,ndre,savi,ndmi,bsi,valid_mask',
      durationMs,
    });
    return {
      storageKey,
      rasterUrl,
      sizeBytes: serialized.sizeBytes,
      checksum: serialized.checksum,
      provider: 's3',
      raster_schema_version: schemaVersion,
      raster_storage_key: storageKey,
      raster_storage_provider: 's3',
    };
  }

  const localPath = localCachePath(storageKey);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, serialized.buffer);
  console.log('[NDVI_RASTER_STORE]', {
    sceneId,
    storageKey,
    sizeBytes: serialized.sizeBytes,
    bands: 'ndvi,ndre,savi,ndmi,bsi,valid_mask',
    durationMs,
    provider: 'local',
  });
  return {
    storageKey,
    rasterUrl: null,
    sizeBytes: serialized.sizeBytes,
    checksum: serialized.checksum,
    provider: 'local',
    raster_schema_version: schemaVersion,
    raster_storage_key: storageKey,
    raster_storage_provider: 'local',
  };
}

export async function loadInternalGrid({ plotId, sceneId, schemaVersion = RASTER_SCHEMA_NUM }) {
  const storageKey = buildStorageKey({ plotId, sceneId, schemaVersion });
  const started = Date.now();
  let buffer = null;

  if (isS3Configured()) {
    try {
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const bucket = envFirst('FORTSMART_S3_BUCKET', 'R2_BUCKET_NAME');
      const endpoint = envFirst('FORTSMART_S3_ENDPOINT', 'R2_ENDPOINT');
      const region = envFirst('FORTSMART_S3_REGION', 'R2_REGION', 'AWS_REGION') || 'auto';
      const client = new S3Client({
        region,
        endpoint,
        credentials: {
          accessKeyId: envFirst('FORTSMART_S3_ACCESS_KEY', 'FORTSMART_S3_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID'),
          secretAccessKey: envFirst(
            'FORTSMART_S3_SECRET_KEY',
            'FORTSMART_S3_SECRET_ACCESS_KEY',
            'R2_SECRET_ACCESS_KEY',
          ),
        },
        forcePathStyle: true,
      });
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
      buffer = Buffer.from(await res.Body.transformToByteArray());
    } catch (error) {
      console.warn(`[NDVI_RASTER_LOAD] S3 miss sceneId=${sceneId} ${error.message}`);
    }
  } else {
    try {
      buffer = await fs.readFile(localCachePath(storageKey));
    } catch (error) {
      console.warn(`[NDVI_RASTER_LOAD] local miss sceneId=${sceneId} ${error.message}`);
    }
  }

  const grid = buffer ? deserializeInternalGridBuffer(buffer) : null;
  console.log('[NDVI_RASTER_LOAD]', {
    sceneId,
    storageKey,
    loaded: !!grid,
    durationMs: Date.now() - started,
  });
  return grid;
}

export async function isRasterAvailable({ plotId, sceneId, schemaVersion = RASTER_SCHEMA_NUM }) {
  const grid = await loadInternalGrid({ plotId, sceneId, schemaVersion });
  return Boolean(grid?.bands?.ndvi?.length);
}
