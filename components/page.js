import { state, stateMeta } from '../core/state.js';
import { applyTransform } from '../animation/shared.js';
import { renderTextBlocks } from './textBlock.js';

export const domSpreads = { prev: null, curr: null, next: null };

export function buildPageNode(pageIndex, isLeft) {
  if (pageIndex >= state.pages.length || pageIndex < 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = `page ${isLeft ? 'page-left' : 'page-right'}`;
    emptyDiv.style.background = 'transparent';
    emptyDiv.style.boxShadow = 'none';
    return emptyDiv;
  }
  
  const pageData = state.pages[pageIndex];
  const div = document.createElement('div');
  div.className = `page ${isLeft ? 'page-left' : 'page-right'}`;
  div.dataset.index = pageIndex;
  
  const dateStr = pageData.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const dateDom = document.createElement('div');
  dateDom.className = 'page-date';
  dateDom.textContent = dateStr;
  div.appendChild(dateDom);
  
  const pageNum = document.createElement('div');
  pageNum.className = 'page-number';
  pageNum.textContent = `Page ${pageIndex + 1}`;
  div.appendChild(pageNum);
  
  renderTextBlocks(div, pageData);
  return div;
}

export function buildSpreadNode(spreadIndex) {
  const div = document.createElement('div');
  div.className = 'spread';
  
  if (stateMeta.isDesktop) {
    div.appendChild(buildPageNode(spreadIndex * 2, true));
    div.appendChild(buildPageNode(spreadIndex * 2 + 1, false));
  } else {
    div.appendChild(buildPageNode(spreadIndex, false)); 
  }
  return div;
}

export function renderDomSpreads(container, getSpreadCount) {
  if (state.pages.length === 0) return;
  container.innerHTML = '';
  
  domSpreads.curr = buildSpreadNode(stateMeta.currentSpreadIndex);
  applyTransform(domSpreads.curr, 0);
  container.appendChild(domSpreads.curr);
  
  if (stateMeta.currentSpreadIndex > 0) {
    domSpreads.prev = buildSpreadNode(stateMeta.currentSpreadIndex - 1);
    applyTransform(domSpreads.prev, -100);
    container.appendChild(domSpreads.prev);
  } else { domSpreads.prev = null; }
  
  if (stateMeta.currentSpreadIndex < getSpreadCount() - 1) {
    domSpreads.next = buildSpreadNode(stateMeta.currentSpreadIndex + 1);
    applyTransform(domSpreads.next, 100);
    container.appendChild(domSpreads.next);
  } else { domSpreads.next = null; }
}
