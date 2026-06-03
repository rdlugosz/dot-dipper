// Median-cut color quantization. Reduces an arbitrary image to a small palette
// of representative colors, which become the "dot" colors in the painting.

export function medianCut(pixels, maxColors) {
  // pixels: array of [r,g,b]. Returns an array of [r,g,b] palette colors.
  if (pixels.length === 0) return [[0, 0, 0]];
  let buckets = [pixels];

  while (buckets.length < maxColors) {
    let target = -1, widest = -1, channel = 0;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].length < 2) continue;
      const r = channelRange(buckets[i]);
      if (r.range > widest) { widest = r.range; target = i; channel = r.channel; }
    }
    if (target === -1) break; // nothing left to split
    const b = buckets[target];
    b.sort((p, q) => p[channel] - q[channel]);
    const mid = b.length >> 1;
    buckets.splice(target, 1, b.slice(0, mid), b.slice(mid));
  }

  return buckets.filter(b => b.length).map(average);
}

function channelRange(bucket) {
  let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
  for (const p of bucket) {
    if (p[0] < rmin) rmin = p[0]; if (p[0] > rmax) rmax = p[0];
    if (p[1] < gmin) gmin = p[1]; if (p[1] > gmax) gmax = p[1];
    if (p[2] < bmin) bmin = p[2]; if (p[2] > bmax) bmax = p[2];
  }
  // Weight green slightly higher to better match human perception.
  const rr = rmax - rmin, gr = (gmax - gmin) * 1.2, br = bmax - bmin;
  const range = Math.max(rr, gr, br);
  const channel = range === rr ? 0 : (range === gr ? 1 : 2);
  return { range, channel };
}

function average(bucket) {
  let r = 0, g = 0, b = 0;
  for (const p of bucket) { r += p[0]; g += p[1]; b += p[2]; }
  const n = bucket.length;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

export function nearestIndex(palette, r, g, b) {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = p[0] - r, dg = p[1] - g, db = p[2] - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}
