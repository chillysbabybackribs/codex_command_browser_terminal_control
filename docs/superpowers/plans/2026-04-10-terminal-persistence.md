# Terminal Persistence (tmux-backed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the terminal surface survive window close and app restart by backing it with a tmux session, with graceful fallback to plain PTY when tmux is unavailable.

**Architecture:** The terminal PTY is spawned inside a named tmux session (`v1workspace`). On reattach, scrollback is captured with ANSI escapes via `tmux capture-pane`, written into xterm.js, then the live stream is reconnected. A persistence store saves session metadata (cwd, shell, session name) to disk. When tmux is not installed, the current plain PTY behavior is preserved with a visible suggestion to install tmux.

**Tech Stack:** node-pty, tmux (optional runtime dependency), child_process.execFileSync/execFile, xterm.js

---

### Task 1: Extend Terminal Types

**Files:**
- Modify: `src/shared/types/terminal.ts:1-25`
- Modify: `src/renderer/global.d.ts:15-18`

- [ ] **Step 1: Add persistence fields to TerminalSessionInfo**

In `src/shared/types/terminal.ts`, add three new fields to `TerminalSessionInfo`:

```ts
export type TerminalSessionInfo = {
  id: string;
  pid: number | null;
  shell: string;
  cwd: string;
  startedAt: number;
  lastActivityAt: number | null;
  status: TerminalSessionStatus;
  exitCode: number | null;
  cols: number;
  rows: number;
  persistent: boolean;
  tmuxSession: string | null;
  restored: boolean;
};
```

- [ ] **Step 2: Update renderer global type declaration**

In `src/renderer/global.d.ts`, update the `TerminalSessionInfo` interface to match:

```ts
interface TerminalSessionInfo {
  id: string; pid: number | null; shell: string; cwd: string;
  startedAt: number; lastActivityAt: number | null; status: string;
  exitCode: number | null; cols: number; rows: number;
  persistent: boolean; tmuxSession: string | null; restored: boolean;
}
```

- [ ] **Step 3: Build to verify types compile**

Run: `npm run build`
Expected: Exit 0, no type errors

- [ ] **Step 4: Commit**

```bash
git add src/shared/types/terminal.ts src/renderer/global.d.ts
git commit -m "feat(terminal): add persistence fields to TerminalSessionInfo"
```

---

### Task 2: Add Terminal Session Reattached Event

**Files:**
- Modify: `src/shared/types/events.ts:71-79` (enum) and `:130-131` (payload)
- Modify: `src/main/events/eventRouter.ts`

- [ ] **Step 1: Add event type to enum**

In `src/shared/types/events.ts`, add after `TERMINAL_STATUS_UPDATED`:

```ts
  TERMINAL_SESSION_REATTACHED = 'TERMINAL_SESSION_REATTACHED',
```

- [ ] **Step 2: Add payload type**

In the `AppEventPayloads` type, add after the `TERMINAL_STATUS_UPDATED` entry:

```ts
  [AppEventType.TERMINAL_SESSION_REATTACHED]: { session: TerminalSessionInfo; scrollbackLength: number };
```

- [ ] **Step 3: Wire event in eventRouter**

In `src/main/events/eventRouter.ts`, add after the `TERMINAL_SESSION_RESTARTED` handler:

```ts
  eventBus.on(AppEventType.TERMINAL_SESSION_REATTACHED, (event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.webContents) {
        win.webContents.send('terminal:status', event.payload.session);
      }
    }
  });
```

- [ ] **Step 4: Build to verify**

Run: `npm run build`
Expected: Exit 0

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/events.ts src/main/events/eventRouter.ts
git commit -m "feat(terminal): add TERMINAL_SESSION_REATTACHED event"
```

---

### Task 3: Create tmux Manager

**Files:**
- Create: `src/main/terminal/tmuxManager.ts`

This module handles all tmux subprocess interactions. No state, no events — pure functions wrapping tmux commands.

- [ ] **Step 1: Create tmuxManager.ts**

```ts
// ═══════════════════════════════════════════════════════════════════════════
// tmux Manager — Detection, session lifecycle, scrollback capture
// ═══════════════════════════════════════════════════════════════════════════
//
// Pure functions wrapping tmux commands. Uses execFileSync for synchronous
// checks and execFile for async operations. All commands use argument
// arrays — no string interpolation — for safety.

import { execFileSync, execFile } from 'child_process';

const TMUX_SESSION_NAME = 'v1workspace';

let tmuxPath: string | null = null;
let detectionDone = false;

