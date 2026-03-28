import { state, pushHistorySnapshot } from './state.js';
import { showToast, setSyncUI } from '../components/indicators.js';

let autoSaveTimer = null;

export function loadLocalData(fallbackCb) {
  try {
    const localPayload = localStorage.getItem('notebook_pages_mod');
    if (localPayload) {
      const parsed = JSON.parse(localPayload);
      state.pages = parsed.map(p => ({ ...p, date: new Date(p.date) }));
      return true;
    }
  } catch(e) {
    showToast("Error loading saved pages", true);
  }
  
  if (fallbackCb) fallbackCb();
  return false;
}

export function syncToLocal() {
  setSyncUI('Saving...', true);
  try {
    localStorage.setItem('notebook_pages_mod', JSON.stringify(state.pages));
    setTimeout(() => setSyncUI('Saved', false), 400); 
  } catch (e) {
    showToast("Storage quota exceeded", true);
  }
}

export function triggerAutoSave() {
  clearTimeout(autoSaveTimer);
  setSyncUI('Saving...', true);
  autoSaveTimer = setTimeout(() => {
    pushHistorySnapshot(JSON.stringify(state.pages)); 
    syncToLocal();
  }, 1200);
}

export function exportDataJson() {
  try {
    const blob = new Blob([JSON.stringify(state.pages, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `Notebook_Modular_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Export successful");
  } catch(e) {
    showToast("Export failed", true);
  }
}
