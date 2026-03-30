/**
 * SLATE — app.js
 * Full implementation per formal feature specification.
 * Free-form spatially-positioned writing, 3-spread DOM,
 * strict device separation, PWA, autosave, undo, gallery.
 */
'use strict';

/* ═══════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════ */
const STORAGE_KEY    = 'slate_v2';
const BASE_LINE_H    = 32;   // base line height px
const ZOOM_STEP      = 2;    // px per zoom level
const MIN_ZOOM       = -4;
const MAX_ZOOM       = 6;
const LINE_OFFSET_D  = 56;
const LINE_OFFSET_M  = 52;
const MARGIN_LEFT_D  = 68;
const MARGIN_LEFT_M  = 40;
const PROX_Y_ROWS    = 1;    // row proximity
const PROX_X_FRAC    = 0.30; // col fraction proximity
const PINCH_THRESH   = 60;
const SWIPE_VEL      = 0.28;
const SWIPE_PCT      = 0.22;
const SPREAD_DUR     = 320;
const AUTOSAVE_MS    = 900;
const UNDO_LIMIT     = 50;

/* ═══════════════════════════════════════════════════════════
   DEVICE DETECTION — locked at boot, strictly enforced
═══════════════════════════════════════════════════════════ */
const IS_MOBILE = (() => {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const narrow = window.innerWidth < 768;
  return coarse || narrow;
})();

/* ═══════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════ */
const state = {
  pages:       [],
  spreadIdx:   0,
  view:        'notebook',
  undoStack:   [],
  user:        null,
  online:      navigator.onLine,
  saveTimer:   null,
  animating:   false,
  zoomLevel:   0,
  mode:        'text',   // 'text' | 'checklist' | 'draw'
  drawColor:   '#1a1a1a',
  drawWidth:   2,
  activeStyle: { font: 'serif', italic: false, underline: false, color: '#1a1a1a' },
  activeBlockId: null,   // only one block editable at a time
};

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function formatDate(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(isoStr) {
  const d = new Date(isoStr), now = new Date();
  const diff = now - d;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (d.toDateString() === now.toDateString()) return 'Today';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function monthKey(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function pagesPerSpread() { return IS_MOBILE ? 1 : 2; }

function spreadCount() {
  return Math.max(1, Math.ceil(state.pages.length / pagesPerSpread()));
}

function pageIndicesForSpread(si) {
  const pps = pagesPerSpread();
  const base = si * pps;
  return IS_MOBILE ? [base] : [base, base + 1];
}

function lineOffset()  { return IS_MOBILE ? LINE_OFFSET_M : LINE_OFFSET_D; }
function marginLeft()  { return IS_MOBILE ? MARGIN_LEFT_M : MARGIN_LEFT_D; }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function currentLineH() {
  return Math.max(16, BASE_LINE_H + state.zoomLevel * ZOOM_STEP);
}

function snapY(rawY) {
  const lo = lineOffset(), lh = currentLineH();
  if (rawY < lo) return lo;
  return lo + Math.round((rawY - lo) / lh) * lh;
}

function toGrid(relX, relY, pw) {
  const lh = currentLineH(), lo = lineOffset();
  return {
    row: Math.max(0, Math.round((relY - lo) / lh)),
    col: Math.max(0, Math.min(0.98, relX / Math.max(1, pw))),
  };
}

function toPixel(row, col, pw) {
  return { x: col * pw, y: lineOffset() + row * currentLineH() };
}

function pageTextContent(page) {
  return page.elements.map(e => {
    const d = document.createElement('div');
    d.innerHTML = e.content || '';
    return d.textContent || '';
  }).join(' ').trim();
}

/* ═══════════════════════════════════════════════════════════
   PERSISTENCE
═══════════════════════════════════════════════════════════ */
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Invalid');
    const estW = window.innerWidth / (IS_MOBILE ? 1 : 2);
    parsed.forEach(page => {
      if (!page.checklists) page.checklists = [];
      if (!page.drawings)   page.drawings   = [];
      if (page.zoomLevel === undefined) page.zoomLevel = 0;
      page.elements = (page.elements || []).map(el => {
        if ('row' in el) return el;
        const loV = IS_MOBILE ? LINE_OFFSET_M : LINE_OFFSET_D;
        return {
          id: el.id, content: el.content || '', style: el.style || null,
          row: Math.max(0, Math.round(((el.y || 0) - loV) / BASE_LINE_H)),
          col: Math.max(0, Math.min(0.98, (el.x || 0) / Math.max(1, estW))),
        };
      });
    });
    state.pages = parsed;
  } catch (e) {
    console.warn('[Slate] Load failed:', e);
    state.pages = [];
    toast('Storage error — starting fresh', 'err');
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.pages));
    setSyncStatus('saved');
  } catch (e) {
    toast('Failed to save', 'err');
  }
}

function triggerSave() {
  setSyncStatus('saving');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    pushUndo();
    saveData();
  }, AUTOSAVE_MS);
}

