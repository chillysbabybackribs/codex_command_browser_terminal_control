import * as os from 'os';
import * as pty from 'node-pty';
import { TerminalSessionInfo, TerminalSessionStatus } from '../../shared/types/terminal';
import { eventBus } from '../events/eventBus';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { AppEventType } from '../../shared/types/events';
import { generateId } from '../../shared/utils/ids';

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

  getSession(): TerminalSessionInfo | null {
    return this.session;
  }

  startSession(): TerminalSessionInfo {
    if (this.session && this.session.status === 'running' && this.ptyProcess) {
      return this.session;
    }

    this.cleanupPty();

    const shell = resolveShell();
    const cwd = process.env.HOME || os.homedir();
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
      this.emitLog('info', `Terminal session started: ${shell} (PID ${this.ptyProcess.pid})`);

      this.ptyProcess.onData((data: string) => {
        if (!this.session) return;
        this.session.lastActivityAt = Date.now();
        eventBus.emit(AppEventType.TERMINAL_SESSION_OUTPUT, {
          sessionId: this.session.id,
          data,
        });
      });

      this.ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        if (!this.session) return;
        this.session.status = 'exited';
        this.session.exitCode = exitCode;
        this.ptyProcess = null;
        this.updateState();
        this.emitStatus();

        eventBus.emit(AppEventType.TERMINAL_SESSION_EXITED, {
          sessionId: this.session.id,
          exitCode,
        });
        this.emitLog('info', `Terminal exited with code ${exitCode}`);
      });
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
    this.updateState();

    eventBus.emit(AppEventType.TERMINAL_SESSION_RESIZED, {
      sessionId: this.session.id,
      cols,
      rows,
    });
  }

  restart(): TerminalSessionInfo {
    const oldSessionId = this.session?.id || 'none';
    this.cleanupPty();

    const session = this.startSession();

    eventBus.emit(AppEventType.TERMINAL_SESSION_RESTARTED, {
      oldSessionId,
      session: { ...session },
    });
    this.emitLog('info', 'Terminal session restarted');

    return session;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cleanupPty();

    if (this.session) {
      this.session.status = 'exited';
      this.updateState();
    }
  }

  private cleanupPty(): void {
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

  private updateState(): void {
    appStateStore.dispatch({
      type: ActionType.SET_TERMINAL_SESSION,
      session: this.session ? { ...this.session } : null,
    });

    // Keep the surface execution state in sync
    const surfaceStatus = this.mapToSurfaceStatus();
    appStateStore.dispatch({
      type: ActionType.SET_SURFACE_STATUS,
      surface: 'terminal',
      status: {
        status: surfaceStatus,
        lastUpdatedAt: Date.now(),
        detail: this.session
          ? `${this.session.shell} (PID ${this.session.pid || '?'})`
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
