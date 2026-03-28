import { state, stateMeta, updateMeta } from '../core/state.js';
import { performZoomTransition } from '../animation/shared.js';
import { showToast } from './indicators.js';

export function setupGallery(domRefs, openPageCb) {
  domRefs.galleryBtn.addEventListener('click', () => openGallery(domRefs));
  domRefs.notebookBtn.addEventListener('click', () => closeGallery(domRefs, openPageCb));
  
  domRefs.scroller.addEventListener('scroll', () => {
    domRefs.scrollIndicator.classList.remove('hidden');
    clearTimeout(domRefs.scroller.indicatorTimeout);
    domRefs.scroller.indicatorTimeout = setTimeout(() => domRefs.scrollIndicator.classList.add('hidden'), 1500);

    const headers = document.querySelectorAll('.month-header');
    let currentHeader = headers[0];
    for(let h of headers) {
      if (h.getBoundingClientRect().top <= 140) currentHeader = h;
    }
    if (currentHeader) domRefs.scrollIndicator.textContent = currentHeader.textContent;
  });
}

function groupByMonth(pages) {
  const groups = {};
  pages.forEach((p, idx) => {
    const monthYear = p.date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (!groups[monthYear]) groups[monthYear] = [];
    groups[monthYear].push({ ...p, originalIndex: idx });
  });
  return groups;
}

export function renderGallery(domRefs, openPageCb) {
  domRefs.scroller.innerHTML = ''; 
  if (state.pages.length === 0) {
    domRefs.galleryEmpty.classList.remove('hidden');
    return;
  }
  domRefs.galleryEmpty.classList.add('hidden');
  
  const groups = groupByMonth(state.pages);
  const sortedMonths = Object.keys(groups).sort((a,b) => new Date(b) - new Date(a));
  
  sortedMonths.forEach(month => {
    const mDiv = document.createElement('div');
    mDiv.className = 'gallery-month';
    const h2 = document.createElement('h2'); h2.className = 'month-header'; h2.textContent = month; mDiv.appendChild(h2);
    
    const grid = document.createElement('div');
    grid.className = 'gallery-grid';
    
    groups[month].sort((a,b) => b.date - a.date).forEach(pInfo => {
      const thumb = document.createElement('div'); thumb.className = 'gallery-thumb';
      const thumbDate = document.createElement('div'); thumbDate.className = 'thumb-date'; thumbDate.textContent = pInfo.date.getDate(); thumb.appendChild(thumbDate);
      
      if (pInfo.elements.length > 0) {
        const snippet = document.createElement('div'); snippet.className = 'thumb-content';
        snippet.textContent = pInfo.elements[0].content.replace(/<[^>]*>?/gm, '').substring(0, 50);
        thumb.appendChild(snippet);
      }
      thumb.addEventListener('click', () => {
         updateMeta('currentSpreadIndex', Math.floor(pInfo.originalIndex / (stateMeta.isDesktop ? 2 : 1)));
         closeGallery(domRefs, openPageCb);
      });
      grid.appendChild(thumb);
    });
    
    mDiv.appendChild(grid); domRefs.scroller.appendChild(mDiv);
  });
}

export function openGallery(domRefs) {
  renderGallery(domRefs);
  performZoomTransition(domRefs.notebookView, domRefs.galleryView, 'zoom-out', null, () => {
    domRefs.galleryBtn.classList.add('hidden');
    domRefs.notebookBtn.classList.remove('hidden');
    domRefs.dateTitle.textContent = state.pages.length === 0 ? "" : "Gallery";
    domRefs.syncStatus.classList.add('hidden'); 
  });
}

export function closeGallery(domRefs, openPageCb) {
  if (state.pages.length === 0) {
    showToast("Create a page first to open notebook");
    return;
  }
  
  performZoomTransition(domRefs.galleryView, domRefs.notebookView, null, 'zoom-in', () => {
    domRefs.galleryBtn.classList.remove('hidden');
    domRefs.notebookBtn.classList.add('hidden');
    domRefs.syncStatus.classList.remove('hidden');
    
    if (openPageCb) openPageCb();
  });
}