function exportJSON() {
  try {
    const blob = new Blob([JSON.stringify(state.pages, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `slate-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Notes exported', 'ok');
  } catch (e) {
    toast('Export failed', 'err');
  }
}

/* ═══════════════════════════════════════════════════════════
   UNDO
═══════════════════════════════════════════════════════════ */
function pushUndo() {
  const snap = JSON.stringify(state.pages);
  if (state.undoStack.length && state.undoStack[state.undoStack.length - 1] === snap) return;
  state.undoStack.push(snap);
  if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
}

function undo() {
  if (state.undoStack.length < 2) return;
  state.undoStack.pop(); // discard current
  const prev = state.undoStack[state.undoStack.length - 1];
  state.pages = JSON.parse(prev);
  saveData();
  renderSpreads();
  toast('Undo');
}

/* ═══════════════════════════════════════════════════════════
   SYNC STATUS UI
═══════════════════════════════════════════════════════════ */
function setSyncStatus(status) {
  const pill  = document.getElementById('sync-pill');
  const label = pill.querySelector('.sync-text');
  if (!state.online) {
    pill.className = 'sync-pill offline';
    label.textContent = 'Offline';
    return;
  }
  pill.className = status === 'saving' ? 'sync-pill saving' : 'sync-pill';
  label.textContent = status === 'saving' ? 'Saving…' : 'Saved';
}

/* ═══════════════════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════════════════ */
function toast(msg, type = '') {
  const c  = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`.trim();
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 300ms';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 2400);
}

/* ═══════════════════════════════════════════════════════════
   CONFIRM DIALOG
═══════════════════════════════════════════════════════════ */
function confirm(msg) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-overlay');
    document.getElementById('confirm-msg').textContent = msg;
    overlay.classList.remove('hidden');
    const ok     = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    function cleanup(val) {
      overlay.classList.add('hidden');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      resolve(val);
    }
    function onOk()     { cleanup(true); }
    function onCancel() { cleanup(false); }
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
  });
}

/* ═══════════════════════════════════════════════════════════
   PAGE MANAGEMENT
═══════════════════════════════════════════════════════════ */
function createPage() {
  const page = { id: uid(), date: new Date().toISOString(), elements: [], checklists: [], drawings: [], zoomLevel: 0 };
  state.pages.push(page);
  state.spreadIdx = Math.floor((state.pages.length - 1) / pagesPerSpread());
  saveData(); pushUndo();
  return page;
}

async function deletePage(pageIdx) {
  const ok = await confirm('Delete this page? This cannot be undone.');
  if (!ok) return;
  state.pages.splice(pageIdx, 1);
  state.spreadIdx = clamp(state.spreadIdx, 0, Math.max(0, spreadCount() - 1));
  saveData();
  pushUndo();
  renderSpreads();
  updateHeaderDate();
  toast('Page deleted');
}

/* ═══════════════════════════════════════════════════════════
   TEXT BLOCK RENDERING
═══════════════════════════════════════════════════════════ */
function activateBlock(elData, div) {
  // Deactivate previous active block
  if (state.activeBlockId && state.activeBlockId !== elData.id) {
    const prev = document.querySelector(`[data-el-id="${state.activeBlockId}"]`);
    if (prev) {
      prev.contentEditable = 'false';
      prev.classList.remove('active-block');
    }
  }
  state.activeBlockId = elData.id;
  div.contentEditable = 'true';
  div.classList.add('active-block');
  showToolbar(elData, div);
}

function deactivateAllBlocks() {
  if (!state.activeBlockId) return;
  const prev = document.querySelector(`[data-el-id="${state.activeBlockId}"]`);
  if (prev) {
    prev.contentEditable = 'false';
    prev.classList.remove('active-block');
  }
  state.activeBlockId = null;
  hideToolbar();
}

function buildTextBlock(elData, page, pageEl) {
  const div = document.createElement('div');
  div.className = 'text-block';
  // NOT editable by default — only active block is editable
  div.contentEditable = 'false';
  div.spellcheck = true;
  div.dataset.elId = elData.id;

  const pw = pageEl.offsetWidth || 400;
  const { x, y } = toPixel(elData.row, elData.col, pw);
  const lh = currentLineH();
  div.style.left       = `${x}px`;
  div.style.top        = `${y}px`;
  div.style.lineHeight = `${lh}px`;
  div.style.fontSize   = `${Math.max(10, lh * 0.53)}px`;

  applyBlockStyle(div, elData.style);
  div.innerHTML = elData.content || '';
  if (!elData.content) div.setAttribute('data-placeholder', 'Start writing…');

  div.addEventListener('paste', e => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  div.addEventListener('input', () => {
    elData.content = div.innerHTML;
    if (!elData.content.replace(/<[^>]+>/g, '').trim()) {
      div.setAttribute('data-placeholder', 'Start writing…');
    } else {
      div.removeAttribute('data-placeholder');
    }
    triggerSave();
    updateHeaderDate();
  });

  // Click to activate (single-block editability)
  div.addEventListener('mousedown', e => {
    e.stopPropagation();
    if (state.mode === 'draw') return;
    activateBlock(elData, div);
    // Let native mousedown place the cursor
  });
  div.addEventListener('touchstart', e => {
    e.stopPropagation();
    if (state.mode === 'draw') return;
    activateBlock(elData, div);
  }, { passive: true });

  div.addEventListener('blur', () => {
    // Delay to allow toolbar clicks to process first
    setTimeout(() => {
      // If activeBlockId changed, this block was already deactivated
      if (state.activeBlockId !== elData.id) return;
      const txt = div.textContent.trim();
      if (!txt) {
        div.remove();
        page.elements = page.elements.filter(e => e.id !== elData.id);
        state.activeBlockId = null;
        triggerSave();
      }
    }, 250);
  });

  pageEl.appendChild(div);
  return div;
}

/* ═══════════════════════════════════════════════════════════
   TEXT PLACEMENT LOGIC (shared by mouse + mobile tap)
═══════════════════════════════════════════════════════════ */
function placeText(clientX, clientY, pageEl) {
  if (state.animating) return;
  if (state.mode === 'draw') return;
  const pageIdx = parseInt(pageEl.dataset.pageIdx);
  if (isNaN(pageIdx) || !state.pages[pageIdx]) return;
  const page = state.pages[pageIdx];

  const rect = pageEl.getBoundingClientRect();
  const pw   = rect.width;
  const relX = Math.max(marginLeft(), Math.min(pw - 24, clientX - rect.left));
  const relY = clientY - rect.top;
  const { row, col } = toGrid(relX, relY, pw);

  // Proximity: focus existing text block
  const existing = page.elements.find(el =>
    Math.abs(el.row - row) <= PROX_Y_ROWS &&
    Math.abs(el.col - col) <= PROX_X_FRAC
  );
  if (existing) {
    const domEl = pageEl.querySelector(`[data-el-id="${existing.id}"]`);
    if (domEl) {
      activateBlock(existing, domEl);
      domEl.focus();
      const sel = window.getSelection(), range = document.createRange();
      range.selectNodeContents(domEl); range.collapse(false);
      sel.removeAllRanges(); sel.addRange(range);
    }
    return;
  }

  // Collision check (text + checklists)
  const collision =
    page.elements.some(el => el.row === row && Math.abs(el.col - col) < 0.2) ||
    (page.checklists || []).some(cl => cl.row === row && Math.abs(cl.col - col) < 0.2);
  if (collision) return;

  if (state.mode === 'checklist') {
    placeChecklist(row, col, page, pageEl);
    return;
  }

  // New text block
  const elData = { id: uid(), row, col, content: '', style: { ...state.activeStyle } };
  page.elements.push(elData);
  triggerSave();
  const domEl = buildTextBlock(elData, page, pageEl);
  requestAnimationFrame(() => {
    activateBlock(elData, domEl);
    domEl.focus();
  });
}

/* ═══════════════════════════════════════════════════════════
   PAGE DOM BUILDER
═══════════════════════════════════════════════════════════ */
function buildPage(pageIdx, position) {
  const div = document.createElement('div');
  div.className = `page ${position}`;

  const isReal = pageIdx >= 0 && pageIdx < state.pages.length;
  if (!isReal) { div.classList.add('ghost'); return div; }

  div.dataset.pageIdx = pageIdx;
  const page = state.pages[pageIdx];

  const dateEl = document.createElement('div');
  dateEl.className = 'page-date';
  dateEl.textContent = formatDate(page.date);
  div.appendChild(dateEl);

  const numEl = document.createElement('div');
  numEl.className = 'page-num';
  numEl.textContent = pageIdx + 1;
  div.appendChild(numEl);

  // Drawing canvas (inserted first, below text)
  const canvas = buildDrawingCanvas(page, div);

  // Text blocks
  page.elements.forEach(el => buildTextBlock(el, page, div));

  // Checklists
  (page.checklists || []).forEach(cl => buildChecklist(cl, page, div));

  // Click → place (DESKTOP ONLY)
  if (!IS_MOBILE) {
    div.addEventListener('click', e => {
      if (e.target.classList.contains('text-block')) return;
      if (e.target.closest('.text-block')) return;
      if (e.target.closest('.checklist-block')) return;
      if (state.mode === 'draw') return;
      // Deactivate current block before placing new one
      deactivateAllBlocks();
      placeText(e.clientX, e.clientY, div);
    });
  }

  // After DOM insertion: correct pixel positions using actual width
  requestAnimationFrame(() => {
    const pw  = div.offsetWidth;
    const lh  = currentLineH();
    canvas.width  = div.offsetWidth;
    canvas.height = div.offsetHeight;
    redrawCanvas(canvas, page, pw);

    div.querySelectorAll('.text-block').forEach(tb => {
      const el = page.elements.find(e => e.id === tb.dataset.elId);
      if (!el) return;
      const { x, y } = toPixel(el.row, el.col, pw);
      tb.style.left       = `${x}px`;
      tb.style.top        = `${y}px`;
      tb.style.lineHeight = `${lh}px`;
      tb.style.fontSize   = `${Math.max(10, lh * 0.53)}px`;
    });

    div.querySelectorAll('.checklist-block').forEach(cb => {
      const cl = (page.checklists || []).find(c => c.id === cb.dataset.clId);
      if (!cl) return;
      const { x, y } = toPixel(cl.row, cl.col, pw);
      cb.style.left     = `${x}px`;
      cb.style.top      = `${y}px`;
      cb.style.fontSize = `${Math.max(9, lh * 0.44)}px`;
    });
  });

  return div;
}

/* ═══════════════════════════════════════════════════════════
   SPREAD BUILDER
═══════════════════════════════════════════════════════════ */
function buildSpread(si) {
  const div = document.createElement('div');
  div.className = 'spread';
  div.dataset.spreadIdx = si;

  if (IS_MOBILE) {
    div.appendChild(buildPage(si, 'single'));
  } else {
    const [li, ri] = [si * 2, si * 2 + 1];
    div.appendChild(buildPage(li, 'left'));
    div.appendChild(buildPage(ri, 'right'));
  }

  return div;
}

/* ═══════════════════════════════════════════════════════════
   SPREAD RENDERING & NAVIGATION
═══════════════════════════════════════════════════════════ */
let spreads = { prev: null, curr: null, next: null };

function applyTransform(el, vw) {
  if (el) el.style.transform = `translate3d(${vw}vw, 0, 0)`;
}

function setAnim(on) {
  [spreads.prev, spreads.curr, spreads.next].forEach(s => {
    if (!s) return;
    if (on) s.classList.add('anim');
    else    s.classList.remove('anim');
  });
}

function renderSpreads() {
  const track = document.getElementById('notebook-track');
  track.innerHTML = '';
  spreads = { prev: null, curr: null, next: null };

  // Empty state — no pages at all
  if (state.pages.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'empty-notebook-state';
    emptyDiv.innerHTML = `
      <div class="empty-nb-inner">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        <h2>Your notebook is empty</h2>
        <p>Press <kbd>+</kbd> to create your first page, then click anywhere on the page to start writing.</p>
      </div>
    `;
    track.appendChild(emptyDiv);
    updateHeaderDate();
    return;
  }

  const si = state.spreadIdx;
  const sc = spreadCount();

  spreads.curr = buildSpread(si);
  applyTransform(spreads.curr, 0);
  track.appendChild(spreads.curr);

  if (si > 0) {
    spreads.prev = buildSpread(si - 1);
    applyTransform(spreads.prev, -100);
    track.appendChild(spreads.prev);
  }

  if (si < sc - 1) {
    spreads.next = buildSpread(si + 1);
    applyTransform(spreads.next, 100);
    track.appendChild(spreads.next);
  }

  updateHeaderDate();
}

function navigateTo(direction) {
  // direction: -1 (prev) | +1 (next)
  if (state.animating) return;
  const sc = spreadCount();
  const target = state.spreadIdx + direction;
  if (target < 0 || target >= sc) return;

  // Save current page content before navigating
  clearTimeout(state.saveTimer);
  pushUndo();
  saveData();

  setAnim(true);
  state.animating = true;

  if (direction === -1) {
    applyTransform(spreads.prev,  0);
    applyTransform(spreads.curr, 100);
  } else {
    applyTransform(spreads.curr, -100);
    applyTransform(spreads.next,  0);
  }

  state.spreadIdx = target;
  setTimeout(() => {
    state.animating = false;
    // Full re-render so prev/next are correctly pre-positioned
    setAnim(false);
    renderSpreads();
  }, SPREAD_DUR);
}

/* ═══════════════════════════════════════════════════════════
   HEADER
═══════════════════════════════════════════════════════════ */
function updateHeaderDate() {
  const label = document.getElementById('date-label');
  if (!label) return;
  if (state.view === 'gallery') { label.textContent = 'Gallery'; return; }
  if (state.pages.length === 0) { label.textContent = 'Slate'; return; }

  const indices = pageIndicesForSpread(state.spreadIdx);
  const pageIdx = indices.find(i => i < state.pages.length);
  if (pageIdx === undefined) { label.textContent = 'Slate'; return; }

  const page = state.pages[pageIdx];
  label.textContent = formatDate(page.date);
}

/* ═══════════════════════════════════════════════════════════
   GALLERY
═══════════════════════════════════════════════════════════ */
function openGallery() {
  if (state.view === 'gallery') return;
  state.view = 'gallery';

  const nv = document.getElementById('notebook-view');
  const gv = document.getElementById('gallery-view');

  // Save pending
  clearTimeout(state.saveTimer);
  saveData();

  nv.classList.add('zooming-out');

  setTimeout(() => {
    nv.classList.add('hidden');
    nv.classList.remove('zooming-out');

    renderGallery();

    gv.classList.remove('hidden');
    gv.classList.add('gallery-entering');
    void gv.offsetWidth; // flush
    gv.classList.remove('gallery-entering');

    document.getElementById('gallery-btn').classList.add('hidden');
    document.getElementById('back-btn').classList.remove('hidden');
    updateHeaderDate();
  }, 260);
}

function closeGallery(targetSpreadIdx) {
  if (state.view !== 'gallery') return;
  state.view = 'notebook';

  if (targetSpreadIdx !== undefined) {
    state.spreadIdx = targetSpreadIdx;
  }

  const gv = document.getElementById('gallery-view');
  const nv = document.getElementById('notebook-view');

  gv.classList.add('hidden');

  renderSpreads();

  nv.classList.remove('hidden');
  nv.classList.add('zooming-in');
  void nv.offsetWidth;
  nv.classList.remove('zooming-in');

  document.getElementById('gallery-btn').classList.remove('hidden');
  document.getElementById('back-btn').classList.add('hidden');
  updateHeaderDate();
}

function renderGallery() {
  const scroller = document.getElementById('gallery-scroller');
  const empty    = document.getElementById('gallery-empty');
  scroller.innerHTML = '';

  if (state.pages.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  // Group by month (newest first within month, months also newest first)
  const groups = {};
  state.pages.forEach((page, idx) => {
    const mk = monthKey(page.date);
    if (!groups[mk]) groups[mk] = [];
    groups[mk].push({ page, idx });
  });

  const sortedMonths = Object.keys(groups).sort((a, b) => {
    return new Date(b) - new Date(a);
  });

  sortedMonths.forEach(month => {
    const section = document.createElement('div');
    section.className = 'gallery-month';
    section.dataset.month = month;

    const header = document.createElement('div');
    header.className = 'month-header';
    header.textContent = month;
    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'gallery-grid';

    const items = groups[month].sort((a, b) => new Date(b.page.date) - new Date(a.page.date));
    items.forEach(({ page, idx }) => {
      grid.appendChild(buildThumb(page, idx));
    });

    section.appendChild(grid);
    scroller.appendChild(section);
  });
}

function buildThumb(page, pageIdx) {
  const div = document.createElement('div');
  div.className = 'gallery-thumb';
  div.setAttribute('role', 'button');
  div.setAttribute('tabindex', '0');
  div.setAttribute('aria-label', `Page ${pageIdx + 1}`);

  // Snippet
  const text = pageTextContent(page).substring(0, 80);
  if (text) {
    const preview = document.createElement('div');
    preview.className = 'thumb-preview';
    preview.textContent = text;
    div.appendChild(preview);
  }

  const numEl = document.createElement('div');
  numEl.className = 'thumb-page-num';
  numEl.textContent = pageIdx + 1;
  div.appendChild(numEl);

  const si = Math.floor(pageIdx / pagesPerSpread());
  div.addEventListener('click', () => closeGallery(si));
  div.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeGallery(si); }
  });

  return div;
}

