import { AppState, LayoutPreset, LogLevel, LogSource, SurfaceExecutionState, TaskStatus } from './appState';
import { AppEventType } from './events';
import { WindowRole } from './windowRoles';

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
