# Surface Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Command Center into an operator console that shows real-time browser and terminal state, splits actions into active/recent, and elevates errors — all built on existing state models.

**Architecture:** Add `TerminalCommandState` to AppState as a separate field tracking orchestration-derived command state. Extend `BrowserNavigationState` with `lastNavigationAt`. Wire state updates through existing action lifecycle in `SurfaceActionRouter` and existing browser events. Restructure Command Center HTML/CSS/TS to show Surface State Panel at top with split active/recent action lists.

**Tech Stack:** Electron, TypeScript, DOM (no framework)

---

### Task 1: Add TerminalCommandState type and AppState field

**Files:**
- Modify: `src/shared/types/terminal.ts:1-28`
- Modify: `src/shared/types/appState.ts:1-103`

- [ ] **Step 1: Add TerminalCommandState type to terminal.ts**

In `src/shared/types/terminal.ts`, add the new type and factory after the existing `TerminalSessionState` type:

```typescript
export type TerminalCommandState = {
  isRunning: boolean;
  lastCommand: string | null;
  lastExitCode: number | null;
  lastUpdatedAt: number;
};

export function createDefaultTerminalCommandState(): TerminalCommandState {
  return {
    isRunning: false,
    lastCommand: null,
    lastExitCode: null,
    lastUpdatedAt: 0,
  };
}
```

- [ ] **Step 2: Add terminalCommand field to AppState**

In `src/shared/types/appState.ts`, add the import of `TerminalCommandState` and `createDefaultTerminalCommandState` from `./terminal`, add `terminalCommand: TerminalCommandState` to the `AppState` type (after the `terminalSession` field), and add `terminalCommand: createDefaultTerminalCommandState()` to the `createDefaultAppState()` function return.

Import line — change:
```typescript
import { TerminalSessionState, createDefaultTerminalState } from './terminal';
```
to:
```typescript
import { TerminalSessionState, createDefaultTerminalState, TerminalCommandState, createDefaultTerminalCommandState } from './terminal';
```

Add to `AppState` type after `terminalSession`:
```typescript
  terminalCommand: TerminalCommandState;
```

Add to `createDefaultAppState()` return after `terminalSession`:
```typescript
  terminalCommand: createDefaultTerminalCommandState(),
```

- [ ] **Step 3: Build to verify types compile**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Errors only from files that reference AppState and expect the old shape (reducer, actions) — those are fixed in the next task.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types/terminal.ts src/shared/types/appState.ts
git commit -m "feat: add TerminalCommandState type and AppState field"
```

---

### Task 2: Add lastNavigationAt to BrowserNavigationState

**Files:**
- Modify: `src/shared/types/browser.ts:8-16`

- [ ] **Step 1: Extend BrowserNavigationState**

In `src/shared/types/browser.ts`, add `lastNavigationAt` to the `BrowserNavigationState` type:

```typescript
export type BrowserNavigationState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  loadingProgress: number | null;
  favicon: string;
  lastNavigationAt: number | null;
};
```

- [ ] **Step 2: Update createDefaultBrowserState**

In `src/shared/types/browser.ts`, in the `createDefaultBrowserState()` function, add `lastNavigationAt: null` to the `navigation` object:

```typescript
    navigation: {
      url: '',
      title: '',
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      loadingProgress: null,
      favicon: '',
      lastNavigationAt: null,
    },
```

- [ ] **Step 3: Update BrowserService tab creation**

In `src/main/browser/BrowserService.ts`, in the `createTabInternal` method (around line 188), add `lastNavigationAt: null` to the `navigation` object in the `TabInfo`:

```typescript
    const info: TabInfo = {
      id,
      navigation: {
        url: '', title: 'New Tab', canGoBack: false, canGoForward: false,
        isLoading: false, loadingProgress: null, favicon: '',
        lastNavigationAt: null,
      },
      status: 'idle',
      zoomLevel: this.settings.defaultZoom,
      muted: false,
      isAudible: false,
      createdAt: Date.now(),
    };
