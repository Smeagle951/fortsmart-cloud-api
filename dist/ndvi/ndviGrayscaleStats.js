import { PNG } from 'pngjs';

/**
 * Estatísticas NDVI a partir de PNG onde R=G=B = (clamp(ndvi,-1,1)+1)/2  [0..1],
 * gerado pelo evalscript (banda derivada de B04/B08, não paleta RGB).
 */
const BUCKET_EDGES = [-1, -0.25, 0.25, 0.5, 1.01];

function bucketIndex(ndvi) {
  for (let i = 0; i < BUCKET_EDGES.length - 1; i += 1) {
    if (ndvi < BUCKET_EDGES[i + 1]) return i;
  }
  return BUCKET_EDGES.length - 2;
}

export function computeNdviStatsFromFloatEncodedPng(buffer, { sceneId = '-' } = {}) {
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

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (width * y + x) << 2;
      const a = data[i + 3];
      if (a < 40) continue;
      const r = data[i] / 255;
      const ndvi = r * 2 - 1;
      if (!Number.isFinite(ndvi) || ndvi < -1.0001 || ndvi > 1.0001) continue;
      values.push(Math.max(-1, Math.min(1, ndvi)));
      buckets[bucketIndex(ndvi)] += 1;
    }
  }

  if (values.length < 24) {
    console.warn(
      `⚠️ [NDVI][GrayStats] pixel insuficiente sceneId=${sceneId} validPixels=${values.length}`,
    );
    return null;
  }

  let sum = 0;
  let min = 1;
  let max = -1;
  for (const v of values) {
    sum += v;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }

  const mean = sum / values.length;
  if (!Number.isFinite(mean)) return null;

  let sumSq = 0;
  for (const v of values) {
    const d = v - mean;
    sumSq += d * d;
  }
  const std = Math.sqrt(sumSq / values.length);

  const total = values.length;
  const result = {
    ndvi_mean: Number(mean.toFixed(3)),
    ndvi_min: Number(min.toFixed(3)),
    ndvi_max: Number(max.toFixed(3)),
    very_low_percent: Number(((buckets[0] / total) * 100).toFixed(1)),
    low_percent: Number(((buckets[1] / total) * 100).toFixed(1)),
    medium_percent: Number(((buckets[2] / total) * 100).toFixed(1)),
    high_percent: Number(((buckets[3] / total) * 100).toFixed(1)),
    ndvi_std: Number(std.toFixed(3)),
    valid_pixels: total,
  };

  console.log(
    `✅ [NDVI][GrayStats] sceneId=${sceneId} validPixels=${total} ` +
      `mean=${result.ndvi_mean} min=${result.ndvi_min} max=${result.ndvi_max} std=${result.ndvi_std}`,
  );

  return result;
}