/* Scroll date indicator */
function setupScrollIndicator() {
  const scroller   = document.getElementById('gallery-scroller');
  const indicator  = document.getElementById('scroll-date-indicator');
  let hideTimer;

  const onScroll = debounce(() => {
    // Find which month header is nearest top
    const headers = Array.from(document.querySelectorAll('.month-header'));
    if (!headers.length) return;

    let active = headers[0];
    headers.forEach(h => {
      if (h.getBoundingClientRect().top < 80) active = h;
    });
    indicator.textContent = active.textContent;

    indicator.classList.add('visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      indicator.classList.remove('visible');
    }, 1200);
  }, 30);

  scroller.addEventListener('scroll', onScroll, { passive: true });
}

/* ═══════════════════════════════════════════════════════════
   DESKTOP INTERACTIONS
═══════════════════════════════════════════════════════════ */
function initDesktop() {
  // Keyboard navigation (DESKTOP ONLY)
  document.addEventListener('keydown', e => {
    // Skip if in a text block
    if (document.activeElement && document.activeElement.isContentEditable) {
      // Allow undo inside text blocks too
      if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        // browser can handle text undo naturally; only intercept at app level
        // when NOT in a text block
      }
      return;
    }

    if (state.view === 'gallery') {
      if (e.key === 'Escape') { e.preventDefault(); closeGallery(); }
      return;
    }

    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); navigateTo(1);  break;
      case 'ArrowLeft':  e.preventDefault(); navigateTo(-1); break;
      case 'ArrowDown':  e.preventDefault(); navigateTo(1);  break;
      case 'ArrowUp':    e.preventDefault(); navigateTo(-1); break;
      case 'Escape':     e.preventDefault(); document.activeElement?.blur(); break;
    }

    // Undo
    if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      undo();
    }

    // New page
    if (e.key === 'n' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      newPage();
    }
  });

  // Block trackpad horizontal swipe from triggering browser back/forward
  // Also prevent it from hijacking page nav
  const track = document.getElementById('notebook-track');
  track.addEventListener('wheel', e => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault(); // block horizontal scroll navigation
    }
  }, { passive: false });

  // Block any mouse drag on the track (no drag navigation on desktop)
  track.addEventListener('mousedown', e => {
    // Only block if not clicking into a page
    if (!e.target.closest('.page')) e.preventDefault();
  });
}

