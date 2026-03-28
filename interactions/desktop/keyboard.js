import { state, stateMeta, updateMeta, getSpreadCount } from '../../core/state.js';
import { renderDomSpreads } from '../../components/page.js';
import { performUndo } from '../../core/persistence.js';
import { inputState } from '../device.js';

export function setupDesktopKeyboard(container) {
  if (inputState.isMobileTouch) return; // STRICT separation

  document.addEventListener('keydown', (e) => {
    // Exclude if typing in a text editable block
    if (document.activeElement && document.activeElement.isContentEditable) return;

    if (e.key === 'ArrowRight') {
      if (stateMeta.currentSpreadIndex < getSpreadCount() - 1) {
        updateMeta('currentSpreadIndex', stateMeta.currentSpreadIndex + 1);
        renderDomSpreads(container, getSpreadCount);
      }
    } else if (e.key === 'ArrowLeft') {
      if (stateMeta.currentSpreadIndex > 0) {
        updateMeta('currentSpreadIndex', stateMeta.currentSpreadIndex - 1);
        renderDomSpreads(container, getSpreadCount);
      }
    } 
    
    // Undo handling
    if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      performUndo();
    }
  });

  // Block native trackpad swipes crossing over to history navigation
  container.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault(); // Prevent accidental page flip
    }
  }, { passive: false });
}