```

- [ ] **Step 4: Set lastNavigationAt on navigation complete**

In `src/main/browser/BrowserService.ts`, in the `wireTabEvents` method, inside the `did-navigate` handler (around line 307), add `nav.lastNavigationAt = Date.now();` after the existing URL update:

Change:
```typescript
    wc.on('did-navigate', (_e: ElectronEvent, url: string) => {
      nav.url = url;
      nav.canGoBack = wc.navigationHistory.canGoBack();
      nav.canGoForward = wc.navigationHistory.canGoForward();
      this.addHistoryEntry(url, nav.title, nav.favicon);
      this.syncTabAndMaybeNavigation(entry);
    });
```

To:
```typescript
    wc.on('did-navigate', (_e: ElectronEvent, url: string) => {
      nav.url = url;
      nav.canGoBack = wc.navigationHistory.canGoBack();
      nav.canGoForward = wc.navigationHistory.canGoForward();
      nav.lastNavigationAt = Date.now();
      this.addHistoryEntry(url, nav.title, nav.favicon);
      this.syncTabAndMaybeNavigation(entry);
    });
```

- [ ] **Step 5: Update getState default navigation**

In `src/main/browser/BrowserService.ts`, in the `getState()` method (around line 743), add `lastNavigationAt: null` to the fallback navigation object:

Change:
```typescript
    const nav = active ? { ...active.info.navigation } : {
      url: '', title: '', canGoBack: false, canGoForward: false,
      isLoading: false, loadingProgress: null, favicon: '',
    };
```

To:
```typescript
    const nav = active ? { ...active.info.navigation } : {
      url: '', title: '', canGoBack: false, canGoForward: false,
      isLoading: false, loadingProgress: null, favicon: '',
      lastNavigationAt: null,
    };
```

- [ ] **Step 6: Build to verify**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No type errors related to BrowserNavigationState.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types/browser.ts src/main/browser/BrowserService.ts
git commit -m "feat: add lastNavigationAt to BrowserNavigationState"
```

---

### Task 3: Add SET_TERMINAL_COMMAND reducer action

**Files:**
- Modify: `src/main/state/actions.ts:1-38`
- Modify: `src/main/state/reducer.ts:1-97`

- [ ] **Step 1: Add SET_TERMINAL_COMMAND to ActionType enum and Action union**

In `src/main/state/actions.ts`, add `SET_TERMINAL_COMMAND` to the `ActionType` enum (after `SET_TERMINAL_SESSION`):

```typescript
  SET_TERMINAL_COMMAND = 'SET_TERMINAL_COMMAND',
```

Add the import of `TerminalCommandState` at the top — change the terminal import:
```typescript
import { TerminalSessionInfo } from '../../shared/types/terminal';
```
to:
```typescript
import { TerminalSessionInfo, TerminalCommandState } from '../../shared/types/terminal';
```

Add to the `Action` union (after the `SET_TERMINAL_SESSION` line):
```typescript
  | { type: ActionType.SET_TERMINAL_COMMAND; command: TerminalCommandState }
```

- [ ] **Step 2: Add reducer case for SET_TERMINAL_COMMAND**

In `src/main/state/reducer.ts`, add a case after `SET_TERMINAL_SESSION`:

```typescript
    case ActionType.SET_TERMINAL_COMMAND:
      return {
        ...state,
        terminalCommand: action.command,
      };
```

