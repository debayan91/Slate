/**
 * SLATE — app.js
 * Single, clean, zero-dependency application logic.
 * Strict desktop/mobile separation. 100% localStorage persistence.
 */

'use strict';

// ─── Constants ─────────────────────────────────────────────────────────────
const STORAGE_KEY = 'slate_v1_pages';
const AUTOSAVE_DELAY = 800; // ms
const IS_MOBILE = window.matchMedia('(max-width: 767px)').matches ||
                  window.matchMedia('(pointer: coarse)').matches;

// ─── State ─────────────────────────────────────────────────────────────────
const state = {
  pages: [],         // Array<{ id, createdAt, updatedAt, content }>
  activePageId: null,
  user: null,        // { name, email, picture } | null
  saveTimer: null,
  isOnline: navigator.onLine,
};

// ─── DOM References ─────────────────────────────────────────────────────────
// Populated after DOMContentLoaded
let DOM = {};

// ─── Utils ──────────────────────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

function pageTitle(page) {
  const text = (typeof page.content === 'string' ? stripHtml(page.content) : '').trim();
  const firstLine = text.split('\n')[0].trim();
  return firstLine.length > 0 ? firstLine.substring(0, 50) : 'Untitled page';
}

// ─── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`.trim();
  el.textContent = msg;
  DOM.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 300ms';
    setTimeout(() => el.remove(), 300);
  }, 2500);
}

// ─── Confirm Dialog ─────────────────────────────────────────────────────────
function showConfirm(msg) {
  return new Promise((resolve) => {
    DOM.confirmMessage.textContent = msg;
    DOM.confirmOverlay.classList.remove('hidden');
    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    const cleanup = () => {
      DOM.confirmOk.removeEventListener('click', onOk);
      DOM.confirmCancel.removeEventListener('click', onCancel);
      DOM.confirmOverlay.classList.add('hidden');
    };
    DOM.confirmOk.addEventListener('click', onOk);
    DOM.confirmCancel.addEventListener('click', onCancel);
  });
}

// ─── Persistence ────────────────────────────────────────────────────────────
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      state.pages = parsed;
    }
  } catch (e) {
    console.warn('Slate: Failed to parse saved data. Starting fresh.', e);
    state.pages = [];
    showToast('Could not load saved notes', 'error');
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.pages));
    setSyncStatus('saved');
  } catch (e) {
    console.warn('Slate: Failed to save data.', e);
    showToast('Failed to save', 'error');
  }
}

