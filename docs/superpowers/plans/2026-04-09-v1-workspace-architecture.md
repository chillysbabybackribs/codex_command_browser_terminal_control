# V1 Workspace Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 3-window Electron desktop workspace (Command Center, Browser, Terminal) with shared event bus, centralized state, layout presets, and persistence.

**Architecture:** Main process owns state via a reducer-based store. A typed EventBus synchronizes state changes to all renderer windows via IPC. Three singleton BrowserWindows (one per role) share a preload-exposed `window.workspaceAPI`. Layout presets use Electron's `screen` API to position windows across displays.

**Tech Stack:** Electron 35, TypeScript 5.8, electron-builder, HTML/CSS renderers (no framework), electron-store for persistence.

---

## File Structure

```
v1workspace/
  package.json
  tsconfig.json
  tsconfig.main.json
  tsconfig.preload.json
  tsconfig.renderer.json
  electron-builder.yml
  src/
    shared/
      types/
        windowRoles.ts          # WindowRole type + constants
        appState.ts             # AppState, TaskRecord, LogRecord, etc.
        events.ts               # Event type enum + payload map
        ipc.ts                  # IPC channel names + WorkspaceAPI interface
      utils/
        ids.ts                  # ID generation utility
    main/
      main.ts                  # Electron app entry point
      state/
        appStateStore.ts        # Central state store with reducer
        actions.ts              # Action creators
        reducer.ts              # State reducer
        persistence.ts          # Load/save state to disk
      events/
        eventBus.ts             # Typed pub/sub event bus
        eventRouter.ts          # Routes events between bus, state, IPC
      windows/
        windowManager.ts        # Create/track/manage 3 windows
        layoutPresets.ts        # Layout preset definitions + apply logic
        windowStateStore.ts     # Persist/restore window bounds
      ipc/
        registerIpc.ts          # All IPC handler registration
    preload/
      preload.ts               # contextBridge exposes workspaceAPI
    renderer/
      shared/
        styles.css              # Shared base styles
        renderUtils.ts          # DOM helpers shared across renderers
      command/
        index.html              # Command Center HTML
        command.ts              # Command Center renderer logic
        command.css             # Command Center styles
      browser/
        index.html              # Browser window HTML
        browser.ts              # Browser renderer logic
        browser.css             # Browser styles
      terminal/
        index.html              # Terminal window HTML
        terminal.ts             # Terminal renderer logic
        terminal.css            # Terminal styles
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.main.json`
- Create: `tsconfig.preload.json`
- Create: `tsconfig.renderer.json`
- Create: `electron-builder.yml`
- Create: `.gitignore`

- [ ] **Step 1: Initialize git repo**

```bash
cd /home/dp/Desktop/v1workspace
git init
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "v1-workspace",
  "version": "1.0.0",
  "description": "Multi-window AI workspace",
  "main": "dist/main/main.js",
  "scripts": {
    "build:main": "tsc -p tsconfig.main.json",
    "build:preload": "tsc -p tsconfig.preload.json",
    "build:renderer": "tsc -p tsconfig.renderer.json",
    "build": "npm run build:main && npm run build:preload && npm run build:renderer && npm run copy:html",
    "copy:html": "node scripts/copy-renderer.js",
    "start": "npm run build && electron .",
    "dev": "npm run build && electron .",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "electron": "^35.0.0",
    "typescript": "^5.8.0"
  },
  "dependencies": {
    "electron-store": "^10.0.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json (base)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "moduleResolution": "node"
  }
}
```

- [ ] **Step 4: Create tsconfig.main.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist/main",
    "rootDir": "src",
    "module": "commonjs"
  },
  "include": ["src/main/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 5: Create tsconfig.preload.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist/preload",
    "rootDir": "src/preload"
  },
  "include": ["src/preload/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 6: Create tsconfig.renderer.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist/renderer",
    "rootDir": "src/renderer",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["src/renderer/**/*"]
}
```

- [ ] **Step 7: Create electron-builder.yml**

```yaml
appId: com.v1workspace.app
productName: V1 Workspace
directories:
  output: release
files:
  - dist/**/*
  - "!node_modules/**/*"
```

- [ ] **Step 8: Create .gitignore**

```
node_modules/
dist/
release/
*.js.map
.DS_Store
```

- [ ] **Step 9: Create scripts/copy-renderer.js**

This script copies HTML and CSS files from `src/renderer/` to `dist/renderer/` since TypeScript doesn't copy non-TS files.

```js
const fs = require('fs');
const path = require('path');

const srcBase = path.join(__dirname, '..', 'src', 'renderer');
const distBase = path.join(__dirname, '..', 'dist', 'renderer');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyRecursive(srcPath, destPath);
    } else if (entry.name.endsWith('.html') || entry.name.endsWith('.css')) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyRecursive(srcBase, distBase);
console.log('Renderer assets copied.');
```

- [ ] **Step 10: Install dependencies**

```bash
cd /home/dp/Desktop/v1workspace
npm install
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold Electron project with TypeScript config"
```

---

### Task 2: Shared Types

**Files:**
- Create: `src/shared/types/windowRoles.ts`
- Create: `src/shared/types/appState.ts`
- Create: `src/shared/types/events.ts`
- Create: `src/shared/types/ipc.ts`
- Create: `src/shared/utils/ids.ts`

- [ ] **Step 1: Create windowRoles.ts**

```ts
export const WINDOW_ROLES = ['command', 'browser', 'terminal'] as const;
export type WindowRole = typeof WINDOW_ROLES[number];
```

- [ ] **Step 2: Create appState.ts**

```ts
import { WindowRole } from './windowRoles';

export type WindowState = {
  role: WindowRole;
  bounds: { x: number; y: number; width: number; height: number };
  isVisible: boolean;
  isFocused: boolean;
  displayId: number;
};

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export type TaskRecord = {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
};

export type LogLevel = 'info' | 'warn' | 'error';
export type LogSource = WindowRole | 'system';

export type LogRecord = {
  id: string;
  timestamp: number;
  level: LogLevel;
  source: LogSource;
  message: string;
  taskId?: string;
};

export type SurfaceStatus = 'idle' | 'running' | 'done' | 'error';

export type SurfaceExecutionState = {
  status: SurfaceStatus;
  lastUpdatedAt: number | null;
  detail: string;
};

export type LayoutPreset = 'default' | 'focus-browser' | 'focus-terminal' | 'focus-command';

export type AppState = {
  windows: Record<WindowRole, WindowState>;
  layoutPreset: LayoutPreset;
  tasks: TaskRecord[];
  activeTaskId: string | null;
  logs: LogRecord[];
  browser: SurfaceExecutionState;
  terminal: SurfaceExecutionState;
};

export function createDefaultWindowState(role: WindowRole): WindowState {
  return {
    role,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    isVisible: false,
    isFocused: false,
    displayId: 0,
  };
}

export function createDefaultAppState(): AppState {
  return {
    windows: {
      command: createDefaultWindowState('command'),
      browser: createDefaultWindowState('browser'),
      terminal: createDefaultWindowState('terminal'),
    },
    layoutPreset: 'default',
    tasks: [],
    activeTaskId: null,
    logs: [],
    browser: { status: 'idle', lastUpdatedAt: null, detail: '' },
    terminal: { status: 'idle', lastUpdatedAt: null, detail: '' },
  };
}
```

- [ ] **Step 3: Create events.ts**

```ts
import { WindowRole } from './windowRoles';
import { TaskRecord, LogRecord, LayoutPreset, SurfaceExecutionState, AppState, WindowState } from './appState';

export enum AppEventType {
  TASK_CREATED = 'TASK_CREATED',
  TASK_UPDATED = 'TASK_UPDATED',
  TASK_COMPLETED = 'TASK_COMPLETED',
  LOG_ADDED = 'LOG_ADDED',
  WINDOW_BOUNDS_CHANGED = 'WINDOW_BOUNDS_CHANGED',
  WINDOW_FOCUSED = 'WINDOW_FOCUSED',
  WINDOW_LAYOUT_APPLIED = 'WINDOW_LAYOUT_APPLIED',
  WINDOW_LAYOUT_RESET = 'WINDOW_LAYOUT_RESET',
  BROWSER_ACTION_REQUESTED = 'BROWSER_ACTION_REQUESTED',
  BROWSER_ACTION_UPDATED = 'BROWSER_ACTION_UPDATED',
  TERMINAL_ACTION_REQUESTED = 'TERMINAL_ACTION_REQUESTED',
  TERMINAL_ACTION_UPDATED = 'TERMINAL_ACTION_UPDATED',
  APP_STATE_SYNCED = 'APP_STATE_SYNCED',
}

