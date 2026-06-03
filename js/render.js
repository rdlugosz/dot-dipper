// Renders a project's art to a high-resolution PNG and shows a full-screen
// viewer with a Save/Share action (which surfaces "Save to Photos" on mobile
// via the Web Share API, falling back to a download elsewhere).

const SHAPES = ['circle', 'diamond', 'square'];
const GEM_VARIANTS = 3;
const clamp8 = v => Math.max(0, Math.min(255, Math.round(v)));

function currentShape() {
  const s = localStorage.getItem('dotdipper.shape');
  return SHAPES.includes(s) ? s : 'circle';
}

function cellVariant(x, y, n) {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return h % n;
}

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function shapePath(g, shape, cx, cy, rad) {
  if (shape === 'square') {
    const s = rad * 0.9;
    roundRectPath(g, cx - s, cy - s, s * 2, s * 2, s * 0.22);
    return;
  }
  g.beginPath();
  if (shape === 'diamond') {
    g.moveTo(cx, cy - rad); g.lineTo(cx + rad, cy);
    g.lineTo(cx, cy + rad); g.lineTo(cx - rad, cy);
    g.closePath();
  } else {
    g.arc(cx, cy, rad, 0, 7);
  }
}

// Draws one placed gem (matching the editor's bed + inset gem + gloss + ombre).
function drawGem(g, shape, col, sx, sy, size, x, y) {
  const pad = size * 0.06, r = size - pad * 2;
  const bx = sx + pad, by = sy + pad, cx = bx + r / 2, cy = by + r / 2, rad = (r / 2) * 0.82;
  const jit = (cellVariant(x, y, GEM_VARIANTS) - (GEM_VARIANTS - 1) / 2) * 14;
  roundRectPath(g, bx, by, r, r, r * 0.14);
  g.fillStyle = `rgb(${clamp8(col[0] * 0.5)},${clamp8(col[1] * 0.5)},${clamp8(col[2] * 0.5)})`;
  g.fill();
  shapePath(g, shape, cx, cy, rad);
  g.fillStyle = `rgb(${clamp8(col[0] + jit)},${clamp8(col[1] + jit)},${clamp8(col[2] + jit)})`;
  g.fill();
  g.save();
  shapePath(g, shape, cx, cy, rad);
  g.clip();
  const grd = g.createRadialGradient(cx - rad * 0.35, cy - rad * 0.35, rad * 0.1, cx, cy, rad);
  grd.addColorStop(0, 'rgba(255,255,255,0.5)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  grd.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = grd;
  g.fillRect(bx, by, r, r);
  g.restore();
}

export function renderArt(p) {
  const { cols, rows } = p;
  const cellPx = Math.max(6, Math.min(24, Math.round(1400 / Math.max(cols, rows))));
  const c = document.createElement('canvas');
  c.width = cols * cellPx;
  c.height = rows * cellPx;
  const g = c.getContext('2d');
  g.fillStyle = '#161427';
  g.fillRect(0, 0, c.width, c.height);
  const shape = currentShape();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x, placed = p.filled[idx], sx = x * cellPx, sy = y * cellPx;
      if (placed >= 0) {
        drawGem(g, shape, p.palette[placed], sx, sy, cellPx, x, y);
      } else {
        // Unplaced: a faint template so an unfinished picture still reads.
        const col = p.palette[p.grid[idx]];
        const pad = cellPx * 0.06, r = cellPx - pad * 2;
        roundRectPath(g, sx + pad, sy + pad, r, r, r * 0.18);
        g.fillStyle = `rgb(${clamp8(col[0] * 0.28)},${clamp8(col[1] * 0.28)},${clamp8(col[2] * 0.28)})`;
        g.fill();
      }
    }
  }
  return c;
}

