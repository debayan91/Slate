// =========================
// STATE & DATA MODEL
// =========================

const state = {
  pages: [],
};
let currentSpreadIndex = 0;
let isDesktop = window.innerWidth >= 800;
let undoStack = []; // History stack for Cmd+Z

// Config
const LINE_HEIGHT = 32;
const LINE_OFFSET = 40; 
const SWIPE_THRESHOLD = 0.2; 
const VELOCITY_THRESHOLD = 0.5;

// DOM Elements
const nbContainer = document.getElementById('notebook-container');
const galleryView = document.getElementById('gallery-view');
const notebookView = document.getElementById('notebook-view');
const galleryBtn = document.getElementById('gallery-btn');
const notebookBtn = document.getElementById('notebook-btn');
const dateTitle = document.getElementById('date-title');

// DOM cache max 3 spreads
const domSpreads = { prev: null, curr: null, next: null };

// Gestures State
let touchStartX = 0, touchStartY = 0, touchCurrentX = 0, touchCurrentY = 0;
let startTime = 0, isSwiping = false, startXForDelta = 0;
let animationTimeout = null;

// Pinch State
let initialPinchDistance = null;
let isPinching = false;

// =========================
// INITIALIZATION & MOCK DATA
// =========================

function init() {
  generateMockData();
  saveHistory(true); // Initial state
  
  window.addEventListener('resize', handleResize);
  setupGestures();
  setupGallery();
  setupAuth();
  setupKeyboard();
  
  // Render initial
  renderDomSpreads();
  updateTopBarTitle();
}

function generateMockData() {
  const now = new Date();
  state.pages = [];
  
  // Generate 12 pages spanning recent months 
  for(let i = 11; i >= 0; i--) {
    let d = new Date(now);
    d.setDate(d.getDate() - (i * 12)); // Spread dates backwards
    
    state.pages.push({
      id: 'page_' + Date.now() + i,
      date: new Date(d),
      elements: i === 11 ? [
        { id: 'el1', x: 50, y: LINE_OFFSET + LINE_HEIGHT * 2 - 2, content: "Welcome to the real notebook experience." },
        { id: 'el2', x: 50, y: LINE_OFFSET + LINE_HEIGHT * 3 - 2, content: "Pinch out to view all your pages." }
      ] : []
    });
  }
}

function handleResize() {
  const newIsDesktop = window.innerWidth >= 800;
  if (newIsDesktop !== isDesktop) {
    isDesktop = newIsDesktop;
    // Map current spread index to maintain reading position
    const pagesPerSpread = isDesktop ? 2 : 1;
    let absolutePageIndex = currentSpreadIndex * (isDesktop ? 1 : 2); // Approximation if shrinking
    
    // Safety check recalculation
    currentSpreadIndex = Math.floor(absolutePageIndex / pagesPerSpread);
    renderDomSpreads();
  }
}

// =========================
// HISTORY (UNDO)
// =========================

// Deep clone state for history
function saveHistory(isInitial = false) {
  const snapshot = JSON.stringify(state.pages);
  // Don't save duplicate consecutive states
  if (undoStack.length > 0 && undoStack[undoStack.length - 1] === snapshot) return;
  
  undoStack.push(snapshot);
  if (undoStack.length > 50) undoStack.shift(); // Max 50 undos
}

function performUndo() {
  if (undoStack.length > 1) { // Leave the oldest intact
    undoStack.pop(); // Pop current
    const prevState = undoStack[undoStack.length - 1];
    state.pages = JSON.parse(prevState);
    // Re-hydrate Date objects after JSON parse
    state.pages.forEach(p => p.date = new Date(p.date));
    
    if (galleryView.classList.contains('hidden')) {
      renderDomSpreads();
    } else {
      renderGallery();
    }
  }
}

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      performUndo();
    }
  });
}

// =========================
// NOTEBOOK DOM RENDERING 
// =========================

