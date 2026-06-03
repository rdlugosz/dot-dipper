// Export/import a project as a single shareable text code, so a picture can be
// moved between devices by copy/paste (no backend). The grid and progress are
// packed as bytes (one palette index per cell) to keep the code compact, then
// the whole thing is base64-encoded behind a small prefix.

import { makeThumb } from './process.js';

const PREFIX = 'DOTDIP1:';
const EMPTY = 255; // marks an un-placed cell in the progress bytes

function bytesToB64(nums) {
  const u = Uint8Array.from(nums);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  }
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

export function exportProject(p) {
  const obj = {
    v: 1,
    name: p.name,
    cols: p.cols,
    rows: p.rows,
    palette: p.palette,
    g: bytesToB64(p.grid),
    f: bytesToB64(p.filled.map(v => (v < 0 ? EMPTY : v))),
  };
  return PREFIX + b64Utf8(JSON.stringify(obj));
}

// Parses a code into a project object WITHOUT an id (caller assigns one).
export function importProject(code) {
  const trimmed = (code || '').trim();
  if (!trimmed.startsWith(PREFIX)) {
    throw new Error("That doesn't look like a Dot Dipper code.");
  }
  let obj;
  try {
    obj = JSON.parse(utf8FromB64(trimmed.slice(PREFIX.length)));
  } catch {
    throw new Error("Couldn't read that code — it may be incomplete.");
  }
  if (obj.v !== 1 || !obj.cols || !obj.rows || !Array.isArray(obj.palette) || !obj.g) {
    throw new Error('This code is unsupported or corrupt.');
  }
  const grid = Array.from(b64ToBytes(obj.g));
  if (grid.length !== obj.cols * obj.rows) {
    throw new Error('This code is corrupt (size mismatch).');
  }
  const fbytes = obj.f ? Array.from(b64ToBytes(obj.f)) : [];
  const filled = fbytes.length === grid.length
    ? fbytes.map(v => (v === EMPTY ? -1 : v))
    : new Array(grid.length).fill(-1);

  return {
    name: obj.name || 'Imported picture',
    createdAt: Date.now(),
    cols: obj.cols,
    rows: obj.rows,
    palette: obj.palette,
    grid,
    filled,
    thumb: makeThumb(obj.cols, obj.rows, grid, obj.palette),
  };
}
