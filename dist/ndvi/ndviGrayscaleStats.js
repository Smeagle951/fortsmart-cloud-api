import { PNG } from 'pngjs';

/**
 * Estatísticas NDVI a partir de PNG onde R=G=B = (clamp(ndvi,-1,1)+1)/2 [0..1],
 * gerado pelo EVALSCRIPT_FLOAT_GRAY (B04/B08 numérico, não paleta).
 */
const BUCKET_EDGES = [-1, -0.25, 0.25, 0.5, 1.01];

function bucketIndex(ndvi) {
  for (let i = 0; i < BUCKET_EDGES.length - 1; i += 1) {
    if (ndvi < BUCKET_EDGES[i + 1]) return i;
  }
  return BUCKET_EDGES.length - 2;
}

export function computeNdviStatsFromFloatEncodedPng(buffer, { sceneId = '-' } = {}) {
  if (!buffer?.length || buffer[0] !== 0x89) {
    console.warn(`⚠️ [NDVI][GrayStats] buffer inválido sceneId=${sceneId}`);
    return null;
  }

  let png;
  try {
    png = PNG.sync.read(buffer);
  } catch (err) {
    console.warn(`⚠️ [NDVI][GrayStats] PNG parse falhou sceneId=${sceneId}: ${err.message}`);
    return null;
  }

  const { data, width, height } = png;
  const totalPixels = width * height;
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

  const validPixels = values.length;
  console.log(
    `ℹ️ [NDVI][GrayStats] sceneId=${sceneId} ` +
      `totalPixels=${totalPixels} validPixels=${validPixels} ` +
      `sample0=${values[0]?.toFixed(3) ?? '-'} sample1=${values[1]?.toFixed(3) ?? '-'}`,
  );

  if (validPixels < 24) {
    console.warn(
      `⚠️ [NDVI][GrayStats] pixel insuficiente sceneId=${sceneId} validPixels=${validPixels}`,
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

  const mean = sum / validPixels;
  if (!Number.isFinite(mean)) return null;

  const total = validPixels;
  const stats = {
    ndvi_mean: Number(mean.toFixed(3)),
    ndvi_min: Number(min.toFixed(3)),
    ndvi_max: Number(max.toFixed(3)),
    very_low_percent: Number(((buckets[0] / total) * 100).toFixed(1)),
    low_percent: Number(((buckets[1] / total) * 100).toFixed(1)),
    medium_percent: Number(((buckets[2] / total) * 100).toFixed(1)),
    high_percent: Number(((buckets[3] / total) * 100).toFixed(1)),
  };

  console.log(
    `✅ [NDVI][GrayStats] sceneId=${sceneId} ` +
      `mean=${stats.ndvi_mean} min=${stats.ndvi_min} max=${stats.ndvi_max} ` +
      `veryLow=${stats.very_low_percent}% low=${stats.low_percent}% ` +
      `medium=${stats.medium_percent}% high=${stats.high_percent}%`,
  );

  return stats;
}
