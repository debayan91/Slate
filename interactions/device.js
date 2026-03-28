// The Device Controller acts as a master fuse for input logic.
// Strictly enforces Desktop (Keyboard/Mouse) vs Mobile (Touch/Gestures)

export const inputState = {
  isMobileTouch: false
};

export function initDeviceMode() {
  // Coarse pointer detects mobile touch devices (avoids desktop resizing false positives)
  inputState.isMobileTouch = window.matchMedia("(pointer: coarse)").matches;
}

export function assertDesktop() {
  if (inputState.isMobileTouch) {
    throw new Error("[Architecture Warning]: Attempted to trigger Desktop logic on Mobile");
  }
}

export function assertMobile() {
  if (!inputState.isMobileTouch) {
     throw new Error("[Architecture Warning]: Attempted to trigger Mobile logic on Desktop");
  }
}
