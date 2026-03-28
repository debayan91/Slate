import { loadLocalData, triggerAutoSave, exportDataJson, showToast } from './core/persistence.js';
import { state, stateMeta, updateMeta, getSpreadCount, createNewPageObj } from './core/state.js';
import { renderDomSpreads } from './components/page.js';
import { setupGallery, openGallery, closeGallery } from './components/gallery.js';
import { initDeviceMode, inputState } from './interactions/device.js';
import { setupDesktopKeyboard } from './interactions/desktop/keyboard.js';
import { setupDesktopMouse } from './interactions/desktop/mouse.js';
import { setupMobileGestures } from './interactions/mobile/gestures.js';
import { decodeJwtPayload } from './utils/helpers.js';

// DOM Reference Mapping
const DOM = {
  container: document.getElementById('notebook-container'),
  galleryBtn: document.getElementById('gallery-btn'),
  notebookBtn: document.getElementById('notebook-btn'),
  galleryView: document.getElementById('gallery-view'),
  notebookView: document.getElementById('notebook-view'),
  scroller: document.getElementById('gallery-scroller'),
  galleryEmpty: document.getElementById('gallery-empty'),
  scrollIndicator: document.getElementById('scroll-indicator'),
  dateTitle: document.getElementById('date-title'),
  syncStatus: document.getElementById('sync-status')
};

// =========================
// APPLICATION ENTRYPOINT
// =========================
function boot() {
  initDeviceMode(); 
  
  // Set up modular handlers
  setupGallery(DOM, () => renderDomSpreads(DOM.container, getSpreadCount));
  
  if (inputState.isMobileTouch) {
    setupMobileGestures(DOM.container, () => openGallery(DOM));
  } else {
    setupDesktopKeyboard(DOM.container);
    setupDesktopMouse(DOM.container);
  }

  // Load state and trigger initial UI boot
  const loaded = loadLocalData(() => {
    // fallback if missing
    state.pages = [];
  });

  if (state.pages.length === 0) {
    openGallery(DOM);
  } else {
    updateMeta('currentSpreadIndex', Math.max(0, getSpreadCount() - 1));
    renderDomSpreads(DOM.container, getSpreadCount);
    updateDateTitle();
  }

  // Bind Buttons
  document.getElementById('new-page-btn').addEventListener('click', () => {
    state.pages.push(createNewPageObj());
    closeGallery(DOM, () => renderDomSpreads(DOM.container, getSpreadCount));
    triggerAutoSave();
  });
  
  document.getElementById('export-btn').addEventListener('click', exportDataJson);
  
  // Screen Resize Mapper
  window.addEventListener('resize', () => {
    const newIsDesktop = window.innerWidth >= 800;
    if (newIsDesktop !== stateMeta.isDesktop) {
      updateMeta('isDesktop', newIsDesktop);
      const pagesPerSpread = newIsDesktop ? 2 : 1;
      let absolutePageIndex = stateMeta.currentSpreadIndex * (newIsDesktop ? 1 : 2); 
      updateMeta('currentSpreadIndex', Math.floor(absolutePageIndex / pagesPerSpread));
      if (state.pages.length > 0) renderDomSpreads(DOM.container, getSpreadCount);
    }
  });
}

export function updateDateTitle() {
  const pIndex = stateMeta.isDesktop ? stateMeta.currentSpreadIndex * 2 : stateMeta.currentSpreadIndex;
  if(state.pages[pIndex]) {
    DOM.dateTitle.textContent = state.pages[pIndex].date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
}

// Google Auth Handlers
window.handleCredentialResponse = function(response) {
  try {
    const payload = decodeJwtPayload(response.credential);
    if (payload.picture) {
      document.getElementById('user-avatar').src = payload.picture;
      document.getElementById('user-profile').classList.remove('hidden');
      document.querySelector('.g_id_signin').classList.add('hidden');
      showToast("Signed in as " + payload.name);
    }
  } catch (e) {
    showToast("Authentication failed", true);
  }
};

document.getElementById('user-avatar').addEventListener('click', () => {
  document.getElementById('user-menu').classList.toggle('hidden');
});

document.getElementById('logout-btn').addEventListener('click', () => {
  document.getElementById('user-profile').classList.add('hidden');
  document.querySelector('.g_id_signin').classList.remove('hidden');
  document.getElementById('user-menu').classList.add('hidden');
  showToast("Logged out successfully");
});

document.addEventListener("DOMContentLoaded", boot);
