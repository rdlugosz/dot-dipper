// Main controller: home/library screen, the "new picture" flow (upload / AI /
// sample), and routing into the full-screen editor.

import { listProjects, getProject, saveProject, deleteProject, newId, getDotsPlaced } from './storage.js';
import { processImage } from './process.js';
import { SAMPLES, sampleThumb, sampleSource } from './samples.js';
import { generateImage, fileToImage, clipboardToImage } from './ai.js';
import { openEditor } from './editor.js';
import { exportProject, importProject } from './share.js';

const homeView = document.getElementById('home');
const editorView = document.getElementById('editor');
const modal = document.getElementById('newModal');
const modalCard = document.getElementById('newModalCard');
let editor = null;

const SIZES = { Small: 40, Medium: 64, Large: 90 };

/* ---------- routing ---------- */

function showHome() {
  if (editor) { editor.destroy(); editor = null; }
  editorView.classList.add('hidden');
  homeView.classList.remove('hidden');
  renderHome();
}

function openProject(id) {
  const p = getProject(id);
  if (!p) return;
  homeView.classList.add('hidden');
  editorView.classList.remove('hidden');
  editor = openEditor(p, showHome);
  editor.draw();
}

function renderHome() {
  const list = listProjects();
  const grid = document.getElementById('projectList');
  grid.innerHTML = '';

  const dots = getDotsPlaced();
  document.getElementById('dotStat').textContent = `💎 ${dots.toLocaleString()} dots placed`;

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <div class="big">🎨</div>
      <p>No pictures yet.<br>Tap the <b>＋</b> button to start your first one!</p>
    </div>`;
    return;
  }

  for (const p of list) {
    const pct = Math.round((p.placed / p.total) * 100);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <img class="thumb" src="${p.thumb}" alt="">
      <button class="menu-btn" aria-label="Options">⋯</button>
      <div class="meta">
        <div class="name">${escapeHtml(p.name)}</div>
        <div class="sub">${p.cols}×${p.rows} · ${pct}% done</div>
        <div class="mini-track"><div class="mini-bar" style="width:${pct}%"></div></div>
      </div>`;
    card.addEventListener('click', () => openProject(p.id));
    card.querySelector('.menu-btn').addEventListener('click', e => {
      e.stopPropagation();
      openCardMenu(p);
    });
    grid.appendChild(card);
  }
}

/* ---------- gallery item actions (rename / export / delete) ---------- */

// A small standalone modal overlay (separate from the new-project dialog).
function showModal(build) {
  const ov = document.createElement('div');
  ov.className = 'modal';
  const card = document.createElement('div');
  card.className = 'modal-card';
  ov.appendChild(card);
  const close = () => ov.remove();
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  build(card, close);
  document.body.appendChild(ov);
}

function openCardMenu(p) {
  showModal((card, close) => {
    card.innerHTML = `
      <h2>${escapeHtml(p.name)}</h2>
      <button class="btn-primary" data-a="open">Open</button>
      <button class="btn-ghost" data-a="rename">✏️ Rename</button>
      <button class="btn-ghost" data-a="export">📤 Export / share</button>
      <button class="btn-ghost danger" data-a="delete">🗑 Delete</button>
      <button class="btn-ghost" data-a="cancel">Cancel</button>`;
    const act = (a, fn) => { card.querySelector(`[data-a=${a}]`).onclick = fn; };
    act('open', () => { close(); openProject(p.id); });
    act('rename', () => { close(); renameProject(p.id); });
    act('export', () => { close(); exportDialog(p.id); });
    act('delete', () => {
      close();
      if (confirm(`Delete "${p.name}"? This can't be undone.`)) { deleteProject(p.id); renderHome(); }
    });
    act('cancel', close);
  });
}

function renameProject(id) {
  const p = getProject(id);
  if (!p) return;
  const name = prompt('Rename picture:', p.name);
  if (name && name.trim()) { p.name = name.trim(); saveProject(p); renderHome(); }
}