async function saveOrShare(blob, name) {
  const base = (name || 'dot-dipper').replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'picture';
  const file = new File([blob], base + '.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name || 'My picture' }); } catch { /* cancelled */ }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
}

// Full-screen, chrome-free view of the finished art. Tap the image to hide the
// buttons for a clean screenshot; the Save button shares/downloads a PNG.
export function showFinishedArt(p) {
  const canvas = renderArt(p);
  const ov = document.createElement('div');
  ov.className = 'finish-view';
  const img = document.createElement('img');
  img.alt = p.name || 'Finished picture';
  const bar = document.createElement('div');
  bar.className = 'finish-bar';
  bar.innerHTML = `<button class="btn-primary" id="finSave">📷 Save photo</button>
    <button class="btn-ghost" id="finClose">Close</button>`;
  ov.append(img, bar);

  let url = null;
  canvas.toBlob(blob => {
    if (!blob) return;
    url = URL.createObjectURL(blob);
    img.src = url;
    bar.querySelector('#finSave').onclick = () => saveOrShare(blob, p.name);
  }, 'image/png');

  const close = () => { ov.remove(); if (url) URL.revokeObjectURL(url); };
  bar.querySelector('#finClose').onclick = close;
  img.onclick = () => ov.classList.toggle('bare');  // hide UI for a clean screenshot
  document.body.appendChild(ov);
}

// ---- printable paint-by-number chart ----

const escHtml = s => String(s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A print-friendly chart: white cells with each color's number, faint color
// guide tints, light gridlines, and heavier lines every 5 cells for counting.
export function renderChart(p) {
  const { cols, rows, grid, palette } = p;
  const cell = Math.max(12, Math.min(28, Math.floor(2600 / Math.max(cols, rows))));
  const c = document.createElement('canvas');
  c.width = cols * cell;
  c.height = rows * cell;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${Math.floor(cell * 0.5)}px system-ui, sans-serif`;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const col = palette[grid[y * cols + x]];
      const sx = x * cell, sy = y * cell;
      g.fillStyle = `rgb(${clamp8(255 - (255 - col[0]) * 0.18)},${clamp8(255 - (255 - col[1]) * 0.18)},${clamp8(255 - (255 - col[2]) * 0.18)})`;
      g.fillRect(sx, sy, cell, cell);
      g.fillStyle = '#222';
      g.fillText(String(grid[y * cols + x] + 1), sx + cell / 2, sy + cell / 2 + cell * 0.04);
    }
  }
  const lines = (step, color, width) => {
    g.strokeStyle = color; g.lineWidth = width;
    g.beginPath();
    for (let x = 0; x <= cols; x += step) { g.moveTo(x * cell + 0.5, 0); g.lineTo(x * cell + 0.5, c.height); }
    for (let y = 0; y <= rows; y += step) { g.moveTo(0, y * cell + 0.5); g.lineTo(c.width, y * cell + 0.5); }
    g.stroke();
  };
  lines(1, '#c8c8c8', 1);
  lines(5, '#777', 1.5);
  return c;
}

export function printChart(p) {
  const url = renderChart(p).toDataURL('image/png');
  const legend = p.palette.map((col, i) =>
    `<div class="leg"><span class="sw" style="background:rgb(${col[0]},${col[1]},${col[2]})"></span>${i + 1}</div>`
  ).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8">
    <title>${escHtml(p.name)} — chart</title>
    <style>
      @page { margin: 10mm; }
      body { font-family: system-ui, sans-serif; color: #111; margin: 0; padding: 8px;
             -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      h1 { font-size: 16px; margin: 0 0 6px; }
      .meta { font-size: 11px; color: #555; margin-bottom: 8px; }
      img.chart { width: 100%; height: auto; image-rendering: pixelated; display: block; }
      h2 { font-size: 13px; margin: 12px 0 6px; }
      .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12px; }
      .leg { display: flex; align-items: center; gap: 5px; }
      .sw { width: 14px; height: 14px; border: 1px solid #999; display: inline-block; }
    </style></head><body>
      <h1>${escHtml(p.name)} — color-by-number chart</h1>
      <div class="meta">${p.cols} × ${p.rows} · ${p.palette.length} colors · heavier lines every 5 squares</div>
      <img class="chart" src="${url}">
      <h2>Colors</h2>
      <div class="legend">${legend}</div>
    </body></html>`;

  // Print via a hidden iframe (more reliable than window.open on mobile/PWAs).
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  const img = doc.querySelector('img');
  const go = () => {
    try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch {}
    setTimeout(() => iframe.remove(), 1000);
  };
  if (img.complete) go(); else img.onload = go;
}

