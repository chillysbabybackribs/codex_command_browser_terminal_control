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

    if (this.tmuxMode && tmuxHasSession()) {
      const reattached = this.reattachSession();
      if (reattached) return reattached;
    }

    if (this.tmuxMode) {
      return this.startTmuxSession();
    } else {
      return this.startPlainSession();
    }
  }

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

    this.persistNow();

    if (this.tmuxMode) {
      this.detachPty();
    } else {
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
      tmuxCreateSession(cols, rows, shell, cwd);

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