/* ═══════════════════════════════════════════════════════════
   MOBILE TOUCH INTERACTIONS
═══════════════════════════════════════════════════════════ */
function initMobile() {
  const track = document.getElementById('notebook-track');

  let t = {
    startX: 0, startY: 0, currX: 0,
    startTime: 0,
    isSwiping: false,
    isPinching: false, pinchStart: 0,
    rafId: null,
  };

  function getPinchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  function onTouchStart(e) {
    if (state.animating) return;

    if (e.touches.length === 2) {
      t.isPinching  = true;
      t.pinchStart  = getPinchDist(e.touches);
      t.isSwiping   = false;
      return;
    }

    t.isPinching  = false;
    t.isSwiping   = false;
    t.startX      = e.touches[0].clientX;
    t.startY      = e.touches[0].clientY;
    t.currX       = t.startX;
    t.startTime   = performance.now();

    setAnim(false); // disable transitions during tracking
  }

  function onTouchMove(e) {
    if (state.animating) { e.preventDefault(); return; }

    // Pinch: check if spread shrunk enough to open gallery
    if (t.isPinching && e.touches.length === 2 && state.view === 'notebook') {
      e.preventDefault();
      const dist = getPinchDist(e.touches);
      if (t.pinchStart - dist > PINCH_THRESH) {
        t.isPinching = false;
        openGallery();
      }
      return;
    }

    // Don't steal events from editing text
    if (e.target.isContentEditable) return;

    const dx = e.touches[0].clientX - t.startX;
    const dy = e.touches[0].clientY - t.startY;

    // Determine swipe axis
    if (!t.isSwiping) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        t.isSwiping = true;
        if (document.activeElement) document.activeElement.blur();
      } else if (Math.abs(dy) > 8) {
        return; // vertical scroll — don't interfere
      }
    }

    if (!t.isSwiping) return;
    e.preventDefault();

    t.currX = e.touches[0].clientX;

    // RAF-throttled transform update
    if (t.rafId) return;
    t.rafId = requestAnimationFrame(() => {
      t.rafId = null;
      let delta = t.currX - t.startX;
      const sc = spreadCount();

      // Rubber-band at edges
      if (state.spreadIdx === 0       && delta > 0) delta *= 0.12;
      if (state.spreadIdx >= sc - 1   && delta < 0) delta *= 0.12;

      const pct = (delta / window.innerWidth) * 100;
      applyTransform(spreads.curr, pct);
      applyTransform(spreads.prev, pct - 100);
      applyTransform(spreads.next, pct + 100);
    });
  }

  function onTouchEnd(e) {
    if (t.rafId) { cancelAnimationFrame(t.rafId); t.rafId = null; }
    t.isPinching = false;

    if (!t.isSwiping) {
      // It's a tap — place text
      if (e.changedTouches.length && state.view === 'notebook') {
        const ct = e.changedTouches[0];
        const dx = ct.clientX - t.startX;
        const dy = ct.clientY - t.startY;
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
          // Confirmed tap
          const el = document.elementFromPoint(ct.clientX, ct.clientY);
          const pageEl = el && el.closest('.page[data-page-idx]');
          if (pageEl && !el.isContentEditable) {
            placeText(ct.clientX, ct.clientY, pageEl);
          }
        }
      }
      return;
    }

    t.isSwiping = false;

    const dx       = t.currX - t.startX;
    const elapsed  = performance.now() - t.startTime;
    const velocity = Math.abs(dx) / elapsed;
    const pct      = Math.abs(dx) / window.innerWidth;
    const sc       = spreadCount();

    let dir = 0;
    if (velocity > SWIPE_VEL || pct > SWIPE_PCT) {
      if (dx > 0 && state.spreadIdx > 0)      dir = -1;
      if (dx < 0 && state.spreadIdx < sc - 1) dir =  1;
    }

    // Save on page change
    if (dir !== 0) {
      clearTimeout(state.saveTimer);
      pushUndo();
      saveData();
    }

    setAnim(true);
    state.animating = true;

    if (dir === -1) {
      state.spreadIdx--;
      applyTransform(spreads.prev,   0);
      applyTransform(spreads.curr, 100);
    } else if (dir === 1) {
      state.spreadIdx++;
      applyTransform(spreads.curr, -100);
      applyTransform(spreads.next,    0);
    } else {
      // Snap back
      applyTransform(spreads.curr,   0);
      applyTransform(spreads.prev, -100);
      applyTransform(spreads.next,  100);
    }

    setTimeout(() => {
      state.animating = false;
      setAnim(false);
      if (dir !== 0) renderSpreads();
    }, SPREAD_DUR);
  }

  track.addEventListener('touchstart', onTouchStart, { passive: true });
  track.addEventListener('touchmove',  onTouchMove,  { passive: false });
  track.addEventListener('touchend',   onTouchEnd,   { passive: true });
}