export function detectTmux(): boolean {
  if (detectionDone) return tmuxPath !== null;
  detectionDone = true;
  try {
    const result = execFileSync('which', ['tmux'], { encoding: 'utf-8', timeout: 3000 }).trim();
    if (result) {
      tmuxPath = result;
      return true;
    }
  } catch {
    // not found
  }
  tmuxPath = null;
  return false;
}

export function isTmuxAvailable(): boolean {
  return tmuxPath !== null;
}

export function getTmuxPath(): string {
  if (!tmuxPath) throw new Error('tmux not available');
  return tmuxPath;
}

export function getSessionName(): string {
  return TMUX_SESSION_NAME;
}

export function hasSession(): boolean {
  if (!tmuxPath) return false;
  try {
    execFileSync(tmuxPath, ['has-session', '-t', TMUX_SESSION_NAME], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export function createSession(cols: number, rows: number, shell: string, cwd: string): void {
  if (!tmuxPath) throw new Error('tmux not available');
  execFileSync(tmuxPath, [
    'new-session', '-d',
    '-s', TMUX_SESSION_NAME,
    '-x', String(Math.max(1, cols)),
    '-y', String(Math.max(1, rows)),
    shell,
  ], { cwd, timeout: 5000 });
}

export function killSession(): void {
  if (!tmuxPath) return;
  try {
    execFileSync(tmuxPath, ['kill-session', '-t', TMUX_SESSION_NAME], { timeout: 3000 });
  } catch {
    // session may not exist
  }
}

export function captureScrollback(): string {
  if (!tmuxPath) return '';
  try {
    return execFileSync(tmuxPath, [
      'capture-pane', '-t', TMUX_SESSION_NAME,
      '-p',   // print to stdout
      '-e',   // include escape sequences (colors)
      '-S', '-', // from start of scrollback
    ], { encoding: 'utf-8', timeout: 5000, maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return '';
  }
}

export function resizeSession(cols: number, rows: number): void {
  if (!tmuxPath) return;
  try {
    execFileSync(tmuxPath, [
      'resize-window', '-t', TMUX_SESSION_NAME,
      '-x', String(Math.max(1, cols)),
      '-y', String(Math.max(1, rows)),
    ], { timeout: 3000 });
  } catch {
    // resize can fail if session is gone
  }
}

export function getCurrentCwd(): string | null {
  if (!tmuxPath) return null;
  try {
    const result = execFileSync(tmuxPath, [
      'display-message', '-t', TMUX_SESSION_NAME,
      '-p', '#{pane_current_path}',
    ], { encoding: 'utf-8', timeout: 3000 }).trim();
    return result || null;
  } catch {
    return null;
  }
}

/**
 * Returns the command + args to spawn in node-pty to attach to the tmux session.
 * The PTY process is `tmux attach-session`, which pipes I/O to the real shell
 * running inside tmux.
 */
export function getAttachCommand(): { command: string; args: string[] } {
  if (!tmuxPath) throw new Error('tmux not available');
  return {
    command: tmuxPath,
    args: ['attach-session', '-t', TMUX_SESSION_NAME],
  };
}
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: Exit 0

- [ ] **Step 3: Commit**

```bash
git add src/main/terminal/tmuxManager.ts
git commit -m "feat(terminal): add tmuxManager for tmux subprocess interactions"
```

---

### Task 4: Create Terminal Session Store

**Files:**
- Create: `src/main/terminal/terminalSessionStore.ts`

Follows the same pattern as `src/main/browser/browserSessionStore.ts`.

- [ ] **Step 1: Create terminalSessionStore.ts**

```ts
// ═══════════════════════════════════════════════════════════════════════════
// Terminal Session Store — Persistent terminal data across sessions
// ═══════════════════════════════════════════════════════════════════════════

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

const DATA_FILE = 'terminal-data.json';

function getDataPath(): string {
  return path.join(app.getPath('userData'), DATA_FILE);
}

export type PersistedTerminalData = {
  tmuxSession: string | null;
  lastCwd: string | null;
  shell: string;
  persistent: boolean;
};

function createDefaults(): PersistedTerminalData {
  return {
    tmuxSession: null,
    lastCwd: null,
    shell: '',
    persistent: false,
  };
}

export function loadTerminalData(): PersistedTerminalData {
  try {
    const filePath = getDataPath();
    if (!fs.existsSync(filePath)) return createDefaults();
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      tmuxSession: typeof parsed.tmuxSession === 'string' ? parsed.tmuxSession : null,
      lastCwd: typeof parsed.lastCwd === 'string' ? parsed.lastCwd : null,
      shell: typeof parsed.shell === 'string' ? parsed.shell : '',
      persistent: typeof parsed.persistent === 'boolean' ? parsed.persistent : false,
    };
  } catch {
    return createDefaults();
  }
}

export function saveTerminalData(data: PersistedTerminalData): void {
  try {
    const filePath = getDataPath();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist terminal data:', err);
  }
}
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: Exit 0

- [ ] **Step 3: Commit**

```bash
git add src/main/terminal/terminalSessionStore.ts
git commit -m "feat(terminal): add terminalSessionStore for persistence"
```

---

### Task 5: Refactor TerminalService for tmux-backed Sessions

**Files:**
- Modify: `src/main/terminal/TerminalService.ts` (full rewrite)

This is the core task. The service branches between tmux mode and plain mode at `startSession()`.

- [ ] **Step 1: Rewrite TerminalService.ts**

Replace the entire contents of `src/main/terminal/TerminalService.ts` with:

```ts
// ═══════════════════════════════════════════════════════════════════════════
// Terminal Service — PTY management with optional tmux persistence
// ═══════════════════════════════════════════════════════════════════════════
//
// When tmux is available: spawns a named tmux session, attaches via PTY.
// On reattach: captures scrollback with ANSI escapes, reconnects live stream.
// When tmux is unavailable: plain PTY (original behavior) + install suggestion.

import * as os from 'os';
import * as pty from 'node-pty';
import { TerminalSessionInfo, TerminalSessionStatus } from '../../shared/types/terminal';
import { eventBus } from '../events/eventBus';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { AppEventType } from '../../shared/types/events';
import { generateId } from '../../shared/utils/ids';
import {
  detectTmux, isTmuxAvailable, hasSession as tmuxHasSession,
  createSession as tmuxCreateSession, killSession as tmuxKillSession,
  captureScrollback as tmuxCaptureScrollback, resizeSession as tmuxResizeSession,
  getCurrentCwd as tmuxGetCurrentCwd, getAttachCommand, getSessionName,
} from './tmuxManager';
import { loadTerminalData, saveTerminalData, PersistedTerminalData } from './terminalSessionStore';

const CWD_POLL_INTERVAL = 5000;

function resolveShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

export class TerminalService {
  private session: TerminalSessionInfo | null = null;
  private ptyProcess: pty.IPty | null = null;
  private disposed = false;
  private tmuxMode = false;
  private cwdPollTimer: ReturnType<typeof setInterval> | null = null;
  private isAppQuitting = false;

  getSession(): TerminalSessionInfo | null {
    return this.session;
  }

  /**
   * Initialize tmux detection. Call once at app startup before startSession().
   */
  init(): void {
    const available = detectTmux();
    this.tmuxMode = available;

    if (!available) {
      this.emitLog('info', 'Terminal persistence unavailable \u2014 install tmux for session survival across restarts');
    } else {
      this.emitLog('info', 'tmux detected \u2014 terminal sessions will persist across restarts');
    }
  }

  startSession(): TerminalSessionInfo {
    if (this.session && this.session.status === 'running' && this.ptyProcess) {
      return this.session;
    }

    this.cleanupPty();

    // If tmux mode and an existing session is alive, reattach instead of creating new
    if (this.tmuxMode && tmuxHasSession()) {
      const reattached = this.reattachSession();
      if (reattached) return reattached;
      // If reattach failed, fall through to create new
    }

    if (this.tmuxMode) {
      return this.startTmuxSession();
    } else {
      return this.startPlainSession();
    }
  }

  /**
   * Attempt to reattach to an existing tmux session.
   * Returns the session info if successful, null if no session exists.
   */
  reattachSession(): TerminalSessionInfo | null {
    if (!this.tmuxMode || !tmuxHasSession()) {
      return null;
    }

    this.cleanupPty();

    const shell = resolveShell();
    const persisted = loadTerminalData();
    const cwd = persisted.lastCwd || process.env.HOME || os.homedir();
    const cols = 80;
    const rows = 24;
    const id = generateId('term');

    this.session = {
      id,
      pid: null,
      shell,
      cwd,
      startedAt: Date.now(),
      lastActivityAt: null,
      status: 'starting',
      exitCode: null,
      cols,
      rows,
      persistent: true,
      tmuxSession: getSessionName(),
      restored: true,
    };

    this.updateState();
    eventBus.emit(AppEventType.TERMINAL_SESSION_CREATED, { session: { ...this.session } });

    try {
      const { command, args } = getAttachCommand();
      this.ptyProcess = pty.spawn(command, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env } as Record<string, string>,
      });

      this.session.pid = this.ptyProcess.pid;
      this.session.status = 'running';
      this.updateState();
      this.emitStatus();
      this.startCwdPolling();

      // Update cwd from tmux immediately
      const currentCwd = tmuxGetCurrentCwd();
      if (currentCwd) this.session.cwd = currentCwd;

      const scrollback = tmuxCaptureScrollback();
      const scrollbackLength = scrollback.length;

      eventBus.emit(AppEventType.TERMINAL_SESSION_STARTED, { session: { ...this.session } });
      eventBus.emit(AppEventType.TERMINAL_SESSION_REATTACHED, {
        session: { ...this.session },
        scrollbackLength,
      });
      this.emitLog('info', `Terminal session reattached: ${shell} (tmux: ${getSessionName()})`);

      this.wirePtyEvents();

      return { ...this.session };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.session.status = 'error';
      this.updateState();
      this.emitStatus();
      eventBus.emit(AppEventType.TERMINAL_SESSION_ERROR, {
        sessionId: this.session.id,
        error: message,
      });
      this.emitLog('error', `Terminal reattach failed: ${message}`);
      return null;
    }
  }

  captureScrollback(): string {
    if (!this.tmuxMode) return '';
    return tmuxCaptureScrollback();
  }

  write(data: string): void {
    if (!this.ptyProcess || !this.session || this.session.status !== 'running') return;
    this.ptyProcess.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.ptyProcess || !this.session || this.session.status !== 'running') return;
    if (cols < 1 || rows < 1) return;

    this.ptyProcess.resize(cols, rows);
    this.session.cols = cols;
    this.session.rows = rows;

    // Also resize the tmux window so it matches
    if (this.tmuxMode) {
      tmuxResizeSession(cols, rows);
    }

    this.updateState();
    eventBus.emit(AppEventType.TERMINAL_SESSION_RESIZED, {
      sessionId: this.session.id,
      cols,
      rows,
    });
  }

  restart(): TerminalSessionInfo {
    const oldSessionId = this.session?.id || 'none';

    if (this.tmuxMode) {
      // Kill the tmux session entirely, then create a fresh one
      this.cleanupPty();
      tmuxKillSession();
    } else {
      this.cleanupPty();
    }

    const session = this.startSession();

    eventBus.emit(AppEventType.TERMINAL_SESSION_RESTARTED, {
      oldSessionId,
      session: { ...session },
    });
    this.emitLog('info', 'Terminal session restarted');

    return session;
  }

  setAppQuitting(): void {
    this.isAppQuitting = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopCwdPolling();

    // Save persistence data before cleanup
    this.persistNow();

    if (this.tmuxMode && !this.isAppQuitting) {
      // Window close (not app quit): just detach — tmux session survives
      this.detachPty();
    } else if (this.tmuxMode && this.isAppQuitting) {
      // App quit: detach PTY but leave tmux running for next launch
      this.detachPty();
    } else {
      // Plain mode: kill the PTY
      this.cleanupPty();
    }

    if (this.session) {
      this.session.status = 'exited';
      this.updateState();
    }
  }

  isPersistent(): boolean {
    return this.tmuxMode;
  }

  persistNow(): void {
    const data: PersistedTerminalData = {
      tmuxSession: this.tmuxMode ? getSessionName() : null,
      lastCwd: this.session?.cwd || null,
      shell: this.session?.shell || resolveShell(),
      persistent: this.tmuxMode,
    };

    // Try to get live cwd from tmux
    if (this.tmuxMode) {
      const liveCwd = tmuxGetCurrentCwd();
      if (liveCwd) data.lastCwd = liveCwd;
    }

    saveTerminalData(data);
  }

  // ─── Private: tmux session ────────────────────────────────────────────────

  private startTmuxSession(): TerminalSessionInfo {
    const shell = resolveShell();
    const persisted = loadTerminalData();
    const cwd = persisted.lastCwd || process.env.HOME || os.homedir();
    const cols = 80;
    const rows = 24;
    const id = generateId('term');

    this.session = {
      id,
      pid: null,
      shell,
      cwd,
      startedAt: Date.now(),
      lastActivityAt: null,
      status: 'starting',
      exitCode: null,
      cols,
      rows,
      persistent: true,
      tmuxSession: getSessionName(),
      restored: false,
    };

    this.updateState();
    eventBus.emit(AppEventType.TERMINAL_SESSION_CREATED, { session: { ...this.session } });

    try {
      // Create the tmux session with the shell inside it
      tmuxCreateSession(cols, rows, shell, cwd);

      // Attach to it via PTY
      const { command, args } = getAttachCommand();
      this.ptyProcess = pty.spawn(command, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env } as Record<string, string>,
      });

      this.session.pid = this.ptyProcess.pid;
      this.session.status = 'running';
      this.updateState();
      this.emitStatus();
      this.startCwdPolling();

      eventBus.emit(AppEventType.TERMINAL_SESSION_STARTED, { session: { ...this.session } });
      this.emitLog('info', `Terminal session started: ${shell} (tmux: ${getSessionName()}, PID ${this.ptyProcess.pid})`);

      this.wirePtyEvents();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.session.status = 'error';
      this.updateState();
      this.emitStatus();

      eventBus.emit(AppEventType.TERMINAL_SESSION_ERROR, {
        sessionId: this.session.id,
        error: message,
      });
      this.emitLog('error', `Terminal spawn failed: ${message}`);
    }

    return { ...this.session };
  }

  // ─── Private: plain session (no tmux) ─────────────────────────────────────

  private startPlainSession(): TerminalSessionInfo {
    const shell = resolveShell();
    const persisted = loadTerminalData();
    const cwd = persisted.lastCwd || process.env.HOME || os.homedir();
    const cols = 80;
    const rows = 24;
    const id = generateId('term');

    this.session = {
      id,
      pid: null,
      shell,
      cwd,
      startedAt: Date.now(),
      lastActivityAt: null,
      status: 'starting',
      exitCode: null,
      cols,
      rows,
      persistent: false,
      tmuxSession: null,
      restored: false,
    };

    this.updateState();
    eventBus.emit(AppEventType.TERMINAL_SESSION_CREATED, { session: { ...this.session } });

    try {
      this.ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env } as Record<string, string>,
      });

      this.session.pid = this.ptyProcess.pid;
      this.session.status = 'running';
      this.updateState();
      this.emitStatus();

      eventBus.emit(AppEventType.TERMINAL_SESSION_STARTED, { session: { ...this.session } });
      this.emitLog('info', `Terminal session started: ${shell} (PID ${this.ptyProcess.pid}) (no persistence)`);

      this.wirePtyEvents();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.session.status = 'error';
      this.updateState();
      this.emitStatus();

      eventBus.emit(AppEventType.TERMINAL_SESSION_ERROR, {
        sessionId: this.session.id,
        error: message,
      });
      this.emitLog('error', `Terminal spawn failed: ${message}`);
    }

    return { ...this.session };
  }

  // ─── Private: shared PTY wiring ───────────────────────────────────────────

  private wirePtyEvents(): void {
    if (!this.ptyProcess || !this.session) return;
    const sessionId = this.session.id;

    this.ptyProcess.onData((data: string) => {
      if (!this.session) return;
      this.session.lastActivityAt = Date.now();
      eventBus.emit(AppEventType.TERMINAL_SESSION_OUTPUT, { sessionId, data });
    });

    this.ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      if (!this.session) return;
      this.stopCwdPolling();

      if (this.tmuxMode && tmuxHasSession()) {
        // The PTY wrapper exited but tmux session is still alive.
        // This means we detached. Don't mark as exited — mark as idle
        // so the renderer knows it can reattach.
        this.session.status = 'exited';
        this.session.exitCode = exitCode;
        this.ptyProcess = null;
        this.updateState();
        this.emitStatus();
        this.emitLog('info', 'Terminal detached (tmux session still alive)');
      } else {
        this.session.status = 'exited';
        this.session.exitCode = exitCode;
        this.ptyProcess = null;
        this.updateState();
        this.emitStatus();

        eventBus.emit(AppEventType.TERMINAL_SESSION_EXITED, { sessionId, exitCode });
        this.emitLog('info', `Terminal exited with code ${exitCode}`);
      }
    });
  }

  // ─── Private: CWD polling ─────────────────────────────────────────────────

  private startCwdPolling(): void {
    if (!this.tmuxMode) return;
    this.stopCwdPolling();
    this.cwdPollTimer = setInterval(() => {
      if (!this.session || this.session.status !== 'running') {
        this.stopCwdPolling();
        return;
      }
      const cwd = tmuxGetCurrentCwd();
      if (cwd && cwd !== this.session.cwd) {
        this.session.cwd = cwd;
        this.updateState();
      }
    }, CWD_POLL_INTERVAL);
  }

  private stopCwdPolling(): void {
    if (this.cwdPollTimer) {
      clearInterval(this.cwdPollTimer);
      this.cwdPollTimer = null;
    }
  }

  // ─── Private: PTY cleanup ─────────────────────────────────────────────────

  private detachPty(): void {
    // Kill the PTY process (the `tmux attach` wrapper) without killing tmux
    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill();
      } catch {
        // Already exited
      }
      this.ptyProcess = null;
    }
  }

  private cleanupPty(): void {
    this.stopCwdPolling();
    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill();
      } catch {
        // Already exited
      }
      this.ptyProcess = null;
    }
    if (this.session) {
      this.session.status = 'exited';
    }
  }

  // ─── Private: state sync ──────────────────────────────────────────────────

  private updateState(): void {
    appStateStore.dispatch({
      type: ActionType.SET_TERMINAL_SESSION,
      session: this.session ? { ...this.session } : null,
    });

    const surfaceStatus = this.mapToSurfaceStatus();
    appStateStore.dispatch({
      type: ActionType.SET_SURFACE_STATUS,
      surface: 'terminal',
      status: {
        status: surfaceStatus,
        lastUpdatedAt: Date.now(),
        detail: this.session
          ? `${this.session.shell} (PID ${this.session.pid || '?'})${this.tmuxMode ? ' [tmux]' : ''}`
          : '',
      },
    });
  }

  private mapToSurfaceStatus(): 'idle' | 'running' | 'done' | 'error' {
    if (!this.session) return 'idle';
    switch (this.session.status) {
      case 'idle':
      case 'starting':
        return 'idle';
      case 'running':
        return 'running';
      case 'exited':
        return 'done';
      case 'error':
        return 'error';
      default:
        return 'idle';
    }
  }

  private emitStatus(): void {
    if (!this.session) return;
    eventBus.emit(AppEventType.TERMINAL_STATUS_UPDATED, {
      sessionId: this.session.id,
      status: this.session.status,
    });
  }

  private emitLog(level: 'info' | 'warn' | 'error', message: string): void {
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level,
        source: 'terminal',
        message,
      },
    });
  }
}

