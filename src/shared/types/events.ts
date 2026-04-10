import { WindowRole } from './windowRoles';
import { TaskRecord, LogRecord, LayoutPreset, SurfaceExecutionState, AppState, WindowBounds } from './appState';

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
  [AppEventType.WINDOW_BOUNDS_CHANGED]: { role: WindowRole; bounds: WindowBounds; displayId: number };
  [AppEventType.WINDOW_FOCUSED]: { role: WindowRole };
  [AppEventType.WINDOW_LAYOUT_APPLIED]: { preset: LayoutPreset };
  [AppEventType.WINDOW_LAYOUT_RESET]: Record<string, never>;
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
