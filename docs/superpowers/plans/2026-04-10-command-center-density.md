# Command Center Density & Log Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Command Center information density by moving raw logs into a retractable/pinnable sidebar, collapsing idle sections, and removing duplicate terminal info from the controls bar.

**Architecture:** Wrap the existing `.window-container` in a new flex-row `.app-shell` div. Add a `.log-sidebar` element beside it. Move `#logStream` from the main pane into the sidebar. Add collapsible behavior to action panels and task list via CSS class toggles. Store sidebar open/pinned state in `localStorage`. No changes to execution behavior, state models, or `renderLogs` logic.

**Tech Stack:** Electron, TypeScript, DOM (no framework), CSS custom properties (Vercel Noir design system)

---

### Task 1: HTML Restructure — Sidebar Skeleton & Log Relocation

**Files:**
- Modify: `src/renderer/command/index.html`

This task restructures the HTML to introduce the sidebar container and move the log stream into it. No visual changes yet — CSS comes in Task 2.

- [ ] **Step 1: Add `.app-shell` wrapper and `.log-sidebar` to `index.html`**

Replace the entire `<body>` content in `src/renderer/command/index.html` with this structure. The key changes are:
1. New `.app-shell` flex-row wrapper around everything
2. `#logStream` moved from `.window-body` into `.log-sidebar`
3. Controls bar simplified: terminal session info removed (kept in surface state panel)
4. Sidebar has its own header with toggle/pin buttons
5. Sidebar toggle button added to status bar

```html
<body>
  <div class="app-shell">
    <div class="window-container">
      <header class="window-header">
        <div class="role-badge role-command"><span class="dot"></span>COMMAND CENTER</div>
        <div class="task-summary" id="taskSummary">No active task</div>
      </header>

      <!-- Surface State Panel -->
      <div class="surface-state-panel">
        <div class="surface-state-section browser-state">
          <div class="surface-state-header">
            <span class="surface-state-label">Browser</span>
            <span class="surface-state-status" id="browserStateStatus">idle</span>
          </div>
          <div class="surface-state-details">
            <div class="state-row">
              <span class="state-key">URL</span>
              <span class="state-value" id="browserStateUrl">-</span>
            </div>
            <div class="state-row">
              <span class="state-key">Title</span>
              <span class="state-value" id="browserStateTitle">-</span>
            </div>
            <div class="state-row">
              <span class="state-key">Tabs</span>
              <span class="state-value tab-id-list" id="browserStateTabs">-</span>
            </div>
            <div class="state-row state-row-inline">
              <span class="state-tag" id="browserStateLoading">idle</span>
              <span class="state-tag" id="browserStateBack">back: no</span>
              <span class="state-tag" id="browserStateForward">fwd: no</span>
            </div>
          </div>
        </div>
        <div class="surface-state-section terminal-state">
          <div class="surface-state-header">
            <span class="surface-state-label">Terminal</span>
            <span class="surface-state-status" id="terminalStateStatus">no session</span>
          </div>
          <div class="surface-state-details">
            <div class="state-row">
              <span class="state-key">Shell</span>
              <span class="state-value" id="terminalStateShell">untracked</span>
            </div>
            <div class="state-row">
              <span class="state-key">Last Dispatched</span>
              <span class="state-value" id="terminalStateCommand">-</span>
            </div>
            <div class="state-row state-row-inline">
              <span class="state-tag" id="terminalStateDispatch">no dispatch</span>
              <span class="state-tag" id="terminalStatePid">-</span>
              <span class="state-tag" id="terminalStateDims">-</span>
            </div>
          </div>
        </div>
      </div>

      <div class="controls-bar">
        <div class="control-group">
          <span class="control-label">Execution Split:</span>
          <div class="layout-controls" id="layoutControls">
            <button class="btn active" data-preset="balanced">Balanced</button>
            <button class="btn" data-preset="focus-browser">Browser</button>
            <button class="btn" data-preset="focus-terminal">Terminal</button>
          </div>
        </div>
      </div>

      <!-- Action Composer -->
      <div class="action-composer" id="actionComposer">
        <div class="action-composer-row">
          <div class="action-target-selector">
            <button class="target-btn active" data-target="browser" id="targetBrowserBtn">Browser</button>
            <button class="target-btn" data-target="terminal" id="targetTerminalBtn">Terminal</button>
          </div>
          <select class="action-kind-select" id="actionKindSelect">
            <option value="browser.navigate">Navigate</option>
          </select>
          <input type="text" class="action-payload-input" id="actionPayloadInput" placeholder="URL..." autocomplete="off">
          <select class="action-tab-picker" id="actionTabPicker" style="display:none"></select>
          <button class="btn primary btn-sm" id="actionSubmitBtn">Execute</button>
        </div>
      </div>

      <!-- Active Actions (collapsible) -->
      <div class="actions-panel active-actions-panel collapsed" id="activeActionsPanel">
        <div class="actions-panel-header" id="activeActionsHeader">
          <span class="actions-title">Active Actions</span>
          <span class="actions-count" id="activeActionsCount">0</span>
        </div>
        <div class="actions-list" id="activeActionsList">
          <div class="empty-state">No active actions</div>
        </div>
      </div>

      <!-- Recent Actions (collapsible) -->
      <div class="actions-panel collapsed" id="recentActionsPanel">
        <div class="actions-panel-header" id="recentActionsHeader">
          <span class="actions-title">Recent Actions</span>
          <span class="actions-count" id="recentActionsCount">0</span>
        </div>
        <div class="actions-list" id="recentActionsList">
          <div class="empty-state">No recent actions</div>
        </div>
      </div>

      <div class="window-body">
        <div class="task-list collapsed" id="taskList"><div class="empty-state">No tasks yet</div></div>
      </div>

      <div class="input-area">
        <input type="text" id="taskInput" placeholder="Enter a task..." autocomplete="off">
        <button class="btn primary" id="submitBtn">Submit</button>
      </div>

      <div class="status-bar">
        <div class="status-indicator"><span class="status-dot done" id="syncDot"></span><span id="syncLabel">Synced</span></div>
        <span id="splitLabel">Split: 50/50</span>
        <span id="taskCount">Tasks: 0</span>
        <button class="btn btn-sm sidebar-toggle-btn" id="sidebarToggleBtn">Logs</button>
      </div>
    </div>

    <!-- Log Sidebar -->
    <div class="log-sidebar" id="logSidebar">
      <div class="log-sidebar-header">
        <span class="log-sidebar-title">Logs</span>
        <div class="log-sidebar-controls">
          <button class="btn btn-sm" id="sidebarPinBtn" title="Pin sidebar open">Pin</button>
          <button class="btn btn-sm" id="sidebarCloseBtn" title="Close sidebar">&times;</button>
        </div>
      </div>
      <div class="log-stream" id="logStream"></div>
    </div>
  </div>
  <script type="module" src="command.js"></script>
</body>
```

