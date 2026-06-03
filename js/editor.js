// Full-screen editor: a zoomable / pannable grid of "gem" cells that the player
// fills in paint-by-number style. Selecting a color highlights every cell that
// needs it; tapping (or dragging across) those cells places the gems.

import { saveProject, addDotsPlaced } from './storage.js';

const CELL = 20;        // world units per cell
const MIN_LABEL = 15;   // show numbers only when cells are at least this big (px)
const GEM_VARIANTS = 3; // subtly varied shades per color, for an ombre look
const SHAPES = ['circle', 'diamond', 'square'];
const SHAPE_GLYPH = { circle: '●', diamond: '◆', square: '■' };

function loadShape() {
  const s = localStorage.getItem('dotdipper.shape');
  return SHAPES.includes(s) ? s : 'circle';
}
function saveShape(s) { localStorage.setItem('dotdipper.shape', s); }

const clamp8 = v => Math.max(0, Math.min(255, Math.round(v)));

// Deterministic scatter so the ombre shades don't form visible stripes.
function cellVariant(x, y, n) {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return h % n;
}

// Builds a gem outline (no fill) of the given shape, centered at (cx, cy).
function shapePath(g, shape, cx, cy, rad) {
  if (shape === 'square') {
    const s = rad * 0.9;
    roundRect(g, cx - s, cy - s, s * 2, s * 2, s * 0.22);
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

export function openEditor(project, onExit) {
  return new Editor(project, onExit);
}

class Editor {
  constructor(project, onExit) {
    this.p = project;
    this.onExit = onExit;
    if (!this.p.filled) this.p.filled = new Array(this.p.grid.length).fill(-1);

    this.canvas = document.getElementById('board');
    this.ctx = this.canvas.getContext('2d');
    this.ac = new AbortController();

    this.scale = 1;
    this.ox = 0;
    this.oy = 0;
    this.tool = 'dot';            // 'dot' | 'hand' | 'erase'
    this.brush = 1;               // brush width in cells (1, 2, or 3 → 1/4/9 dots)
    this.shape = loadShape();     // gem shape: 'circle' | 'diamond' | 'square'
    this.history = [];
    this.pointers = new Map();
    this.pinch = null;
    this.lastPaintIdx = -1;
    this.saveTimer = null;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._raf = 0;
    this.interacting = false;   // true during a pan/zoom/paint gesture (skips text)

    this.totals = new Array(this.p.palette.length).fill(0);
    for (const t of this.p.grid) this.totals[t]++;
    this.selected = this.firstUnfinished();
    this.buildGemSprites();

    document.getElementById('editorTitle').textContent = this.p.name;
    this.bindUI();
    this.renderPalette();   // before measuring: palette height affects canvas size
    this.resize();
    this.initialView();
    this.updateProgress();
    this.draw();
    this.observeResize();
  }

  // Pre-render each palette color as a set of glossy gem sprites (a few subtly
  // varied shades for an ombre effect) in the current shape. Each sprite keeps
  // the flat template color as a "bed" behind an inset gem, so the template
  // shows through around the dot. Drawing a placed cell is then one drawImage.
  buildGemSprites() {
    const S = 128, m = S / 2, rad = m * 0.82;
    this.gemSprites = this.p.palette.map(c => {
      const variants = [];
      for (let v = 0; v < GEM_VARIANTS; v++) {
        const jit = (v - (GEM_VARIANTS - 1) / 2) * 14;  // subtle lighter/darker shades
        const gc = [clamp8(c[0] + jit), clamp8(c[1] + jit), clamp8(c[2] + jit)];
        const cv = document.createElement('canvas');
        cv.width = cv.height = S;
        const g = cv.getContext('2d');
        // bed = a darker shade of the template color, visible around/behind the
        // gem (like the canvas grid in real diamond art) so the shape reads while
        // the template hue still shows through.
        roundRect(g, S * 0.04, S * 0.04, S * 0.92, S * 0.92, S * 0.14);
        g.fillStyle = `rgb(${clamp8(c[0] * 0.5)},${clamp8(c[1] * 0.5)},${clamp8(c[2] * 0.5)})`;
        g.fill();
        // inset gem in the chosen shape, in the slightly varied shade
        shapePath(g, this.shape, m, m, rad);
        g.fillStyle = `rgb(${gc[0]},${gc[1]},${gc[2]})`;
        g.fill();
        // glossy highlight, clipped to the gem
        g.save();
        shapePath(g, this.shape, m, m, rad);
        g.clip();
        const grd = g.createRadialGradient(m - rad * 0.35, m - rad * 0.35, rad * 0.1, m, m, rad);
        grd.addColorStop(0, 'rgba(255,255,255,0.5)');
        grd.addColorStop(0.5, 'rgba(255,255,255,0.05)');
        grd.addColorStop(1, 'rgba(0,0,0,0.22)');
        g.fillStyle = grd;
        g.fillRect(0, 0, S, S);
        g.restore();
        variants.push(cv);
      }
      return variants;
    });
  }

  cycleShape() {
    this.shape = SHAPES[(SHAPES.indexOf(this.shape) + 1) % SHAPES.length];
    saveShape(this.shape);
    this.buildGemSprites();
    this.updateShapeBtn();
    this.scheduleDraw();
  }

  updateShapeBtn() {
    document.getElementById('shapeBtn').textContent = SHAPE_GLYPH[this.shape];
  }

  // Coalesce repaint requests into one render per animation frame.
  scheduleDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
  }

  /* ---------- setup ---------- */

  bindUI() {
    const sig = { signal: this.ac.signal };
    const on = (id, fn) => document.getElementById(id).addEventListener('click', fn, sig);

    on('backBtn', () => { this.flushSave(); this.destroy(); this.onExit(); });
    on('undoBtn', () => this.undo());
    on('fitBtn', () => { this.fit(); this.draw(); });
    on('handBtn', () => this.setTool(this.tool === 'hand' ? 'dot' : 'hand'));
    on('eraseBtn', () => this.setTool(this.tool === 'erase' ? 'dot' : 'erase'));
    on('brushBtn', () => { this.brush = this.brush % 3 + 1; this.updateBrushBtn(); });
    on('shapeBtn', () => this.cycleShape());
    on('refBtn', () => this.toggleReference());
    this.updateBrushBtn();
    this.updateShapeBtn();
    document.getElementById('reference')
      .addEventListener('click', () => document.getElementById('reference').classList.add('hidden'), sig);
    document.getElementById('celebrateClose')
      .addEventListener('click', () => document.getElementById('celebrate').classList.add('hidden'), sig);

    const c = this.canvas;
    c.addEventListener('pointerdown', e => this.onDown(e), sig);
    c.addEventListener('pointermove', e => this.onMove(e), sig);
    c.addEventListener('pointerup', e => this.onUp(e), sig);
    c.addEventListener('pointercancel', e => this.onUp(e), sig);
    c.addEventListener('wheel', e => this.onWheel(e), { passive: false, signal: this.ac.signal });
    window.addEventListener('resize', () => { this.resize(); this.clampOffset(); this.draw(); }, sig);
  }

  setTool(t) {
    this.tool = t;
    document.getElementById('handBtn').classList.toggle('active', t === 'hand');
    document.getElementById('eraseBtn').classList.toggle('active', t === 'erase');
  }

  updateBrushBtn() {
    document.getElementById('brushBadge').textContent = this.brush;
    document.getElementById('brushBtn').classList.toggle('active', this.brush > 1);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.cssW = r.width;
    this.cssH = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.computeScaleBounds();
  }

  // Re-measure and redraw whenever the canvas box changes (orientation change,
  // the mobile address bar showing/hiding, the palette wrapping, etc.).
  observeResize() {
    if (typeof ResizeObserver === 'undefined') return;
    this.ro = new ResizeObserver(() => { this.resize(); this.clampOffset(); this.draw(); });
    this.ro.observe(this.canvas);
  }

  computeScaleBounds() {
    const gw = this.p.cols * CELL, gh = this.p.rows * CELL;
    // minScale shows the whole picture; maxScale allows big, tappable gems.
    this.minScale = Math.min(this.cssW / gw, this.cssH / gh) * 0.95;
    this.maxScale = Math.max(this.minScale * 8, 80 / CELL);
    this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.scale));
  }

  centerGrid() {
    const gw = this.p.cols * CELL, gh = this.p.rows * CELL;
    this.ox = (this.cssW - gw * this.scale) / 2;
    this.oy = (this.cssH - gh * this.scale) / 2;
  }

  // Overview: the entire picture fits on screen.
  fit() {
    this.scale = this.minScale;
    this.centerGrid();
  }

  // Default when opening: zoomed in to a comfortable, tappable size (~14 cells
  // across) centered on the picture — never a tiny unusable thumbnail.
  initialView() {
    const target = this.cssW / (14 * CELL);
    this.scale = Math.max(this.minScale, Math.min(this.maxScale, target));
    this.centerGrid();
    this.clampOffset();
  }

  toggleReference() {
    const ov = document.getElementById('reference');
    const img = document.getElementById('referenceImg');
    if (ov.classList.contains('hidden')) {
      img.src = this.p.thumb;
      ov.classList.remove('hidden');
    } else {
      ov.classList.add('hidden');
    }
  }

  /* ---------- rendering ---------- */

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#161427';
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    const { cols, rows } = this.p;
    const cell = CELL * this.scale;
    const x0 = Math.max(0, Math.floor(-this.ox / cell));
    const y0 = Math.max(0, Math.floor(-this.oy / cell));
    const x1 = Math.min(cols, Math.ceil((this.cssW - this.ox) / cell) + 1);
    const y1 = Math.min(rows, Math.ceil((this.cssH - this.oy) / cell) + 1);
    // Numbers are the costliest part — skip them mid-gesture, restore at rest.
    const showNum = cell >= MIN_LABEL && !this.interacting;

    if (showNum) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.floor(cell * 0.42)}px system-ui, sans-serif`;
    }

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        this.drawCell(ctx, this.ox + x * cell, this.oy + y * cell, cell, y * cols + x, showNum, x, y);
      }
    }
  }

  drawCell(ctx, sx, sy, cell, idx, showNum, cx, cy) {
    const target = this.p.grid[idx];
    const placed = this.p.filled[idx];
    const pad = cell * 0.06;
    const r = cell - pad * 2;

    if (placed >= 0) {
      // Pick one of the varied shades per cell for a subtle ombre across same-color areas.
      const variants = this.gemSprites[placed];
      ctx.drawImage(variants[cellVariant(cx, cy, variants.length)], sx + pad, sy + pad, r, r);
      return;
    }

    const isSel = target === this.selected;
    const col = this.p.palette[target];
    roundRect(ctx, sx + pad, sy + pad, r, r, Math.min(5, cell * 0.18));
    if (isSel) {
      // Highlight: a bright cell waiting for the currently selected color.
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = Math.max(1, cell * 0.07);
      ctx.strokeStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      ctx.stroke();
    } else {
      // Muted: a dimmed tint of the cell's real color so the picture still
      // reads and you keep your bearings, instead of a black-and-white look.
      ctx.fillStyle = mutedColor(col);
      ctx.fill();
    }
    if (showNum) {
      ctx.fillStyle = isSel ? `rgb(${col[0]},${col[1]},${col[2]})` : numberInk(col);
      ctx.fillText(String(target + 1), sx + cell / 2, sy + cell / 2 + cell * 0.03);
    }
  }

  /* ---------- pointer handling ---------- */

  onDown(e) {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.interacting = true;

    if (this.pointers.size >= 2) { this.pinch = null; return; }
    this.lastPaintIdx = -1;
    if (this.tool === 'hand') {
      this.panFrom = { x: e.clientX, y: e.clientY };
    } else {
      this.paintAt(e.clientX, e.clientY);
    }
  }

  onMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size >= 2) { this.handlePinch(); return; }

    if (this.tool === 'hand' && this.panFrom) {
      this.ox += e.clientX - this.panFrom.x;
      this.oy += e.clientY - this.panFrom.y;
      this.panFrom = { x: e.clientX, y: e.clientY };
      this.clampOffset();
      this.scheduleDraw();
    } else if (this.tool !== 'hand') {
      this.paintAt(e.clientX, e.clientY);
    }
  }

  onUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) {
      this.panFrom = null;
      this.lastPaintIdx = -1;
      this.interacting = false;   // gesture over — redraw once with numbers
      this.scheduleDraw();
    }
  }

  handlePinch() {
    const pts = [...this.pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const mx = (pts[0].x + pts[1].x) / 2;
    const my = (pts[0].y + pts[1].y) / 2;
    if (this.pinch) {
      this.zoomAround(dist / this.pinch.dist, mx, my);
      this.ox += mx - this.pinch.mx;
      this.oy += my - this.pinch.my;
      this.clampOffset();
      this.scheduleDraw();
    }
    this.pinch = { dist, mx, my };
  }

  onWheel(e) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    this.zoomAround(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    this.clampOffset();
    // Wheel zoom (desktop) has no gesture end; briefly drop numbers, then restore.
    this.interacting = true;
    this.scheduleDraw();
    clearTimeout(this._wheelIdle);
    this._wheelIdle = setTimeout(() => { this.interacting = false; this.scheduleDraw(); }, 140);
  }

  zoomAround(factor, sx, sy) {
    const ns = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
    const k = ns / this.scale;
    this.ox = sx - (sx - this.ox) * k;
    this.oy = sy - (sy - this.oy) * k;
    this.scale = ns;
  }

  clampOffset() {
    const gw = this.p.cols * CELL * this.scale;
    const gh = this.p.rows * CELL * this.scale;
    const m = 60;
    this.ox = Math.min(this.cssW - m, Math.max(m - gw, this.ox));
    this.oy = Math.min(this.cssH - m, Math.max(m - gh, this.oy));
  }

  /* ---------- placement ---------- */

  cellXYAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const cell = CELL * this.scale;
    const x = Math.floor((clientX - r.left - this.ox) / cell);
    const y = Math.floor((clientY - r.top - this.oy) / cell);
    if (x < 0 || y < 0 || x >= this.p.cols || y >= this.p.rows) return null;
    return { x, y };
  }

  paintAt(clientX, clientY) {
    const c = this.cellXYAt(clientX, clientY);
    if (!c) return;
    const center = c.y * this.p.cols + c.x;
    if (center === this.lastPaintIdx) return;   // still on the same cell, skip
    this.lastPaintIdx = center;

    // Brush footprint: an n×n block of cells centered on the touched cell, so a
    // single tap/wipe can fill several dots at once.
    const lo = -Math.floor((this.brush - 1) / 2);
    const hi = Math.ceil((this.brush - 1) / 2);
    const erase = this.tool === 'erase';
    const changes = [];
    for (let dy = lo; dy <= hi; dy++) {
      const y = c.y + dy;
      if (y < 0 || y >= this.p.rows) continue;
      for (let dx = lo; dx <= hi; dx++) {
        const x = c.x + dx;
        if (x < 0 || x >= this.p.cols) continue;
        const idx = y * this.p.cols + x;
        if (erase) {
          if (this.p.filled[idx] >= 0) { changes.push({ idx, prev: this.p.filled[idx] }); this.p.filled[idx] = -1; }
        } else if (this.p.grid[idx] === this.selected && this.p.filled[idx] < 0) {
          // Only fill cells that match the selected color — no mistakes.
          changes.push({ idx, prev: -1 });
          this.p.filled[idx] = this.selected;
        }
      }
    }
    if (changes.length) {
      this.history.push(changes);   // one undo step per brush dab
      if (!erase) addDotsPlaced(changes.length);   // lifetime stat (placements only)
      this.afterChange();
    }
  }

  undo() {
    const group = this.history.pop();
    if (!group) return;
    // If this group was a placement (cells went from empty), reverse the stat.
    if (group.length && group[0].prev < 0) addDotsPlaced(-group.length);
    for (const c of group) this.p.filled[c.idx] = c.prev;
    this.afterChange();
  }

  afterChange() {
    this.scheduleDraw();
    this.updateProgress();
    this.scheduleSave();
  }

  /* ---------- palette + progress ---------- */

  renderPalette() {
    const bar = document.getElementById('palette');
    bar.innerHTML = '';
    this.swatches = this.p.palette.map((c, i) => {
      const el = document.createElement('button');
      el.className = 'swatch' + (i === this.selected ? ' sel' : '');
      el.innerHTML =
        `<span class="num">${i + 1}</span>` +
        `<span class="chip" style="background:rgb(${c[0]},${c[1]},${c[2]})"></span>` +
        `<span class="left"></span>`;
      el.addEventListener('click', () => this.selectColor(i), { signal: this.ac.signal });
      bar.appendChild(el);
      return el;
    });
  }

  selectColor(i) {
    this.selected = i;
    this.swatches.forEach((el, n) => el.classList.toggle('sel', n === i));
    this.scheduleDraw();
    const el = this.swatches[i];
    if (el) el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  updateProgress() {
    const placedPer = new Array(this.p.palette.length).fill(0);
    let placed = 0;
    for (const v of this.p.filled) if (v >= 0) { placedPer[v]++; placed++; }
    const total = this.p.grid.length;
    const pct = Math.round((placed / total) * 100);
    document.getElementById('progressBar').style.width = pct + '%';
    document.getElementById('progressPct').textContent = pct + '%';

    this.swatches.forEach((el, i) => {
      const left = this.totals[i] - placedPer[i];
      el.querySelector('.left').textContent = left > 0 ? left : '';
      el.classList.toggle('done', left === 0);
    });

    // When the current color is finished, jump to the next unfinished one.
    if (this.totals[this.selected] - placedPer[this.selected] === 0) {
      const next = this.firstUnfinished(placedPer);
      if (next !== this.selected) this.selectColor(next);
    }
    if (placed === total) this.celebrate();
  }

  firstUnfinished(placedPer) {
    const counts = placedPer || (() => {
      const c = new Array(this.p.palette.length).fill(0);
      for (const v of this.p.filled) if (v >= 0) c[v]++;
      return c;
    })();
    for (let i = 0; i < this.p.palette.length; i++) {
      if (this.totals ? this.totals[i] - counts[i] > 0 : true) return i;
    }
    return 0;
  }

  celebrate() {
    const overlay = document.getElementById('celebrate');
    if (!overlay.classList.contains('hidden')) return;
    overlay.classList.remove('hidden');
    runConfetti(document.getElementById('confetti'));
  }

  /* ---------- saving / teardown ---------- */

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => saveProject(this.p), 400);
  }

  flushSave() {
    clearTimeout(this.saveTimer);
    saveProject(this.p);
  }

  destroy() {
    clearTimeout(this.saveTimer);
    clearTimeout(this._wheelIdle);
    cancelAnimationFrame(this._raf);
    this.ac.abort();
    this.ro?.disconnect();
    this.setTool('dot');
    document.getElementById('reference').classList.add('hidden');
  }
}

/* ---------- helpers ---------- */

const MUTE_BASE = [22, 20, 39]; // board background (#161427)

// A dimmed tint of a palette color: keeps the hue (so the picture still reads)
// but blends toward the dark background so highlighted cells clearly stand out.
function mutedColor(col) {
  const t = 0.62;
  const r = Math.round(col[0] * (1 - t) + MUTE_BASE[0] * t);
  const g = Math.round(col[1] * (1 - t) + MUTE_BASE[1] * t);
  const b = Math.round(col[2] * (1 - t) + MUTE_BASE[2] * t);
  return `rgb(${r},${g},${b})`;
}

// A faint, legible number on a muted cell (light ink on dark tints, dark on light).
function numberInk(col) {
  const mutedLum = (0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2]) * 0.38 + 9;
  return mutedLum > 120 ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.4)';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function runConfetti(canvas) {
  const ctx = canvas.getContext('2d');
  canvas.width = innerWidth; canvas.height = innerHeight;
  const colors = ['#ff4d4d', '#ffd84d', '#4dd964', '#4db8ff', '#7c5cff', '#ff6fae'];
  const bits = Array.from({ length: 140 }, () => ({
    x: Math.random() * canvas.width, y: -Math.random() * canvas.height,
    s: 5 + Math.random() * 7, vy: 2 + Math.random() * 4, vx: -2 + Math.random() * 4,
    c: colors[(Math.random() * colors.length) | 0], rot: Math.random() * 7, vr: -0.2 + Math.random() * 0.4,
  }));
  let frames = 0;
  (function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const b of bits) {
      b.x += b.vx; b.y += b.vy; b.rot += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
      ctx.fillStyle = b.c; ctx.fillRect(-b.s / 2, -b.s / 2, b.s, b.s * 0.6); ctx.restore();
    }
    if (++frames < 240) requestAnimationFrame(tick);
  })();
}