export const terminalService = new TerminalService();
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: Exit 0

- [ ] **Step 3: Commit**

```bash
git add src/main/terminal/TerminalService.ts
git commit -m "feat(terminal): refactor TerminalService for tmux-backed persistence"
```

---

### Task 6: Add IPC Channel for Scrollback Capture

**Files:**
- Modify: `src/shared/types/ipc.ts` (add channel + API method)
- Modify: `src/main/ipc/registerIpc.ts` (register handler)
- Modify: `src/preload/preload.ts` (expose to renderer)
- Modify: `src/renderer/global.d.ts` (type declaration)

- [ ] **Step 1: Add IPC channel constant**

In `src/shared/types/ipc.ts`, add after `TERMINAL_EXIT`:

```ts
  TERMINAL_CAPTURE_SCROLLBACK: 'terminal:capture-scrollback',
```

- [ ] **Step 2: Add to WorkspaceAPI terminal interface**

In `src/shared/types/ipc.ts`, add to the `terminal` sub-interface after `restart()`:

```ts
    captureScrollback(): Promise<string>;
```

- [ ] **Step 3: Register IPC handler**

In `src/main/ipc/registerIpc.ts`, add after the `TERMINAL_RESTART` handler:

```ts
  ipcMain.handle(IPC_CHANNELS.TERMINAL_CAPTURE_SCROLLBACK, () => {
    return terminalService.captureScrollback();
  });
```

