export {};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function escapeHtml(str: string): string {
  const div = document.createElement('div'); div.textContent = str; return div.innerHTML;
}

// ─── Action Kind Definitions ───────────────────────────────────────────────

type ActionKindDef = { value: string; label: string; hasInput: boolean; placeholder: string };

const BROWSER_KINDS: ActionKindDef[] = [
  { value: 'browser.navigate', label: 'Navigate', hasInput: true, placeholder: 'URL...' },
  { value: 'browser.back', label: 'Back', hasInput: false, placeholder: '' },
  { value: 'browser.forward', label: 'Forward', hasInput: false, placeholder: '' },
  { value: 'browser.reload', label: 'Reload', hasInput: false, placeholder: '' },
  { value: 'browser.stop', label: 'Stop', hasInput: false, placeholder: '' },
];

const TERMINAL_KINDS: ActionKindDef[] = [
  { value: 'terminal.execute', label: 'Execute', hasInput: true, placeholder: 'Command...' },
  { value: 'terminal.write', label: 'Write', hasInput: true, placeholder: 'Input...' },
  { value: 'terminal.restart', label: 'Restart', hasInput: false, placeholder: '' },
  { value: 'terminal.interrupt', label: 'Interrupt', hasInput: false, placeholder: '' },
];

// ─── DOM ────────────────────────────────────────────────────────────────────

const taskInput = document.getElementById('taskInput') as HTMLInputElement;
const submitBtn = document.getElementById('submitBtn')!;
const taskList = document.getElementById('taskList')!;
const logStream = document.getElementById('logStream')!;
const taskSummary = document.getElementById('taskSummary')!;
const layoutControls = document.getElementById('layoutControls')!;
const browserStatusDot = document.getElementById('browserStatusDot')!;
const terminalStatusDot = document.getElementById('terminalStatusDot')!;
const splitLabel = document.getElementById('splitLabel')!;
const taskCount = document.getElementById('taskCount')!;
const termPanelDot = document.getElementById('termPanelDot')!;
const termPanelStatus = document.getElementById('termPanelStatus')!;
const termPanelMeta = document.getElementById('termPanelMeta')!;
const termRestartBtn = document.getElementById('termRestartBtn') as HTMLButtonElement;

// Action composer
const targetBrowserBtn = document.getElementById('targetBrowserBtn')!;
const targetTerminalBtn = document.getElementById('targetTerminalBtn')!;
const actionKindSelect = document.getElementById('actionKindSelect') as HTMLSelectElement;
const actionPayloadInput = document.getElementById('actionPayloadInput') as HTMLInputElement;
const actionSubmitBtn = document.getElementById('actionSubmitBtn')!;

// Actions panel
const actionsList = document.getElementById('actionsList')!;
const actionsCount = document.getElementById('actionsCount')!;

// ─── State ──────────────────────────────────────────────────────────────────

let currentTarget: 'browser' | 'terminal' = 'browser';
let actionRecords: any[] = [];

// ─── Target Selector ────────────────────────────────────────────────────────

function setTarget(target: 'browser' | 'terminal'): void {
  currentTarget = target;
  targetBrowserBtn.classList.toggle('active', target === 'browser');
  targetTerminalBtn.classList.toggle('active', target === 'terminal');
  populateKinds();
}

targetBrowserBtn.addEventListener('click', () => setTarget('browser'));
targetTerminalBtn.addEventListener('click', () => setTarget('terminal'));

function populateKinds(): void {
  const kinds = currentTarget === 'browser' ? BROWSER_KINDS : TERMINAL_KINDS;
  actionKindSelect.innerHTML = kinds.map(k => `<option value="${k.value}">${k.label}</option>`).join('');
  updatePayloadInput();
}

function getSelectedKindDef(): ActionKindDef | undefined {
  const kinds = currentTarget === 'browser' ? BROWSER_KINDS : TERMINAL_KINDS;
  return kinds.find(k => k.value === actionKindSelect.value);
}

function updatePayloadInput(): void {
  const def = getSelectedKindDef();
  if (def && def.hasInput) {
    actionPayloadInput.disabled = false;
    actionPayloadInput.placeholder = def.placeholder;
  } else {
    actionPayloadInput.disabled = true;
    actionPayloadInput.value = '';
    actionPayloadInput.placeholder = 'No input needed';
  }
}

