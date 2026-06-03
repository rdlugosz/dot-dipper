// Simple localStorage-backed project store. Projects are compact: a palette,
// a per-cell target index grid, and a per-cell "filled" progress array.

const INDEX_KEY = 'dotdipper.index';
const key = id => `dotdipper.project.${id}`;
const DOTS_KEY = 'dotdipper.dotsPlaced'; // lifetime count of dots placed

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function ids() {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]'); }
  catch { return []; }
}

export function getProject(id) {
  const raw = localStorage.getItem(key(id));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function saveProject(p) {
  p.updatedAt = Date.now();
  localStorage.setItem(key(p.id), JSON.stringify(p));
  const list = ids();
  if (!list.includes(p.id)) {
    list.push(p.id);
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  }
}

export function deleteProject(id) {
  localStorage.removeItem(key(id));
  localStorage.setItem(INDEX_KEY, JSON.stringify(ids().filter(x => x !== id)));
}

// Lightweight metadata for the home screen (avoids parsing full grids twice).
export function listProjects() {
  const out = [];
  for (const id of ids()) {
    const p = getProject(id);
    if (!p) continue;
    let placed = 0;
    for (const v of p.filled) if (v >= 0) placed++;
    out.push({
      id: p.id, name: p.name, thumb: p.thumb,
      cols: p.cols, rows: p.rows,
      total: p.grid.length, placed,
      updatedAt: p.updatedAt || p.createdAt,
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/* ---------- lifetime "dots placed" stat ---------- */

// Returns the running total of dots placed. The first time it's read, it is
// seeded from the dots already placed across existing projects so current work
// counts. Stored separately from projects (no save-format change).
export function getDotsPlaced() {
  const raw = localStorage.getItem(DOTS_KEY);
  if (raw === null) {
    let total = 0;
    for (const id of ids()) {
      const p = getProject(id);
      if (p && p.filled) for (const v of p.filled) if (v >= 0) total++;
    }
    localStorage.setItem(DOTS_KEY, String(total));
    return total;
  }
  return parseInt(raw, 10) || 0;
}

export function addDotsPlaced(n) {
  const next = Math.max(0, getDotsPlaced() + n);
  localStorage.setItem(DOTS_KEY, String(next));
  return next;
}