function exportDialog(id) {
  const p = getProject(id);
  if (!p) return;
  const code = exportProject(p);
  showModal((card, close) => {
    card.innerHTML = `
      <h2>Share "${escapeHtml(p.name)}"</h2>
      <p class="hint">Copy this code, then on another device tap ＋ → "Import a code" and paste it.</p>
      <textarea id="expCode" class="codebox" readonly></textarea>
      <button class="btn-primary" id="copyCode">📋 Copy code</button>
      <button class="btn-ghost" id="closeExp">Close</button>`;
    const ta = card.querySelector('#expCode');
    ta.value = code;
    card.querySelector('#copyCode').onclick = async () => {
      try { await navigator.clipboard.writeText(code); }
      catch { ta.select(); document.execCommand('copy'); }
      card.querySelector('#copyCode').textContent = '✓ Copied!';
    };
    card.querySelector('#closeExp').onclick = close;
  });
}

/* ---------- new project flow ---------- */

const state = { source: null, name: '', size: 'Medium', colors: 16 };
let previewTimer = null;

function openNewModal() {
  state.source = null;
  state.name = '';
  state.size = 'Medium';
  state.colors = 16;
  modal.classList.remove('hidden');
  document.addEventListener('paste', onPasteEvent);
  renderSourceStep();
}

function closeModal() {
  modal.classList.add('hidden');
  modalCard.innerHTML = '';
  document.removeEventListener('paste', onPasteEvent);
}

// Desktop convenience: Ctrl/Cmd+V anywhere in the dialog grabs a copied image.
function onPasteEvent(e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const it of items) {
    if (it.type && it.type.startsWith('image/')) {
      const file = it.getAsFile();
      if (!file) return;
      e.preventDefault();
      fileToImage(file)
        .then(img => { state.source = img; state.name = 'Pasted image'; renderConfigStep(); })
        .catch(err => alert(err.message));
      return;
    }
  }
}

async function pickClipboard() {
  try {
    state.source = await clipboardToImage();
    state.name = 'Pasted image';
    renderConfigStep();
  } catch (e) {
    alert(e.message);
  }
}

function renderSourceStep() {
  modalCard.innerHTML = `
    <h2>New picture</h2>
    <p class="hint">Where should it come from?</p>
    <div class="source-row">
      <button class="source-btn" data-s="upload"><span class="ico">📷</span>Upload photo</button>
      <button class="source-btn" data-s="paste"><span class="ico">📋</span>Paste image</button>
      <button class="source-btn" data-s="ai"><span class="ico">✨</span>AI image</button>
      <button class="source-btn" data-s="sample"><span class="ico">🖼️</span>Samples</button>
    </div>
    <button class="btn-ghost" id="importBtn">📥 Import a code</button>
    <button class="btn-ghost" id="cancelNew">Cancel</button>`;
  modalCard.querySelector('[data-s=upload]').onclick = pickUpload;
  modalCard.querySelector('[data-s=paste]').onclick = pickClipboard;
  modalCard.querySelector('[data-s=ai]').onclick = renderAiStep;
  modalCard.querySelector('[data-s=sample]').onclick = renderSampleStep;
  modalCard.querySelector('#importBtn').onclick = renderImportStep;
  modalCard.querySelector('#cancelNew').onclick = closeModal;
}

function renderImportStep() {
  modalCard.innerHTML = `
    <h2>📥 Import a picture</h2>
    <p class="hint">Paste a code that was shared from another device.</p>
    <div class="field"><textarea id="impCode" class="codebox" placeholder="DOTDIP1:…"></textarea></div>
    <div id="impErr" class="error"></div>
    <button class="btn-primary" id="doImport">Import</button>
    <button class="btn-ghost" id="backSrc">Back</button>`;
  modalCard.querySelector('#backSrc').onclick = renderSourceStep;
  modalCard.querySelector('#doImport').onclick = () => {
    try {
      const p = importProject(modalCard.querySelector('#impCode').value);
      p.id = newId();
      saveProject(p);
      closeModal();
      openProject(p.id);
    } catch (e) {
      modalCard.querySelector('#impErr').textContent = e.message;
    }
  };
}

function pickUpload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    if (!input.files[0]) return;
    try {
      const img = await fileToImage(input.files[0]);
      state.source = img;
      state.name = cleanName(input.files[0].name) || 'My photo';
      renderConfigStep();
    } catch (e) { alert(e.message); }
  };
  input.click();
}