function getSpreadCount() {
  const itemsPerSpread = isDesktop ? 2 : 1;
  return Math.ceil(state.pages.length / itemsPerSpread);
}

function buildPageNode(pageIndex, isLeft) {
  if (pageIndex >= state.pages.length || pageIndex < 0) {
    // Return empty placeholder div for unbalanced pairs
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
  
  // Date in corner
  const dateStr = pageData.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const dateDom = document.createElement('div');
  dateDom.className = 'page-date';
  dateDom.textContent = dateStr;
  div.appendChild(dateDom);
  
  // Page Num
  const pageNum = document.createElement('div');
  pageNum.className = 'page-number';
  pageNum.textContent = `Page ${pageIndex + 1}`;
  div.appendChild(pageNum);
  
  renderTextBlocks(div, pageData);
  return div;
}

function renderTextBlocks(pageDiv, pageData) {
  pageData.elements.forEach(el => {
    const div = document.createElement('div');
    div.className = 'text-block';
    div.contentEditable = true;
    div.style.left = `${el.x}px`;
    div.style.top = `${el.y}px`;
    div.innerHTML = el.content;
    div.dataset.id = el.id;
    bindTextBlockEvents(div, el, pageData);
    
    // For empty initial blocks
    if (!el.content) {
      div.style.minHeight = `${LINE_HEIGHT}px`;
      div.style.minWidth = "20px";
      div.dataset.placeholder = "Start writing...";
    }
    
    pageDiv.appendChild(div);
  });
}

// Debounce timer for saving history on typing
let typingTimeout = null;

function bindTextBlockEvents(div, stateEl, pageData) {
  div.addEventListener('input', (e) => {
    stateEl.content = e.target.innerHTML;
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      saveHistory(); // Save after user stops typing for 1s
    }, 1000);
  });
  
  div.addEventListener('blur', (e) => {
    if (!e.target.textContent.trim()) {
      e.target.remove();
      pageData.elements = pageData.elements.filter(item => item.id !== stateEl.id);
      saveHistory(); // Save deletion
    }
  });
}

function buildSpreadNode(spreadIndex) {
  const div = document.createElement('div');
  div.className = 'spread';
  
  if (isDesktop) {
    const p1Index = spreadIndex * 2;
    const p2Index = spreadIndex * 2 + 1;
    
    div.appendChild(buildPageNode(p1Index, true));
    div.appendChild(buildPageNode(p2Index, false));
  } else {
    // Mobile: 1 page per spread
    div.appendChild(buildPageNode(spreadIndex, false)); 
  }
  
  return div;
}

function applyTransform(el, translationPercent) {
  if (el) {
    el.style.transform = `translate3d(${translationPercent}vw, 0, 0)`;
  }
}

function renderDomSpreads() {
  nbContainer.innerHTML = '';
  
  // Build Curr
  domSpreads.curr = buildSpreadNode(currentSpreadIndex);
  applyTransform(domSpreads.curr, 0);
  nbContainer.appendChild(domSpreads.curr);
  
  // Build Prev
  if (currentSpreadIndex > 0) {
    domSpreads.prev = buildSpreadNode(currentSpreadIndex - 1);
    applyTransform(domSpreads.prev, -100);
    nbContainer.appendChild(domSpreads.prev);
  } else {
    domSpreads.prev = null;
  }
  
  // Build Next
  const maxSpreads = getSpreadCount();
  if (currentSpreadIndex < maxSpreads - 1) {
    domSpreads.next = buildSpreadNode(currentSpreadIndex + 1);
    applyTransform(domSpreads.next, 100);
    nbContainer.appendChild(domSpreads.next);
  } else {
    domSpreads.next = null;
  }
  
  updateTopBarTitle();
}