export type AppEventPayloads = {
  [AppEventType.TASK_CREATED]: { task: TaskRecord };
  [AppEventType.TASK_UPDATED]: { task: TaskRecord };
  [AppEventType.TASK_COMPLETED]: { taskId: string };
  [AppEventType.LOG_ADDED]: { log: LogRecord };
  [AppEventType.WINDOW_BOUNDS_CHANGED]: { role: WindowRole; bounds: WindowState['bounds']; displayId: number };
  [AppEventType.WINDOW_FOCUSED]: { role: WindowRole };
  [AppEventType.WINDOW_LAYOUT_APPLIED]: { preset: LayoutPreset };
  [AppEventType.WINDOW_LAYOUT_RESET]: {};
  [AppEventType.BROWSER_ACTION_REQUESTED]: { action: string; taskId?: string };
  [AppEventType.BROWSER_ACTION_UPDATED]: { status: SurfaceExecutionState };
  [AppEventType.TERMINAL_ACTION_REQUESTED]: { action: string; taskId?: string };
  [AppEventType.TERMINAL_ACTION_UPDATED]: { status: SurfaceExecutionState };
  [AppEventType.APP_STATE_SYNCED]: { state: AppState };
};

export type AppEvent<T extends AppEventType = AppEventType> = {
  type: T;
  payload: AppEventPayloads[T];
  timestamp: number;
};
```

- [ ] **Step 4: Create ipc.ts**

```ts
import { AppState, LayoutPreset, LogLevel, LogSource, SurfaceExecutionState, TaskStatus } from './appState';
import { AppEventType, AppEventPayloads } from './events';
import { WindowRole } from './windowRoles';

// IPC channel constants
export const IPC_CHANNELS = {
  GET_STATE: 'workspace:get-state',
  GET_ROLE: 'workspace:get-role',
  EMIT_EVENT: 'workspace:emit-event',
  STATE_UPDATE: 'workspace:state-update',
  EVENT_BROADCAST: 'workspace:event-broadcast',
  CREATE_TASK: 'workspace:create-task',
  UPDATE_TASK_STATUS: 'workspace:update-task-status',
  ADD_LOG: 'workspace:add-log',
  APPLY_LAYOUT: 'workspace:apply-layout',
  RESET_LAYOUT: 'workspace:reset-layout',
  REQUEST_BROWSER_ACTION: 'workspace:request-browser-action',
  REQUEST_TERMINAL_ACTION: 'workspace:request-terminal-action',
  UPDATE_SURFACE_STATUS: 'workspace:update-surface-status',
} as const;

// The API shape exposed to renderers via contextBridge
export interface WorkspaceAPI {
  getState(): Promise<AppState>;
  getRole(): Promise<WindowRole>;

  createTask(title: string): Promise<void>;
  updateTaskStatus(taskId: string, status: TaskStatus): Promise<void>;

  addLog(level: LogLevel, source: LogSource, message: string, taskId?: string): Promise<void>;

  applyLayout(preset: LayoutPreset): Promise<void>;
  resetLayout(): Promise<void>;

  requestBrowserAction(action: string, taskId?: string): Promise<void>;
  requestTerminalAction(action: string, taskId?: string): Promise<void>;
  updateSurfaceStatus(surface: 'browser' | 'terminal', status: SurfaceExecutionState): Promise<void>;

  onStateUpdate(callback: (state: AppState) => void): void;
  onEvent(callback: (type: AppEventType, payload: unknown) => void): void;

  removeAllListeners(): void;
}
```

- [ ] **Step 5: Create ids.ts**

```ts
let counter = 0;

export function generateId(prefix: string = 'id'): string {
  counter++;
  return `${prefix}_${Date.now()}_${counter}`;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/shared/
git commit -m "feat: add shared types for window roles, app state, events, and IPC contract"
```

---

### Task 3: App State Store (Reducer + Persistence)

**Files:**
- Create: `src/main/state/reducer.ts`
- Create: `src/main/state/actions.ts`
- Create: `src/main/state/persistence.ts`
- Create: `src/main/state/appStateStore.ts`

- [ ] **Step 1: Create actions.ts**

Defines the action types and action creators for the state reducer.

```ts
import { WindowRole } from '../../shared/types/windowRoles';
import { TaskRecord, LogRecord, LayoutPreset, SurfaceExecutionState, WindowState, TaskStatus } from '../../shared/types/appState';

export enum ActionType {
  SET_WINDOW_STATE = 'SET_WINDOW_STATE',
  SET_WINDOW_BOUNDS = 'SET_WINDOW_BOUNDS',
  SET_WINDOW_FOCUSED = 'SET_WINDOW_FOCUSED',
  SET_WINDOW_VISIBLE = 'SET_WINDOW_VISIBLE',
  SET_LAYOUT_PRESET = 'SET_LAYOUT_PRESET',
  ADD_TASK = 'ADD_TASK',
  UPDATE_TASK = 'UPDATE_TASK',
  SET_ACTIVE_TASK = 'SET_ACTIVE_TASK',
  ADD_LOG = 'ADD_LOG',
  SET_SURFACE_STATUS = 'SET_SURFACE_STATUS',
  REPLACE_STATE = 'REPLACE_STATE',
}

export type Action =
  | { type: ActionType.SET_WINDOW_STATE; role: WindowRole; state: Partial<WindowState> }
  | { type: ActionType.SET_WINDOW_BOUNDS; role: WindowRole; bounds: WindowState['bounds']; displayId: number }
  | { type: ActionType.SET_WINDOW_FOCUSED; role: WindowRole; isFocused: boolean }
  | { type: ActionType.SET_WINDOW_VISIBLE; role: WindowRole; isVisible: boolean }
  | { type: ActionType.SET_LAYOUT_PRESET; preset: LayoutPreset }
  | { type: ActionType.ADD_TASK; task: TaskRecord }
  | { type: ActionType.UPDATE_TASK; taskId: string; updates: Partial<Pick<TaskRecord, 'status' | 'updatedAt'>> }
  | { type: ActionType.SET_ACTIVE_TASK; taskId: string | null }
  | { type: ActionType.ADD_LOG; log: LogRecord }
  | { type: ActionType.SET_SURFACE_STATUS; surface: 'browser' | 'terminal'; status: SurfaceExecutionState }
  | { type: ActionType.REPLACE_STATE; state: import('../../shared/types/appState').AppState };
```

- [ ] **Step 2: Create reducer.ts**

```ts
import { AppState } from '../../shared/types/appState';
import { Action, ActionType } from './actions';

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case ActionType.SET_WINDOW_STATE:
      return {
        ...state,
        windows: {
          ...state.windows,
          [action.role]: { ...state.windows[action.role], ...action.state },
        },
      };

    case ActionType.SET_WINDOW_BOUNDS:
      return {
        ...state,
        windows: {
          ...state.windows,
          [action.role]: {
            ...state.windows[action.role],
            bounds: action.bounds,
            displayId: action.displayId,
          },
        },
      };

    case ActionType.SET_WINDOW_FOCUSED: {
      const updated = { ...state.windows };
      // Unfocus all, then focus the target
      for (const role of Object.keys(updated) as Array<keyof typeof updated>) {
        updated[role] = { ...updated[role], isFocused: role === action.role && action.isFocused };
      }
      return { ...state, windows: updated };
    }

    case ActionType.SET_WINDOW_VISIBLE:
      return {
        ...state,
        windows: {
          ...state.windows,
          [action.role]: { ...state.windows[action.role], isVisible: action.isVisible },
        },
      };

    case ActionType.SET_LAYOUT_PRESET:
      return { ...state, layoutPreset: action.preset };

    case ActionType.ADD_TASK:
      return {
        ...state,
        tasks: [...state.tasks, action.task],
        activeTaskId: action.task.id,
      };

    case ActionType.UPDATE_TASK:
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.taskId ? { ...t, ...action.updates } : t
        ),
      };

    case ActionType.SET_ACTIVE_TASK:
      return { ...state, activeTaskId: action.taskId };

    case ActionType.ADD_LOG: {
      // Keep last 500 logs to prevent unbounded growth
      const logs = [...state.logs, action.log];
      return { ...state, logs: logs.length > 500 ? logs.slice(-500) : logs };
    }

    case ActionType.SET_SURFACE_STATUS:
      return { ...state, [action.surface]: action.status };

    case ActionType.REPLACE_STATE:
      return action.state;

    default:
      return state;
  }
}
```

- [ ] **Step 3: Create persistence.ts**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { AppState, createDefaultAppState } from '../../shared/types/appState';

const STATE_FILE = 'workspace-state.json';

function getStatePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE);
}

// Only persist the parts that matter across restarts
type PersistedState = {
  layoutPreset: AppState['layoutPreset'];
  windows: AppState['windows'];
};

export function loadPersistedState(): Partial<PersistedState> {
  try {
    const filePath = getStatePath();
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedState;
    return parsed;
  } catch {
    return {};
  }
}

export function savePersistedState(state: AppState): void {
  try {
    const persisted: PersistedState = {
      layoutPreset: state.layoutPreset,
      windows: state.windows,
    };
    const filePath = getStatePath();
    fs.writeFileSync(filePath, JSON.stringify(persisted, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist state:', err);
  }
}

export function buildInitialState(): AppState {
  const defaults = createDefaultAppState();
  const persisted = loadPersistedState();
  return {
    ...defaults,
    layoutPreset: persisted.layoutPreset ?? defaults.layoutPreset,
    windows: persisted.windows
      ? { ...defaults.windows, ...persisted.windows }
      : defaults.windows,
  };
}
```