/* ═══════════════════════════════════════════════════════════
   NEW PAGE
═══════════════════════════════════════════════════════════ */
function newPage() {
  if (state.view === 'gallery') {
    createPage();
    closeGallery(Math.floor((state.pages.length - 1) / pagesPerSpread()));
  } else {
    createPage();
    renderSpreads();
  }
  updateHeaderDate();
  toast('New page created', 'ok');
}

/* ═══════════════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════════════ */
window.handleCredentialResponse = function(response) {
  try {
    const b64 = response.credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(decodeURIComponent(
      atob(b64).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2,'0')).join('')
    ));
    state.user = { name: payload.name, email: payload.email, picture: payload.picture };
    applyAuthUI();
    toast(`Signed in as ${payload.given_name || payload.name}`, 'ok');
  } catch (e) {
    toast('Sign-in failed', 'err');
  }
};

function applyAuthUI() {
  const widget = document.getElementById('user-widget');
  const avatar = document.getElementById('user-avatar');
  const nameEl = document.getElementById('user-name-label');
  const gsignin = document.querySelector('.g_id_signin');

  if (state.user) {
    avatar.src = state.user.picture || '';
    avatar.alt = state.user.name;
    nameEl.textContent = state.user.name;
    widget.classList.remove('hidden');
    if (gsignin) gsignin.classList.add('hidden');
  } else {
    widget.classList.add('hidden');
    if (gsignin) gsignin.classList.remove('hidden');
  }
}