Key changes from original:
- `<div class="app-shell">` wraps everything
- Controls bar: removed the terminal session info `control-group` (the surface state panel already shows this)
- Actions panels and task list start with `collapsed` class
- `#logStream` is now inside `.log-sidebar` instead of `.window-body`
- `.window-body` no longer contains `#logStream`
- Status bar has a `#sidebarToggleBtn`
- Terminal surface state section: rearranged to show shell, last dispatched, and inline tags for dispatch/PID/dims (absorbs what the controls bar used to show)

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
npm run build:renderer
```
Expected: Compiles successfully. The TS file references `getElementById('logStream')` which still exists — it just moved DOM parents. `getElementById('termPanelDot')`, `getElementById('termPanelStatus')`, and `getElementById('termPanelMeta')` will return null since those elements were removed. This is expected — we fix the TS in Task 3.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/command/index.html
git commit -m "refactor: restructure command center HTML for log sidebar and collapsible sections"
```

---

### Task 2: Sidebar & Collapsible Section CSS

**Files:**
- Modify: `src/renderer/command/command.css`

This task adds all the styling for the sidebar (open/closed/pinned states, transitions) and collapsible panel behavior. No JS yet — the classes are toggled manually for now.

- [ ] **Step 1: Add app-shell, log-sidebar, and collapsible CSS to `command.css`**

Append the following to the end of `src/renderer/command/command.css`:

