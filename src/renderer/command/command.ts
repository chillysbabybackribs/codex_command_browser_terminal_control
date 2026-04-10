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
  { value: 'browser.create-tab', label: 'New Tab', hasInput: true, placeholder: 'URL (optional)...' },
  { value: 'browser.close-tab', label: 'Close Tab', hasInput: true, placeholder: 'Tab ID...' },
  { value: 'browser.activate-tab', label: 'Switch Tab', hasInput: true, placeholder: 'Tab ID...' },
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
const splitLabel = document.getElementById('splitLabel')!;
const taskCount = document.getElementById('taskCount')!;

// Action composer
const targetBrowserBtn = document.getElementById('targetBrowserBtn')!;
const targetTerminalBtn = document.getElementById('targetTerminalBtn')!;
const actionKindSelect = document.getElementById('actionKindSelect') as HTMLSelectElement;
const actionPayloadInput = document.getElementById('actionPayloadInput') as HTMLInputElement;
const actionTabPicker = document.getElementById('actionTabPicker') as HTMLSelectElement;
const actionSubmitBtn = document.getElementById('actionSubmitBtn')!;

// Actions panels (split: active + recent)
const activeActionsList = document.getElementById('activeActionsList')!;
const activeActionsCount = document.getElementById('activeActionsCount')!;
const recentActionsList = document.getElementById('recentActionsList')!;
const recentActionsCount = document.getElementById('recentActionsCount')!;

// Sidebar
const logSidebar = document.getElementById('logSidebar')!;
const sidebarToggleBtn = document.getElementById('sidebarToggleBtn')!;
const sidebarPinBtn = document.getElementById('sidebarPinBtn')!;
const sidebarCloseBtn = document.getElementById('sidebarCloseBtn')!;

// Collapsible panel headers
const activeActionsHeader = document.getElementById('activeActionsHeader')!;
const recentActionsHeader = document.getElementById('recentActionsHeader')!;
const activeActionsPanel = document.getElementById('activeActionsPanel')!;
const recentActionsPanel = document.getElementById('recentActionsPanel')!;

// Surface State Panel
const browserStateStatus = document.getElementById('browserStateStatus')!;
const browserStateUrl = document.getElementById('browserStateUrl')!;
const browserStateTitle = document.getElementById('browserStateTitle')!;
const browserStateTabs = document.getElementById('browserStateTabs')!;
const browserStateLoading = document.getElementById('browserStateLoading')!;
const browserStateBack = document.getElementById('browserStateBack')!;
const browserStateForward = document.getElementById('browserStateForward')!;
const terminalStateStatus = document.getElementById('terminalStateStatus')!;
const terminalStateCommand = document.getElementById('terminalStateCommand')!;
const terminalStateDispatch = document.getElementById('terminalStateDispatch')!;
const terminalStateShell = document.getElementById('terminalStateShell')!;
const terminalStatePid = document.getElementById('terminalStatePid')!;
const terminalStateDims = document.getElementById('terminalStateDims')!;

// ─── State ──────────────────────────────────────────────────────────────────

let currentTarget: 'browser' | 'terminal' = 'browser';
let actionRecords: any[] = [];
let cachedTabs: any[] = [];

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

function isTabPickerKind(kind: string): boolean {
  return kind === 'browser.close-tab' || kind === 'browser.activate-tab';
}

function updatePayloadInput(): void {
  const def = getSelectedKindDef();
  const kind = actionKindSelect.value;

  if (isTabPickerKind(kind)) {
    actionPayloadInput.style.display = 'none';
    actionTabPicker.style.display = '';
    updateTabPicker();
  } else {
    actionPayloadInput.style.display = '';
    actionTabPicker.style.display = 'none';
    if (def && def.hasInput) {
      actionPayloadInput.disabled = false;
      actionPayloadInput.placeholder = def.placeholder;
    } else {
      actionPayloadInput.disabled = true;
      actionPayloadInput.value = '';
      actionPayloadInput.placeholder = 'No input needed';
    }
  }
}