- [ ] **Step 4: Expose in preload**

In `src/preload/preload.ts`, add the channel constant:

```ts
  TERMINAL_CAPTURE_SCROLLBACK: 'terminal:capture-scrollback',
```

And add to the `terminal` sub-object, after `restart()`:

```ts
    captureScrollback() {
      return ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_CAPTURE_SCROLLBACK);
    },
```

- [ ] **Step 5: Update renderer global.d.ts**

In `src/renderer/global.d.ts`, add to the `terminal` interface after `restart()`:

```ts
    captureScrollback(): Promise<string>;
```

- [ ] **Step 6: Build to verify**

Run: `npm run build`
Expected: Exit 0

- [ ] **Step 7: Commit**

```bash
git add src/shared/types/ipc.ts src/main/ipc/registerIpc.ts src/preload/preload.ts src/renderer/global.d.ts
git commit -m "feat(terminal): add IPC channel for scrollback capture"
```

---

### Task 7: Update main.ts for tmux-aware Lifecycle

**Files:**
- Modify: `src/main/main.ts`

- [ ] **Step 1: Add init() call and quitting flag**

Replace `src/main/main.ts` with:

```ts
import { app, BrowserWindow } from 'electron';
import { registerIpc } from './ipc/registerIpc';
import { initEventRouter } from './events/eventRouter';
import { createAllWindows, applyDefaultBounds, setAppQuitting, showAllWindows } from './windows/windowManager';
import { appStateStore } from './state/appStateStore';
import { terminalService } from './terminal/TerminalService';
import { browserService } from './browser/BrowserService';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showAllWindows();
  });
}

app.on('ready', () => {
  terminalService.init();
  registerIpc();
  initEventRouter();
  createAllWindows();
  applyDefaultBounds();
});

app.on('before-quit', () => {
  setAppQuitting();
  terminalService.setAppQuitting();
  terminalService.persistNow();
  browserService.dispose();
  terminalService.dispose();
  appStateStore.persistNow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createAllWindows();
    applyDefaultBounds();
  } else {
    showAllWindows();
  }
});
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: Exit 0

- [ ] **Step 3: Commit**

```bash
git add src/main/main.ts
git commit -m "feat(terminal): wire tmux init and quitting lifecycle in main.ts"
```

---

### Task 8: Update Execution Renderer for Reattach Flow

**Files:**
- Modify: `src/renderer/execution/execution.ts:395-470` (terminal init + init function)

- [ ] **Step 1: Update initTerminal and init functions**

In `src/renderer/execution/execution.ts`, replace the `initTerminal` function (line 396-409) with:

```ts
function initTerminal(): void {
  term = new Terminal({
    theme: { background: '#000000', foreground: '#ededed', cursor: '#ffffff', cursorAccent: '#000000', selectionBackground: 'rgba(255,255,255,0.12)', selectionForeground: '#ffffff', black: '#000000', red: '#ee4444', green: '#00d47b', yellow: '#ff9500', blue: '#3b82f6', magenta: '#a78bfa', cyan: '#22d3ee', white: '#ededed', brightBlack: '#555555', brightRed: '#ff6b6b', brightGreen: '#34d399', brightYellow: '#fbbf24', brightBlue: '#60a5fa', brightMagenta: '#c4b5fd', brightCyan: '#67e8f9', brightWhite: '#ffffff' },
    fontFamily: "'Geist Mono', 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
    fontSize: 13, lineHeight: 1.35, cursorBlink: true, cursorStyle: 'bar', allowTransparency: false, scrollback: 5000,
  });
  fitAddon = new FitAddon.FitAddon(); term.loadAddon(fitAddon); term.open(terminalContainer);
  requestAnimationFrame(() => fitTerminal());
  term.onData((data: string) => workspaceAPI.terminal.write(data));
  workspaceAPI.terminal.onOutput((data: string) => term.write(data));
  workspaceAPI.terminal.onStatus((session: TerminalSessionInfo) => updateTerminalMeta(session));
  workspaceAPI.terminal.onExit((exitCode: number) => { terminalStatus.textContent = `Exited (${exitCode})`; connectionDot.className = 'status-dot error'; connectionLabel.textContent = 'Disconnected'; });
  new ResizeObserver(() => scheduleFit()).observe(terminalContainer);
}
```

(This is unchanged — kept for clarity that it stays the same.)

- [ ] **Step 2: Update the updateTerminalMeta function**

Replace the `updateTerminalMeta` function (line 416-422) with:

```ts
function updateTerminalMeta(session: TerminalSessionInfo): void {
  const m: Record<string, string> = { idle: 'Idle', starting: 'Starting', running: 'Running', exited: 'Exited', error: 'Error' };
  terminalStatus.textContent = m[session.status] || session.status;
  const p: string[] = []; if (session.shell) p.push(session.shell.split('/').pop() || session.shell); if (session.pid) p.push(`PID ${session.pid}`);
  if (session.persistent) p.push('tmux');
  else p.push('no persistence');
  terminalMeta.textContent = p.join(' | ');
  if (session.status === 'running') { connectionDot.className = 'status-dot done'; connectionLabel.textContent = session.restored ? 'Reconnected' : 'Connected'; }
}
```

- [ ] **Step 3: Update the init function for reattach flow**

Replace the `init` function (line 457-470) with:

```ts
async function init(): Promise<void> {
  initSplitter(); initTerminal(); initBrowserBoundsObserver();
  const state = await workspaceAPI.getState();
  if (state.executionSplit) applySplitRatio(state.executionSplit.ratio); else applySplitRatio(0.5);
  renderState(state);
  const bs = await workspaceAPI.browser.getState();
  updateBrowserState(bs);
  requestAnimationFrame(() => reportBrowserBounds());

  const existing = await workspaceAPI.terminal.getSession();
  if (existing && existing.status === 'running') {
    updateTerminalMeta(existing);
    // If this is a restored tmux session, replay scrollback
    if (existing.restored) {
      connectionDot.className = 'status-dot running';
      connectionLabel.textContent = 'Reconnecting...';
      try {
        const scrollback = await workspaceAPI.terminal.captureScrollback();
        if (scrollback) {
          term.write(scrollback);
        }
      } catch {
        // scrollback capture failed — continue without it
      }
      connectionDot.className = 'status-dot done';
      connectionLabel.textContent = 'Reconnected';
    }
  } else {
    const s = await workspaceAPI.terminal.startSession();
    updateTerminalMeta(s);
  }
  workspaceAPI.addLog('info', 'system', 'Execution window initialized');
}
init();
```

- [ ] **Step 4: Build to verify**

Run: `npm run build`
Expected: Exit 0

- [ ] **Step 5: Commit**

```bash
git add src/renderer/execution/execution.ts
git commit -m "feat(terminal): add reattach flow with scrollback restoration in execution renderer"
```

---

### Task 9: Update Command Center Persistence Badge

**Files:**
- Modify: `src/renderer/command/command.ts:177-185` (renderTerminalPanel)

- [ ] **Step 1: Update renderTerminalPanel to show persistence badge**

Replace the `renderTerminalPanel` function in `src/renderer/command/command.ts`:

```ts
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

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: Exit 0

