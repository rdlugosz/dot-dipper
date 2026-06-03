// Main controller: home/library screen, the "new picture" flow (upload / AI /
// sample), and routing into the full-screen editor.

import { listProjects, getProject, saveProject, deleteProject, newId } from './storage.js';
import { processImage } from './process.js';
import { SAMPLES, sampleThumb, sampleSource } from './samples.js';
import { generateImage, fileToImage, clipboardToImage } from './ai.js';
import { openEditor } from './editor.js';

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
      <button class="del" aria-label="Delete">🗑</button>
      <div class="meta">
        <div class="name">${escapeHtml(p.name)}</div>
        <div class="sub">${p.cols}×${p.rows} · ${pct}% done</div>
        <div class="mini-track"><div class="mini-bar" style="width:${pct}%"></div></div>
      </div>`;
    card.addEventListener('click', () => openProject(p.id));
    card.querySelector('.del').addEventListener('click', e => {
      e.stopPropagation();
      if (confirm(`Delete "${p.name}"? This can't be undone.`)) { deleteProject(p.id); renderHome(); }
    });
    grid.appendChild(card);
  }
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
    <button class="btn-ghost" id="cancelNew">Cancel</button>`;
  modalCard.querySelector('[data-s=upload]').onclick = pickUpload;
  modalCard.querySelector('[data-s=paste]').onclick = pickClipboard;
  modalCard.querySelector('[data-s=ai]').onclick = renderAiStep;
  modalCard.querySelector('[data-s=sample]').onclick = renderSampleStep;
  modalCard.querySelector('#cancelNew').onclick = closeModal;
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

/* ---------- boot ---------- */

document.getElementById('newBtn').addEventListener('click', openNewModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

renderHome();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