function renderAiStep() {
  modalCard.innerHTML = `
    <h2>✨ Make an AI picture</h2>
    <p class="hint">Describe what you'd like to see.</p>
    <div class="field">
      <input type="text" id="aiPrompt" placeholder="a happy rainbow unicorn" autocomplete="off">
    </div>
    <button class="btn-primary" id="genBtn">Generate</button>
    <div id="aiStatus"></div>
    <button class="btn-ghost" id="backSrc">Back</button>
    <p class="note">Images come from a free public AI service (Pollinations.ai) with its
    safe filter on. It's rate-limited (about one picture every 15s) and may add a small
    watermark, so it can be slow or busy — just try again, or use a photo / sample.
    It's not a closed garden, so a grown-up should glance at results.</p>`;
  const prompt = modalCard.querySelector('#aiPrompt');
  modalCard.querySelector('#backSrc').onclick = renderSourceStep;
  modalCard.querySelector('#genBtn').onclick = async () => {
    const text = prompt.value.trim();
    if (!text) { prompt.focus(); return; }
    const status = modalCard.querySelector('#aiStatus');
    status.innerHTML = `<div class="field" style="display:flex;align-items:center;gap:12px">
      <div class="spinner"></div><span>Generating… this can take 10–30s.</span></div>`;
    modalCard.querySelector('#genBtn').disabled = true;
    try {
      state.source = await generateImage(text);
      state.name = text.slice(0, 28);
      renderConfigStep();
    } catch (e) {
      const busy = e && e.code === 'rate';
      status.innerHTML = `<div class="error">${busy
        ? 'The free AI service is busy (it only allows one picture every several seconds). Wait a few seconds and tap Generate again — or use a photo / sample.'
        : "Couldn't generate that image. Check the connection and try again, or use a photo / sample."}</div>`;
      modalCard.querySelector('#genBtn').disabled = false;
    }
  };
  prompt.focus();
}

function renderSampleStep() {
  modalCard.innerHTML = `
    <h2>🖼️ Pick a sample</h2>
    <p class="hint">Tap one to use it.</p>
    <div class="sample-grid" id="sampleGrid"></div>
    <button class="btn-ghost" id="backSrc">Back</button>`;
  modalCard.querySelector('#backSrc').onclick = renderSourceStep;
  const grid = modalCard.querySelector('#sampleGrid');
  for (const s of SAMPLES) {
    const c = document.createElement('canvas');
    c.width = c.height = 120;
    c.title = s.name;
    c.onclick = async () => {
      try {
        state.source = await sampleSource(s);
        state.name = s.name;
        renderConfigStep();
      } catch (e) { alert(e.message); }
    };
    grid.appendChild(c);
    sampleThumb(s, 120).then(tc => c.getContext('2d').drawImage(tc, 0, 0)).catch(() => {});
  }
}