function updateTopBarTitle() {
  const pIndex = isDesktop ? currentSpreadIndex * 2 : currentSpreadIndex;
  if(state.pages[pIndex]) {
    dateTitle.textContent = state.pages[pIndex].date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
}

// =========================
// GESTURES & PINCH 
// =========================

function setupGestures() {
  nbContainer.addEventListener('touchstart', onTouchStart, { passive: false });
  nbContainer.addEventListener('touchmove', onTouchMove, { passive: false });
  nbContainer.addEventListener('touchend', onTouchEnd);
  
  nbContainer.addEventListener('mousedown', onTouchStart);
  window.addEventListener('mousemove', onTouchMove);
  window.addEventListener('mouseup', onTouchEnd);
  
  nbContainer.addEventListener('click', onClick);
}

function getCoords(e) {
  const evt = (e.touches && e.touches.length) ? e.touches[0] : (e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e);
  return { x: evt.clientX, y: evt.clientY };
}

function getPinchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx*dx + dy*dy);
}

function toggleAnimatingClass(isEnabled) {
  [domSpreads.prev, domSpreads.curr, domSpreads.next].forEach(p => {
    if (p) {
      if (isEnabled) p.classList.add('animating');
      else p.classList.remove('animating');
    }
  });
}

function onTouchStart(e) {
  if (e.target.isContentEditable) return; 
  if (animationTimeout) return; 
  
  // Handle Pinch
  if (e.touches && e.touches.length === 2) {
    isPinching = true;
    initialPinchDistance = getPinchDistance(e.touches);
    return;
  }
  
  isPinching = false;
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
  if (document.activeElement && document.activeElement.isContentEditable) return; 
  
  // Pinch tracking
  if (isPinching && e.touches && e.touches.length === 2) {
    e.preventDefault();
    const currentDist = getPinchDistance(e.touches);
    if (initialPinchDistance - currentDist > 50) { 
      // Pinched in enough -> go to gallery
      isPinching = false; // Reset to avoid double trigger
      openGallery();
    }
    return;
  }

  if (isPinching) return; // Wait until fingers lift

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
    
    // Limits
    if (currentSpreadIndex === 0 && deltaXPercent > 0) deltaXPercent *= 0.2;
    if (currentSpreadIndex === getSpreadCount() - 1 && deltaXPercent < 0) deltaXPercent *= 0.2;
    
    applyTransform(domSpreads.curr, deltaXPercent);
    applyTransform(domSpreads.prev, -100 + deltaXPercent);
    applyTransform(domSpreads.next, 100 + deltaXPercent);
  }
}

function onTouchEnd(e) {
  isPinching = false; // reset
  if (!isSwiping) return; 
  
  const coords = getCoords(e);
  const deltaX = coords.x - startXForDelta;
  const deltaXPercent = (deltaX / window.innerWidth) * 100;
  
  const velocity = Math.abs(deltaX) / Math.max(1, Date.now() - startTime);
  let dir = 0; 
  
  if (Math.abs(deltaXPercent) > (SWIPE_THRESHOLD * 100) || velocity > VELOCITY_THRESHOLD) {
    if (deltaX > 0 && currentSpreadIndex > 0) dir = -1;
    else if (deltaX < 0 && currentSpreadIndex < getSpreadCount() - 1) dir = 1; 
  }
  
  executeSnap(dir);
  isSwiping = false;
}

function executeSnap(direction) {
  toggleAnimatingClass(true);
  
  if (direction === -1) {
    currentSpreadIndex--;
    applyTransform(domSpreads.prev, 0);
    applyTransform(domSpreads.curr, 100);
  } else if (direction === 1) {
    currentSpreadIndex++;
    applyTransform(domSpreads.curr, -100);
    applyTransform(domSpreads.next, 0);
  } else {
    // Snap Back
    applyTransform(domSpreads.prev, -100);
    applyTransform(domSpreads.curr, 0);
    applyTransform(domSpreads.next, 100);
  }
  
  animationTimeout = setTimeout(() => {
    if (direction !== 0) {
      renderDomSpreads();
    }
    toggleAnimatingClass(false);
    animationTimeout = null;
  }, 350);
}

// =========================
// SMART WRITING (TAP)
// =========================

