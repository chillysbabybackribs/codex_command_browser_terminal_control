import { WindowRole } from './windowRoles';

export type WindowBounds = { x: number; y: number; width: number; height: number };

export type WindowState = {
  role: WindowRole;
  bounds: WindowBounds;
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
