// Central State Machine
export const state = {
  pages: []
};

export let undoStack = [];
export let stateMeta = {
  currentSpreadIndex: 0,
  isDesktop: window.innerWidth >= 800
};

export function setPages(newPages) {
  state.pages = newPages;
}

export function updateMeta(key, value) {
  stateMeta[key] = value;
}

export function getSpreadCount() {
  const itemsPerSpread = stateMeta.isDesktop ? 2 : 1;
  return Math.ceil(state.pages.length / itemsPerSpread);
}

export function createNewPageObj() {
  return { id: 'page_' + Math.random().toString(36).substr(2), date: new Date(), elements: [] };
}

// History API
export function pushHistorySnapshot(snapshotDataStr) {
  if (undoStack.length > 0 && undoStack[undoStack.length - 1] === snapshotDataStr) return;
  undoStack.push(snapshotDataStr);
  if (undoStack.length > 50) undoStack.shift(); 
}

export function popHistorySnapshot() {
  if (undoStack.length > 1) {
    undoStack.pop(); 
    return undoStack[undoStack.length - 1];
  }
  return null;
}