- [ ] **Step 4: Create appStateStore.ts**

```ts
import { AppState } from '../../shared/types/appState';
import { Action } from './actions';
import { appReducer } from './reducer';
import { buildInitialState, savePersistedState } from './persistence';

export type StateListener = (state: AppState) => void;

class AppStateStore {
  private state: AppState;
  private listeners: StateListener[] = [];
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.state = buildInitialState();
  }

  getState(): AppState {
    return this.state;
  }

  dispatch(action: Action): void {
    this.state = appReducer(this.state, action);
    this.notifyListeners();
    this.schedulePersist();
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(): void {
    const snapshot = this.state;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  // Debounce persistence to avoid excessive disk writes
  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      savePersistedState(this.state);
      this.persistTimer = null;
    }, 1000);
  }

  persistNow(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    savePersistedState(this.state);
  }
}

// Singleton
export const appStateStore = new AppStateStore();
```

- [ ] **Step 5: Commit**

```bash
git add src/main/state/
git commit -m "feat: add app state store with reducer, actions, and persistence"
```

---

### Task 4: Event Bus

**Files:**
- Create: `src/main/events/eventBus.ts`
- Create: `src/main/events/eventRouter.ts`

- [ ] **Step 1: Create eventBus.ts**

```ts
import { AppEventType, AppEventPayloads, AppEvent } from '../../shared/types/events';

type EventHandler<T extends AppEventType> = (event: AppEvent<T>) => void;
type AnyEventHandler = (event: AppEvent) => void;

export class EventBus {
  private handlers: Map<AppEventType, Set<EventHandler<any>>> = new Map();
  private globalHandlers: Set<AnyEventHandler> = new Set();

  on<T extends AppEventType>(type: T, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  onAny(handler: AnyEventHandler): () => void {
    this.globalHandlers.add(handler);
    return () => {
      this.globalHandlers.delete(handler);
    };
  }

  emit<T extends AppEventType>(type: T, payload: AppEventPayloads[T]): void {
    const event: AppEvent<T> = {
      type,
      payload,
      timestamp: Date.now(),
    };

    const handlers = this.handlers.get(type);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    }

    for (const handler of this.globalHandlers) {
      handler(event as AppEvent);
    }
  }

  removeAll(): void {
    this.handlers.clear();
    this.globalHandlers.clear();
  }
}

// Singleton
export const eventBus = new EventBus();
```

- [ ] **Step 2: Create eventRouter.ts**

The event router connects the event bus to the state store and broadcasts events to all renderer windows via IPC.

```ts
import { BrowserWindow } from 'electron';
import { eventBus } from './eventBus';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { AppEventType, AppEvent } from '../../shared/types/events';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { WindowRole } from '../../shared/types/windowRoles';
import { generateId } from '../../shared/utils/ids';

// Broadcast an event to all renderer windows
function broadcastToRenderers(event: AppEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send(IPC_CHANNELS.EVENT_BROADCAST, event.type, event.payload);
    }
  }
}

// Broadcast current state snapshot to all renderers
function broadcastState(): void {
  const state = appStateStore.getState();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send(IPC_CHANNELS.STATE_UPDATE, state);
    }
  }
}

export function initEventRouter(): void {
  // Every event gets broadcast to renderers
  eventBus.onAny((event) => {
    broadcastToRenderers(event);
  });

  // State changes trigger state broadcast
  appStateStore.subscribe(() => {
    broadcastState();
  });

  // Wire specific events to state mutations
  eventBus.on(AppEventType.TASK_CREATED, (event) => {
    appStateStore.dispatch({ type: ActionType.ADD_TASK, task: event.payload.task });
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level: 'info',
        source: 'system',
        message: `Task created: ${event.payload.task.title}`,
        taskId: event.payload.task.id,
      },
    });
  });

  eventBus.on(AppEventType.TASK_UPDATED, (event) => {
    appStateStore.dispatch({
      type: ActionType.UPDATE_TASK,
      taskId: event.payload.task.id,
      updates: { status: event.payload.task.status, updatedAt: event.payload.task.updatedAt },
    });
  });

  eventBus.on(AppEventType.TASK_COMPLETED, (event) => {
    appStateStore.dispatch({
      type: ActionType.UPDATE_TASK,
      taskId: event.payload.taskId,
      updates: { status: 'completed', updatedAt: Date.now() },
    });
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level: 'info',
        source: 'system',
        message: `Task completed: ${event.payload.taskId}`,
        taskId: event.payload.taskId,
      },
    });
  });

  eventBus.on(AppEventType.LOG_ADDED, (event) => {
    appStateStore.dispatch({ type: ActionType.ADD_LOG, log: event.payload.log });
  });

  eventBus.on(AppEventType.WINDOW_BOUNDS_CHANGED, (event) => {
    appStateStore.dispatch({
      type: ActionType.SET_WINDOW_BOUNDS,
      role: event.payload.role,
      bounds: event.payload.bounds,
      displayId: event.payload.displayId,
    });
  });

  eventBus.on(AppEventType.WINDOW_FOCUSED, (event) => {
    appStateStore.dispatch({
      type: ActionType.SET_WINDOW_FOCUSED,
      role: event.payload.role,
      isFocused: true,
    });
  });

  eventBus.on(AppEventType.WINDOW_LAYOUT_APPLIED, (event) => {
    appStateStore.dispatch({ type: ActionType.SET_LAYOUT_PRESET, preset: event.payload.preset });
  });

  eventBus.on(AppEventType.BROWSER_ACTION_REQUESTED, (event) => {
    appStateStore.dispatch({
      type: ActionType.SET_SURFACE_STATUS,
      surface: 'browser',
      status: { status: 'running', lastUpdatedAt: Date.now(), detail: event.payload.action },
    });
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level: 'info',
        source: 'browser',
        message: `Browser action requested: ${event.payload.action}`,
        taskId: event.payload.taskId,
      },
    });
  });

  eventBus.on(AppEventType.BROWSER_ACTION_UPDATED, (event) => {
    appStateStore.dispatch({
      type: ActionType.SET_SURFACE_STATUS,
      surface: 'browser',
      status: event.payload.status,
    });
  });

  eventBus.on(AppEventType.TERMINAL_ACTION_REQUESTED, (event) => {
    appStateStore.dispatch({
      type: ActionType.SET_SURFACE_STATUS,
      surface: 'terminal',
      status: { status: 'running', lastUpdatedAt: Date.now(), detail: event.payload.action },
    });
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level: 'info',
        source: 'terminal',
        message: `Terminal action requested: ${event.payload.action}`,
        taskId: event.payload.taskId,
      },
    });
  });

  eventBus.on(AppEventType.TERMINAL_ACTION_UPDATED, (event) => {
    appStateStore.dispatch({
      type: ActionType.SET_SURFACE_STATUS,
      surface: 'terminal',
      status: event.payload.status,
    });
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main/events/
git commit -m "feat: add typed event bus and event router"
```

