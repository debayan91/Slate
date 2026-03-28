import { state, stateMeta, updateMeta, getSpreadCount } from '../../core/state.js';
import { performZoomTransition, applyTransform, toggleAnimatingClass, CONFIG } from '../../animation/shared.js';
import { domSpreads, renderDomSpreads } from '../../components/page.js';
import { inputState } from '../device.js';
import { throttleRAF } from '../../utils/helpers.js';

let touchStartX = 0, touchStartY = 0, touchCurrentX = 0, touchCurrentY = 0;
let startTime = 0, isSwiping = false, startXForDelta = 0;
let animationTimeout = null;

let isPinching = false, initialPinchDistance = null;

function getCoords(e) {
  const evt = (e.touches && e.touches.length) ? e.touches[0] : (e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e);
  return { x: evt.clientX, y: evt.clientY };
}

function getPinchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx*dx + dy*dy);
}

export function setupMobileGestures(container, openGalleryCb) {
  if (!inputState.isMobileTouch) return; // STRICT desktop ban

  container.addEventListener('touchstart', onTouchStart, { passive: false });
  // Pass RAF throttled callback
  container.addEventListener('touchmove', throttleRAF((e) => onTouchMove(e, openGalleryCb)), { passive: false });
  container.addEventListener('touchend', onTouchEnd);
  
  // NOTE: Touch writing (tap) is handled similarly to mouse but restricted to touch logic
  // Since "writing UX correctness" requires tap near text to continue, we attach touchstart click logic here
  container.addEventListener('click', (e) => {
    // Rely exclusively on touchstart/touchend logic mapping, discarding native synthetic click noise
  });
}

function onTouchStart(e) {
  if (e.target.isContentEditable) return; 
  if (animationTimeout) return; 
  
  if (e.touches && e.touches.length === 2) {
    isPinching = true;
    initialPinchDistance = getPinchDistance(e.touches);
    return;
  }
  
  isPinching = false;
  const coords = getCoords(e);
  touchStartX = coords.x; touchStartY = coords.y;
  startXForDelta = coords.x;
  touchCurrentX = touchStartX; touchCurrentY = touchStartY;
  startTime = Date.now();
  isSwiping = false;
  
  toggleAnimatingClass(Object.values(domSpreads), false);
}

function onTouchMove(e, openGalleryCb) {
  if (animationTimeout) return;
  if (document.activeElement && document.activeElement.isContentEditable) return; 
  
  if (isPinching && e.touches && e.touches.length === 2) {
    e.preventDefault();
    const currentDist = getPinchDistance(e.touches);
    if (initialPinchDistance - currentDist > 50) { 
      isPinching = false; 
      if (openGalleryCb) openGalleryCb();
    }
    return;
  }
  if (isPinching) return; 

  const coords = getCoords(e);
  const dx = coords.x - touchStartX;
  const dy = coords.y - touchStartY;
  
  if (!isSwiping && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
    isSwiping = true;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  
  if (isSwiping) {
    e.preventDefault(); 
    
    touchCurrentX = coords.x;
    touchCurrentY = coords.y;
    
    let deltaXPercent = ((coords.x - startXForDelta) / window.innerWidth) * 100;
    
    if (stateMeta.currentSpreadIndex === 0 && deltaXPercent > 0) deltaXPercent *= 0.2;
    if (stateMeta.currentSpreadIndex === getSpreadCount() - 1 && deltaXPercent < 0) deltaXPercent *= 0.2;
    
    applyTransform(domSpreads.curr, deltaXPercent);
    applyTransform(domSpreads.prev, -100 + deltaXPercent);
    applyTransform(domSpreads.next, 100 + deltaXPercent);
  }
}

function onTouchEnd(e) {
  isPinching = false; 
  if (!isSwiping) {
     // Trigger Tap logic since movement was negligible
     handleMobileTap(e);
     return; 
  }
  
  const coords = getCoords(e);
  const deltaX = coords.x - startXForDelta;
  const deltaXPercent = (deltaX / window.innerWidth) * 100;
  
  const velocity = Math.abs(deltaX) / Math.max(1, Date.now() - startTime);
  let dir = 0; 
  
  if (Math.abs(deltaXPercent) > (CONFIG.SWIPE_THRESHOLD * 100) || velocity > CONFIG.VELOCITY_THRESHOLD) {
    if (deltaX > 0 && stateMeta.currentSpreadIndex > 0) dir = -1;
    else if (deltaX < 0 && stateMeta.currentSpreadIndex < getSpreadCount() - 1) dir = 1; 
  }
  
  executeSnap(dir);
  isSwiping = false;
}

function executeSnap(direction) {
  toggleAnimatingClass(Object.values(domSpreads), true);
  
  if (direction === -1) {
    updateMeta('currentSpreadIndex', stateMeta.currentSpreadIndex - 1);
    applyTransform(domSpreads.prev, 0);
    applyTransform(domSpreads.curr, 100);
  } else if (direction === 1) {
    updateMeta('currentSpreadIndex', stateMeta.currentSpreadIndex + 1);
    applyTransform(domSpreads.curr, -100);
    applyTransform(domSpreads.next, 0);
  } else {
    applyTransform(domSpreads.prev, -100);
    applyTransform(domSpreads.curr, 0);
    applyTransform(domSpreads.next, 100);
  }
  
  animationTimeout = setTimeout(() => {
    if (direction !== 0) renderDomSpreads(document.getElementById('notebook-container'), getSpreadCount);
    toggleAnimatingClass(Object.values(domSpreads), false);
    animationTimeout = null;
  }, CONFIG.TRANSITION_DUR);
}

// Ensure tap runs writing logic precisely
function handleMobileTap(e) {
   // TBD identical to mouse logic but tuned for touch
   // To avoid duplication, we can reuse the generic 'findNearestBlock' math exported from components
}
