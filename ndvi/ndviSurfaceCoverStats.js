import { PNG } from 'pngjs';
import { aggregateSurfaceClassPixels } from './ndviSurfaceCoverCore.js';

export function decodeSurfacePackedPng(buffer) {
  if (!buffer?.length || buffer[0] !== 0x89) return [];
  let png;
  try {
    png = PNG.sync.read(buffer);
  } catch {
    return [];
  }
  const { data, width, height } = png;
  const pixels = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (width * y + x) << 2;
      if (data[i + 3] < 40) continue;
      const classCode = Math.max(
        0,
        Math.min(7, Math.round((data[i] / 255) * 7)),
      );
      pixels.push({
        classCode,
        confidence: data[i + 1] / 255,
      });
    }
  }
  return pixels;
}

export function computeSurfaceCoverStatsFromPackedPng(buffer, { resolutionM = 20 } = {}) {
  const pixels = decodeSurfacePackedPng(buffer);
  if (!pixels.length) return null;
  return aggregateSurfaceClassPixels(pixels, { resolutionM });
}