---

### Task 5: Layout Presets

**Files:**
- Create: `src/main/windows/layoutPresets.ts`

- [ ] **Step 1: Create layoutPresets.ts**

```ts
import { screen } from 'electron';
import { LayoutPreset, WindowState } from '../../shared/types/appState';
import { WindowRole, WINDOW_ROLES } from '../../shared/types/windowRoles';

type BoundsConfig = { x: number; y: number; width: number; height: number };
type LayoutBounds = Record<WindowRole, BoundsConfig & { displayId: number }>;

function getDisplays(): Electron.Display[] {
  return screen.getAllDisplays();
}

function getPrimaryDisplay(): Electron.Display {
  return screen.getPrimaryDisplay();
}

/**
 * Detect display arrangement:
 * - If 2+ displays, find the external (larger or non-primary) for top workspace
 *   and use primary/internal for command center
 * - If 1 display, stack all windows
 */
function classifyDisplays(): { topDisplay: Electron.Display; bottomDisplay: Electron.Display; isSingleMonitor: boolean } {
  const displays = getDisplays();

  if (displays.length === 1) {
    return { topDisplay: displays[0], bottomDisplay: displays[0], isSingleMonitor: true };
  }

  const primary = getPrimaryDisplay();

  // Find the external display (non-primary, or the larger one)
  // For the user's setup: top = ultrawide (external), bottom = laptop (primary)
  const external = displays.find((d) => d.id !== primary.id) ?? primary;

  // The external/larger display is "top" (browser + terminal)
  // The primary/internal is "bottom" (command)
  return {
    topDisplay: external,
    bottomDisplay: primary,
    isSingleMonitor: false,
  };
}

function computeDefaultLayout(): LayoutBounds {
  const { topDisplay, bottomDisplay, isSingleMonitor } = classifyDisplays();
  const top = topDisplay.workArea;
  const bottom = bottomDisplay.workArea;

  if (isSingleMonitor) {
    // Single monitor: stack vertically - command bottom third, browser/terminal split top two-thirds
    const totalH = top.height;
    const commandH = Math.floor(totalH * 0.33);
    const surfaceH = totalH - commandH;
    const halfW = Math.floor(top.width / 2);

    return {
      browser: { x: top.x, y: top.y, width: halfW, height: surfaceH, displayId: topDisplay.id },
      terminal: { x: top.x + halfW, y: top.y, width: top.width - halfW, height: surfaceH, displayId: topDisplay.id },
      command: { x: bottom.x, y: top.y + surfaceH, width: top.width, height: commandH, displayId: bottomDisplay.id },
    };
  }

  // Dual monitor: browser + terminal split on top display, command full on bottom
  const halfW = Math.floor(top.width / 2);
  return {
    browser: { x: top.x, y: top.y, width: halfW, height: top.height, displayId: topDisplay.id },
    terminal: { x: top.x + halfW, y: top.y, width: top.width - halfW, height: top.height, displayId: topDisplay.id },
    command: { x: bottom.x, y: bottom.y, width: bottom.width, height: bottom.height, displayId: bottomDisplay.id },
  };
}

function computeFocusBrowserLayout(): LayoutBounds {
  const { topDisplay, bottomDisplay, isSingleMonitor } = classifyDisplays();
  const top = topDisplay.workArea;
  const bottom = bottomDisplay.workArea;

  if (isSingleMonitor) {
    const totalH = top.height;
    const commandH = Math.floor(totalH * 0.2);
    const terminalW = Math.floor(top.width * 0.3);
    const browserH = totalH - commandH;

    return {
      browser: { x: top.x, y: top.y, width: top.width - terminalW, height: browserH, displayId: topDisplay.id },
      terminal: { x: top.x + top.width - terminalW, y: top.y, width: terminalW, height: browserH, displayId: topDisplay.id },
      command: { x: bottom.x, y: top.y + browserH, width: top.width, height: commandH, displayId: bottomDisplay.id },
    };
  }

  // Browser gets 70% of top display
  const browserW = Math.floor(top.width * 0.7);
  return {
    browser: { x: top.x, y: top.y, width: browserW, height: top.height, displayId: topDisplay.id },
    terminal: { x: top.x + browserW, y: top.y, width: top.width - browserW, height: top.height, displayId: topDisplay.id },
    command: { x: bottom.x, y: bottom.y, width: bottom.width, height: bottom.height, displayId: bottomDisplay.id },
  };
}

function computeFocusTerminalLayout(): LayoutBounds {
  const { topDisplay, bottomDisplay, isSingleMonitor } = classifyDisplays();
  const top = topDisplay.workArea;
  const bottom = bottomDisplay.workArea;

  if (isSingleMonitor) {
    const totalH = top.height;
    const commandH = Math.floor(totalH * 0.2);
    const browserW = Math.floor(top.width * 0.3);
    const surfaceH = totalH - commandH;

    return {
      browser: { x: top.x, y: top.y, width: browserW, height: surfaceH, displayId: topDisplay.id },
      terminal: { x: top.x + browserW, y: top.y, width: top.width - browserW, height: surfaceH, displayId: topDisplay.id },
      command: { x: bottom.x, y: top.y + surfaceH, width: top.width, height: commandH, displayId: bottomDisplay.id },
    };
  }

  // Terminal gets 70% of top display
  const terminalW = Math.floor(top.width * 0.7);
  const browserW = top.width - terminalW;
  return {
    browser: { x: top.x, y: top.y, width: browserW, height: top.height, displayId: topDisplay.id },
    terminal: { x: top.x + browserW, y: top.y, width: terminalW, height: top.height, displayId: topDisplay.id },
    command: { x: bottom.x, y: bottom.y, width: bottom.width, height: bottom.height, displayId: bottomDisplay.id },
  };
}

function computeFocusCommandLayout(): LayoutBounds {
  const { topDisplay, bottomDisplay, isSingleMonitor } = classifyDisplays();
  const top = topDisplay.workArea;
  const bottom = bottomDisplay.workArea;

  if (isSingleMonitor) {
    const totalH = top.height;
    const commandH = Math.floor(totalH * 0.5);
    const surfaceH = totalH - commandH;
    const halfW = Math.floor(top.width / 2);

    return {
      browser: { x: top.x, y: top.y, width: halfW, height: surfaceH, displayId: topDisplay.id },
      terminal: { x: top.x + halfW, y: top.y, width: top.width - halfW, height: surfaceH, displayId: topDisplay.id },
      command: { x: bottom.x, y: top.y + surfaceH, width: top.width, height: commandH, displayId: bottomDisplay.id },
    };
  }

  // Command gets entire bottom display (same as default), but top windows get smaller
  const halfW = Math.floor(top.width / 2);
  const surfaceH = Math.floor(top.height * 0.6);
  return {
    browser: { x: top.x, y: top.y, width: halfW, height: surfaceH, displayId: topDisplay.id },
    terminal: { x: top.x + halfW, y: top.y, width: top.width - halfW, height: surfaceH, displayId: topDisplay.id },
    command: { x: bottom.x, y: bottom.y, width: bottom.width, height: bottom.height, displayId: bottomDisplay.id },
  };
}

export function getLayoutBounds(preset: LayoutPreset): LayoutBounds {
  switch (preset) {
    case 'default': return computeDefaultLayout();
    case 'focus-browser': return computeFocusBrowserLayout();
    case 'focus-terminal': return computeFocusTerminalLayout();
    case 'focus-command': return computeFocusCommandLayout();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/windows/layoutPresets.ts
git commit -m "feat: add layout presets with dual-monitor and single-monitor support"
```

---

### Task 6: Window Manager

**Files:**
- Create: `src/main/windows/windowManager.ts`

- [ ] **Step 1: Create windowManager.ts**