```css
/* ── App Shell (flex-row wrapper) ────────────────────────────────────── */

.app-shell {
  display: flex;
  flex-direction: row;
  height: 100vh;
  overflow: hidden;
}

.app-shell > .window-container {
  flex: 1;
  min-width: 0;
}

/* ── Log Sidebar ─────────────────────────────────────────────────────── */

.log-sidebar {
  width: 0;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-left: 1px solid var(--border);
  transition: width var(--duration-normal) var(--ease-out),
              min-width var(--duration-normal) var(--ease-out);
  flex-shrink: 0;
}

.log-sidebar.open,
.log-sidebar.pinned {
  width: 360px;
  min-width: 280px;
}

.log-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 36px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.log-sidebar-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-ghost);
  font-family: var(--font-mono);
}

.log-sidebar-controls {
  display: flex;
  gap: 4px;
}

.log-sidebar-controls .btn-sm {
  padding: 2px 6px;
  font-size: 10px;
  color: var(--text-muted);
  border-color: transparent;
  background: transparent;
}

.log-sidebar-controls .btn-sm:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.log-sidebar-controls .btn-sm.active {
  color: var(--accent-green);
}

.log-sidebar .log-stream {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  font-family: var(--font-mono);
  font-size: 12px;
}

/* ── Sidebar Toggle (status bar) ─────────────────────────────────────── */

.sidebar-toggle-btn {
  margin-left: auto;
  padding: 2px 8px;
  font-size: 10px;
  color: var(--text-muted);
  border-color: var(--border);
  background: var(--bg-primary);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}

.sidebar-toggle-btn:hover {
  color: var(--text-primary);
  border-color: var(--border-hover);
}

.sidebar-toggle-btn.active {
  color: var(--accent-green);
  border-color: rgba(0, 212, 123, 0.25);
  background: rgba(0, 212, 123, 0.06);
}

/* ── Collapsible Sections ────────────────────────────────────────────── */

.actions-panel.collapsed > .actions-list {
  display: none;
}

.actions-panel.collapsed {
  max-height: none;
}

.actions-panel-header {
  cursor: pointer;
  user-select: none;
  transition: background var(--duration-fast) ease;
}

.actions-panel-header:hover {
  background: var(--bg-hover);
}

.task-list.collapsed {
  max-height: none;
  padding: 0;
  border-bottom: 1px solid var(--border);
}

.task-list.collapsed > .task-item,
.task-list.collapsed > .empty-state {
  display: none;
}

.task-list.collapsed::before {
  content: 'Tasks';
  display: block;
  padding: 4px 16px;
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-ghost);
  font-family: var(--font-mono);
  cursor: pointer;
}

.task-list:not(.collapsed)::before {
  content: 'Tasks';
  display: block;
  padding: 4px 16px;
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-ghost);
  font-family: var(--font-mono);
  cursor: pointer;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

/* ── Slim Controls Bar (no terminal info) ────────────────────────────── */

.controls-bar {
  height: 32px;
  padding: 0 12px;
}
```

- [ ] **Step 2: Remove the controls bar terminal styles that are no longer needed**

In `src/renderer/command/command.css`, the `.terminal-session-info`, `.session-label`, `.session-status`, and `.session-meta` rules are now unused since we removed the terminal info from the controls bar HTML. Delete these rules:

```css
/* DELETE these blocks: */

.terminal-session-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.session-label {
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-ghost);
  font-size: 10px;
}

.session-status {
  font-family: var(--font-mono);
  color: var(--text-muted);
}

.session-meta {
  font-family: var(--font-mono);
  color: var(--text-ghost);
}
```

- [ ] **Step 3: Verify build**

Run:
```bash
npm run build:renderer
```
Expected: Compiles. CSS changes don't affect TS compilation.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/command/command.css
git commit -m "style: add log sidebar, collapsible sections, and slim controls bar CSS"
```

---

### Task 3: Sidebar & Collapse JavaScript Logic

**Files:**
- Modify: `src/renderer/command/command.ts`

This task wires up the sidebar toggle/pin/close buttons, section collapse toggle on click, localStorage persistence for sidebar state, and updates terminal rendering to match the new HTML structure (removed controls bar terminal info elements).

- [ ] **Step 1: Replace the DOM references and add sidebar/collapse logic in `command.ts`**

**First**, remove the terminal controls bar DOM references that no longer exist. Delete these lines:

```typescript
const termPanelDot = document.getElementById('termPanelDot')!;
const termPanelStatus = document.getElementById('termPanelStatus')!;
const termPanelMeta = document.getElementById('termPanelMeta')!;
const termRestartBtn = document.getElementById('termRestartBtn') as HTMLButtonElement;
```

**Second**, add the sidebar and collapse DOM references. After the existing `// Actions panels` DOM section, add:

```typescript
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
```

- [ ] **Step 2: Delete the `renderTerminalPanel` function and its caller**

Delete the entire `renderTerminalPanel` function:

```typescript
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
```

In the `renderState` function, remove this line:

```typescript
  renderTerminalPanel(state);
```

Delete the `termRestartBtn` click handler:

```typescript
termRestartBtn.addEventListener('click', async () => { termRestartBtn.disabled = true; try { await workspaceAPI.actions.submit({ target: 'terminal', kind: 'terminal.restart', payload: {} }); } finally { termRestartBtn.disabled = false; } });
```

- [ ] **Step 3: Update `renderTerminalSurfaceState` to show shell/PID/dims info**

The terminal surface state panel now absorbs the info that was in the controls bar. Also add two new DOM references at the top with the other Surface State Panel references:

```typescript
const terminalStatePid = document.getElementById('terminalStatePid')!;
const terminalStateDims = document.getElementById('terminalStateDims')!;
```