- [ ] **Step 3: Commit**

```bash
git add src/renderer/command/command.ts
git commit -m "feat(terminal): show persistence badge in Command Center terminal panel"
```

---

### Task 10: Update Terminal Action Executor for Reattach-aware Restart

**Files:**
- Modify: `src/main/actions/terminalActionExecutor.ts`

No code changes needed — the executor calls `terminalService.restart()` and `terminalService.write()` which already handle tmux mode internally. This task is a verification step.

- [ ] **Step 1: Verify the executor still works**

Read `src/main/actions/terminalActionExecutor.ts` and confirm:
- `terminal.execute` calls `terminalService.write()` — works in both modes
- `terminal.write` calls `terminalService.write()` — works in both modes
- `terminal.restart` calls `terminalService.restart()` — now kills tmux session + creates fresh one
- `terminal.interrupt` calls `terminalService.write('\x03')` — works in both modes

No changes needed.

- [ ] **Step 2: Full build + smoke test**

Run: `npm run build`
Expected: Exit 0

Then start the app: `npx electron . --no-sandbox`

Verify:
1. Terminal starts (check Command Center log for "tmux detected" or "install tmux" message)
2. Terminal panel shows "persistent" or "no persistence" badge
3. Execute a command from Command Center action composer (target: Terminal, kind: Execute, command: `echo hello`)
4. Verify it appears in the terminal pane
5. Close and reopen the app — if tmux is installed, verify the session reattaches with scrollback

