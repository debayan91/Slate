// State & Config
const state = {
  pages: [{ id: 0, elements: [] }],
  currentIndex: 0
};

const LINE_HEIGHT = 32;
const LINE_OFFSET = 40; // background-position offsetY
const LEFT_MARGIN = 40; // account for red line at 32px
const SWIPE_THRESHOLD = 0.25; // 25% screen width needed to commit pageturn
const VELOCITY_THRESHOLD = 0.6; // swipe speed limit vs distance

const container = document.getElementById('notebook-container');

// DOM cache max 3 pages
const domPages = { prev: null, curr: null, next: null };

// Gestures State
let touchStartX = 0;
let touchStartY = 0;
let touchCurrentX = 0;
let touchCurrentY = 0;
let startTime = 0;
let isSwiping = false;
let startXForDelta = 0;
let animationTimeout = null;

function init() {
  renderDomPages();
  setupEventListeners();
}

function ensurePageExists(index) {
  while (state.pages.length <= index) {
    state.pages.push({ id: state.pages.length, elements: [] });
  }
}

// Model Manipulation
function createTextElement(pageIndex, x, y) {
  const el = {
    id: 'block_' + Date.now().toString(36) + Math.random().toString(36).substr(2),
    x,
    y,
    content: ''
  };
  ensurePageExists(pageIndex);
  state.pages[pageIndex].elements.push(el);
  return el;
}

// View Building
function renderTextBlocks(pageDiv, pageIndex) {
  const existing = pageDiv.querySelectorAll('.text-block');
  existing.forEach(el => el.remove());

  const pageData = state.pages[pageIndex] || { elements: [] };
  pageData.elements.forEach(el => {
    const div = document.createElement('div');
    div.className = 'text-block';
    div.contentEditable = true;
    div.style.left = `${el.x}px`;
    div.style.top = `${el.y}px`;
    div.innerHTML = el.content;
    div.dataset.id = el.id;
    bindTextBlockEvents(div, el, pageIndex);
    pageDiv.appendChild(div);
  });
}

function bindTextBlockEvents(div, stateEl, pageIndex) {
  // Sync view -> model
  div.addEventListener('input', (e) => {
    stateEl.content = e.target.innerHTML;
  });
  
  div.addEventListener('blur', (e) => {
    div.style.background = 'transparent';
    // Clean up empty block to reduce DOM clutter
    if (!e.target.textContent.trim()) {
      e.target.remove();
      state.pages[pageIndex].elements = state.pages[pageIndex].elements.filter(item => item.id !== stateEl.id);
    }
  });

  // Small visual enhancement to see bounds during edit
  div.addEventListener('focus', () => {
    div.style.background = 'rgba(59, 130, 246, 0.05)';
  });
}

function buildPageNode(index) {
  const div = document.createElement('div');
  div.className = 'page';
  div.dataset.index = index;
  
  const pageNum = document.createElement('div');
  pageNum.className = 'page-number';
  pageNum.textContent = `Page ${index + 1}`;
  div.appendChild(pageNum);
  
  renderTextBlocks(div, index);
  return div;
}

function applyTransform(el, translationPercent) {
  if (el) {
    el.style.transform = `translate3d(${translationPercent}vw, 0, 0)`;
  }
}

function renderDomPages() {
  container.innerHTML = '';
  ensurePageExists(state.currentIndex);
  
  domPages.curr = buildPageNode(state.currentIndex);
  applyTransform(domPages.curr, 0);
  container.appendChild(domPages.curr);
  
  if (state.currentIndex > 0) {
    ensurePageExists(state.currentIndex - 1);
    domPages.prev = buildPageNode(state.currentIndex - 1);
    applyTransform(domPages.prev, -100);
    container.appendChild(domPages.prev);
  } else {
    domPages.prev = null;
  }
  
  ensurePageExists(state.currentIndex + 1);
  domPages.next = buildPageNode(state.currentIndex + 1);
  applyTransform(domPages.next, 100);
  container.appendChild(domPages.next);
}

// Logic Mapping Events
function setupEventListeners() {
  // Touch
  container.addEventListener('touchstart', onTouchStart, { passive: false });
  container.addEventListener('touchmove', onTouchMove, { passive: false });
  container.addEventListener('touchend', onTouchEnd);
  
  // Mouse (for testing parity)
  container.addEventListener('mousedown', onTouchStart);
  window.addEventListener('mousemove', onTouchMove);
  window.addEventListener('mouseup', onTouchEnd);
  
  // Click listener handles generic tap dispatch handling because browsers simulate it later
  container.addEventListener('click', onClick);
}

function getCoords(e) {
  const evt = (e.touches && e.touches.length) ? e.touches[0] : (e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e);
  return { x: evt.clientX, y: evt.clientY };
}

function toggleAnimatingClass(isEnabled) {
  [domPages.prev, domPages.curr, domPages.next].forEach(page => {
    if (page) {
      if (isEnabled) page.classList.add('animating');
      else page.classList.remove('animating');
    }
  });
}