function updateTabPicker(): void {
  if (!isTabPickerKind(actionKindSelect.value)) return;
  const prevVal = actionTabPicker.value;
  if (cachedTabs.length === 0) {
    actionTabPicker.innerHTML = '<option value="">No tabs available</option>';
    actionTabPicker.disabled = true;
  } else {
    actionTabPicker.disabled = false;
    actionTabPicker.innerHTML = cachedTabs.map((t: any) => {
      const title = t.navigation?.title || t.navigation?.url || 'New Tab';
      const shortTitle = title.length > 30 ? title.substring(0, 30) + '...' : title;
      return `<option value="${escapeHtml(t.id)}">${escapeHtml(shortTitle)} [${escapeHtml(t.id.slice(-8))}]</option>`;
    }).join('');
    // Restore previous selection if still valid
    if (prevVal && cachedTabs.some((t: any) => t.id === prevVal)) {
      actionTabPicker.value = prevVal;
    }
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
  } else if (kind === 'browser.create-tab') {
    const url = actionPayloadInput.value.trim();
    if (url) payload = { url };
  } else if (kind === 'browser.close-tab') {
    const tabId = actionTabPicker.value;
    if (!tabId) { actionTabPicker.focus(); return; }
    payload = { tabId };
  } else if (kind === 'browser.activate-tab') {
    const tabId = actionTabPicker.value;
    if (!tabId) { actionTabPicker.focus(); return; }
    payload = { tabId };
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

// ─── Surface State Rendering ────────────────────────────────────────────────

function renderBrowserSurfaceState(state: any): void {
  const br = state.browserRuntime;
  if (!br) {
    browserStateStatus.textContent = 'idle';
    browserStateStatus.className = 'surface-state-status';
    browserStateUrl.textContent = '-';
    browserStateTitle.textContent = '-';
    browserStateTabs.innerHTML = '-';
    cachedTabs = [];
    browserStateLoading.textContent = 'idle';
    browserStateLoading.className = 'state-tag';
    browserStateBack.textContent = 'back: no';
    browserStateBack.className = 'state-tag';
    browserStateForward.textContent = 'fwd: no';
    browserStateForward.className = 'state-tag';
    updateTabPicker();
    return;
  }

  const nav = br.navigation;
  browserStateStatus.textContent = br.surfaceStatus;
  browserStateStatus.className = `surface-state-status ${br.surfaceStatus}`;

  browserStateUrl.textContent = nav.url || '-';
  browserStateTitle.textContent = nav.title || '-';

  // Render tab list with IDs
  const tabs = br.tabs || [];
  const activeTabId = br.activeTabId || '';
  cachedTabs = tabs;
  if (tabs.length === 0) {
    browserStateTabs.innerHTML = '-';
  } else {
    browserStateTabs.innerHTML = tabs.map((t: any) => {
      const isActive = t.id === activeTabId;
      const title = t.navigation?.title || t.navigation?.url || 'New Tab';
      const shortTitle = title.length > 20 ? title.substring(0, 20) + '...' : title;
      return `<span class="tab-id-chip ${isActive ? 'active' : ''}" data-copy-id="${escapeHtml(t.id)}" title="${escapeHtml(t.id)} — ${escapeHtml(title)}">${escapeHtml(shortTitle)} <code>${escapeHtml(t.id.slice(-8))}</code></span>`;
    }).join('');
  }
  updateTabPicker();

  browserStateLoading.textContent = nav.isLoading ? 'loading' : 'idle';
  browserStateLoading.className = `state-tag ${nav.isLoading ? 'loading' : ''}`;

  browserStateBack.textContent = `back: ${nav.canGoBack ? 'yes' : 'no'}`;
  browserStateBack.className = `state-tag ${nav.canGoBack ? 'active' : ''}`;

  browserStateForward.textContent = `fwd: ${nav.canGoForward ? 'yes' : 'no'}`;
  browserStateForward.className = `state-tag ${nav.canGoForward ? 'active' : ''}`;
}

function renderTerminalSurfaceState(state: any): void {
  const session = state.terminalSession?.session;
  const cmd = state.terminalCommand;

  if (!session) {
    terminalStateStatus.textContent = 'no session';
    terminalStateStatus.className = 'surface-state-status';
    terminalStateShell.textContent = 'untracked';
    terminalStateCommand.textContent = '-';
    terminalStateDispatch.textContent = 'no dispatch';
    terminalStateDispatch.className = 'state-tag';
    terminalStatePid.textContent = '-';
    terminalStatePid.className = 'state-tag';
    terminalStateDims.textContent = '-';
    terminalStateDims.className = 'state-tag';
    return;
  }

  const statusLabel = session.status === 'running' ? 'ready' : session.status;
  terminalStateStatus.textContent = statusLabel;
  terminalStateStatus.className = `surface-state-status ${session.status === 'running' ? 'ready' : session.status === 'error' || session.status === 'exited' ? 'error' : ''}`;

  terminalStateShell.textContent = session.shell || 'untracked';

  if (cmd) {
    terminalStateCommand.textContent = cmd.lastDispatchedCommand || '-';
    terminalStateDispatch.textContent = cmd.dispatched ? 'dispatching' : cmd.lastDispatchedCommand ? 'sent' : 'no dispatch';
    terminalStateDispatch.className = `state-tag ${cmd.dispatched ? 'dispatching' : ''}`;
  } else {
    terminalStateCommand.textContent = '-';
    terminalStateDispatch.textContent = 'no dispatch';
    terminalStateDispatch.className = 'state-tag';
  }

  terminalStatePid.textContent = session.pid ? `PID ${session.pid}` : '-';
  terminalStatePid.className = 'state-tag';
  terminalStateDims.textContent = session.cols && session.rows ? `${session.cols}x${session.rows}` : '-';
  terminalStateDims.className = 'state-tag';
}

// ─── Task & Log Rendering ───────────────────────────────────────────────────

function renderTasks(tasks: any[], activeId: string | null): void {
  if (tasks.length === 0) { taskList.innerHTML = '<div class="empty-state">No tasks yet</div>'; taskList.classList.add('collapsed'); return; }
  taskList.classList.remove('collapsed');
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

// ─── Action Rendering (split: active + recent) ─────────────────────────────

function buildActionRowHtml(r: any): string {
  const errorHtml = r.error
    ? `<span class="action-result error">${escapeHtml(r.error)}</span>`
    : '';
  const resultHtml = !r.error && r.resultSummary
    ? `<span class="action-result">${escapeHtml(r.resultSummary)}</span>`
    : '';
  return `<span class="action-status-dot ${r.status}"></span>` +
    `<span class="action-target-badge ${r.target}">${r.target}</span>` +
    `<span class="action-summary">${escapeHtml(r.payloadSummary)}</span>` +
    resultHtml + errorHtml +
    `<span class="action-time">${formatTime(r.createdAt)}</span>`;
}

function renderSplitActions(records: any[]): void {
  actionRecords = records;

  const active = records.filter((r: any) => r.status === 'queued' || r.status === 'running');
  const recent = records.filter((r: any) => r.status !== 'queued' && r.status !== 'running');

  activeActionsCount.textContent = String(active.length);
  recentActionsCount.textContent = String(recent.length);

  // Auto-collapse when empty, auto-expand when non-empty
  if (active.length === 0) {
    activeActionsPanel.classList.add('collapsed');
  } else {
    activeActionsPanel.classList.remove('collapsed');
  }

  if (active.length === 0) {
    activeActionsList.innerHTML = '<div class="empty-state">No active actions</div>';
  } else {
    activeActionsList.innerHTML = active.slice().reverse().map((r: any) =>
      `<div class="action-row status-${r.status}" data-action-id="${r.id}">${buildActionRowHtml(r)}</div>`
    ).join('');
  }

  const visibleRecent = recent.slice().reverse().slice(0, 30);
  if (visibleRecent.length === 0) {
    recentActionsList.innerHTML = '<div class="empty-state">No recent actions</div>';
  } else {
    recentActionsList.innerHTML = visibleRecent.map((r: any) =>
      `<div class="action-row status-${r.status}" data-action-id="${r.id}">${buildActionRowHtml(r)}</div>`
    ).join('');
  }
}

function patchActionInSplit(record: any): void {
  const idx = actionRecords.findIndex((r: any) => r.id === record.id);
  if (idx >= 0) {
    actionRecords[idx] = record;
  } else {
    actionRecords.push(record);
  }

  const isActive = record.status === 'queued' || record.status === 'running';

  // Remove from both lists first (action may have moved from active to recent)
  const existingActive = activeActionsList.querySelector(`[data-action-id="${record.id}"]`);
  const existingRecent = recentActionsList.querySelector(`[data-action-id="${record.id}"]`);
  if (existingActive) existingActive.remove();
  if (existingRecent) existingRecent.remove();

  // Insert into the correct list
  const targetList = isActive ? activeActionsList : recentActionsList;

  // Clear empty state if present
  const emptyState = targetList.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const row = document.createElement('div');
  row.className = `action-row status-${record.status}`;
  row.setAttribute('data-action-id', record.id);
  row.innerHTML = buildActionRowHtml(record);
  targetList.insertBefore(row, targetList.firstChild);

  // Trim recent to 30 visible
  if (!isActive) {
    while (recentActionsList.children.length > 30) {
      recentActionsList.removeChild(recentActionsList.lastChild!);
    }
  }

  // Update counts
  const activeCount = actionRecords.filter((r: any) => r.status === 'queued' || r.status === 'running').length;
  const recentCount = actionRecords.filter((r: any) => r.status !== 'queued' && r.status !== 'running').length;
  activeActionsCount.textContent = String(activeCount);
  recentActionsCount.textContent = String(recentCount);

  // Auto-collapse/expand active panel based on content
  if (activeCount === 0) {
    activeActionsPanel.classList.add('collapsed');
  } else {
    activeActionsPanel.classList.remove('collapsed');
  }

  // Restore empty state if list is now empty
  if (activeActionsList.children.length === 0) {
    activeActionsList.innerHTML = '<div class="empty-state">No active actions</div>';
  }
  if (recentActionsList.children.length === 0) {
    recentActionsList.innerHTML = '<div class="empty-state">No recent actions</div>';
  }
}

// ─── Full State Render ──────────────────────────────────────────────────────

function renderState(state: any): void {
  const active = state.tasks.find((t: any) => t.id === state.activeTaskId);
  taskSummary.textContent = active ? `Active: ${active.title}` : 'No active task';
  renderTasks(state.tasks, state.activeTaskId);
  renderLogs(state.logs);
  renderBrowserSurfaceState(state);
  renderTerminalSurfaceState(state);

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
  patchActionInSplit(record);
});

workspaceAPI.browser.onStateUpdate((bs: any) => {
  renderBrowserSurfaceState({ browserRuntime: bs });
});

// Click-to-copy tab IDs in browser state panel
browserStateTabs.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;
  const chip = target.closest('[data-copy-id]') as HTMLElement | null;
  if (!chip) return;
  const id = chip.getAttribute('data-copy-id')!;
  navigator.clipboard.writeText(id).then(() => {
    chip.classList.add('copied');
    setTimeout(() => chip.classList.remove('copied'), 1200);
  });
});