function setupAuthEvents() {
  const avatar  = document.getElementById('user-avatar');
  const menu    = document.getElementById('user-menu');
  const logout  = document.getElementById('logout-btn');
  const exportB = document.getElementById('export-btn');

  avatar.addEventListener('click', () => {
    const open = menu.classList.toggle('hidden');
    avatar.setAttribute('aria-expanded', !open ? 'true' : 'false');
  });

  // Close menu when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('#user-widget')) {
      menu.classList.add('hidden');
      avatar.setAttribute('aria-expanded', 'false');
    }
  });

  logout.addEventListener('click', () => {
    state.user = null;
    applyAuthUI();
    menu.classList.add('hidden');
    toast('Signed out');
  });

  exportB.addEventListener('click', () => {
    exportJSON();
    menu.classList.add('hidden');
  });
}

/* ═══════════════════════════════════════════════════════════
   OFFLINE
═══════════════════════════════════════════════════════════ */
function setupOffline() {
  window.addEventListener('offline', () => {
    state.online = false;
    setSyncStatus('offline');
    toast('You\'re offline — writing continues locally');
  });
  window.addEventListener('online', () => {
    state.online = true;
    setSyncStatus('saved');
    toast('Back online', 'ok');
  });
}

/* ═══════════════════════════════════════════════════════════
   SERVICE WORKER
═══════════════════════════════════════════════════════════ */
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {/* non-fatal */});
  }
}

/* ═══════════════════════════════════════════════════════════
   STYLE HELPERS
═══════════════════════════════════════════════════════════ */
function applyBlockStyle(div, style) {
  if (!style) return;
  div.style.fontFamily = style.font === 'roboto'
    ? "'Roboto', sans-serif"
    : "var(--font-writing)";
  div.style.fontStyle      = style.italic    ? 'italic'    : 'normal';
  div.style.textDecoration = style.underline ? 'underline' : 'none';
  if (style.color) div.style.color = style.color;
}

let _focusedElData = null;
let _focusedBlock  = null;

function showToolbar(elData, blockDiv) {
  _focusedElData = elData;
  _focusedBlock  = blockDiv;
  const s = elData.style || state.activeStyle;
  const fontSel = document.getElementById('tb-font');
  const italic  = document.getElementById('tb-italic');
  const uline   = document.getElementById('tb-underline');
  const color   = document.getElementById('tb-color');
  const hex     = document.getElementById('tb-color-hex');
  if (fontSel) fontSel.value = s.font || 'serif';
  if (italic)  italic.classList.toggle('active', !!s.italic);
  if (uline)   uline.classList.toggle('active', !!s.underline);
  if (color)   color.value = s.color || '#1a1a1a';
  if (hex)     hex.value   = s.color || '#1a1a1a';
}

function hideToolbar() {
  // Don't clear if we still have an active block (toolbar click in progress)
  if (state.activeBlockId) return;
  _focusedElData = null;
  _focusedBlock  = null;
}

function updateFocusedStyle(key, value) {
  if (!_focusedElData) return;
  if (!_focusedElData.style) _focusedElData.style = { ...state.activeStyle };
  _focusedElData.style[key] = value;
  state.activeStyle[key] = value;
  if (_focusedBlock) applyBlockStyle(_focusedBlock, _focusedElData.style);
  triggerSave();
}

/* ═══════════════════════════════════════════════════════════
   CHECKLIST
═══════════════════════════════════════════════════════════ */
function buildChecklistItem(item, clData, page) {
  const row = document.createElement('div');
  row.className = 'cl-item' + (item.checked ? ' cl-checked' : '');

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'cl-checkbox';
  cb.checked = item.checked;
  cb.addEventListener('change', () => {
    item.checked = cb.checked;
    row.classList.toggle('cl-checked', cb.checked);
    triggerSave();
  });

  const txt = document.createElement('span');
  txt.className = 'cl-item-text';
  txt.contentEditable = 'true';
  txt.textContent = item.text || '';
  txt.setAttribute('data-placeholder', 'To-do…');

  txt.addEventListener('input', () => {
    item.text = txt.textContent;
    triggerSave();
  });

  txt.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const idx = clData.items.indexOf(item);
      const newItem = { text: '', checked: false };
      clData.items.splice(idx + 1, 0, newItem);
      triggerSave();
      const newRow = buildChecklistItem(newItem, clData, page);
      row.parentElement.insertBefore(newRow, row.nextSibling);
      newRow.querySelector('.cl-item-text').focus();
    }
    if (e.key === 'Backspace' && !txt.textContent) {
      e.preventDefault();
      const idx = clData.items.indexOf(item);
      if (clData.items.length <= 1) return; // keep at least one
      clData.items.splice(idx, 1);
      const prev = row.previousElementSibling;
      row.remove();
      if (prev) {
        const prevTxt = prev.querySelector('.cl-item-text');
        if (prevTxt) prevTxt.focus();
      }
      triggerSave();
    }
  });

  txt.addEventListener('mousedown', e => e.stopPropagation());
  txt.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });

  row.appendChild(cb);
  row.appendChild(txt);
  return row;
}