function onTouchStart(e) {
  if (e.target.isContentEditable) return; // Allow native typing controls
  if (animationTimeout) return; // Prevent spamming swipe mid-snap
  
  const coords = getCoords(e);
  touchStartX = coords.x;
  touchStartY = coords.y;
  startXForDelta = coords.x;
  touchCurrentX = touchStartX;
  touchCurrentY = touchStartY;
  startTime = Date.now();
  isSwiping = false;
  
  toggleAnimatingClass(false);
}

function onTouchMove(e) {
  if (animationTimeout) return;
  if (document.activeElement && document.activeElement.isContentEditable) return; // typing focus active
  
  const coords = getCoords(e);
  const dx = coords.x - touchStartX;
  const dy = coords.y - touchStartY;
  
  // Check once per start cycle if it's horizontal swipe vs scroll trigger
  if (!isSwiping && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
    isSwiping = true;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  
  if (isSwiping) {
    e.preventDefault(); // lock viewport
    touchCurrentX = coords.x;
    touchCurrentY = coords.y;
    
    // Live tracking
    const deltaXPercent = ((coords.x - startXForDelta) / window.innerWidth) * 100;
    
    // Hard stop dragging right if on first page
    let finalPercent = deltaXPercent;
    if (state.currentIndex === 0 && finalPercent > 0) {
      finalPercent = finalPercent * 0.2; // Rubber band friction effect
    }
    
    applyTransform(domPages.curr, finalPercent);
    applyTransform(domPages.prev, -100 + finalPercent);
    applyTransform(domPages.next, 100 + finalPercent);
  }
}

function onTouchEnd(e) {
  if (!isSwiping) return; // Tap resolution happens in onClick
  
  const coords = getCoords(e);
  const deltaX = coords.x - startXForDelta;
  const deltaXPercent = (deltaX / window.innerWidth) * 100;
  
  const velocity = Math.abs(deltaX) / Math.max(1, Date.now() - startTime);
  let dir = 0; // 0=stay, -1=prev, 1=next
  
  if (Math.abs(deltaXPercent) > (SWIPE_THRESHOLD * 100) || velocity > VELOCITY_THRESHOLD) {
    if (deltaX > 0 && state.currentIndex > 0) {
      dir = -1; // user swept right, pull left page in
    } else if (deltaX < 0) {
      dir = 1; // user swept left, pull right page in
    }
  }
  
  executeSnap(dir);
  isSwiping = false;
}

function executeSnap(direction) {
  toggleAnimatingClass(true);
  
  if (direction === -1) {
    state.currentIndex--;
    applyTransform(domPages.prev, 0);
    applyTransform(domPages.curr, 100);
  } else if (direction === 1) {
    state.currentIndex++;
    applyTransform(domPages.curr, -100);
    applyTransform(domPages.next, 0);
  } else {
    // Return back to neutral
    applyTransform(domPages.prev, -100);
    applyTransform(domPages.curr, 0);
    applyTransform(domPages.next, 100);
  }
  
  // Queue DOM reconstruction strictly after 350ms CSS transition completes
  animationTimeout = setTimeout(() => {
    if (direction !== 0) {
      renderDomPages();
    }
    toggleAnimatingClass(false);
    animationTimeout = null;
  }, 350);
}

function onClick(e) {
  // Ignore purely swiped touches disguised as clicks
  if (Math.abs(touchStartX - touchCurrentX) > 10 || Math.abs(touchStartY - touchCurrentY) > 10 || isSwiping) {
    return; 
  }
  
  if (e.target.isContentEditable) return;
  // Ensure we operate inside the current page scope specifically
  const pageTarget = e.target.closest('.page');
  if (!pageTarget || pageTarget !== domPages.curr) return;
  
  const rect = domPages.curr.getBoundingClientRect();
  let relX = e.clientX - rect.left;
  let relY = e.clientY - rect.top;
  
  // Magnetic baseline snapping mechanism:
  // Offset=40px, Height=32px per line unit
  // We want the text element's top position to snap such that baseline aligns natively
  let targetTop;
  if (relY <= LINE_OFFSET) {
    targetTop = LINE_OFFSET;
  } else {
    // Nearest integer line gap multiple
    const multiples = Math.floor((relY - LINE_OFFSET) / LINE_HEIGHT);
    targetTop = LINE_OFFSET + (multiples * LINE_HEIGHT);
  }
  
  // Shift slightly to account for red margin line visuals
  if (relX < LEFT_MARGIN) {
    relX = LEFT_MARGIN;
  }
  
  // Shift block upwards slightly so text perfectly centers/sits on the gradient rule
  targetTop -= 2; 

  const elState = createTextElement(state.currentIndex, relX, targetTop);
  
  // Direct insert to avoid whole page re-render disruption
  const textInput = document.createElement('div');
  textInput.className = 'text-block';
  textInput.contentEditable = true;
  textInput.style.left = `${elState.x}px`;
  textInput.style.top = `${elState.y}px`;
  textInput.style.minHeight = `${LINE_HEIGHT}px`;
  textInput.dataset.id = elState.id;
  
  bindTextBlockEvents(textInput, elState, state.currentIndex);
  domPages.curr.appendChild(textInput);
  
  setTimeout(() => textInput.focus(), 15);
}

// Kickoff
init();