// ─── Sidebar ───────────────────────────────────────────────────────────────

function sidebarOpen(): void {
  logSidebar.classList.add('open');
  sidebarToggleBtn.classList.add('active');
}

function sidebarClose(): void {
  logSidebar.classList.remove('open');
  sidebarToggleBtn.classList.remove('active');
}

function sidebarToggle(): void {
  if (logSidebar.classList.contains('open') || logSidebar.classList.contains('pinned')) {
    sidebarClose();
    sidebarUnpin();
  } else {
    sidebarOpen();
  }
}

function sidebarPin(): void {
  logSidebar.classList.add('pinned', 'open');
  sidebarPinBtn.classList.add('active');
  sidebarToggleBtn.classList.add('active');
  localStorage.setItem('v1-sidebar-pinned', '1');
}

function sidebarUnpin(): void {
  logSidebar.classList.remove('pinned');
  sidebarPinBtn.classList.remove('active');
  localStorage.removeItem('v1-sidebar-pinned');
}

function sidebarTogglePin(): void {
  if (logSidebar.classList.contains('pinned')) {
    sidebarUnpin();
  } else {
    sidebarPin();
  }
}

sidebarToggleBtn.addEventListener('click', sidebarToggle);
sidebarPinBtn.addEventListener('click', sidebarTogglePin);
sidebarCloseBtn.addEventListener('click', () => { sidebarClose(); sidebarUnpin(); });

// Restore pinned state from localStorage
if (localStorage.getItem('v1-sidebar-pinned') === '1') {
  sidebarPin();
}

// ─── Collapsible Sections ──────────────────────────────────────────────────

function togglePanel(panel: HTMLElement): void {
  panel.classList.toggle('collapsed');
}

activeActionsHeader.addEventListener('click', () => togglePanel(activeActionsPanel));
recentActionsHeader.addEventListener('click', () => togglePanel(recentActionsPanel));
taskList.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;
  if (target === taskList) {
    togglePanel(taskList);
  }
});

// ─── Init ───────────────────────────────────────────────────────────────────

populateKinds();

workspaceAPI.getState().then((state: any) => {
  renderState(state);
  workspaceAPI.addLog('info', 'system', 'Command Center initialized');
});

// Load recent actions into split view
workspaceAPI.actions.listRecent(50).then((records: any[]) => {
  renderSplitActions(records);
});
