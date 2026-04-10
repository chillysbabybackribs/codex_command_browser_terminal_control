import { WindowRole } from '../../shared/types/windowRoles';
import { TaskRecord, LogRecord, LayoutPreset, SurfaceExecutionState, WindowState, WindowBounds, AppState, TaskStatus } from '../../shared/types/appState';

export enum ActionType {
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
  | { type: ActionType.SET_WINDOW_BOUNDS; role: WindowRole; bounds: WindowBounds; displayId: number }
  | { type: ActionType.SET_WINDOW_FOCUSED; role: WindowRole; isFocused: boolean }
  | { type: ActionType.SET_WINDOW_VISIBLE; role: WindowRole; isVisible: boolean }
  | { type: ActionType.SET_LAYOUT_PRESET; preset: LayoutPreset }
  | { type: ActionType.ADD_TASK; task: TaskRecord }
  | { type: ActionType.UPDATE_TASK; taskId: string; updates: Partial<Pick<TaskRecord, 'status' | 'updatedAt'>> }
  | { type: ActionType.SET_ACTIVE_TASK; taskId: string | null }
  | { type: ActionType.ADD_LOG; log: LogRecord }
  | { type: ActionType.SET_SURFACE_STATUS; surface: 'browser' | 'terminal'; status: SurfaceExecutionState }
  | { type: ActionType.REPLACE_STATE; state: AppState };
