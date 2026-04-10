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

const taskInput = document.getElementById('taskInput') as HTMLInputElement;
const submitBtn = document.getElementById('submitBtn')!;
const taskList = document.getElementById('taskList')!;
const logStream = document.getElementById('logStream')!;
const taskSummary = document.getElementById('taskSummary')!;
const layoutControls = document.getElementById('layoutControls')!;
const resetLayoutBtn = document.getElementById('resetLayoutBtn')!;
const browserStatusDot = document.getElementById('browserStatusDot')!;
const terminalStatusDot = document.getElementById('terminalStatusDot')!;
const layoutLabel = document.getElementById('layoutLabel')!;
const taskCount = document.getElementById('taskCount')!;

function submitTask(): void {
  const title = taskInput.value.trim();
  if (!title) return;
  taskInput.value = '';
  workspaceAPI.createTask(title);
}

submitBtn.addEventListener('click', submitTask);
taskInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') submitTask();
});

layoutControls.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;
  if (target.id === 'resetLayoutBtn') return;
  const preset = target.dataset.preset;
  if (preset) {
    workspaceAPI.applyLayout(preset);
  }
});

resetLayoutBtn.addEventListener('click', () => {
  workspaceAPI.resetLayout();
});

function renderTasks(tasks: any[], activeId: string | null): void {
  if (tasks.length === 0) {
    taskList.innerHTML = '<div class="empty-state">No tasks yet</div>';
    return;
  }

  taskList.innerHTML = tasks
    .slice()
    .reverse()
    .map((t: any) => {
      const isActive = t.id === activeId;
      return `<div class="task-item ${isActive ? 'active' : ''}">
        <span class="task-status ${t.status}"></span>
        <span class="task-title">${escapeHtml(t.title)}</span>
        <span class="task-time">${formatTime(t.createdAt)}</span>
      </div>`;
    })
    .join('');
}

let lastLogCount = 0;

function renderLogs(logs: any[]): void {
  const newLogs = logs.slice(lastLogCount);
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
  lastLogCount = logs.length;
  logStream.scrollTop = logStream.scrollHeight;
}

function renderState(state: any): void {
  const active = state.tasks.find((t: any) => t.id === state.activeTaskId);
  taskSummary.textContent = active ? `Active: ${active.title}` : 'No active task';

  renderTasks(state.tasks, state.activeTaskId);
  renderLogs(state.logs);

  browserStatusDot.className = `status-dot ${state.browser.status}`;
  terminalStatusDot.className = `status-dot ${state.terminal.status}`;

  layoutLabel.textContent = `Layout: ${state.layoutPreset}`;
  const buttons = layoutControls.querySelectorAll('[data-preset]');
  buttons.forEach((btn) => {
    const el = btn as HTMLElement;
    el.classList.toggle('active', el.dataset.preset === state.layoutPreset);
  });

  taskCount.textContent = `Tasks: ${state.tasks.length}`;
}

workspaceAPI.onStateUpdate((state: any) => {
  renderState(state);
});

workspaceAPI.getState().then((state: any) => {
  renderState(state);
  workspaceAPI.addLog('info', 'system', 'Command Center initialized');
});