- [ ] **Step 3: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "feat(terminal): verify terminal action executor with tmux persistence"
```

---

### Task 11: End-to-End Verification

- [ ] **Step 1: Install tmux (if not already)**

```bash
sudo apt install -y tmux
```

- [ ] **Step 2: Build and start**

```bash
npm run build && npx electron . --no-sandbox
```

- [ ] **Step 3: Verify tmux session creation**

In a separate terminal, run:
```bash
tmux list-sessions
```
Expected: `v1workspace` session listed

- [ ] **Step 4: Verify persistence across window close**

1. Type a command in the terminal pane (e.g., `echo "persistence test"`)
2. Close the execution window (not quit the app)
3. Reopen the execution window
4. Verify the terminal shows "Reconnecting..." then displays previous output with colors intact

- [ ] **Step 5: Verify persistence across app restart**

1. Run a command that produces colored output (e.g., `ls --color=auto /`)
2. Quit the app completely
3. Restart the app: `npm run build && npx electron . --no-sandbox`
4. Verify the terminal reattaches and shows the colored output from before

- [ ] **Step 6: Verify restart kills tmux session**

1. Click "Restart" on the terminal panel
2. Check `tmux list-sessions` — verify the old session is gone and a new one exists
3. Verify the terminal is fresh

- [ ] **Step 7: Verify fallback without tmux**

1. Quit the app
2. Temporarily rename tmux: `sudo mv /usr/bin/tmux /usr/bin/tmux.bak`
3. Start the app
4. Verify Command Center logs: "Terminal persistence unavailable — install tmux..."
5. Verify terminal panel shows "no persistence"
6. Verify terminal still works normally
7. Restore tmux: `sudo mv /usr/bin/tmux.bak /usr/bin/tmux`

- [ ] **Step 8: Verify CWD tracking**

1. In the terminal, run `cd /tmp`
2. Wait 6 seconds (CWD poll interval is 5s)
3. Check that the session info shows `/tmp` as cwd
4. Quit and restart the app
5. Verify the new terminal starts in `/tmp`

- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "feat(terminal): complete tmux-backed terminal persistence"
```
