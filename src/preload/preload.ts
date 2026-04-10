import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/types/ipc';

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

  // Execution split control
  applyExecutionPreset(preset: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.APPLY_EXECUTION_PRESET, preset);
  },

  setSplitRatio(ratio: number) {
    return ipcRenderer.invoke(IPC_CHANNELS.SET_SPLIT_RATIO, ratio);
  },

  // ── Surface actions (single authoritative execution path) ───────────────

  actions: {
    submit(input: any) {
      return ipcRenderer.invoke(IPC_CHANNELS.SUBMIT_SURFACE_ACTION, input);
    },
    listRecent(limit?: number) {
      return ipcRenderer.invoke(IPC_CHANNELS.GET_RECENT_ACTIONS, limit);
    },
    listByTarget(target: string, limit?: number) {
      return ipcRenderer.invoke(IPC_CHANNELS.GET_ACTIONS_BY_TARGET, target, limit);
    },
    listByTask(taskId: string) {
      return ipcRenderer.invoke(IPC_CHANNELS.GET_ACTIONS_BY_TASK, taskId);
    },
    onUpdate(callback: (record: any) => void) {
      ipcRenderer.on(IPC_CHANNELS.SURFACE_ACTION_UPDATE, (_event: any, record: any) => {
        callback(record);
      });
    },
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

  // ── Browser (queries, management, UI features, subscriptions) ───────────

  browser: {
    getState() {
      return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_STATE);
    },
    getHistory() {
      return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_HISTORY);
    },
    clearHistory() {
      return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLEAR_HISTORY);
    },
    clearData() {
      return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLEAR_DATA);
    },
    reportBounds(bounds: { x: number; y: number; width: number; height: number }) {
      return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_REPORT_BOUNDS, bounds);
    },
    getTabs() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_TABS); },
    // Bookmarks
    addBookmark(url: string, title: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_ADD_BOOKMARK, url, title); },
    removeBookmark(bookmarkId: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_REMOVE_BOOKMARK, bookmarkId); },
    getBookmarks() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_BOOKMARKS); },
    // Zoom
    zoomIn() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_ZOOM_IN); },
    zoomOut() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_ZOOM_OUT); },
    zoomReset() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_ZOOM_RESET); },
    // Find in page
    findInPage(query: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_FIND_IN_PAGE, query); },
    findNext() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_FIND_NEXT); },
    findPrevious() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_FIND_PREVIOUS); },
    stopFind() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_STOP_FIND); },
    // DevTools
    toggleDevTools() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_TOGGLE_DEVTOOLS); },
    // Settings
    getSettings() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_SETTINGS); },
    updateSettings(settings: any) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_UPDATE_SETTINGS, settings); },
    // Extensions
    loadExtension(extPath: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_LOAD_EXTENSION, extPath); },
    removeExtension(extensionId: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_REMOVE_EXTENSION, extensionId); },
    getExtensions() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_EXTENSIONS); },
    // Downloads
    getDownloads() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_DOWNLOADS); },
    cancelDownload(downloadId: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CANCEL_DOWNLOAD, downloadId); },
    clearDownloads() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLEAR_DOWNLOADS); },
    // Subscriptions
    onStateUpdate(callback: (state: any) => void) {
      ipcRenderer.on(IPC_CHANNELS.BROWSER_STATE_UPDATE, (_event: any, state: any) => { callback(state); });
    },
    onNavUpdate(callback: (nav: any) => void) {
      ipcRenderer.on(IPC_CHANNELS.BROWSER_NAV_UPDATE, (_event: any, nav: any) => { callback(nav); });
    },
    onFindUpdate(callback: (find: any) => void) {
      ipcRenderer.on(IPC_CHANNELS.BROWSER_FIND_UPDATE, (_event: any, find: any) => { callback(find); });
    },
  },

  // ── Terminal (raw PTY I/O, queries, subscriptions) ──────────────────────

  terminal: {
    startSession() {
      return ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_START_SESSION);
    },
    getSession() {
      return ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_GET_SESSION);
    },
    write(data: string) {
      return ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_WRITE, data);
    },
    resize(cols: number, rows: number) {
      return ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_RESIZE, cols, rows);
    },
    captureScrollback() {
      return ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_CAPTURE_SCROLLBACK);
    },
    onOutput(callback: (data: string) => void) {
      ipcRenderer.on(IPC_CHANNELS.TERMINAL_OUTPUT, (_event: any, data: string) => {
        callback(data);
      });
    },
    onStatus(callback: (session: any) => void) {
      ipcRenderer.on(IPC_CHANNELS.TERMINAL_STATUS, (_event: any, session: any) => {
        callback(session);
      });
    },
    onExit(callback: (exitCode: number) => void) {
      ipcRenderer.on(IPC_CHANNELS.TERMINAL_EXIT, (_event: any, exitCode: number) => {
        callback(exitCode);
      });
    },
  },

  removeAllListeners() {
    ipcRenderer.removeAllListeners(IPC_CHANNELS.STATE_UPDATE);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.EVENT_BROADCAST);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.TERMINAL_OUTPUT);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.TERMINAL_STATUS);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.TERMINAL_EXIT);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.BROWSER_STATE_UPDATE);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.BROWSER_NAV_UPDATE);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.BROWSER_FIND_UPDATE);
    ipcRenderer.removeAllListeners(IPC_CHANNELS.SURFACE_ACTION_UPDATE);
  },
};

contextBridge.exposeInMainWorld('workspaceAPI', api);