function exportData() {
  const payload = JSON.stringify(state.pages, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `slate-export-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Notes exported', 'success');
}

// ─── Sync Status UI ─────────────────────────────────────────────────────────
function setSyncStatus(status) {
  // status: 'saving' | 'saved' | 'offline'
  const pills = [DOM.sidebarStatus, DOM.toolbarStatus, DOM.mStatus].filter(Boolean);
  pills.forEach(el => {
    el.className = 'status-pill';
    if (status === 'saving') {
      el.classList.add('saving');
      el.textContent = 'Saving…';
    } else if (status === 'offline') {
      el.classList.add('offline');
      el.textContent = 'Offline';
    } else {
      el.textContent = 'Saved';
    }
  });
}

function scheduleSave() {
  setSyncStatus('saving');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    saveData();
  }, AUTOSAVE_DELAY);
}

// ─── Page Management ────────────────────────────────────────────────────────
function createPage() {
  const page = {
    id: uid(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    content: '',
  };
  state.pages.unshift(page); // newest first
  saveData();
  return page;
}

function deletePage(id) {
  const idx = state.pages.findIndex(p => p.id === id);
  if (idx === -1) return;
  state.pages.splice(idx, 1);
  saveData();
}

function updatePageContent(id, content) {
  const page = state.pages.find(p => p.id === id);
  if (!page) return;
  page.content = content;
  page.updatedAt = new Date().toISOString();
  scheduleSave();
  // Refresh sidebar list item title without full re-render
  if (!IS_MOBILE) {
    refreshListItemTitle(id);
  } else {
    refreshMobileListItemTitle(id);
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────────
function decodeJwt(token) {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(decodeURIComponent(
    atob(base64).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  ));
}

window.handleCredentialResponse = function(response) {
  try {
    const payload = decodeJwt(response.credential);
    state.user = { name: payload.name, email: payload.email, picture: payload.picture };
    applyAuthState();
    showToast(`Signed in as ${payload.given_name}`, 'success');
  } catch(e) {
    showToast('Sign-in failed', 'error');
  }
};

function applyAuthState() {
  if (IS_MOBILE) {
    applyMobileAuthState();
  } else {
    applyDesktopAuthState();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  DESKTOP
// ─────────────────────────────────────────────────────────────────────────────

function initDesktop() {
  // Wire DOM
  DOM.newPageBtn.addEventListener('click', () => newPageAndOpen());
  DOM.emptyNewBtn.addEventListener('click', () => newPageAndOpen());
  DOM.deletePageBtn.addEventListener('click', () => deleteActivePage());
  DOM.logoutBtn.addEventListener('click', desktopLogout);
  DOM.exportBtn.addEventListener('click', exportData);
  DOM.confirmCancel.addEventListener('click', () => {}); // wired in showConfirm
  DOM.confirmOk.addEventListener('click', () => {});

  // Keyboard navigation
  document.addEventListener('keydown', handleDesktopKeydown);

  // Block wheel-based horizontal page switching (prevent accidental trackpad swipes)
  DOM.pageContainer.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault();
  }, { passive: false });

  // Auth
  applyDesktopAuthState();

  // Render
  renderDesktopPagesList();

  // Open first page if any
  if (state.pages.length > 0) {
    openDesktopPage(state.pages[0].id);
  } else {
    showDesktopEmptyState();
  }
}

function handleDesktopKeydown(e) {
  // Ignore if typing in editor
  if (document.activeElement === DOM.pageEditor) return;

  const idx = state.pages.findIndex(p => p.id === state.activePageId);

  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    e.preventDefault();
    if (idx < state.pages.length - 1) openDesktopPage(state.pages[idx + 1].id);
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    e.preventDefault();
    if (idx > 0) openDesktopPage(state.pages[idx - 1].id);
  } else if ((e.key === 'n' || e.key === 'N') && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    newPageAndOpen();
  }
}

function newPageAndOpen() {
  const page = createPage();
  if (IS_MOBILE) {
    renderMobilePagesList();
    openMobileEditor(page.id);
  } else {
    renderDesktopPagesList();
    openDesktopPage(page.id);
    // Focus editor
    setTimeout(() => DOM.pageEditor.focus(), 100);
  }
}

function showDesktopEmptyState() {
  DOM.emptyState.classList.remove('hidden');
  DOM.editorToolbar.classList.add('hidden');
  DOM.pageContainer.classList.add('hidden');
  state.activePageId = null;
}

function openDesktopPage(id) {
  const page = state.pages.find(p => p.id === id);
  if (!page) return;

  state.activePageId = id;

  // Update UI
  DOM.emptyState.classList.add('hidden');
  DOM.editorToolbar.classList.remove('hidden');
  DOM.pageContainer.classList.remove('hidden');

  // Set content
  DOM.pageEditor.innerHTML = page.content || '';
  DOM.currentPageLabel.textContent = formatDate(page.updatedAt);

  // Highlight active in sidebar
  document.querySelectorAll('.page-list-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });
}

function renderDesktopPagesList() {
  DOM.pagesList.innerHTML = '';
  if (state.pages.length === 0) {
    showDesktopEmptyState();
    return;
  }
  state.pages.forEach(page => {
    const el = createDesktopListItem(page);
    DOM.pagesList.appendChild(el);
  });
}

function createDesktopListItem(page) {
  const el = document.createElement('div');
  el.className = 'page-list-item';
  el.dataset.id = page.id;
  if (page.id === state.activePageId) el.classList.add('active');

  el.innerHTML = `
    <div class="page-item-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    </div>
    <div class="page-item-info">
      <div class="page-item-title">${escHtml(pageTitle(page))}</div>
      <div class="page-item-meta">${formatDate(page.updatedAt)}</div>
    </div>
  `;
  el.addEventListener('click', () => openDesktopPage(page.id));
  return el;
}

function refreshListItemTitle(id) {
  const page = state.pages.find(p => p.id === id);
  if (!page) return;
  const el = DOM.pagesList.querySelector(`[data-id="${id}"]`);
  if (!el) return;
  const titleEl = el.querySelector('.page-item-title');
  const metaEl = el.querySelector('.page-item-meta');
  if (titleEl) titleEl.textContent = pageTitle(page);
  if (metaEl) metaEl.textContent = formatDate(page.updatedAt);
}

async function deleteActivePage() {
  if (!state.activePageId) return;
  const confirmed = await showConfirm('Delete this page? This cannot be undone.');
  if (!confirmed) return;

  const id = state.activePageId;
  const idx = state.pages.findIndex(p => p.id === id);

  deletePage(id);

  // Decide what to open next
  const remaining = state.pages;
  if (remaining.length === 0) {
    renderDesktopPagesList();
    showDesktopEmptyState();
  } else {
    const nextIdx = Math.min(idx, remaining.length - 1);
    renderDesktopPagesList();
    openDesktopPage(remaining[nextIdx].id);
  }
  showToast('Page deleted');
}

function applyDesktopAuthState() {
  if (state.user) {
    DOM.signinArea.classList.add('hidden');
    DOM.userProfile.classList.remove('hidden');
    DOM.userAvatar.src = state.user.picture || '';
    DOM.userName.textContent = state.user.name;
  } else {
    DOM.signinArea.classList.remove('hidden');
    DOM.userProfile.classList.add('hidden');
  }
}

function desktopLogout() {
  state.user = null;
  applyDesktopAuthState();
  showToast('Signed out');
}

// Editor input handler (desktop)
const debouncedDesktopInput = debounce(() => {
  if (!state.activePageId) return;
  updatePageContent(state.activePageId, DOM.pageEditor.innerHTML);
}, 300);

// ─────────────────────────────────────────────────────────────────────────────
//  MOBILE
// ─────────────────────────────────────────────────────────────────────────────

function initMobile() {
  // Nav buttons
  DOM.mPagesBtn.addEventListener('click', () => showMobilePanel('pages'));
  DOM.mNewBtn.addEventListener('click', () => {
    newPageAndOpen();
    showMobilePanel('editor');
  });
  DOM.mAuthBtn.addEventListener('click', () => showMobilePanel('auth'));

  DOM.mBackBtn.addEventListener('click', () => {
    // Save content before leaving
    if (state.activePageId) {
      const content = DOM.mobilePageEditor.innerHTML;
      updatePageContent(state.activePageId, content);
      clearTimeout(state.saveTimer);
      saveData();
    }
    showMobilePanel('pages');
    renderMobilePagesList();
  });

  DOM.mDeleteBtn.addEventListener('click', () => deleteMobilePage());
  DOM.mExportBtn.addEventListener('click', exportData);
  DOM.mLogoutBtn.addEventListener('click', mobileLogout);

  applyMobileAuthState();
  renderMobilePagesList();
}

function showMobilePanel(panel) {
  // panel: 'pages' | 'editor' | 'auth'
  const panels = {
    pages: DOM.mobilePagesPanel,
    editor: DOM.mobileEditorPanel,
    auth: DOM.mobileAuthPanel,
  };

  Object.entries(panels).forEach(([key, el]) => {
    el.classList.toggle('active-panel', key === panel);
  });

  // Nav button active states
  DOM.mPagesBtn.classList.toggle('active', panel === 'pages');
  DOM.mNewBtn.classList.remove('active');
  DOM.mAuthBtn.classList.toggle('active', panel === 'auth');
}

function renderMobilePagesList() {
  DOM.mobilePagesListEl.innerHTML = '';
  if (state.pages.length === 0) {
    DOM.mobileEmptyState.classList.add('visible');
    return;
  }
  DOM.mobileEmptyState.classList.remove('visible');

  state.pages.forEach(page => {
    const el = createMobileListItem(page);
    DOM.mobilePagesListEl.appendChild(el);
  });
}

function createMobileListItem(page) {
  const el = document.createElement('div');
  el.className = 'm-page-item';
  el.dataset.id = page.id;
  el.innerHTML = `
    <div class="m-page-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    </div>
    <div class="m-page-info">
      <div class="m-page-title">${escHtml(pageTitle(page))}</div>
      <div class="m-page-meta">${formatDate(page.updatedAt)}</div>
    </div>
    <div class="m-page-chevron">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
  `;
  el.addEventListener('click', () => {
    openMobileEditor(page.id);
    showMobilePanel('editor');
  });
  return el;
}

function refreshMobileListItemTitle(id) {
  const page = state.pages.find(p => p.id === id);
  if (!page) return;
  const el = DOM.mobilePagesListEl.querySelector(`[data-id="${id}"]`);
  if (!el) return;
  const titleEl = el.querySelector('.m-page-title');
  if (titleEl) titleEl.textContent = pageTitle(page);
}

function openMobileEditor(id) {
  const page = state.pages.find(p => p.id === id);
  if (!page) return;
  state.activePageId = id;
  DOM.mobilePageEditor.innerHTML = page.content || '';
  DOM.mPageLabel.textContent = pageTitle(page);
}

async function deleteMobilePage() {
  if (!state.activePageId) return;
  const confirmed = await showConfirm('Delete this page? This cannot be undone.');
  if (!confirmed) return;

  deletePage(state.activePageId);
  state.activePageId = null;
  DOM.mobilePageEditor.innerHTML = '';
  renderMobilePagesList();
  showMobilePanel('pages');
  showToast('Page deleted');
}

function applyMobileAuthState() {
  if (state.user) {
    // Update avatar in nav
    DOM.mAuthIcon.style.display = 'none';
    DOM.mAvatar.style.display = 'block';
    DOM.mAvatar.src = state.user.picture || '';
    DOM.mAuthLabel.textContent = state.user.name.split(' ')[0];

    // Auth panel
    DOM.mSigninState.classList.add('hidden');
    DOM.mLoggedinState.classList.remove('hidden');
    DOM.mProfileAvatar.src = state.user.picture || '';
    DOM.mProfileName.textContent = state.user.name;
    DOM.mProfileEmail.textContent = state.user.email;
  } else {
    DOM.mAuthIcon.style.display = '';
    DOM.mAvatar.style.display = 'none';
    DOM.mAuthLabel.textContent = 'Sign In';
    DOM.mSigninState.classList.remove('hidden');
    DOM.mLoggedinState.classList.add('hidden');
  }
}

function mobileLogout() {
  state.user = null;
  applyMobileAuthState();
  showToast('Signed out');
}

// Mobile editor input handler
const debouncedMobileInput = debounce(() => {
  if (!state.activePageId) return;
  updatePageContent(state.activePageId, DOM.mobilePageEditor.innerHTML);
}, 300);

// ─── Helpers ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Offline Handling ────────────────────────────────────────────────────────
function setupOfflineHandling() {
  window.addEventListener('offline', () => {
    state.isOnline = false;
    setSyncStatus('offline');
    showToast('You\'re offline — changes saved locally');
  });
  window.addEventListener('online', () => {
    state.isOnline = true;
    setSyncStatus('saved');
    showToast('Back online', 'success');
  });
}

// ─── Service Worker ──────────────────────────────────────────────────────────
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(e => {
      // SW optional, fail silently
    });
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────
function init() {
  // Populate DOM refs
  DOM = {
    // Shared
    toastContainer: document.getElementById('toast-container'),
    confirmOverlay: document.getElementById('confirm-overlay'),
    confirmMessage: document.getElementById('confirm-message'),
    confirmOk: document.getElementById('confirm-ok'),
    confirmCancel: document.getElementById('confirm-cancel'),
    appLoader: document.getElementById('app-loader'),

    // Desktop
    sidebar: document.getElementById('sidebar'),
    sidebarStatus: document.getElementById('sidebar-status'),
    newPageBtn: document.getElementById('new-page-btn'),
    pagesList: document.getElementById('pages-list'),
    signinArea: document.getElementById('signin-area'),
    userProfile: document.getElementById('user-profile'),
    userAvatar: document.getElementById('user-avatar'),
    userName: document.getElementById('user-name'),
    logoutBtn: document.getElementById('logout-btn'),
    exportBtn: document.getElementById('export-btn'),
    editorArea: document.getElementById('editor-area'),
    emptyState: document.getElementById('empty-state'),
    emptyNewBtn: document.getElementById('empty-new-btn'),
    editorToolbar: document.getElementById('editor-toolbar'),
    toolbarStatus: document.getElementById('toolbar-status'),
    currentPageLabel: document.getElementById('current-page-label'),
    deletePageBtn: document.getElementById('delete-page-btn'),
    pageContainer: document.getElementById('page-container'),
    pageEditor: document.getElementById('page-editor'),

    // Mobile
    mobileNav: document.getElementById('mobile-nav'),
    mPagesBtn: document.getElementById('m-pages-btn'),
    mNewBtn: document.getElementById('m-new-btn'),
    mAuthBtn: document.getElementById('m-auth-btn'),
    mAuthIcon: document.getElementById('m-auth-icon'),
    mAvatar: document.getElementById('m-avatar'),
    mAuthLabel: document.getElementById('m-auth-label'),
    mStatus: document.getElementById('m-status'),
    mobilePagesPanel: document.getElementById('mobile-pages-panel'),
    mobilePagesListEl: document.getElementById('mobile-pages-list'),
    mobileEmptyState: document.getElementById('mobile-empty-state'),
    mobileEditorPanel: document.getElementById('mobile-editor-panel'),
    mobileAuthPanel: document.getElementById('mobile-auth-panel'),
    mBackBtn: document.getElementById('m-back-btn'),
    mPageLabel: document.getElementById('m-page-label'),
    mDeleteBtn: document.getElementById('m-delete-btn'),
    mobilePageContainer: document.getElementById('mobile-page-container'),
    mobilePageEditor: document.getElementById('mobile-page-editor'),
    mSigninState: document.getElementById('m-signin-state'),
    mLoggedinState: document.getElementById('m-loggedin-state'),
    mProfileAvatar: document.getElementById('m-profile-avatar'),
    mProfileName: document.getElementById('m-profile-name'),
    mProfileEmail: document.getElementById('m-profile-email'),
    mExportBtn: document.getElementById('m-export-btn'),
    mLogoutBtn: document.getElementById('m-logout-btn'),
  };

  // Load persisted data
  loadData();
  setupOfflineHandling();
  registerServiceWorker();

  // Branch to device mode
  if (IS_MOBILE) {
    initMobile();
  } else {
    initDesktop();
  }

  // Wire editor input events
  if (DOM.pageEditor) {
    DOM.pageEditor.addEventListener('input', debouncedDesktopInput);
    DOM.pageEditor.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    });
  }

  if (DOM.mobilePageEditor) {
    DOM.mobilePageEditor.addEventListener('input', debouncedMobileInput);
    DOM.mobilePageEditor.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    });
  }

  // Initial sync status
  setSyncStatus(navigator.onLine ? 'saved' : 'offline');

  // Remove loader
  setTimeout(() => {
    DOM.appLoader.classList.add('hidden');
  }, 350);
}

document.addEventListener('DOMContentLoaded', init);