function buildChecklist(clData, page, pageEl) {
  const div = document.createElement('div');
  div.className = 'checklist-block';
  div.dataset.clId = clData.id;

  const pw = pageEl.offsetWidth || 400;
  const { x, y } = toPixel(clData.row, clData.col, pw);
  const lh = currentLineH();
  div.style.left     = `${x}px`;
  div.style.top      = `${y}px`;
  div.style.fontSize = `${Math.max(9, lh * 0.44)}px`;

  clData.items.forEach(item => {
    div.appendChild(buildChecklistItem(item, clData, page));
  });

  div.addEventListener('mousedown', e => e.stopPropagation());
  div.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });

  pageEl.appendChild(div);
  return div;
}

function placeChecklist(row, col, page, pageEl) {
  const clData = {
    id: uid(),
    row, col,
    items: [{ text: '', checked: false }],
  };
  page.checklists.push(clData);
  triggerSave();
  const div = buildChecklist(clData, page, pageEl);
  requestAnimationFrame(() => {
    const firstTxt = div.querySelector('.cl-item-text');
    if (firstTxt) firstTxt.focus();
  });
}

/* ═══════════════════════════════════════════════════════════
   DRAWING
═══════════════════════════════════════════════════════════ */
function buildDrawingCanvas(page, pageEl) {
  const canvas = document.createElement('canvas');
  canvas.className = 'drawing-layer';
  // True overlay — position via CSS, size set in buildPage rAF
  canvas.style.position = 'absolute';
  canvas.style.top      = '0';
  canvas.style.left     = '0';
  canvas.style.width    = '100%';
  canvas.style.height   = '100%';
  canvas.width  = 0;
  canvas.height = 0;
  pageEl.appendChild(canvas);

  // Drawing state for this canvas
  let drawing = false;
  let currentStroke = null;

  function getRowCol(e) {
    const rect = pageEl.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return toGrid(cx, cy, rect.width);
  }

  function beginStroke(e) {
    if (state.mode !== 'draw') return;
    e.preventDefault();
    drawing = true;
    const rc = getRowCol(e);
    currentStroke = {
      points: [rc],
      color: state.drawColor,
      width: state.drawWidth,
    };
  }

  function moveStroke(e) {
    if (!drawing || !currentStroke) return;
    e.preventDefault();
    const rc = getRowCol(e);
    currentStroke.points.push(rc);
    // Incremental draw for performance
    const ctx = canvas.getContext('2d');
    const pts = currentStroke.points;
    const pw  = canvas.width;
    if (pts.length < 2) return;
    const prev = pts[pts.length - 2];
    const curr = pts[pts.length - 1];
    const p1 = toPixel(prev.row, prev.col, pw);
    const p2 = toPixel(curr.row, curr.col, pw);
    ctx.strokeStyle = currentStroke.color;
    ctx.lineWidth   = currentStroke.width;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  function endStroke(e) {
    if (!drawing || !currentStroke) return;
    drawing = false;
    if (currentStroke.points.length > 1) {
      if (!page.drawings) page.drawings = [];
      page.drawings.push(currentStroke);
      triggerSave();
    }
    currentStroke = null;
  }

  // Mouse events
  canvas.addEventListener('mousedown',  beginStroke);
  canvas.addEventListener('mousemove',  moveStroke);
  canvas.addEventListener('mouseup',    endStroke);
  canvas.addEventListener('mouseleave', endStroke);

  // Touch events
  canvas.addEventListener('touchstart', beginStroke, { passive: false });
  canvas.addEventListener('touchmove',  moveStroke,  { passive: false });
  canvas.addEventListener('touchend',   endStroke);
  canvas.addEventListener('touchcancel', endStroke);

  return canvas;
}

function redrawCanvas(canvas, page, pw) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!page.drawings || !page.drawings.length) return;

  page.drawings.forEach(stroke => {
    if (!stroke.points || stroke.points.length < 2) return;
    ctx.strokeStyle = stroke.color || '#1a1a1a';
    ctx.lineWidth   = stroke.width || 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    const first = toPixel(stroke.points[0].row, stroke.points[0].col, pw);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < stroke.points.length; i++) {
      const p = toPixel(stroke.points[i].row, stroke.points[i].col, pw);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  });
}

/* ═══════════════════════════════════════════════════════════
   ZOOM
═══════════════════════════════════════════════════════════ */
function applyZoom() {
  const lh = currentLineH();
  document.documentElement.style.setProperty('--line-h', `${lh}px`);

  // Update all visible text blocks and checklists in-place (no full re-render)
  document.querySelectorAll('.page[data-page-idx]').forEach(pageEl => {
    const pageIdx = parseInt(pageEl.dataset.pageIdx);
    const page = state.pages[pageIdx];
    if (!page) return;
    const pw = pageEl.offsetWidth;

    pageEl.querySelectorAll('.text-block').forEach(tb => {
      const el = page.elements.find(e => e.id === tb.dataset.elId);
      if (!el) return;
      const { x, y } = toPixel(el.row, el.col, pw);
      tb.style.left       = `${x}px`;
      tb.style.top        = `${y}px`;
      tb.style.lineHeight = `${lh}px`;
      tb.style.fontSize   = `${Math.max(10, lh * 0.53)}px`;
    });

    pageEl.querySelectorAll('.checklist-block').forEach(cb => {
      const cl = (page.checklists || []).find(c => c.id === cb.dataset.clId);
      if (!cl) return;
      const { x, y } = toPixel(cl.row, cl.col, pw);
      cb.style.left     = `${x}px`;
      cb.style.top      = `${y}px`;
      cb.style.fontSize = `${Math.max(9, lh * 0.44)}px`;
      cb.querySelectorAll('.cl-item').forEach(item => {
        item.style.lineHeight = `${lh}px`;
        item.style.minHeight  = `${lh}px`;
      });
    });

    // Redraw canvases
    const canvas = pageEl.querySelector('canvas.drawing-layer');
    if (canvas) {
      canvas.width  = pw;
      canvas.height = pageEl.offsetHeight;
      redrawCanvas(canvas, page, pw);
    }
  });
}