```ts
import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import { WindowRole, WINDOW_ROLES } from '../../shared/types/windowRoles';
import { LayoutPreset, WindowState } from '../../shared/types/appState';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { getLayoutBounds } from './layoutPresets';
import { generateId } from '../../shared/utils/ids';

const windows: Map<WindowRole, BrowserWindow> = new Map();
const roleByWebContentsId: Map<number, WindowRole> = new Map();

function getRendererPath(role: WindowRole): string {
  return path.join(__dirname, '..', 'renderer', role, 'index.html');
}

function getPreloadPath(): string {
  return path.join(__dirname, '..', 'preload', 'preload.js');
}

function createRoleWindow(role: WindowRole): BrowserWindow {
  const state = appStateStore.getState();
  const winState = state.windows[role];

  // Validate that persisted bounds are on a valid display
  const bounds = validateBounds(winState.bounds);

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 400,
    minHeight: 300,
    title: `V1 Workspace - ${role.charAt(0).toUpperCase() + role.slice(1)}`,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false, // Show after ready-to-show
  });

  windows.set(role, win);
  roleByWebContentsId.set(win.webContents.id, role);

  // Load the renderer HTML
  win.loadFile(getRendererPath(role));

  // Show when ready
  win.once('ready-to-show', () => {
    win.show();
    appStateStore.dispatch({ type: ActionType.SET_WINDOW_VISIBLE, role, isVisible: true });
  });

  // Track bounds changes (move + resize)
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const onBoundsChanged = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const b = win.getBounds();
      const display = screen.getDisplayMatching(b);
      eventBus.emit(AppEventType.WINDOW_BOUNDS_CHANGED, {
        role,
        bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
        displayId: display.id,
      });
      boundsTimer = null;
    }, 300);
  };
  win.on('move', onBoundsChanged);
  win.on('resize', onBoundsChanged);

  // Track focus
  win.on('focus', () => {
    eventBus.emit(AppEventType.WINDOW_FOCUSED, { role });
  });

  win.on('blur', () => {
    appStateStore.dispatch({ type: ActionType.SET_WINDOW_FOCUSED, role, isFocused: false });
  });

  // Handle close: hide instead of destroy to keep the app running
  win.on('close', (e) => {
    // If app is quitting, let it close
    if ((global as any).__appQuitting) return;

    e.preventDefault();
    win.hide();
    appStateStore.dispatch({ type: ActionType.SET_WINDOW_VISIBLE, role, isVisible: false });
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level: 'info',
        source: 'system',
        message: `${role} window hidden`,
      },
    });
  });

  return win;
}

function validateBounds(bounds: WindowState['bounds']): WindowState['bounds'] {
  const displays = screen.getAllDisplays();

  // Check if bounds center point is within any display
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  const onScreen = displays.some((d) => {
    const wa = d.workArea;
    return centerX >= wa.x && centerX < wa.x + wa.width &&
           centerY >= wa.y && centerY < wa.y + wa.height;
  });

  if (onScreen) return bounds;

  // Fallback: center on primary display
  const primary = screen.getPrimaryDisplay();
  const wa = primary.workArea;
  return {
    x: wa.x + Math.floor((wa.width - bounds.width) / 2),
    y: wa.y + Math.floor((wa.height - bounds.height) / 2),
    width: Math.min(bounds.width, wa.width),
    height: Math.min(bounds.height, wa.height),
  };
}

export function createAllWindows(): void {
  for (const role of WINDOW_ROLES) {
    createRoleWindow(role);
  }
}

export function getWindowByRole(role: WindowRole): BrowserWindow | undefined {
  const win = windows.get(role);
  return win && !win.isDestroyed() ? win : undefined;
}

export function getRoleByWebContentsId(webContentsId: number): WindowRole | undefined {
  return roleByWebContentsId.get(webContentsId);
}

export function showAllWindows(): void {
  for (const [role, win] of windows) {
    if (!win.isDestroyed()) {
      win.show();
      appStateStore.dispatch({ type: ActionType.SET_WINDOW_VISIBLE, role, isVisible: true });
    }
  }
}

export function focusWindow(role: WindowRole): void {
  const win = windows.get(role);
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }
}

export function applyLayout(preset: LayoutPreset): void {
  const bounds = getLayoutBounds(preset);

  for (const role of WINDOW_ROLES) {
    const win = windows.get(role);
    if (win && !win.isDestroyed()) {
      const b = bounds[role];
      win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    }
  }

  eventBus.emit(AppEventType.WINDOW_LAYOUT_APPLIED, { preset });
  appStateStore.dispatch({
    type: ActionType.ADD_LOG,
    log: {
      id: generateId('log'),
      timestamp: Date.now(),
      level: 'info',
      source: 'system',
      message: `Layout applied: ${preset}`,
    },
  });
}

export function resetLayout(): void {
  applyLayout('default');
  eventBus.emit(AppEventType.WINDOW_LAYOUT_RESET, {});
}

export function setAppQuitting(): void {
  (global as any).__appQuitting = true;
}

export function destroyAllWindows(): void {
  for (const [, win] of windows) {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
  windows.clear();
  roleByWebContentsId.clear();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/windows/windowManager.ts
git commit -m "feat: add window manager with role-based windows and layout application"
```

---

### Task 7: IPC Registration

**Files:**
- Create: `src/main/ipc/registerIpc.ts`

- [ ] **Step 1: Create registerIpc.ts**

```ts
import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { appStateStore } from '../state/appStateStore';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { getRoleByWebContentsId, applyLayout, resetLayout } from '../windows/windowManager';
import { generateId } from '../../shared/utils/ids';
import { TaskRecord, LogRecord, SurfaceExecutionState, LayoutPreset, TaskStatus, LogLevel, LogSource } from '../../shared/types/appState';

export function registerIpc(): void {
  // Get current app state snapshot
  ipcMain.handle(IPC_CHANNELS.GET_STATE, () => {
    return appStateStore.getState();
  });

  // Get the role of the requesting window
  ipcMain.handle(IPC_CHANNELS.GET_ROLE, (event) => {
    return getRoleByWebContentsId(event.sender.id);
  });

  // Create a new task
  ipcMain.handle(IPC_CHANNELS.CREATE_TASK, (_event, title: string) => {
    const task: TaskRecord = {
      id: generateId('task'),
      title,
      status: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    eventBus.emit(AppEventType.TASK_CREATED, { task });
  });

  // Update task status
  ipcMain.handle(IPC_CHANNELS.UPDATE_TASK_STATUS, (_event, taskId: string, status: TaskStatus) => {
    const state = appStateStore.getState();
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    const updated = { ...task, status, updatedAt: Date.now() };
    eventBus.emit(AppEventType.TASK_UPDATED, { task: updated });

    if (status === 'completed') {
      eventBus.emit(AppEventType.TASK_COMPLETED, { taskId });
    }
  });

  // Add a log entry
  ipcMain.handle(IPC_CHANNELS.ADD_LOG, (_event, level: LogLevel, source: LogSource, message: string, taskId?: string) => {
    const log: LogRecord = {
      id: generateId('log'),
      timestamp: Date.now(),
      level,
      source,
      message,
      taskId,
    };
    eventBus.emit(AppEventType.LOG_ADDED, { log });
  });

  // Apply layout preset
  ipcMain.handle(IPC_CHANNELS.APPLY_LAYOUT, (_event, preset: LayoutPreset) => {
    applyLayout(preset);
  });

  // Reset layout
  ipcMain.handle(IPC_CHANNELS.RESET_LAYOUT, () => {
    resetLayout();
  });

  // Request browser action
  ipcMain.handle(IPC_CHANNELS.REQUEST_BROWSER_ACTION, (_event, action: string, taskId?: string) => {
    eventBus.emit(AppEventType.BROWSER_ACTION_REQUESTED, { action, taskId });
  });

  // Request terminal action
  ipcMain.handle(IPC_CHANNELS.REQUEST_TERMINAL_ACTION, (_event, action: string, taskId?: string) => {
    eventBus.emit(AppEventType.TERMINAL_ACTION_REQUESTED, { action, taskId });
  });

  // Update surface status
  ipcMain.handle(IPC_CHANNELS.UPDATE_SURFACE_STATUS, (_event, surface: 'browser' | 'terminal', status: SurfaceExecutionState) => {
    if (surface === 'browser') {
      eventBus.emit(AppEventType.BROWSER_ACTION_UPDATED, { status });
    } else {
      eventBus.emit(AppEventType.TERMINAL_ACTION_UPDATED, { status });
    }
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/ipc/registerIpc.ts
git commit -m "feat: add IPC handler registration for all workspace operations"
```

---

### Task 8: Preload Script

