export type TerminalSessionStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error';

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

export function createDefaultTerminalState(): TerminalSessionState {
  return {
    session: null,
  };
}

export type TerminalSessionState = {
  session: TerminalSessionInfo | null;
};

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