actionKindSelect.addEventListener('change', updatePayloadInput);

// ─── Action Submission ──────────────────────────────────────────────────────

async function submitAction(): Promise<void> {
  const kind = actionKindSelect.value;
  const def = getSelectedKindDef();
  if (!def) return;

  let payload: Record<string, unknown> = {};

  if (kind === 'browser.navigate') {
    const url = actionPayloadInput.value.trim();
    if (!url) { actionPayloadInput.focus(); return; }
    payload = { url };
  } else if (kind === 'terminal.execute') {
    const command = actionPayloadInput.value.trim();
    if (!command) { actionPayloadInput.focus(); return; }
    payload = { command };
  } else if (kind === 'terminal.write') {
    const input = actionPayloadInput.value;
    payload = { input };
  }

  actionSubmitBtn.setAttribute('disabled', '');

  try {
    await workspaceAPI.actions.submit({
      target: currentTarget,
      kind,
      payload,
    });
    actionPayloadInput.value = '';
  } catch (err: any) {
    workspaceAPI.addLog('error', 'system', `Action submission failed: ${err.message || err}`);
  } finally {
    actionSubmitBtn.removeAttribute('disabled');
  }
}

actionSubmitBtn.addEventListener('click', submitAction);
actionPayloadInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') submitAction();
});

// ─── Tasks ──────────────────────────────────────────────────────────────────

function submitTask(): void {
  const title = taskInput.value.trim(); if (!title) return;
  taskInput.value = ''; workspaceAPI.createTask(title);
}
submitBtn.addEventListener('click', submitTask);
taskInput.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') submitTask(); });

layoutControls.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;
  if (target.dataset.preset) workspaceAPI.applyExecutionPreset(target.dataset.preset);
});

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderTasks(tasks: any[], activeId: string | null): void {
  if (tasks.length === 0) { taskList.innerHTML = '<div class="empty-state">No tasks yet</div>'; return; }
  taskList.innerHTML = tasks.slice().reverse().map((t: any) => {
    const isActive = t.id === activeId;
    return `<div class="task-item ${isActive ? 'active' : ''}"><span class="task-status ${t.status}"></span><span class="task-title">${escapeHtml(t.title)}</span><span class="task-time">${formatTime(t.createdAt)}</span></div>`;
  }).join('');
}

let lastLogCount = 0;
function renderLogs(logs: any[]): void {
  const newLogs = logs.slice(lastLogCount);
  for (const log of newLogs) {
    const el = document.createElement('div'); el.className = `log-entry ${log.level}`;
    el.innerHTML = `<span class="log-time">${formatTime(log.timestamp)}</span><span class="log-source">[${escapeHtml(log.source)}]</span><span class="log-message">${escapeHtml(log.message)}</span>`;
    logStream.appendChild(el);
  }
  lastLogCount = logs.length; logStream.scrollTop = logStream.scrollHeight;
}

function renderTerminalPanel(state: any): void {
  const session = state.terminalSession?.session;
  if (!session) { termPanelDot.className = 'status-dot idle'; termPanelStatus.textContent = 'No session'; termPanelMeta.textContent = ''; return; }
  const dotMap: Record<string, string> = { idle: 'idle', starting: 'running', running: 'running', exited: 'error', error: 'error' };
  termPanelDot.className = `status-dot ${dotMap[session.status] || 'idle'}`;
  termPanelStatus.textContent = session.status.charAt(0).toUpperCase() + session.status.slice(1);
  const parts: string[] = [];
  if (session.shell) parts.push(session.shell);
  if (session.pid) parts.push(`PID ${session.pid}`);
  if (session.cols && session.rows) parts.push(`${session.cols}x${session.rows}`);
  if (session.persistent) parts.push('persistent');
  else parts.push('no persistence');
  termPanelMeta.textContent = parts.join(' | ');
}

function buildActionRowHtml(r: any): string {
  const resultHtml = r.error
    ? `<span class="action-result error">${escapeHtml(r.error)}</span>`
    : r.resultSummary
      ? `<span class="action-result">${escapeHtml(r.resultSummary)}</span>`
      : '';
  return `<span class="action-status-dot ${r.status}"></span>` +
    `<span class="action-target-badge ${r.target}">${r.target}</span>` +
    `<span class="action-summary">${escapeHtml(r.payloadSummary)}</span>` +
    resultHtml +
    `<span class="action-time">${formatTime(r.createdAt)}</span>`;
}