**Files:**
- Create: `src/preload/preload.ts`

- [ ] **Step 1: Create preload.ts**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { WorkspaceAPI, IPC_CHANNELS } from '../shared/types/ipc';
import { AppState, LayoutPreset, LogLevel, LogSource, SurfaceExecutionState, TaskStatus } from '../shared/types/appState';
import { AppEventType } from '../shared/types/events';
import { WindowRole } from '../shared/types/windowRoles';

const api: WorkspaceAPI = {
  getState(): Promise<AppState> {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_STATE);
  },

  getRole(): Promise<WindowRole> {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_ROLE);
  },

  createTask(title: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.CREATE_TASK, title);
  },

  updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.UPDATE_TASK_STATUS, taskId, status);
  },

  addLog(level: LogLevel, source: LogSource, message: string, taskId?: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.ADD_LOG, level, source, message, taskId);
  },

  applyLayout(preset: LayoutPreset): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.APPLY_LAYOUT, preset);
  },

  resetLayout(): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.RESET_LAYOUT);
  },

  requestBrowserAction(action: string, taskId?: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.REQUEST_BROWSER_ACTION, action, taskId);
  },

  requestTerminalAction(action: string, taskId?: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.REQUEST_TERMINAL_ACTION, action, taskId);
  },

  updateSurfaceStatus(surface: 'browser' | 'terminal', status: SurfaceExecutionState): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SURFACE_STATUS, surface, status);
  },

  onStateUpdate(callback: (state: AppState) => void): void {
    ipcRenderer.on(IPC_CHANNELS.STATE_UPDATE, (_event, state: AppState) => {
      callback(state);
    });
  },

  onEvent(callback: (type: AppEventType, payload: unknown) => void): void {
    ipcRenderer.on(IPC_CHANNELS.EVENT_BROADCAST, (_event, type: AppEventType, payload: unknown) => {
      callback(type, payload);
    });
  },

  removeAllListeners(): void {
    ipcRenderer.removeAllListeners(IPC_CHANNELS.STATE_UPDATE);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.EVENT_BROADCAST);
  },
};

contextBridge.exposeInMainWorld('workspaceAPI', api);
```

- [ ] **Step 2: Commit**

```bash
git add src/preload/preload.ts
git commit -m "feat: add preload script exposing workspaceAPI via contextBridge"
```

---

### Task 9: Renderer Shared Styles and Utilities

**Files:**
- Create: `src/renderer/shared/styles.css`
- Create: `src/renderer/shared/renderUtils.ts`

- [ ] **Step 1: Create styles.css**

```css
/* V1 Workspace - Base Styles */
:root {
  --bg-primary: #0d1117;
  --bg-secondary: #161b22;
  --bg-tertiary: #21262d;
  --bg-surface: #1a1f27;
  --border: #30363d;
  --border-active: #58a6ff;
  --text-primary: #e6edf3;
  --text-secondary: #8b949e;
  --text-muted: #6e7681;
  --accent-blue: #58a6ff;
  --accent-green: #3fb950;
  --accent-orange: #d29922;
  --accent-red: #f85149;
  --accent-purple: #bc8cff;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', 'Menlo', monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  --radius: 6px;
  --radius-sm: 4px;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.5;
}

/* Window chrome */
.window-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.window-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
  user-select: none;
  flex-shrink: 0;
}

.window-header .role-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

.window-header .role-badge .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.role-command .dot { background: var(--accent-blue); }
.role-browser .dot { background: var(--accent-green); }
.role-terminal .dot { background: var(--accent-purple); }

.window-header .task-summary {
  font-size: 12px;
  color: var(--text-secondary);
  flex: 1;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 12px;
}

.window-header .sync-status {
  font-size: 11px;
  color: var(--text-muted);
}

.window-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Status bar */
.status-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 4px 16px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.status-indicator .status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.status-dot.idle { background: var(--text-muted); }
.status-dot.running { background: var(--accent-orange); }
.status-dot.done { background: var(--accent-green); }
.status-dot.error { background: var(--accent-red); }

/* Log stream */
.log-stream {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  font-family: var(--font-mono);
  font-size: 12px;
}

.log-entry {
  padding: 2px 16px;
  display: flex;
  gap: 8px;
  line-height: 1.6;
}

.log-entry:hover {
  background: var(--bg-tertiary);
}

.log-entry .log-time {
  color: var(--text-muted);
  flex-shrink: 0;
  font-size: 11px;
}

.log-entry .log-source {
  color: var(--accent-blue);
  flex-shrink: 0;
  min-width: 60px;
  font-size: 11px;
}

.log-entry .log-message {
  color: var(--text-primary);
  word-break: break-word;
}

.log-entry.warn .log-message { color: var(--accent-orange); }
.log-entry.error .log-message { color: var(--accent-red); }

/* Input area */
.input-area {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.input-area input[type="text"] {
  flex: 1;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  padding: 8px 12px;
  outline: none;
}

.input-area input[type="text"]:focus {
  border-color: var(--accent-blue);
}

.input-area input[type="text"]::placeholder {
  color: var(--text-muted);
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background 0.15s, border-color 0.15s;
  white-space: nowrap;
}

.btn:hover {
  background: var(--bg-surface);
  border-color: var(--text-muted);
  color: var(--text-primary);
}

.btn.primary {
  background: var(--accent-blue);
  border-color: var(--accent-blue);
  color: #fff;
}

.btn.primary:hover {
  opacity: 0.9;
}

/* Layout controls */
.layout-controls {
  display: flex;
  gap: 4px;
  -webkit-app-region: no-drag;
}

.layout-controls .btn {
  font-size: 11px;
  padding: 4px 8px;
}

.layout-controls .btn.active {
  border-color: var(--accent-blue);
  color: var(--accent-blue);
}

/* Surface status */
.surface-indicators {
  display: flex;
  gap: 12px;
}

.surface-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.surface-indicator .label {
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

/* Placeholder surface */
.surface-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  gap: 8px;
  border: 1px dashed var(--border);
  margin: 16px;
  border-radius: var(--radius);
}

.surface-placeholder .placeholder-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}

.surface-placeholder .placeholder-detail {
  font-size: 12px;
}

/* Task list */
.task-list {
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  max-height: 150px;
  overflow-y: auto;
  flex-shrink: 0;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
}

.task-item .task-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.task-status.queued { background: var(--text-muted); }
.task-status.running { background: var(--accent-orange); }
.task-status.completed { background: var(--accent-green); }
.task-status.failed { background: var(--accent-red); }

.task-item .task-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-item.active {
  color: var(--text-primary);
  font-weight: 500;
}

.task-item:not(.active) {
  color: var(--text-secondary);
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--bg-tertiary);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--border);
}
```

- [ ] **Step 2: Create renderUtils.ts**

```ts
// Type declaration for the workspaceAPI exposed via preload
declare global {
  interface Window {
    workspaceAPI: import('../shared/types/ipc').WorkspaceAPI;
  }
}

export function $(selector: string, parent: Element | Document = document): HTMLElement | null {
  return parent.querySelector(selector);
}