function zoomIn() {
  if (state.zoomLevel >= MAX_ZOOM) return;
  state.zoomLevel++;
  applyZoom();
  toast(`Zoom ${state.zoomLevel > 0 ? '+' : ''}${state.zoomLevel}`);
}

function zoomOut() {
  if (state.zoomLevel <= MIN_ZOOM) return;
  state.zoomLevel--;
  applyZoom();
  toast(`Zoom ${state.zoomLevel > 0 ? '+' : ''}${state.zoomLevel}`);
}

/* ═══════════════════════════════════════════════════════════
   MODE SWITCHING
═══════════════════════════════════════════════════════════ */
function setMode(mode) {
  state.mode = mode;
  const textBtn  = document.getElementById('tb-mode-text');
  const clBtn    = document.getElementById('tb-mode-checklist');
  const drawBtn  = document.getElementById('tb-mode-draw');
  const format   = document.getElementById('tb-format');
  const drawCtrl = document.getElementById('tb-draw-controls');

  [textBtn, clBtn, drawBtn].forEach(b => b.classList.remove('active'));

  if (mode === 'text')      textBtn.classList.add('active');
  if (mode === 'checklist') clBtn.classList.add('active');
  if (mode === 'draw')      drawBtn.classList.add('active');

  // Show/hide formatting vs draw controls
  format.classList.toggle('hidden', mode === 'draw');
  drawCtrl.classList.toggle('hidden', mode !== 'draw');

  // Toggle pointer-events on drawing canvases
  document.querySelectorAll('canvas.drawing-layer').forEach(c => {
    c.style.pointerEvents = mode === 'draw' ? 'auto' : 'none';
  });

  // Deactivate text blocks when entering draw mode
  if (mode === 'draw') {
    deactivateAllBlocks();
    if (document.activeElement && document.activeElement.isContentEditable) {
      document.activeElement.blur();
    }
  }

  // Change page cursor
  document.querySelectorAll('.page').forEach(p => {
    p.style.cursor = mode === 'draw' ? 'crosshair' : 'text';
  });
}

/* ═══════════════════════════════════════════════════════════
   TOOLBAR WIRING
═══════════════════════════════════════════════════════════ */
function setupToolbar() {
  // Mode buttons
  document.getElementById('tb-mode-text').addEventListener('click', () => setMode('text'));
  document.getElementById('tb-mode-checklist').addEventListener('click', () => setMode('checklist'));
  document.getElementById('tb-mode-draw').addEventListener('click', () => setMode('draw'));

  // Zoom
  document.getElementById('zoom-in').addEventListener('click', zoomIn);
  document.getElementById('zoom-out').addEventListener('click', zoomOut);

  // Font select
  document.getElementById('tb-font').addEventListener('change', e => {
    updateFocusedStyle('font', e.target.value);
  });

  // Italic toggle
  document.getElementById('tb-italic').addEventListener('click', e => {
    const btn = e.currentTarget;
    const newVal = !btn.classList.contains('active');
    btn.classList.toggle('active', newVal);
    updateFocusedStyle('italic', newVal);
  });

  // Underline toggle
  document.getElementById('tb-underline').addEventListener('click', e => {
    const btn = e.currentTarget;
    const newVal = !btn.classList.contains('active');
    btn.classList.toggle('active', newVal);
    updateFocusedStyle('underline', newVal);
  });

  // Color picker
  document.getElementById('tb-color').addEventListener('input', e => {
    document.getElementById('tb-color-hex').value = e.target.value;
    updateFocusedStyle('color', e.target.value);
  });

  // Hex input
  document.getElementById('tb-color-hex').addEventListener('change', e => {
    const val = e.target.value;
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      document.getElementById('tb-color').value = val;
      updateFocusedStyle('color', val);
    }
  });

  // Draw color
  document.getElementById('tb-draw-color').addEventListener('input', e => {
    state.drawColor = e.target.value;
  });

  // Draw width
  document.getElementById('tb-draw-width').addEventListener('input', e => {
    state.drawWidth = parseInt(e.target.value) || 2;
  });

  // Initialize --line-h CSS variable
  document.documentElement.style.setProperty('--line-h', `${currentLineH()}px`);
}

/* ═══════════════════════════════════════════════════════════
   TOP-LEVEL BUTTON WIRING
═══════════════════════════════════════════════════════════ */
function setupGlobalButtons() {
  document.getElementById('new-page-btn').addEventListener('click', newPage);
  document.getElementById('gallery-btn').addEventListener('click', openGallery);
  document.getElementById('back-btn').addEventListener('click', () => closeGallery());
}

/* ═══════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════ */
function init() {
  loadData();
  pushUndo(); // seed undo stack with initial state

  // Set initial sync status
  setSyncStatus(navigator.onLine ? 'saved' : 'offline');

  // Render initial spreads (ensure at least conceptually a spread 0 exists)
  state.spreadIdx = clamp(state.spreadIdx, 0, Math.max(0, spreadCount() - 1));
  renderSpreads();
  updateHeaderDate();

  // Wire up interactions — strictly separated by device
  if (IS_MOBILE) {
    initMobile();
  } else {
    initDesktop();
  }

  // Shared setup
  setupGlobalButtons();
  setupToolbar();
  setupAuthEvents();
  setupOffline();
  setupScrollIndicator();
  registerSW();
  applyAuthUI();

  // Dismiss loader
  setTimeout(() => {
    document.getElementById('app-loader').classList.add('out');
  }, 300);
}

document.addEventListener('DOMContentLoaded', init);