- [ ] **Step 3: Build to verify**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Clean compile (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/main/state/actions.ts src/main/state/reducer.ts
git commit -m "feat: add SET_TERMINAL_COMMAND reducer action"
```

---

### Task 4: Wire terminal command state through SurfaceActionRouter

**Files:**
- Modify: `src/main/actions/SurfaceActionRouter.ts:1-236`

- [ ] **Step 1: Import TerminalCommandState**

In `src/main/actions/SurfaceActionRouter.ts`, add the import. Change:

```typescript
import { ActionType } from '../state/actions';
```

to:

```typescript
import { ActionType } from '../state/actions';
import { TerminalCommandState } from '../../shared/types/terminal';
```

- [ ] **Step 2: Dispatch terminal command state on execute lifecycle**

In the `executeAction` method, add terminal command state dispatches. The method currently starts the action, then branches on `action.target`. We need to dispatch `SET_TERMINAL_COMMAND` around `terminal.execute` actions specifically.

Change the `executeAction` method from:

```typescript
  private async executeAction(action: SurfaceAction): Promise<void> {
    const id = action.id;

    // Transition to running
    this.updateStatus(id, 'running');
    eventBus.emit(AppEventType.SURFACE_ACTION_STARTED, { record: this.getCurrentRecord(id) });

    try {
      let resultSummary: string;

      if (action.target === 'browser') {
        resultSummary = await executeBrowserAction(action.kind, action.payload);
      } else {
        resultSummary = await executeTerminalAction(action.kind, action.payload);
      }

      // Transition to completed
      this.updateRecord(id, { status: 'completed', resultSummary, updatedAt: Date.now() });
      eventBus.emit(AppEventType.SURFACE_ACTION_COMPLETED, { record: this.getCurrentRecord(id) });

      appStateStore.dispatch({
        type: ActionType.ADD_LOG,
        log: {
          id: generateId('log'),
          timestamp: Date.now(),
          level: 'info',
          source: action.target,
          message: `Action completed: ${resultSummary}`,
          taskId: action.taskId ?? undefined,
        },
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Transition to failed
      this.updateRecord(id, { status: 'failed', error: errorMsg, updatedAt: Date.now() });
      eventBus.emit(AppEventType.SURFACE_ACTION_FAILED, { record: this.getCurrentRecord(id) });

      appStateStore.dispatch({
        type: ActionType.ADD_LOG,
        log: {
          id: generateId('log'),
          timestamp: Date.now(),
          level: 'error',
          source: action.target,
          message: `Action failed: ${errorMsg}`,
          taskId: action.taskId ?? undefined,
        },
      });
    } finally {
      this.activeActions.delete(id);
    }
  }
```

To:

```typescript
  private async executeAction(action: SurfaceAction): Promise<void> {
    const id = action.id;
    const isTerminalExecute = action.kind === 'terminal.execute';

    // Transition to running
    this.updateStatus(id, 'running');
    eventBus.emit(AppEventType.SURFACE_ACTION_STARTED, { record: this.getCurrentRecord(id) });

    // Track terminal command state for terminal.execute actions
    if (isTerminalExecute) {
      const payload = action.payload as { command: string };
      appStateStore.dispatch({
        type: ActionType.SET_TERMINAL_COMMAND,
        command: {
          isRunning: true,
          lastCommand: payload.command,
          lastExitCode: null,
          lastUpdatedAt: Date.now(),
        },
      });
    }

    try {
      let resultSummary: string;

      if (action.target === 'browser') {
        resultSummary = await executeBrowserAction(action.kind, action.payload);
      } else {
        resultSummary = await executeTerminalAction(action.kind, action.payload);
      }

      // Transition to completed
      this.updateRecord(id, { status: 'completed', resultSummary, updatedAt: Date.now() });
      eventBus.emit(AppEventType.SURFACE_ACTION_COMPLETED, { record: this.getCurrentRecord(id) });

      // Update terminal command state on completion
      if (isTerminalExecute) {
        appStateStore.dispatch({
          type: ActionType.SET_TERMINAL_COMMAND,
          command: {
            isRunning: false,
            lastCommand: (action.payload as { command: string }).command,
            lastExitCode: null, // PTY does not provide per-command exit codes
            lastUpdatedAt: Date.now(),
          },
        });
      }

      appStateStore.dispatch({
        type: ActionType.ADD_LOG,
        log: {
          id: generateId('log'),
          timestamp: Date.now(),
          level: 'info',
          source: action.target,
          message: `Action completed: ${resultSummary}`,
          taskId: action.taskId ?? undefined,
        },
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Transition to failed
      this.updateRecord(id, { status: 'failed', error: errorMsg, updatedAt: Date.now() });
      eventBus.emit(AppEventType.SURFACE_ACTION_FAILED, { record: this.getCurrentRecord(id) });

      // Update terminal command state on failure
      if (isTerminalExecute) {
        appStateStore.dispatch({
          type: ActionType.SET_TERMINAL_COMMAND,
          command: {
            isRunning: false,
            lastCommand: (action.payload as { command: string }).command,
            lastExitCode: null,
            lastUpdatedAt: Date.now(),
          },
        });
      }

      appStateStore.dispatch({
        type: ActionType.ADD_LOG,
        log: {
          id: generateId('log'),
          timestamp: Date.now(),
          level: 'error',
          source: action.target,
          message: `Action failed: ${errorMsg}`,
          taskId: action.taskId ?? undefined,
        },
      });
    } finally {
      this.activeActions.delete(id);
    }
  }
```

- [ ] **Step 3: Build to verify**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Clean compile.

- [ ] **Step 4: Commit**

```bash
git add src/main/actions/SurfaceActionRouter.ts
git commit -m "feat: wire terminal command state through action router"
```

---

### Task 5: Restructure Command Center HTML

**Files:**
- Modify: `src/renderer/command/index.html:1-96`

- [ ] **Step 1: Replace the HTML body content**

Replace the entire `<body>` content of `src/renderer/command/index.html` with the restructured layout. This adds the Surface State Panel at the top, removes the header status dots (replaced by the panel), and splits the actions panel into active/recent sections.

Replace the full `<body>` block:

```html
<body>
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
            <span class="state-key">Command</span>
            <span class="state-value" id="terminalStateCommand">-</span>
          </div>
          <div class="state-row state-row-inline">
            <span class="state-tag" id="terminalStateRunning">idle</span>
            <span class="state-tag" id="terminalStateExitCode">exit: -</span>
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
      <div class="control-group">
        <div class="terminal-session-info">
          <span class="session-label">Terminal:</span>
          <span class="status-dot idle" id="termPanelDot"></span>
          <span class="session-status" id="termPanelStatus">No session</span>
          <span class="session-meta" id="termPanelMeta"></span>
          <button class="btn btn-sm" id="termRestartBtn">Restart</button>
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
        <button class="btn primary btn-sm" id="actionSubmitBtn">Execute</button>
      </div>
    </div>

    <!-- Active Actions -->
    <div class="actions-panel active-actions-panel" id="activeActionsPanel">
      <div class="actions-panel-header">
        <span class="actions-title">Active Actions</span>
        <span class="actions-count" id="activeActionsCount">0</span>
      </div>
      <div class="actions-list" id="activeActionsList">
        <div class="empty-state">No active actions</div>
      </div>
    </div>

    <!-- Recent Actions -->
    <div class="actions-panel" id="recentActionsPanel">
      <div class="actions-panel-header">
        <span class="actions-title">Recent Actions</span>
        <span class="actions-count" id="recentActionsCount">0</span>
      </div>
      <div class="actions-list" id="recentActionsList">
        <div class="empty-state">No recent actions</div>
      </div>
    </div>

    <div class="window-body">
      <div class="task-list" id="taskList"><div class="empty-state">No tasks yet</div></div>
      <div class="log-stream" id="logStream"></div>
    </div>

    <div class="input-area">
      <input type="text" id="taskInput" placeholder="Enter a task..." autocomplete="off">
      <button class="btn primary" id="submitBtn">Submit</button>
    </div>

    <div class="status-bar">
      <div class="status-indicator"><span class="status-dot done" id="syncDot"></span><span id="syncLabel">Synced</span></div>
      <span id="splitLabel">Split: 50/50</span>
      <span id="taskCount">Tasks: 0</span>
    </div>
  </div>
  <script type="module" src="command.js"></script>
</body>
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/command/index.html
git commit -m "feat: restructure Command Center HTML with Surface State Panel"
```

---

### Task 6: Add Surface State Panel and error visibility CSS

**Files:**
- Modify: `src/renderer/command/command.css`

- [ ] **Step 1: Add Surface State Panel styles**

Append the following CSS to the end of `src/renderer/command/command.css`:

```css
/* ── Surface State Panel ─────────────────────────────────────────────── */

.surface-state-panel {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--border);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.surface-state-section {
  background: var(--bg-secondary);
  padding: 8px 16px;
}

.surface-state-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.surface-state-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-ghost);
  font-family: var(--font-mono);
}

.browser-state .surface-state-label {
  color: var(--accent-green);
}

.terminal-state .surface-state-label {
  color: var(--accent-purple);
}

.surface-state-status {
  font-size: 10px;
  font-family: var(--font-mono);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.surface-state-status.loading {
  color: var(--accent-orange);
}

.surface-state-status.ready {
  color: var(--accent-green);
}

.surface-state-status.error {
  color: var(--accent-red);
}

.surface-state-status.running {
  color: var(--accent-orange);
}

.surface-state-details {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.state-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  font-family: var(--font-mono);
  min-height: 16px;
}

.state-row-inline {
  gap: 6px;
  margin-top: 2px;
}

.state-key {
  font-size: 10px;
  color: var(--text-ghost);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
  min-width: 44px;
}

.state-value {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.state-tag {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 2px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.state-tag.active {
  color: var(--accent-green);
  border-color: rgba(0, 212, 123, 0.2);
}

.state-tag.loading {
  color: var(--accent-orange);
  border-color: rgba(255, 149, 0, 0.2);
}

.state-tag.running {
  color: var(--accent-orange);
  border-color: rgba(255, 149, 0, 0.2);
}

/* ── Active Actions Panel ────────────────────────────────────────────── */

.active-actions-panel {
  max-height: 100px;
}

.active-actions-panel .actions-title {
  color: var(--accent-orange);
}

/* ── Error Visibility ────────────────────────────────────────────────── */

.action-row.status-failed {
  background: rgba(238, 68, 68, 0.04);
  border-left-color: var(--accent-red);
}

.action-row.status-failed .action-error-detail {
  display: block;
  color: var(--accent-red);
  font-size: 10px;
  padding: 2px 0 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.action-error-detail {
  display: none;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/command/command.css
git commit -m "feat: add Surface State Panel and error visibility CSS"
```

---

### Task 7: Rewrite Command Center TypeScript

**Files:**
- Modify: `src/renderer/command/command.ts:1-320`

- [ ] **Step 1: Replace the entire command.ts file**

Replace the full contents of `src/renderer/command/command.ts`:

```typescript
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

// Actions panels (split: active + recent)
const activeActionsList = document.getElementById('activeActionsList')!;
const activeActionsCount = document.getElementById('activeActionsCount')!;
const recentActionsList = document.getElementById('recentActionsList')!;
const recentActionsCount = document.getElementById('recentActionsCount')!;

// Surface State Panel
const browserStateStatus = document.getElementById('browserStateStatus')!;
const browserStateUrl = document.getElementById('browserStateUrl')!;
const browserStateTitle = document.getElementById('browserStateTitle')!;
const browserStateLoading = document.getElementById('browserStateLoading')!;
const browserStateBack = document.getElementById('browserStateBack')!;
const browserStateForward = document.getElementById('browserStateForward')!;
const terminalStateStatus = document.getElementById('terminalStateStatus')!;
const terminalStateCommand = document.getElementById('terminalStateCommand')!;
const terminalStateRunning = document.getElementById('terminalStateRunning')!;
const terminalStateExitCode = document.getElementById('terminalStateExitCode')!;

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
  } else if (kind === 'browser.create-tab') {
    const url = actionPayloadInput.value.trim();
    if (url) payload = { url };
  } else if (kind === 'browser.close-tab') {
    const tabId = actionPayloadInput.value.trim();
    if (!tabId) { actionPayloadInput.focus(); return; }
    payload = { tabId };
  } else if (kind === 'browser.activate-tab') {
    const tabId = actionPayloadInput.value.trim();
    if (!tabId) { actionPayloadInput.focus(); return; }
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
    browserStateLoading.textContent = 'idle';
    browserStateLoading.className = 'state-tag';
    browserStateBack.textContent = 'back: no';
    browserStateBack.className = 'state-tag';
    browserStateForward.textContent = 'fwd: no';
    browserStateForward.className = 'state-tag';
    return;
  }

  const nav = br.navigation;
  browserStateStatus.textContent = br.surfaceStatus;
  browserStateStatus.className = `surface-state-status ${br.surfaceStatus}`;

  browserStateUrl.textContent = nav.url || '-';
  browserStateTitle.textContent = nav.title || '-';

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
    terminalStateCommand.textContent = '-';
    terminalStateRunning.textContent = 'no session';
    terminalStateRunning.className = 'state-tag';
    terminalStateExitCode.textContent = 'exit: -';
    terminalStateExitCode.className = 'state-tag';
    return;
  }

  const statusLabel = session.status === 'running' ? 'ready' : session.status;
  terminalStateStatus.textContent = statusLabel;
  terminalStateStatus.className = `surface-state-status ${session.status === 'running' ? 'ready' : session.status === 'error' || session.status === 'exited' ? 'error' : ''}`;

  if (cmd) {
    terminalStateCommand.textContent = cmd.lastCommand || '-';
    terminalStateRunning.textContent = cmd.isRunning ? 'running' : 'idle';
    terminalStateRunning.className = `state-tag ${cmd.isRunning ? 'running' : ''}`;
    const exitDisplay = cmd.lastExitCode !== null ? String(cmd.lastExitCode) : cmd.lastCommand ? 'unknown' : '-';
    terminalStateExitCode.textContent = `exit: ${exitDisplay}`;
    terminalStateExitCode.className = 'state-tag';
  } else {
    terminalStateCommand.textContent = '-';
    terminalStateRunning.textContent = 'idle';
    terminalStateRunning.className = 'state-tag';
    terminalStateExitCode.textContent = 'exit: -';
    terminalStateExitCode.className = 'state-tag';
  }
}

// ─── Task & Log Rendering ───────────────────────────────────────────────────

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
  const recent = records.filter((r: any) => r.status === 'completed' || r.status === 'failed');

  activeActionsCount.textContent = String(active.length);
  recentActionsCount.textContent = String(recent.length);

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
  const recentCount = actionRecords.filter((r: any) => r.status === 'completed' || r.status === 'failed').length;
  activeActionsCount.textContent = String(activeCount);
  recentActionsCount.textContent = String(recentCount);

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
  renderTerminalPanel(state);
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
  // Update browser surface state directly from browser state broadcast
  const nav = bs.navigation;
  browserStateStatus.textContent = bs.surfaceStatus;
  browserStateStatus.className = `surface-state-status ${bs.surfaceStatus}`;
  browserStateUrl.textContent = nav?.url || '-';
  browserStateTitle.textContent = nav?.title || '-';
  if (nav) {
    browserStateLoading.textContent = nav.isLoading ? 'loading' : 'idle';
    browserStateLoading.className = `state-tag ${nav.isLoading ? 'loading' : ''}`;
    browserStateBack.textContent = `back: ${nav.canGoBack ? 'yes' : 'no'}`;
    browserStateBack.className = `state-tag ${nav.canGoBack ? 'active' : ''}`;
    browserStateForward.textContent = `fwd: ${nav.canGoForward ? 'yes' : 'no'}`;
    browserStateForward.className = `state-tag ${nav.canGoForward ? 'active' : ''}`;
  }
});

termRestartBtn.addEventListener('click', async () => { termRestartBtn.disabled = true; try { await workspaceAPI.actions.submit({ target: 'terminal', kind: 'terminal.restart', payload: {} }); } finally { termRestartBtn.disabled = false; } });

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
```

- [ ] **Step 2: Build to verify**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Clean compile.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/command/command.ts
git commit -m "feat: rewrite Command Center with surface state panel and split actions"
```

---

### Task 8: Full build and manual validation

**Files:** None (validation only)

- [ ] **Step 1: Full TypeScript build**

Run: `npx tsc --noEmit`
Expected: Clean compile, zero errors.

- [ ] **Step 2: Webpack/Electron build**

Run: `npm run build 2>&1 | tail -20`
Expected: Build completes without errors.

- [ ] **Step 3: Validate state model integrity**

Verify no duplicate state fields exist:

Run: `grep -n "terminalCommand\|TerminalCommandState" src/shared/types/appState.ts src/shared/types/terminal.ts src/main/state/actions.ts src/main/state/reducer.ts`

Expected: Each file has exactly one reference:
- `terminal.ts`: type definition + factory
- `appState.ts`: field in AppState + default
- `actions.ts`: import + action variant
- `reducer.ts`: case handler

- [ ] **Step 4: Validate no duplicate event types were introduced**

Run: `grep -rn "BROWSER_STATE_UPDATED\|TERMINAL_STATE_UPDATED" src/`
Expected: Zero results (we reused existing events, not duplicates).

- [ ] **Step 5: Validate HTML structure**

Run: `grep -c "browserStatusDot\|terminalStatusDot" src/renderer/command/index.html`
Expected: 0 (old status dots removed).

Run: `grep -c "surface-state-panel" src/renderer/command/index.html`
Expected: 1 (new panel present).

Run: `grep -c "activeActionsList\|recentActionsList" src/renderer/command/index.html`
Expected: 2 (both split panels present).

- [ ] **Step 6: Final commit (if any fixes were needed)**

Only commit if previous steps required adjustments.