function onClick(e) {
  if (Math.abs(touchStartX - touchCurrentX) > 10 || Math.abs(touchStartY - touchCurrentY) > 10 || isSwiping) return; 
  if (e.target.isContentEditable) return;

  const pageTarget = e.target.closest('.page');
  if (!pageTarget) return;

  const pageIndex = parseInt(pageTarget.dataset.index);
  if (isNaN(pageIndex)) return;

  const rect = pageTarget.getBoundingClientRect();
  let relX = e.clientX - rect.left;
  let relY = e.clientY - rect.top;

  // Snap Y to ruled lines
  let targetTop;
  if (relY <= LINE_OFFSET) {
    targetTop = LINE_OFFSET;
  } else {
    const multiples = Math.floor((relY - LINE_OFFSET) / LINE_HEIGHT);
    targetTop = LINE_OFFSET + (multiples * LINE_HEIGHT);
  }
  targetTop -= 2; // Baseline tweak
  
  // Left padding
  let LEFT_MARGIN = 40;
  if (isDesktop && pageTarget.classList.contains('page-right')) LEFT_MARGIN = 20; 
  if (relX < LEFT_MARGIN) relX = LEFT_MARGIN;

  // SMART FIND: Are we close to an existing block on the same line?
  const pageData = state.pages[pageIndex];
  let nearestBlock = null;
  
  for (let el of pageData.elements) {
    // Y must be practically identical (same line or adjacent), X must be reasonably close (avoid clicking right side to edit left side)
    if (Math.abs(el.y - targetTop) <= LINE_HEIGHT/2 + 2) {
      if (Math.abs(el.x - relX) < 120) {
        nearestBlock = el;
        break;
      }
    }
  }

  if (nearestBlock) {
     const domEl = pageTarget.querySelector(`[data-id="${nearestBlock.id}"]`);
     if (domEl) {
       domEl.focus();
       // Try placing cursor at end
       if (typeof window.getSelection !== "undefined" && typeof document.createRange !== "undefined") {
         const range = document.createRange();
         range.selectNodeContents(domEl);
         range.collapse(false);
         const sel = window.getSelection();
         sel.removeAllRanges();
         sel.addRange(range);
       }
       return;
     }
  }

  // Create New
  const elState = {
    id: 'block_' + Date.now().toString(36),
    x: relX,
    y: targetTop,
    content: ''
  };
  pageData.elements.push(elState);
  saveHistory(); // Save the fact we appended an empty block
  
  const textInput = document.createElement('div');
  textInput.className = 'text-block';
  textInput.contentEditable = true;
  textInput.style.left = `${elState.x}px`;
  textInput.style.top = `${elState.y}px`;
  textInput.style.minHeight = `${LINE_HEIGHT}px`;
  textInput.dataset.id = elState.id;
  
  bindTextBlockEvents(textInput, elState, pageData);
  pageTarget.appendChild(textInput);
  
  setTimeout(() => textInput.focus(), 15);
}

// =========================
// GALLERY MODE
// =========================

const scrollIndicator = document.getElementById('scroll-indicator');
const scroller = document.getElementById('gallery-scroller');

