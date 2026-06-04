// Built-in sample pictures. Most are drawn on a canvas at runtime from flat
// shapes/gradients; some are bundled photos (data URLs). All work fully offline.

import { DOG, EYE } from './sample-images.js';

function make(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  return c;
}

function bg(ctx, s, color) { ctx.fillStyle = color; ctx.fillRect(0, 0, s, s); }

export const SAMPLES = [
  { name: 'Puppy', src: DOG },   // bundled photo samples
  { name: 'Eye', src: EYE },
  {
    name: 'Rainbow',
    build: s => make(s, (ctx, S) => {
      bg(ctx, S, '#bfe9ff');
      const colors = ['#ff4d4d', '#ff944d', '#ffe14d', '#4dd964', '#4db8ff', '#7c5cff', '#c66bff'];
      ctx.lineWidth = S * 0.05;
      colors.forEach((col, i) => {
        ctx.beginPath();
        ctx.strokeStyle = col;
        ctx.arc(S * 0.5, S * 0.95, S * (0.62 - i * 0.075), Math.PI, 0);
        ctx.stroke();
      });
      ctx.fillStyle = '#ffd84d';
      ctx.beginPath(); ctx.arc(S * 0.82, S * 0.2, S * 0.1, 0, 7); ctx.fill();
    }),
  },
  {
    name: 'Heart',
    build: s => make(s, (ctx, S) => {
      bg(ctx, S, '#ffd3e6');
      ctx.fillStyle = '#ff3d77';
      ctx.beginPath();
      const x = S / 2, y = S * 0.36, w = S * 0.42;
      ctx.moveTo(x, y + w * 0.3);
      ctx.bezierCurveTo(x, y, x - w, y - w * 0.1, x - w, y + w * 0.35);
      ctx.bezierCurveTo(x - w, y + w * 0.8, x - w * 0.4, y + w * 1.1, x, y + w * 1.5);
      ctx.bezierCurveTo(x + w * 0.4, y + w * 1.1, x + w, y + w * 0.8, x + w, y + w * 0.35);
      ctx.bezierCurveTo(x + w, y - w * 0.1, x, y, x, y + w * 0.3);
      ctx.fill();
    }),
  },
  {
    name: 'Flower',
    build: s => make(s, (ctx, S) => {
      bg(ctx, S, '#dff6e3');
      ctx.strokeStyle = '#3aa757'; ctx.lineWidth = S * 0.04;
      ctx.beginPath(); ctx.moveTo(S * 0.5, S * 0.95); ctx.lineTo(S * 0.5, S * 0.55); ctx.stroke();
      ctx.fillStyle = '#ff7ab8';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(S * 0.5 + Math.cos(a) * S * 0.17, S * 0.4 + Math.sin(a) * S * 0.17,
          S * 0.12, S * 0.12, 0, 0, 7);
        ctx.fill();
      }
      ctx.fillStyle = '#ffd84d';
      ctx.beginPath(); ctx.arc(S * 0.5, S * 0.4, S * 0.1, 0, 7); ctx.fill();
    }),
  },
  {
    name: 'Butterfly',
    build: s => make(s, (ctx, S) => {
      bg(ctx, S, '#eef0ff');
      const wing = (dx, col) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(S * 0.5 + dx * S * 0.2, S * 0.36, S * 0.18, S * 0.14, dx * 0.5, 0, 7); ctx.fill();
        ctx.beginPath();
        ctx.ellipse(S * 0.5 + dx * S * 0.18, S * 0.62, S * 0.14, S * 0.16, -dx * 0.5, 0, 7); ctx.fill();
      };
      wing(-1, '#7c5cff'); wing(1, '#ff6fae');
      ctx.fillStyle = '#2a2740';
      ctx.fillRect(S * 0.48, S * 0.28, S * 0.04, S * 0.42);
    }),
  },
  {
    name: 'Star',
    build: s => make(s, (ctx, S) => {
      bg(ctx, S, '#141233');
      ctx.fillStyle = '#ffd84d';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? S * 0.16 : S * 0.38;
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const fn = i ? 'lineTo' : 'moveTo';
        ctx[fn](S * 0.5 + Math.cos(a) * r, S * 0.5 + Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
    }),
  },
  {
    name: 'Smiley',
    build: s => make(s, (ctx, S) => {
      bg(ctx, S, '#7c5cff');
      ctx.fillStyle = '#ffd84d';
      ctx.beginPath(); ctx.arc(S * 0.5, S * 0.5, S * 0.36, 0, 7); ctx.fill();
      ctx.fillStyle = '#2a2740';
      ctx.beginPath(); ctx.arc(S * 0.38, S * 0.42, S * 0.05, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(S * 0.62, S * 0.42, S * 0.05, 0, 7); ctx.fill();
      ctx.lineWidth = S * 0.05; ctx.strokeStyle = '#2a2740';
      ctx.beginPath(); ctx.arc(S * 0.5, S * 0.52, S * 0.18, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
    }),
  },
];

// ---- accessors (handle both vector and photo samples) ----

const imgCache = {};
function loadImage(src) {
  if (!imgCache[src]) {
    imgCache[src] = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load sample image.'));
      img.src = src;
    });
  }
  return imgCache[src];
}

// A square thumbnail for the picker (photos are center-cropped to fill).
export async function sampleThumb(sample, size) {
  if (sample.build) return sample.build(size);
  const img = await loadImage(sample.src);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const s = Math.max(size / img.naturalWidth, size / img.naturalHeight);
  const w = img.naturalWidth * s, h = img.naturalHeight * s;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return c;
}

// The source passed to image processing: a photo keeps its real aspect ratio;
// a vector sample is rendered to a square canvas.
export async function sampleSource(sample) {
  if (sample.build) return sample.build(420);
  return loadImage(sample.src);
}
