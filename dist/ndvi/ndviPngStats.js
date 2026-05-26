import { PNG } from 'pngjs';

/** Faixas RGB do evalscript NDVI (sentinelProcess.client.js). */
const COLOR_STOPS = [
  { rgb: [191, 13, 13], ndvi: 0.05 },
  { rgb: [242, 89, 26], ndvi: 0.175 },
  { rgb: [250, 191, 38], ndvi: 0.325 },
  { rgb: [216, 230, 51], ndvi: 0.475 },
  { rgb: [102, 191, 64], ndvi: 0.625 },
  { rgb: [26, 140, 38], ndvi: 0.85 },
];

function rgbDistance(a, b) {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2,
  );
}

function rgbToNdvi(r, g, b) {
  let best = COLOR_STOPS[0];
  let bestDist = rgbDistance([r, g, b], best.rgb);
  for (let i = 1; i < COLOR_STOPS.length; i += 1) {
    const dist = rgbDistance([r, g, b], COLOR_STOPS[i].rgb);
    if (dist < bestDist) {
      best = COLOR_STOPS[i];
      bestDist = dist;
    }
  }
  if (bestDist > 72) return null;
  return best.ndvi;
}

function bucketPercent(value, edges) {
  for (let i = 0; i < edges.length - 1; i += 1) {
    if (value < edges[i + 1]) return i;
  }
  return edges.length - 2;
}

/**
 * Estima estatísticas NDVI a partir do PNG colorido (preview Process API).
 */
export function computeNdviStatsFromPreviewPng(buffer) {
  if (!buffer?.length || buffer[0] !== 0x89) return null;

  let png;
  try {
    png = PNG.sync.read(buffer);
  } catch {
    return null;
  }

  const { data, width, height } = png;
  const values = [];
  const buckets = [0, 0, 0, 0];
  const edges = [0, 0.25, 0.45, 0.65, 1.01];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (width * y + x) << 2;
      const a = data[i + 3];
      if (a < 40) continue;
      const ndvi = rgbToNdvi(data[i], data[i + 1], data[i + 2]);
      if (ndvi == null) continue;
      values.push(ndvi);
      buckets[bucketPercent(ndvi, edges)] += 1;
    }
  }

  if (values.length < 24) return null;

  let sum = 0;
  let min = 1;
  let max = -1;
  for (const v of values) {
    sum += v;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }

  const mean = sum / values.length;
  if (!Number.isFinite(mean) || mean <= 0.001) return null;
  if (max - min < 0.02 && values.length > 100) {
    return null;
  }

  const total = values.length;
  return {
    ndvi_mean: Number(mean.toFixed(3)),
    ndvi_min: Number(min.toFixed(3)),
    ndvi_max: Number(max.toFixed(3)),
    very_low_percent: Number(((buckets[0] / total) * 100).toFixed(1)),
    low_percent: Number(((buckets[1] / total) * 100).toFixed(1)),
    medium_percent: Number(((buckets[2] / total) * 100).toFixed(1)),
    high_percent: Number(((buckets[3] / total) * 100).toFixed(1)),
  };
}

export function isPlaceholderPreviewUrl(url) {
  const text = String(url || '').trim().toLowerCase();
  if (!text) return true;
  return (
    text.includes('dummyimage.com') ||
    text.includes('placeholder') ||
    text.includes('/ffffff.png')
  );
}