Replace the entire `renderTerminalSurfaceState` function with:

```typescript
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
```

- [ ] **Step 4: Add sidebar toggle/pin/close logic**

Add the following after the `// ─── Init` section comment (before `populateKinds()`):

```typescript
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
```

- [ ] **Step 5: Add collapsible section toggle logic**

Add after the sidebar section:

```typescript
// ─── Collapsible Sections ──────────────────────────────────────────────────

function togglePanel(panel: HTMLElement): void {
  panel.classList.toggle('collapsed');
}

activeActionsHeader.addEventListener('click', () => togglePanel(activeActionsPanel));
recentActionsHeader.addEventListener('click', () => togglePanel(recentActionsPanel));
taskList.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;
  // Only toggle if clicking the header area (the ::before pseudo-element area)
  // The pseudo-element isn't directly clickable, but the click lands on the task-list itself
  if (target === taskList) {
    togglePanel(taskList);
  }
});
```

- [ ] **Step 6: Add auto-collapse/expand logic for action panels**

In the existing `renderSplitActions` function, after the counts are updated, add auto-collapse logic. Add these lines at the **end** of `renderSplitActions`:

```typescript
  // Auto-collapse when empty, auto-expand when non-empty
  if (active.length === 0) {
    activeActionsPanel.classList.add('collapsed');
  } else {
    activeActionsPanel.classList.remove('collapsed');
  }
```

In the existing `patchActionInSplit` function, after the counts are updated (after the `activeActionsCount.textContent` and `recentActionsCount.textContent` lines), add:

```typescript
  // Auto-collapse/expand active panel based on content
  if (activeCount === 0) {
    activeActionsPanel.classList.add('collapsed');
  } else {
    activeActionsPanel.classList.remove('collapsed');
  }
```

Also, in `renderTasks`, add auto-collapse for empty task list. Change the empty check from:

```typescript
  if (tasks.length === 0) { taskList.innerHTML = '<div class="empty-state">No tasks yet</div>'; return; }
```

to:

```typescript
  if (tasks.length === 0) { taskList.innerHTML = '<div class="empty-state">No tasks yet</div>'; taskList.classList.add('collapsed'); return; }
  taskList.classList.remove('collapsed');
```

- [ ] **Step 7: Verify build**

Run:
```bash
npm run build:renderer
```
Expected: Compiles successfully with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/command/command.ts
git commit -m "feat: add sidebar toggle/pin/close logic and collapsible section behavior"
```

---

### Task 4: Integration Verification

**Files:**
- None modified — verification only

This task validates the full build pipeline and checks that nothing was broken.

- [ ] **Step 1: Full build**

Run:
```bash
npm run build
```
Expected: All three build phases (main, preload, renderer) complete. Copy step copies HTML/CSS to dist.

- [ ] **Step 2: Verify no execution behavior changes**

Check that no files outside `src/renderer/command/` were modified:

```bash
git diff --name-only HEAD~3
```

Expected: Only these files:
- `src/renderer/command/index.html`
- `src/renderer/command/command.css`
- `src/renderer/command/command.ts`

No main process files, no shared types, no execution surface files.

- [ ] **Step 3: Verify `renderLogs` was not modified**

The `renderLogs` function should be completely untouched. It uses `getElementById('logStream')` which still exists (moved to sidebar). Verify:

```bash
git diff HEAD~3 -- src/renderer/command/command.ts | grep -A5 -B5 renderLogs
```

Expected: `renderLogs` function body shows no changes. Only the surrounding context (removed `renderTerminalPanel`, added sidebar logic) appears in the diff.

- [ ] **Step 4: Visual verification checklist**

Run the app:
```bash
npm run start
```

Verify each of these visually:
1. Command Center renders without errors (check DevTools console)
2. Main pane shows: header, surface state, controls bar (split presets only), action composer, collapsed active/recent panels, collapsed task list, input area, status bar with "Logs" button
3. Clicking "Logs" in status bar opens the sidebar on the right with log stream
4. Clicking "Pin" in sidebar header highlights the pin button green
5. Closing the sidebar and reloading — sidebar stays closed (not pinned)
6. Pinning the sidebar and reloading — sidebar stays open (pinned state persisted)
7. Clicking an action panel header toggles it open/closed
8. When an action is running, active actions panel auto-expands
9. When all actions complete, active actions panel auto-collapses
10. Terminal surface state shows shell, PID, and dimensions in the inline tags
11. No raw logs appear in the main pane
12. Logs appear in the sidebar with auto-scroll

- [ ] **Step 5: Commit (if any fixes were needed)**

If any fixes were applied during verification:
```bash
git add src/renderer/command/
git commit -m "fix: address visual verification issues in command center density update"
```