function renderActionsFull(records: any[]): void {
  actionRecords = records;
  actionsCount.textContent = String(records.length);

  if (records.length === 0) {
    actionsList.innerHTML = '<div class="empty-state">No actions yet</div>';
    return;
  }

  const visible = records.slice().reverse().slice(0, 30);
  actionsList.innerHTML = visible.map((r: any) => {
    return `<div class="action-row status-${r.status}" data-action-id="${r.id}">` +
      buildActionRowHtml(r) + `</div>`;
  }).join('');
}

function patchActionRow(record: any): void {
  const existing = actionsList.querySelector(`[data-action-id="${record.id}"]`) as HTMLElement | null;
  if (existing) {
    // Update in place — no flash
    existing.className = `action-row status-${record.status}`;
    existing.innerHTML = buildActionRowHtml(record);
  } else {
    // New record — prepend (most recent first)
    if (actionsList.querySelector('.empty-state')) {
      actionsList.innerHTML = '';
    }
    const row = document.createElement('div');
    row.className = `action-row status-${record.status}`;
    row.setAttribute('data-action-id', record.id);
    row.innerHTML = buildActionRowHtml(record);
    actionsList.insertBefore(row, actionsList.firstChild);
    // Trim to 30 visible
    while (actionsList.children.length > 30) {
      actionsList.removeChild(actionsList.lastChild!);
    }
  }
  actionsCount.textContent = String(actionRecords.length);
}

function renderBrowserStatus(state: any): void {
  const br = state.browserRuntime;
  if (!br) { browserStatusDot.className = 'status-dot idle'; return; }
  const dotMap: Record<string, string> = { idle: 'idle', loading: 'running', ready: 'done', error: 'error' };
  browserStatusDot.className = `status-dot ${dotMap[br.surfaceStatus] || 'idle'}`;
}

function renderState(state: any): void {
  const active = state.tasks.find((t: any) => t.id === state.activeTaskId);
  taskSummary.textContent = active ? `Active: ${active.title}` : 'No active task';
  renderTasks(state.tasks, state.activeTaskId);
  renderLogs(state.logs);
  terminalStatusDot.className = `status-dot ${state.terminal.status}`;
  renderTerminalPanel(state);
  renderBrowserStatus(state);
  // Don't re-render actions from state broadcasts — the dedicated
  // actions.onUpdate channel handles incremental updates without flashing.
  if (state.executionSplit) {
    const ratio = state.executionSplit.ratio;
    splitLabel.textContent = `Split: ${Math.round(ratio * 100)}/${Math.round((1 - ratio) * 100)}`;
    layoutControls.querySelectorAll('[data-preset]').forEach((btn) => {
      (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.preset === state.executionSplit.preset);
    });
  }
  taskCount.textContent = `Tasks: ${state.tasks.length}`;
}

// ─── Live Updates ───────────────────────────────────────────────────────────

workspaceAPI.onStateUpdate((state: any) => renderState(state));

workspaceAPI.actions.onUpdate((record: any) => {
  const idx = actionRecords.findIndex((r: any) => r.id === record.id);
  if (idx >= 0) {
    actionRecords[idx] = record;
  } else {
    actionRecords.push(record);
  }
  patchActionRow(record);
});

workspaceAPI.browser.onStateUpdate((bs: any) => {
  const dotMap: Record<string, string> = { idle: 'idle', loading: 'running', ready: 'done', error: 'error' };
  browserStatusDot.className = `status-dot ${dotMap[bs.surfaceStatus] || 'idle'}`;
});

termRestartBtn.addEventListener('click', async () => { termRestartBtn.disabled = true; try { await workspaceAPI.terminal.restart(); } finally { termRestartBtn.disabled = false; } });

// ─── Init ───────────────────────────────────────────────────────────────────

populateKinds();

workspaceAPI.getState().then((state: any) => {
  renderState(state);
  workspaceAPI.addLog('info', 'system', 'Command Center initialized');
});

// Load recent actions
workspaceAPI.actions.listRecent(50).then((records: any[]) => {
  renderActionsFull(records);
});