function renderConfigStep() {
  modalCard.innerHTML = `
    <h2>Get it ready</h2>
    <div class="preview-box" id="previewBox"><div class="spinner"></div></div>
    <div class="field">
      <label>Name</label>
      <input type="text" id="nameInput" value="${escapeAttr(state.name)}">
    </div>
    <div class="field">
      <label>Size (how many dots)</label>
      <div class="seg" id="sizeSeg">
        ${Object.keys(SIZES).map(k => `<button data-k="${k}" class="${k === state.size ? 'on' : ''}">${k}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Number of colors: <b id="colorVal">${state.colors}</b></label>
      <input type="range" id="colorRange" min="6" max="28" value="${state.colors}">
    </div>
    <button class="btn-primary" id="createBtn">Create &amp; play</button>
    <button class="btn-ghost" id="backSrc">Start over</button>`;

  modalCard.querySelector('#backSrc').onclick = renderSourceStep;
  modalCard.querySelector('#nameInput').oninput = e => { state.name = e.target.value; };
  modalCard.querySelectorAll('#sizeSeg button').forEach(b => {
    b.onclick = () => {
      state.size = b.dataset.k;
      modalCard.querySelectorAll('#sizeSeg button').forEach(x => x.classList.toggle('on', x === b));
      refreshPreview();
    };
  });
  const range = modalCard.querySelector('#colorRange');
  range.oninput = e => {
    state.colors = +e.target.value;
    modalCard.querySelector('#colorVal').textContent = state.colors;
    refreshPreview();
  };
  modalCard.querySelector('#createBtn').onclick = createProject;
  refreshPreview();
}

function refreshPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    try {
      const r = processImage(state.source, { targetWidth: SIZES[state.size], numColors: state.colors });
      state.processed = r;
      const box = document.getElementById('previewBox');
      if (box) box.innerHTML = `<img src="${r.thumb}" alt="preview">`;
    } catch (e) {
      const box = document.getElementById('previewBox');
      if (box) box.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
      state.processed = null;
    }
  }, 120);
}

function createProject() {
  if (!state.processed) return;
  const r = state.processed;
  const project = {
    id: newId(),
    name: (state.name || 'Untitled').trim() || 'Untitled',
    createdAt: Date.now(),
    cols: r.cols, rows: r.rows,
    palette: r.palette, grid: r.grid,
    filled: new Array(r.grid.length).fill(-1),
    thumb: r.thumb,
  };
  saveProject(project);
  closeModal();
  openProject(project.id);
}

/* ---------- utils ---------- */

function cleanName(filename) {
  return filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 28);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

/* ---------- update checks (for installed PWAs that can't easily refresh) ---------- */

// version.json is written at deploy time with the build's git SHA. We remember
// the version we loaded with, then re-check on focus and on an interval; if the
// deployed version differs, we offer a gentle "Refresh" banner.
let loadedVersion = null;

async function fetchVersion() {
  try {
    const r = await fetch('version.json', { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()).version || null;
  } catch { return null; }
}

async function checkForUpdate() {
  const v = await fetchVersion();
  if (v && loadedVersion && v !== loadedVersion) showUpdateBanner();
}

function showUpdateBanner() {
  if (document.getElementById('updateBanner')) return;
  const el = document.createElement('div');
  el.id = 'updateBanner';
  el.className = 'update-banner';
  el.innerHTML = `<span>✨ Update ready</span>
    <button id="updateRefresh">Refresh</button>
    <button id="updateDismiss" aria-label="Dismiss">✕</button>`;
  el.querySelector('#updateRefresh').onclick = async () => {
    try { editor?.flushSave?.(); } catch {}
    try { (await navigator.serviceWorker?.getRegistration())?.update(); } catch {}
    location.reload();
  };
  el.querySelector('#updateDismiss').onclick = () => el.remove();
  document.body.appendChild(el);
}

async function initUpdateChecks() {
  loadedVersion = await fetchVersion();
  if (!loadedVersion) return; // no version stamp (e.g. local dev) → nothing to compare
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  setInterval(checkForUpdate, 15 * 60 * 1000);
}

/* ---------- "install as app" prompt ---------- */

let deferredInstall = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
function isIOS() {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function setupInstall() {
  const btn = document.getElementById('installBtn');
  if (!btn || isStandalone()) return;   // already installed → nothing to do

  // Chrome/Edge/Android: capture the native prompt and show our button.
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstall = e;
    btn.classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    btn.classList.add('hidden');
  });
  // iOS Safari has no install API — show the button so we can give instructions.
  if (isIOS()) btn.classList.remove('hidden');

  btn.onclick = async () => {
    if (deferredInstall) {
      deferredInstall.prompt();
      const { outcome } = await deferredInstall.userChoice;
      deferredInstall = null;
      if (outcome === 'accepted') btn.classList.add('hidden');
    } else {
      showInstallHelp();
    }
  };
}

function showInstallHelp() {
  showModal((card, close) => {
    const ios = isIOS();
    card.innerHTML = `
      <h2>📲 Install Dot Dipper</h2>
      <p class="hint">Add it to your home screen to play like a real app — full screen and offline.</p>
      ${ios
        ? `<p>1. Tap the <b>Share</b> button (the square with an ↑) in Safari's toolbar.<br>
             2. Choose <b>Add to Home Screen</b>.<br>
             3. Tap <b>Add</b>.</p>`
        : `<p>Open your browser's menu (⋮) and choose <b>Install app</b> / <b>Add to Home screen</b>.</p>`}
      <button class="btn-primary" id="installOk">Got it</button>`;
    card.querySelector('#installOk').onclick = close;
  });
}

/* ---------- boot ---------- */

document.getElementById('newBtn').addEventListener('click', openNewModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

renderHome();
setupInstall();
initUpdateChecks();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
