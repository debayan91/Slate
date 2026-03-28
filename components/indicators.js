export function showToast(msg, isError = false) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'error' : ''}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

export function setSyncUI(status, isSaving) {
  const syncStatus = document.getElementById('sync-status');
  if (!syncStatus) return;
  
  if (!navigator.onLine) {
    syncStatus.className = 'offline';
    syncStatus.querySelector('.sync-text').textContent = 'Offline';
    return;
  }
  syncStatus.className = isSaving ? 'saving' : '';
  syncStatus.querySelector('.sync-text').textContent = status;
}