function setupGallery() {
  galleryBtn.addEventListener('click', openGallery);
  notebookBtn.addEventListener('click', closeGallery);
  
  scroller.addEventListener('scroll', () => {
    // Show indicator
    scrollIndicator.classList.remove('hidden');
    clearTimeout(scroller.indicatorTimeout);
    scroller.indicatorTimeout = setTimeout(() => {
      scrollIndicator.classList.add('hidden');
    }, 1500);

    // Magnetic Date calculation
    const headers = document.querySelectorAll('.month-header');
    let currentHeader = headers[0];
    
    for(let h of headers) {
      const rect = h.getBoundingClientRect();
      if (rect.top <= 140) { // accounting for sticky overlap
        currentHeader = h;
      }
    }
    if (currentHeader) {
      scrollIndicator.textContent = currentHeader.textContent;
    }
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

function renderGallery() {
  scroller.innerHTML = ''; // clear
  const groups = groupByMonth(state.pages);
  
  // To show newest first or oldest first? Let's assume pages array is older to newer.
  // We want gallery newest first usually.
  const sortedMonths = Object.keys(groups).sort((a,b) => new Date(b) - new Date(a));
  
  sortedMonths.forEach(month => {
    const mDiv = document.createElement('div');
    mDiv.className = 'gallery-month';
    
    const h2 = document.createElement('h2');
    h2.className = 'month-header';
    h2.textContent = month;
    mDiv.appendChild(h2);
    
    const grid = document.createElement('div');
    grid.className = 'gallery-grid';
    
    // Sort pages in month (descending)
    groups[month].sort((a,b) => b.date - a.date).forEach(pInfo => {
      const thumb = document.createElement('div');
      thumb.className = 'gallery-thumb';
      
      const thumbDate = document.createElement('div');
      thumbDate.className = 'thumb-date';
      thumbDate.textContent = pInfo.date.getDate();
      thumb.appendChild(thumbDate);
      
      // Inject some snippet
      if (pInfo.elements.length > 0) {
        const snippet = document.createElement('div');
        snippet.className = 'thumb-content';
        snippet.textContent = pInfo.elements[0].content.replace(/<[^>]*>?/gm, '').substring(0, 50);
        thumb.appendChild(snippet);
      }
      
      thumb.addEventListener('click', () => {
        openPageFromGallery(pInfo.originalIndex);
      });
      
      grid.appendChild(thumb);
    });
    
    mDiv.appendChild(grid);
    scroller.appendChild(mDiv);
  });
}

function openGallery() {
  renderGallery();
  
  // Visual Transition Zoom Out
  notebookView.classList.add('zoom-out');
  
  setTimeout(() => {
    notebookView.classList.add('hidden');
    notebookView.classList.remove('view-active', 'zoom-out');
    
    galleryView.classList.remove('hidden');
    galleryBtn.classList.add('hidden');
    notebookBtn.classList.remove('hidden');
    dateTitle.textContent = "Gallery";
  }, 400); // match CSS duration
}

function closeGallery() {
  galleryView.classList.add('hidden');
  
  notebookView.classList.remove('hidden');
  notebookView.classList.add('zoom-in');
  
  // Force reflow
  void notebookView.offsetWidth;
  
  notebookView.classList.remove('zoom-in');
  notebookView.classList.add('view-active');
  
  galleryBtn.classList.remove('hidden');
  notebookBtn.classList.add('hidden');
  
  renderDomSpreads();
}

function openPageFromGallery(pageIndex) {
  // Recalculate Spread logic based on selection
  const itemsPerSpread = isDesktop ? 2 : 1;
  currentSpreadIndex = Math.floor(pageIndex / itemsPerSpread);
  
  closeGallery();
}

// =========================
// GOOGLE AUTH
// =========================

function setupAuth() {
  const logoutBtn = document.getElementById('logout-btn');
  const userAvatar = document.getElementById('user-avatar');
  const userMenu = document.getElementById('user-menu');
  
  userAvatar.addEventListener('click', () => {
    userMenu.classList.toggle('hidden');
  });
  
  logoutBtn.addEventListener('click', () => {
    // Clear auth
    document.getElementById('user-profile').classList.add('hidden');
    document.querySelector('.g_id_signin').classList.remove('hidden');
    userMenu.classList.add('hidden');
  });
}

// Global Callback for Google ID payload
window.handleCredentialResponse = function(response) {
  const jwt = response.credential;
  // Decode JWT safely
  try {
    const base64Url = jwt.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    
    const payload = JSON.parse(jsonPayload);
    
    if (payload.picture) {
      document.getElementById('user-avatar').src = payload.picture;
      document.getElementById('user-profile').classList.remove('hidden');
      document.querySelector('.g_id_signin').classList.add('hidden');
    }
  } catch (e) {
    console.error("JWT Decode error", e);
  }
}

// Kickoff
init();
