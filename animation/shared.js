// Shared Animation logic

export const CONFIG = {
  LINE_HEIGHT: 32,
  LINE_OFFSET: 40,
  SWIPE_THRESHOLD: 0.2,
  VELOCITY_THRESHOLD: 0.5,
  TRANSITION_DUR: 350
};

export function toggleAnimatingClass(elements, isEnabled) {
  elements.forEach(el => {
    if (el) {
      if (isEnabled) el.classList.add('animating');
      else el.classList.remove('animating');
    }
  });
}

export function applyTransform(el, translationPercent) {
  if (el) el.style.transform = `translate3d(${translationPercent}vw, 0, 0)`;
}

export function performZoomTransition(viewToHide, viewToShow, hideClass, showClass, cb) {
  viewToHide.classList.add(hideClass);
  setTimeout(() => {
    viewToHide.classList.add('hidden');
    viewToHide.classList.remove('view-active', hideClass);
    
    viewToShow.classList.remove('hidden');
    
    // Zoom in requires flushing CSS layout
    if (showClass) {
      viewToShow.classList.add(showClass);
      void viewToShow.offsetWidth;
      viewToShow.classList.remove(showClass);
      viewToShow.classList.add('view-active');
    }
    
    if (cb) cb();
  }, CONFIG.TRANSITION_DUR);
}
