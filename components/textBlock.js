import { triggerAutoSave } from '../core/persistence.js';
import { CONFIG } from '../animation/shared.js';

export function renderTextBlocks(pageDiv, pageData) {
  pageData.elements.forEach(el => {
    const div = document.createElement('div');
    div.className = 'text-block';
    div.contentEditable = true;
    div.style.left = `${el.x}px`;
    div.style.top = `${el.y}px`;
    div.innerHTML = el.content;
    div.dataset.id = el.id;
    bindTextBlockEvents(div, el, pageData);
    
    if (!el.content) {
      div.style.minHeight = `${CONFIG.LINE_HEIGHT}px`;
      div.style.minWidth = "20px";
      div.dataset.placeholder = "Start writing...";
    }
    pageDiv.appendChild(div);
  });
}

export function bindTextBlockEvents(div, stateEl, pageData) {
  div.addEventListener('input', (e) => {
    stateEl.content = e.target.innerHTML;
    triggerAutoSave();
  });
  
  div.addEventListener('blur', (e) => {
    if (!e.target.textContent.trim()) {
      e.target.remove();
      pageData.elements = pageData.elements.filter(item => item.id !== stateEl.id);
      triggerAutoSave();
    }
  });
}

// Logic to check if an arbitrary tap/click is near an existing block
export function findNearestBlock(pageData, targetTop, relX) {
  for (let el of pageData.elements) {
    if (Math.abs(el.y - targetTop) <= CONFIG.LINE_HEIGHT/2 + 2 && Math.abs(el.x - relX) < 120) {
      return el;
    }
  }
  return null;
}

export function createNewBlockDOM(elState, pageData) {
  const textInput = document.createElement('div');
  textInput.className = 'text-block'; 
  textInput.contentEditable = true;
  textInput.style.left = `${elState.x}px`; 
  textInput.style.top = `${elState.y}px`;
  textInput.style.minHeight = `${CONFIG.LINE_HEIGHT}px`; 
  textInput.dataset.id = elState.id;
  bindTextBlockEvents(textInput, elState, pageData);
  return textInput;
}