export function $$(selector: string, parent: Element | Document = document): HTMLElement[] {
  return Array.from(parent.querySelectorAll(selector));
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function createLogEntryElement(log: { timestamp: number; level: string; source: string; message: string }): HTMLElement {
  const el = document.createElement('div');
  el.className = `log-entry ${log.level}`;
  el.innerHTML = `
    <span class="log-time">${formatTime(log.timestamp)}</span>
    <span class="log-source">[${log.source}]</span>
    <span class="log-message">${escapeHtml(log.message)}</span>
  `;
  return el;
}

export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function createStatusDot(status: string): string {
  return `<span class="status-dot ${status}"></span>`;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/shared/
git commit -m "feat: add shared renderer styles and DOM utilities"
```

---

### Task 10: Command Center Renderer

**Files:**
- Create: `src/renderer/command/index.html`
- Create: `src/renderer/command/command.css`
- Create: `src/renderer/command/command.ts`

- [ ] **Step 1: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'">
  <title>Command Center</title>
  <link rel="stylesheet" href="../shared/styles.css">
  <link rel="stylesheet" href="command.css">
</head>
<body>
  <div class="window-container">
    <header class="window-header">
      <div class="role-badge role-command">
        <span class="dot"></span>
        COMMAND CENTER
      </div>
      <div class="task-summary" id="taskSummary">No active task</div>
      <div class="header-right">
        <div class="surface-indicators">
          <div class="surface-indicator">
            <span class="label">Browser</span>
            <span class="status-dot idle" id="browserStatusDot"></span>
          </div>
          <div class="surface-indicator">
            <span class="label">Terminal</span>
            <span class="status-dot idle" id="terminalStatusDot"></span>
          </div>
        </div>
      </div>
    </header>

    <div class="layout-bar">
      <span class="layout-label">Layout:</span>
      <div class="layout-controls" id="layoutControls">
        <button class="btn active" data-preset="default">Default</button>
        <button class="btn" data-preset="focus-browser">Browser</button>
        <button class="btn" data-preset="focus-terminal">Terminal</button>
        <button class="btn" data-preset="focus-command">Command</button>
        <button class="btn" id="resetLayoutBtn">Reset</button>
      </div>
    </div>

    <div class="window-body">
      <div class="task-list" id="taskList">
        <div class="empty-state">No tasks yet</div>
      </div>

      <div class="log-stream" id="logStream"></div>
    </div>

    <div class="input-area">
      <input type="text" id="taskInput" placeholder="Enter a task..." autocomplete="off">
      <button class="btn primary" id="submitBtn">Submit</button>
    </div>

    <div class="status-bar">
      <div class="status-indicator">
        <span class="status-dot done" id="syncDot"></span>
        <span id="syncLabel">Synced</span>
      </div>
      <span id="layoutLabel">Layout: default</span>
      <span id="taskCount">Tasks: 0</span>
    </div>
  </div>
  <script src="command.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create command.css**

```css
.layout-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.layout-label {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
  -webkit-app-region: no-drag;
}

.empty-state {
  padding: 12px 16px;
  color: var(--text-muted);
  font-size: 12px;
  font-style: italic;
}
```

- [ ] **Step 3: Create command.ts**

```ts
import { AppState, LogRecord, TaskRecord } from '../../shared/types/appState';
import { AppEventType } from '../../shared/types/events';
import { $, createLogEntryElement, formatTime } from '../shared/renderUtils';

const api = window.workspaceAPI;

// DOM references
const taskInput = $<HTMLInputElement>('#taskInput') as HTMLInputElement;
const submitBtn = $('#submitBtn')!;
const taskList = $('#taskList')!;
const logStream = $('#logStream')!;
const taskSummary = $('#taskSummary')!;
const layoutControls = $('#layoutControls')!;
const resetLayoutBtn = $('#resetLayoutBtn')!;
const browserStatusDot = $('#browserStatusDot')!;
const terminalStatusDot = $('#terminalStatusDot')!;
const syncDot = $('#syncDot')!;
const syncLabel = $('#syncLabel')!;
const layoutLabel = $('#layoutLabel')!;
const taskCount = $('#taskCount')!;

// Submit task
function submitTask(): void {
  const title = taskInput.value.trim();
  if (!title) return;
  taskInput.value = '';
  api.createTask(title);
}

submitBtn.addEventListener('click', submitTask);
taskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitTask();
});

// Layout controls
layoutControls.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const preset = target.dataset.preset;
  if (preset) {
    api.applyLayout(preset as any);
  }
});

resetLayoutBtn.addEventListener('click', () => {
  api.resetLayout();
});

// Render task list
function renderTasks(tasks: TaskRecord[], activeId: string | null): void {
  if (tasks.length === 0) {
    taskList.innerHTML = '<div class="empty-state">No tasks yet</div>';
    return;
  }

  taskList.innerHTML = tasks
    .slice()
    .reverse()
    .map((t) => {
      const isActive = t.id === activeId;
      return `<div class="task-item ${isActive ? 'active' : ''}">
        <span class="task-status ${t.status}"></span>
        <span class="task-title">${escapeHtml(t.title)}</span>
        <span class="task-time">${formatTime(t.createdAt)}</span>
      </div>`;
    })
    .join('');
}

// Render logs
let lastLogCount = 0;
function renderLogs(logs: LogRecord[]): void {
  // Only append new logs
  const newLogs = logs.slice(lastLogCount);
  for (const log of newLogs) {
    logStream.appendChild(createLogEntryElement(log));
  }
  lastLogCount = logs.length;

  // Auto-scroll to bottom
  logStream.scrollTop = logStream.scrollHeight;
}

