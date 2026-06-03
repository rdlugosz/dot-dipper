// Turns any image source (uploaded photo, sample, or AI image) into the data a
// project needs: grid dimensions, a color palette, and a per-cell target grid.

import { medianCut, nearestIndex } from './quantize.js';

export function processImage(source, { targetWidth, numColors }) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  const cols = targetWidth;
  const rows = Math.max(1, Math.round(targetWidth * (sh / sw)));

  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, cols, rows);

  let data;
  try {
    data = ctx.getImageData(0, 0, cols, rows).data;
  } catch {
    throw new Error("This image can't be read (the source blocked it). Try a different one.");
  }

  // Quantize on a copy so median-cut's in-place sorting doesn't matter.
  const samples = [];
  for (let i = 0; i < data.length; i += 4) {
    samples.push([data[i], data[i + 1], data[i + 2]]);
  }
  let palette = medianCut(samples, numColors);

  // Map every cell to its nearest palette color.
  const grid = new Array(cols * rows);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    grid[j] = nearestIndex(palette, data[i], data[i + 1], data[i + 2]);
  }

  // Drop unused palette entries and renumber so colors are sorted by how often
  // they appear (color #1 is the most common — nicer to work through).
  const counts = new Map();
  for (const idx of grid) counts.set(idx, (counts.get(idx) || 0) + 1);
  const order = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
  const remap = new Map();
  const newPalette = [];
  order.forEach((old, i) => { remap.set(old, i); newPalette.push(palette[old]); });
  for (let i = 0; i < grid.length; i++) grid[i] = remap.get(grid[i]);
  palette = newPalette;

  return { cols, rows, palette, grid, thumb: makeThumb(cols, rows, grid, palette) };
}

function makeThumb(cols, rows, grid, palette) {
  const scale = Math.max(1, Math.floor(220 / Math.max(cols, rows)));
  const c = document.createElement('canvas');
  c.width = cols * scale;
  c.height = rows * scale;
  const ctx = c.getContext('2d');
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const p = palette[grid[y * cols + x]];
      ctx.fillStyle = `rgb(${p[0]},${p[1]},${p[2]})`;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return c.toDataURL('image/png');
}
