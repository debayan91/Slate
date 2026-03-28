import { state, stateMeta } from '../../core/state.js';
import { triggerAutoSave } from '../../core/persistence.js';
import { findNearestBlock, createNewBlockDOM } from '../../components/textBlock.js';
import { inputState } from '../device.js';
import { CONFIG } from '../../animation/shared.js';

export function setupDesktopMouse(container) {
  if (inputState.isMobileTouch) return; // STRICT mobile ban

  container.addEventListener('click', (e) => {
    if (e.target.isContentEditable) return;

    const pageTarget = e.target.closest('.page');
    if (!pageTarget) return;

    const pageIndex = parseInt(pageTarget.dataset.index);
    if (isNaN(pageIndex)) return;

    const rect = pageTarget.getBoundingClientRect();
    let relX = e.clientX - rect.left;
    let relY = e.clientY - rect.top;

    let targetTop = relY <= CONFIG.LINE_OFFSET ? CONFIG.LINE_OFFSET : CONFIG.LINE_OFFSET + (Math.floor((relY - CONFIG.LINE_OFFSET) / CONFIG.LINE_HEIGHT) * CONFIG.LINE_HEIGHT);
    targetTop -= 2; 
    
    let LEFT_MARGIN = 40;
    if (stateMeta.isDesktop && pageTarget.classList.contains('page-right')) LEFT_MARGIN = 20; 
    if (relX < LEFT_MARGIN) relX = LEFT_MARGIN;

    const pageData = state.pages[pageIndex];
    let nearestBlock = findNearestBlock(pageData, targetTop, relX);

    if (nearestBlock) {
       const domEl = pageTarget.querySelector(`[data-id="${nearestBlock.id}"]`);
       if (domEl) {
         domEl.focus();
         if (typeof window.getSelection !== "undefined" && typeof document.createRange !== "undefined") {
           const range = document.createRange();
           range.selectNodeContents(domEl); range.collapse(false);
           const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
         }
         return;
       }
    }

    const elState = { id: 'block_' + Date.now().toString(36), x: relX, y: targetTop, content: '' };
    pageData.elements.push(elState);
    triggerAutoSave(); 
    
    const textInput = createNewBlockDOM(elState, pageData);
    pageTarget.appendChild(textInput);
    setTimeout(() => textInput.focus(), 15);
  });
  
  // Visual drag is disabled as requested by strict desktop rules.
  container.addEventListener('mousedown', (e) => {
     // Blocks accidental drag triggers on mouse
  });
}