// Full state render
function renderState(state: AppState): void {
  // Active task summary
  const active = state.tasks.find((t) => t.id === state.activeTaskId);
  taskSummary.textContent = active ? `Active: ${active.title}` : 'No active task';

  // Tasks
  renderTasks(state.tasks, state.activeTaskId);

  // Logs
  renderLogs(state.logs);

  // Surface status
  browserStatusDot.className = `status-dot ${state.browser.status}`;
  terminalStatusDot.className = `status-dot ${state.terminal.status}`;

  // Layout
  layoutLabel.textContent = `Layout: ${state.layoutPreset}`;
  const buttons = layoutControls.querySelectorAll('[data-preset]');
  buttons.forEach((btn) => {
    const el = btn as HTMLElement;
    el.classList.toggle('active', el.dataset.preset === state.layoutPreset);
  });

  // Task count
  taskCount.textContent = `Tasks: ${state.tasks.length}`;

  // Sync indicator
  syncDot.className = 'status-dot done';
  syncLabel.textContent = 'Synced';
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// State subscription
api.onStateUpdate((state) => {
  renderState(state);
});

// Initial load
api.getState().then((state) => {
  renderState(state);
  api.addLog('info', 'system', 'Command Center initialized');
});
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/command/
git commit -m "feat: add Command Center renderer with task input, log stream, and layout controls"
```

---

### Task 11: Browser Window Renderer

**Files:**
- Create: `src/renderer/browser/index.html`
- Create: `src/renderer/browser/browser.css`
- Create: `src/renderer/browser/browser.ts`

- [ ] **Step 1: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'">
  <title>Browser Surface</title>
  <link rel="stylesheet" href="../shared/styles.css">
  <link rel="stylesheet" href="browser.css">
</head>
<body>
  <div class="window-container">
    <header class="window-header">
      <div class="role-badge role-browser">
        <span class="dot"></span>
        BROWSER
      </div>
      <div class="task-summary" id="taskSummary">No active task</div>
      <div class="sync-status" id="syncStatus">Synced</div>
    </header>

    <div class="window-body">
      <div class="surface-status-bar" id="surfaceStatus">
        <span class="status-indicator">
          <span class="status-dot idle" id="surfaceDot"></span>
          <span id="surfaceLabel">Idle</span>
        </span>
        <span class="surface-detail" id="surfaceDetail"></span>
      </div>

      <div class="surface-placeholder" id="surfacePlaceholder">
        <div class="placeholder-title">Browser Execution Surface</div>
        <div class="placeholder-detail">Ready for browser automation integration</div>
      </div>

      <div class="log-stream" id="logStream"></div>
    </div>

    <div class="status-bar">
      <div class="status-indicator">
        <span class="status-dot done"></span>
        <span>Connected</span>
      </div>
      <span id="layoutLabel">Layout: default</span>
    </div>
  </div>
  <script src="browser.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create browser.css**

```css
.surface-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.surface-detail {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.window-body {
  display: flex;
  flex-direction: column;
}

.log-stream {
  max-height: 200px;
  border-top: 1px solid var(--border);
}
```

- [ ] **Step 3: Create browser.ts**

```ts
import { AppState, LogRecord } from '../../shared/types/appState';
import { AppEventType } from '../../shared/types/events';
import { $, createLogEntryElement } from '../shared/renderUtils';

const api = window.workspaceAPI;

const taskSummary = $('#taskSummary')!;
const surfaceDot = $('#surfaceDot')!;
const surfaceLabel = $('#surfaceLabel')!;
const surfaceDetail = $('#surfaceDetail')!;
const surfacePlaceholder = $('#surfacePlaceholder')!;
const logStream = $('#logStream')!;
const layoutLabel = $('#layoutLabel')!;

let lastLogCount = 0;

function renderState(state: AppState): void {
  // Active task
  const active = state.tasks.find((t) => t.id === state.activeTaskId);
  taskSummary.textContent = active ? `Active: ${active.title}` : 'No active task';

  // Browser surface status
  surfaceDot.className = `status-dot ${state.browser.status}`;
  surfaceLabel.textContent = state.browser.status.charAt(0).toUpperCase() + state.browser.status.slice(1);
  surfaceDetail.textContent = state.browser.detail || '';

  // Update placeholder based on status
  if (state.browser.status === 'running') {
    surfacePlaceholder.querySelector('.placeholder-detail')!.textContent = state.browser.detail || 'Executing...';
  } else if (state.browser.status === 'done') {
    surfacePlaceholder.querySelector('.placeholder-detail')!.textContent = 'Action completed';
  } else if (state.browser.status === 'error') {
    surfacePlaceholder.querySelector('.placeholder-detail')!.textContent = state.browser.detail || 'Error occurred';
  } else {
    surfacePlaceholder.querySelector('.placeholder-detail')!.textContent = 'Ready for browser automation integration';
  }

  // Browser-relevant logs only
  const browserLogs = state.logs.filter((l) => l.source === 'browser' || l.source === 'system');
  const newLogs = browserLogs.slice(lastLogCount);
  for (const log of newLogs) {
    logStream.appendChild(createLogEntryElement(log));
  }
  lastLogCount = browserLogs.length;
  logStream.scrollTop = logStream.scrollHeight;

  // Layout
  layoutLabel.textContent = `Layout: ${state.layoutPreset}`;
}

api.onStateUpdate((state) => {
  renderState(state);
});

api.getState().then((state) => {
  renderState(state);
  api.addLog('info', 'browser', 'Browser surface initialized');
});
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/browser/
git commit -m "feat: add Browser window renderer with surface status and event stream"
```

---

### Task 12: Terminal Window Renderer

**Files:**
- Create: `src/renderer/terminal/index.html`
- Create: `src/renderer/terminal/terminal.css`
- Create: `src/renderer/terminal/terminal.ts`

- [ ] **Step 1: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'">
  <title>Terminal Surface</title>
  <link rel="stylesheet" href="../shared/styles.css">
  <link rel="stylesheet" href="terminal.css">
</head>
<body>
  <div class="window-container">
    <header class="window-header">
      <div class="role-badge role-terminal">
        <span class="dot"></span>
        TERMINAL
      </div>
      <div class="task-summary" id="taskSummary">No active task</div>
      <div class="sync-status" id="syncStatus">Synced</div>
    </header>

    <div class="window-body">
      <div class="surface-status-bar" id="surfaceStatus">
        <span class="status-indicator">
          <span class="status-dot idle" id="surfaceDot"></span>
          <span id="surfaceLabel">Idle</span>
        </span>
        <span class="surface-detail" id="surfaceDetail"></span>
      </div>

      <div class="surface-placeholder" id="surfacePlaceholder">
        <div class="placeholder-title">Terminal Execution Surface</div>
        <div class="placeholder-detail">Ready for terminal session integration</div>
      </div>

      <div class="log-stream" id="logStream"></div>
    </div>

    <div class="status-bar">
      <div class="status-indicator">
        <span class="status-dot done"></span>
        <span>Connected</span>
      </div>
      <span id="layoutLabel">Layout: default</span>
    </div>
  </div>
  <script src="terminal.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create terminal.css**

```css
.surface-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.surface-detail {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.window-body {
  display: flex;
  flex-direction: column;
}

.log-stream {
  max-height: 200px;
  border-top: 1px solid var(--border);
}

.surface-placeholder {
  background: rgba(188, 140, 255, 0.03);
}
```

- [ ] **Step 3: Create terminal.ts**

```ts
import { AppState, LogRecord } from '../../shared/types/appState';
import { AppEventType } from '../../shared/types/events';
import { $, createLogEntryElement } from '../shared/renderUtils';

const api = window.workspaceAPI;

const taskSummary = $('#taskSummary')!;
const surfaceDot = $('#surfaceDot')!;
const surfaceLabel = $('#surfaceLabel')!;
const surfaceDetail = $('#surfaceDetail')!;
const surfacePlaceholder = $('#surfacePlaceholder')!;
const logStream = $('#logStream')!;
const layoutLabel = $('#layoutLabel')!;

let lastLogCount = 0;

function renderState(state: AppState): void {
  // Active task
  const active = state.tasks.find((t) => t.id === state.activeTaskId);
  taskSummary.textContent = active ? `Active: ${active.title}` : 'No active task';

  // Terminal surface status
  surfaceDot.className = `status-dot ${state.terminal.status}`;
  surfaceLabel.textContent = state.terminal.status.charAt(0).toUpperCase() + state.terminal.status.slice(1);
  surfaceDetail.textContent = state.terminal.detail || '';

  // Update placeholder based on status
  if (state.terminal.status === 'running') {
    surfacePlaceholder.querySelector('.placeholder-detail')!.textContent = state.terminal.detail || 'Executing...';
  } else if (state.terminal.status === 'done') {
    surfacePlaceholder.querySelector('.placeholder-detail')!.textContent = 'Action completed';
  } else if (state.terminal.status === 'error') {
    surfacePlaceholder.querySelector('.placeholder-detail')!.textContent = state.terminal.detail || 'Error occurred';
  } else {
    surfacePlaceholder.querySelector('.placeholder-detail')!.textContent = 'Ready for terminal session integration';
  }

  // Terminal-relevant logs only
  const terminalLogs = state.logs.filter((l) => l.source === 'terminal' || l.source === 'system');
  const newLogs = terminalLogs.slice(lastLogCount);
  for (const log of newLogs) {
    logStream.appendChild(createLogEntryElement(log));
  }
  lastLogCount = terminalLogs.length;
  logStream.scrollTop = logStream.scrollHeight;

  // Layout
  layoutLabel.textContent = `Layout: ${state.layoutPreset}`;
}

api.onStateUpdate((state) => {
  renderState(state);
});

api.getState().then((state) => {
  renderState(state);
  api.addLog('info', 'terminal', 'Terminal surface initialized');
});
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/terminal/
git commit -m "feat: add Terminal window renderer with surface status and event stream"
```

---

### Task 13: Main Process Entry Point

**Files:**
- Create: `src/main/main.ts`

- [ ] **Step 1: Create main.ts**

```ts
import { app, BrowserWindow } from 'electron';
import { registerIpc } from './ipc/registerIpc';
import { initEventRouter } from './events/eventRouter';
import { createAllWindows, applyLayout, setAppQuitting, destroyAllWindows, showAllWindows } from './windows/windowManager';
import { appStateStore } from './state/appStateStore';

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showAllWindows();
  });
}

app.on('ready', () => {
  // Wire up IPC handlers before creating windows
  registerIpc();

  // Connect event bus to state store and IPC
  initEventRouter();

  // Create the 3 role windows
  createAllWindows();

  // Apply persisted or default layout
  const state = appStateStore.getState();
  applyLayout(state.layoutPreset);
});

app.on('before-quit', () => {
  setAppQuitting();
  appStateStore.persistNow();
});

app.on('window-all-closed', () => {
  // On macOS, apps typically stay open. On other platforms, quit.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // macOS dock click: re-show windows
  if (BrowserWindow.getAllWindows().length === 0) {
    createAllWindows();
    const state = appStateStore.getState();
    applyLayout(state.layoutPreset);
  } else {
    showAllWindows();
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add src/main/main.ts
git commit -m "feat: add main process entry point with app lifecycle management"
```

---

### Task 14: Build, Test, and Fix

- [ ] **Step 1: Run the build**

```bash
cd /home/dp/Desktop/v1workspace
npm run build
```

- [ ] **Step 2: Fix any TypeScript compilation errors**

Iterate until `npm run build` succeeds with no errors.

- [ ] **Step 3: Run the app**

```bash
cd /home/dp/Desktop/v1workspace
npm start
```

- [ ] **Step 4: Verify 3 windows appear**

Check that Command Center, Browser, and Terminal windows all open.

- [ ] **Step 5: Test task creation**

Type a task in Command Center and submit. Verify it appears in all windows.

- [ ] **Step 6: Test layout presets**

Click each layout preset button. Verify windows rearrange.

- [ ] **Step 7: Test window persistence**

Move/resize a window, close and reopen the app. Verify bounds are restored.

- [ ] **Step 8: Commit final fixes**

```bash
git add -A
git commit -m "fix: resolve build and runtime issues from integration testing"
```
