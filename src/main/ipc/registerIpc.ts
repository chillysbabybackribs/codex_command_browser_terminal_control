import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { appStateStore } from '../state/appStateStore';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { getRoleByWebContentsId, applyLayout, resetLayout } from '../windows/windowManager';
import { generateId } from '../../shared/utils/ids';
import { TaskRecord, SurfaceExecutionState, LayoutPreset, TaskStatus, LogLevel, LogSource } from '../../shared/types/appState';

export function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.GET_STATE, () => {
    return appStateStore.getState();
  });

  ipcMain.handle(IPC_CHANNELS.GET_ROLE, (event) => {
    return getRoleByWebContentsId(event.sender.id);
  });

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

  ipcMain.handle(IPC_CHANNELS.ADD_LOG, (_event, level: LogLevel, source: LogSource, message: string, taskId?: string) => {
    const log = {
      id: generateId('log'),
      timestamp: Date.now(),
      level,
      source,
      message,
      taskId,
    };
    eventBus.emit(AppEventType.LOG_ADDED, { log });
  });

  ipcMain.handle(IPC_CHANNELS.APPLY_LAYOUT, (_event, preset: LayoutPreset) => {
    applyLayout(preset);
  });

  ipcMain.handle(IPC_CHANNELS.RESET_LAYOUT, () => {
    resetLayout();
  });

  ipcMain.handle(IPC_CHANNELS.REQUEST_BROWSER_ACTION, (_event, action: string, taskId?: string) => {
    eventBus.emit(AppEventType.BROWSER_ACTION_REQUESTED, { action, taskId });
  });

  ipcMain.handle(IPC_CHANNELS.REQUEST_TERMINAL_ACTION, (_event, action: string, taskId?: string) => {
    eventBus.emit(AppEventType.TERMINAL_ACTION_REQUESTED, { action, taskId });
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_SURFACE_STATUS, (_event, surface: 'browser' | 'terminal', status: SurfaceExecutionState) => {
    if (surface === 'browser') {
      eventBus.emit(AppEventType.BROWSER_ACTION_UPDATED, { status });
    } else {
      eventBus.emit(AppEventType.TERMINAL_ACTION_UPDATED, { status });
    }
  });
}
