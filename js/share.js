// Export/import a project as a shareable code (no backend).
//
// Two forms, both understood by decodeShared():
//   • Text code  "DOTDIP1:<base64 JSON>"  — used by "Export progress" (copy/paste).
//   • URL payload "<z|j><base64url>"       — used by "Share pattern" links; "z" is
//                                            gzip-compressed (much shorter), "j" plain.
// The grid and progress are packed as bytes (one palette index per cell).

import { makeThumb } from './process.js';

const PREFIX = 'DOTDIP1:';
const EMPTY = 255; // marks an un-placed cell in the progress bytes

/* ---- base64 helpers ---- */
function bytesToB64(nums) {
  const u = Uint8Array.from(nums);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
const b64Utf8 = str => btoa(unescape(encodeURIComponent(str)));
const utf8FromB64 = b64 => decodeURIComponent(escape(atob(b64)));
const toB64url = b64 => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = u => { u = u.replace(/-/g, '+').replace(/_/g, '/'); while (u.length % 4) u += '='; return u; };

/* ---- project <-> object ---- */
function projectObject(p, includeProgress) {
  const obj = { v: 1, name: p.name, cols: p.cols, rows: p.rows, palette: p.palette, g: bytesToB64(p.grid) };
  if (includeProgress) obj.f = bytesToB64(p.filled.map(v => (v < 0 ? EMPTY : v)));
  return obj;
}

function objToProject(obj) {
  if (obj.v !== 1 || !obj.cols || !obj.rows || !Array.isArray(obj.palette) || !obj.g) {
    throw new Error('This code is unsupported or corrupt.');
  }
  const grid = Array.from(b64ToBytes(obj.g));
  if (grid.length !== obj.cols * obj.rows) throw new Error('This code is corrupt (size mismatch).');
  const fb = obj.f ? Array.from(b64ToBytes(obj.f)) : [];
  const filled = fb.length === grid.length ? fb.map(v => (v === EMPTY ? -1 : v)) : new Array(grid.length).fill(-1);
  return {
    name: obj.name || 'Imported picture', createdAt: Date.now(),
    cols: obj.cols, rows: obj.rows, palette: obj.palette, grid, filled,
    thumb: makeThumb(obj.cols, obj.rows, grid, obj.palette),
  };
}

/* ---- gzip (optional; falls back to uncompressed where unsupported) ---- */
async function gzip(str) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}
function bytesToB64url(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return toB64url(btoa(s));
}

/* ---- public API ---- */

// Copy/paste text code, including current progress (for moving between devices).
export function exportProject(p) {
  return PREFIX + b64Utf8(JSON.stringify(projectObject(p, true)));
}

// Compact payload for a shareable link — a blank pattern (no progress), gzipped.
export async function encodePatternPayload(p) {
  const json = JSON.stringify(projectObject(p, false));
  const gz = await gzip(json);
  return gz ? 'z' + bytesToB64url(gz) : 'j' + toB64url(b64Utf8(json));
}

// Accepts a link (with #pat=…), a raw URL payload, or a DOTDIP1 code → project (no id).
export async function decodeShared(input) {
  let s = (input || '').trim();
  const m = s.match(/[#?&]pat=([^#&\s]+)/);
  if (m) s = decodeURIComponent(m[1]);

  if (s[0] === 'z' || s[0] === 'j') {
    const body = fromB64url(s.slice(1));
    const json = s[0] === 'z'
      ? await gunzip(b64ToBytes(body))
      : utf8FromB64(body);
    return objToProject(JSON.parse(json));
  }
  const idx = s.indexOf(PREFIX);
  if (idx < 0) throw new Error("That doesn't look like a Dot Dipper link or code.");
  return objToProject(JSON.parse(utf8FromB64(s.slice(idx + PREFIX.length))));
}
