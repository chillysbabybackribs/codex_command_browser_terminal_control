import { contextBridge, ipcRenderer } from 'electron';

// Import channel constants - these compile to string literals
const IPC_CHANNELS = {
  GET_STATE: 'workspace:get-state',
  GET_ROLE: 'workspace:get-role',
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

const api = {
  getState() {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_STATE);
  },

  getRole() {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_ROLE);
  },

  createTask(title: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.CREATE_TASK, title);
  },

  updateTaskStatus(taskId: string, status: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.UPDATE_TASK_STATUS, taskId, status);
  },

  addLog(level: string, source: string, message: string, taskId?: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.ADD_LOG, level, source, message, taskId);
  },

  applyLayout(preset: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.APPLY_LAYOUT, preset);
  },

  resetLayout() {
    return ipcRenderer.invoke(IPC_CHANNELS.RESET_LAYOUT);
  },

  requestBrowserAction(action: string, taskId?: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.REQUEST_BROWSER_ACTION, action, taskId);
  },

  requestTerminalAction(action: string, taskId?: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.REQUEST_TERMINAL_ACTION, action, taskId);
  },

  updateSurfaceStatus(surface: string, status: any) {
    return ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SURFACE_STATUS, surface, status);
  },

  onStateUpdate(callback: (state: any) => void) {
    ipcRenderer.on(IPC_CHANNELS.STATE_UPDATE, (_event: any, state: any) => {
      callback(state);
    });
  },

  onEvent(callback: (type: string, payload: any) => void) {
    ipcRenderer.on(IPC_CHANNELS.EVENT_BROADCAST, (_event: any, type: string, payload: any) => {
      callback(type, payload);
    });
  },

  removeAllListeners() {
    ipcRenderer.removeAllListeners(IPC_CHANNELS.STATE_UPDATE);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.EVENT_BROADCAST);
  },
};

contextBridge.exposeInMainWorld('workspaceAPI', api);
