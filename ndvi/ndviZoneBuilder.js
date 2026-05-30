function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 3) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function areaHaFromBounds(bounds) {
  if (!bounds) return null;
  const west = num(bounds.west);
  const east = num(bounds.east);
  const south = num(bounds.south);
  const north = num(bounds.north);
  if ([west, east, south, north].some((v) => v == null) || west >= east || south >= north) {
    return null;
  }
  const midLat = ((south + north) / 2) * (Math.PI / 180);
  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos(midLat);
  return Math.abs((east - west) * metersPerDegLon * (north - south) * metersPerDegLat) / 10_000;
}

function zoneType(value, p) {
  if (value <= p.p10) return 'very_low_relative_vigor';
  if (value <= p.p25) return 'low_relative_vigor';
  if (value < p.p75) return 'medium_relative_vigor';
  if (value < p.p90) return 'high_relative_vigor';
  return 'very_high_relative_vigor';
}

function componentGeometry(cells, width, height, bounds) {
  if (!bounds || !cells.length) return { geometry: null, centroid: null };
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (const idx of cells) {
    const x = idx % width;
    const y = Math.floor(idx / width);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const lon = (x) => bounds.west + ((x + 0.5) / width) * (bounds.east - bounds.west);
  const lat = (y) => bounds.north - ((y + 0.5) / height) * (bounds.north - bounds.south);
  const west = lon(minX);
  const east = lon(maxX);
  const north = lat(minY);
  const south = lat(maxY);
  return {
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ]],
    },
    centroid: {
      lon: round((west + east) / 2, 6),
      lat: round((south + north) / 2, 6),
    },
  };
}

export function buildNdviZones({
  values,
  width,
  height,
  bounds,
  percentiles = {},
  minAreaHa = 0.02,
} = {}) {
  if (!Array.isArray(values) || !width || !height || values.length !== width * height) {
    return { zones: [], spatialMetrics: { zoneCount: 0, largestLowZoneHa: null } };
  }
  const p = {
    p10: num(percentiles.p10),
    p25: num(percentiles.p25),
    p75: num(percentiles.p75),
    p90: num(percentiles.p90),
  };
  if (Object.values(p).some((v) => v == null)) {
    return { zones: [], spatialMetrics: { zoneCount: 0, largestLowZoneHa: null } };
  }

  const totalAreaHa = areaHaFromBounds(bounds);
  const validIndices = values
    .map((value, idx) => ({ value: num(value), idx }))
    .filter((item) => item.value != null);
  const pixelAreaHa = totalAreaHa && validIndices.length ? totalAreaHa / validIndices.length : null;
  const labels = new Map(validIndices.map((item) => [item.idx, zoneType(item.value, p)]));
  const visited = new Set();
  const zones = [];
  const neighbors = (idx) => {
    const x = idx % width;
    const y = Math.floor(idx / width);
    return [
      x > 0 ? idx - 1 : null,
      x < width - 1 ? idx + 1 : null,
      y > 0 ? idx - width : null,
      y < height - 1 ? idx + width : null,
    ].filter((v) => v != null);
  };

  for (const { idx } of validIndices) {
    if (visited.has(idx)) continue;
    const type = labels.get(idx);
    const stack = [idx];
    const cells = [];
    visited.add(idx);
    while (stack.length) {
      const current = stack.pop();
      cells.push(current);
      for (const next of neighbors(current)) {
        if (visited.has(next) || labels.get(next) !== type) continue;
        visited.add(next);
        stack.push(next);
      }
    }
    const areaHa = pixelAreaHa == null ? null : cells.length * pixelAreaHa;
    if (areaHa != null && areaHa < minAreaHa) continue;
    const zoneValues = cells.map((cell) => num(values[cell])).filter((v) => v != null);
    const mean = zoneValues.reduce((sum, value) => sum + value, 0) / zoneValues.length;
    const { geometry, centroid } = componentGeometry(cells, width, height, bounds);
    zones.push({
      id: `zone_${zones.length + 1}`,
      type,
      label: type.includes('low') ? 'Baixo vigor relativo' : 'Vigor relativo',
      areaHa: round(areaHa, 2),
      areaPercent: totalAreaHa && areaHa != null ? round((areaHa / totalAreaHa) * 100, 1) : null,
      meanNdvi: round(mean),
      minNdvi: round(Math.min(...zoneValues)),
      maxNdvi: round(Math.max(...zoneValues)),
      geometry,
      centroid,
      confidence: type.includes('low') ? 0.72 : 0.58,
    });
  }

  const lowZones = zones.filter((zone) => zone.type.includes('low_relative'));
  const largestLowZoneHa = lowZones.length
    ? Math.max(...lowZones.map((zone) => Number(zone.areaHa) || 0))
    : null;
  return {
    zones,
    spatialMetrics: {
      zoneCount: zones.length,
      largestLowZoneHa: round(largestLowZoneHa, 2),
    },
  };
}
