export function medianFilter3x3(values, width, height) {
  if (!Array.isArray(values) || !width || !height) return [];
  const out = new Array(values.length).fill(null);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const neighbors = [];
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy += 1) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx += 1) {
          const value = Number(values[yy * width + xx]);
          if (Number.isFinite(value)) neighbors.push(value);
        }
      }
      neighbors.sort((a, b) => a - b);
      out[y * width + x] = neighbors.length
        ? neighbors[Math.floor(neighbors.length / 2)]
        : null;
    }
  }
  return out;
}

export function bilinearUpscale(values, width, height, factor = 4) {
  if (!Array.isArray(values) || factor <= 1) {
    return { values, width, height };
  }
  const outWidth = width * factor;
  const outHeight = height * factor;
  const out = new Array(outWidth * outHeight).fill(null);
  const at = (x, y) => values[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];

  for (let y = 0; y < outHeight; y += 1) {
    const gy = y / factor;
    const y0 = Math.floor(gy);
    const y1 = Math.min(height - 1, y0 + 1);
    const ty = gy - y0;
    for (let x = 0; x < outWidth; x += 1) {
      const gx = x / factor;
      const x0 = Math.floor(gx);
      const x1 = Math.min(width - 1, x0 + 1);
      const tx = gx - x0;
      const v00 = Number(at(x0, y0));
      const v10 = Number(at(x1, y0));
      const v01 = Number(at(x0, y1));
      const v11 = Number(at(x1, y1));
      if (![v00, v10, v01, v11].every(Number.isFinite)) continue;
      out[y * outWidth + x] =
        v00 * (1 - tx) * (1 - ty) +
        v10 * tx * (1 - ty) +
        v01 * (1 - tx) * ty +
        v11 * tx * ty;
    }
  }
  return { values: out, width: outWidth, height: outHeight };
}

export function smoothPreviewPngBuffer(buffer) {
  if (!buffer?.length) return buffer;
  let png;
  try {
    png = PNG.sync.read(buffer);
  } catch {
    return buffer;
  }
  const out = Buffer.from(png.data);
  const { width, height, data } = png;
  const median = (arr) => {
    arr.sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)];
  };

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = (width * y + x) << 2;
      if (data[idx + 3] < 16) continue;
      for (let c = 0; c < 3; c += 1) {
        const neighbors = [];
        for (let yy = y - 1; yy <= y + 1; yy += 1) {
          for (let xx = x - 1; xx <= x + 1; xx += 1) {
            const nIdx = (width * yy + xx) << 2;
            if (data[nIdx + 3] >= 16) neighbors.push(data[nIdx + c]);
          }
        }
        if (neighbors.length) out[idx + c] = median(neighbors);
      }
    }
  }

  png.data = out;
  return PNG.sync.write(png);
}
import { PNG } from 'pngjs';
