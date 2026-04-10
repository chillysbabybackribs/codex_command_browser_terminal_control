export {};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const taskSummary = document.getElementById('taskSummary')!;
const surfaceDot = document.getElementById('surfaceDot')!;
const surfaceLabel = document.getElementById('surfaceLabel')!;
const surfaceDetail = document.getElementById('surfaceDetail')!;
const surfacePlaceholder = document.getElementById('surfacePlaceholder')!;
const logStream = document.getElementById('logStream')!;
const layoutLabel = document.getElementById('layoutLabel')!;

let lastLogCount = 0;

function renderState(state: any): void {
  const active = state.tasks.find((t: any) => t.id === state.activeTaskId);
  taskSummary.textContent = active ? `Active: ${active.title}` : 'No active task';

  surfaceDot.className = `status-dot ${state.browser.status}`;
  surfaceLabel.textContent = state.browser.status.charAt(0).toUpperCase() + state.browser.status.slice(1);
  surfaceDetail.textContent = state.browser.detail || '';

  const placeholderDetail = surfacePlaceholder.querySelector('.placeholder-detail')!;
  if (state.browser.status === 'running') {
    placeholderDetail.textContent = state.browser.detail || 'Executing...';
  } else if (state.browser.status === 'done') {
    placeholderDetail.textContent = 'Action completed';
  } else if (state.browser.status === 'error') {
    placeholderDetail.textContent = state.browser.detail || 'Error occurred';
  } else {
    placeholderDetail.textContent = 'Ready for browser automation integration';
  }

  const browserLogs = state.logs.filter((l: any) => l.source === 'browser' || l.source === 'system');
  const newLogs = browserLogs.slice(lastLogCount);
  for (const log of newLogs) {
    const el = document.createElement('div');
    el.className = `log-entry ${log.level}`;
    el.innerHTML = `
      <span class="log-time">${formatTime(log.timestamp)}</span>
      <span class="log-source">[${escapeHtml(log.source)}]</span>
      <span class="log-message">${escapeHtml(log.message)}</span>
    `;
    logStream.appendChild(el);
  }
  lastLogCount = browserLogs.length;
  logStream.scrollTop = logStream.scrollHeight;

  layoutLabel.textContent = `Layout: ${state.layoutPreset}`;
}

workspaceAPI.onStateUpdate((state: any) => {
  renderState(state);
});

workspaceAPI.getState().then((state: any) => {
  renderState(state);
  workspaceAPI.addLog('info', 'browser', 'Browser surface initialized');
});
