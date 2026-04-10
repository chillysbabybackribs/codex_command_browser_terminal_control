import { BrowserWindow } from 'electron';
import { eventBus } from './eventBus';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { AppEventType, AppEvent } from '../../shared/types/events';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { generateId } from '../../shared/utils/ids';

function broadcastToRenderers(event: AppEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send(IPC_CHANNELS.EVENT_BROADCAST, event.type, event.payload);
    }
  }
}

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
