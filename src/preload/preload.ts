import { contextBridge, ipcRenderer } from 'electron';

const IPC_CHANNELS = {
  GET_STATE: 'workspace:get-state',
  GET_ROLE: 'workspace:get-role',
  STATE_UPDATE: 'workspace:state-update',
  EVENT_BROADCAST: 'workspace:event-broadcast',
  CREATE_TASK: 'workspace:create-task',
  UPDATE_TASK_STATUS: 'workspace:update-task-status',
  ADD_LOG: 'workspace:add-log',

  APPLY_EXECUTION_PRESET: 'workspace:apply-execution-preset',
  SET_SPLIT_RATIO: 'workspace:set-split-ratio',

  REQUEST_BROWSER_ACTION: 'workspace:request-browser-action',
  REQUEST_TERMINAL_ACTION: 'workspace:request-terminal-action',
  UPDATE_SURFACE_STATUS: 'workspace:update-surface-status',

  SUBMIT_SURFACE_ACTION: 'workspace:submit-surface-action',
  GET_RECENT_ACTIONS: 'workspace:get-recent-actions',
  GET_ACTIONS_BY_TARGET: 'workspace:get-actions-by-target',
  GET_ACTIONS_BY_TASK: 'workspace:get-actions-by-task',
  SURFACE_ACTION_UPDATE: 'workspace:surface-action-update',

  BROWSER_GET_STATE: 'browser:get-state',
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_GO_BACK: 'browser:go-back',
  BROWSER_GO_FORWARD: 'browser:go-forward',
  BROWSER_RELOAD: 'browser:reload',
  BROWSER_STOP: 'browser:stop',
  BROWSER_GET_HISTORY: 'browser:get-history',
  BROWSER_CLEAR_HISTORY: 'browser:clear-history',
  BROWSER_CLEAR_DATA: 'browser:clear-data',
  BROWSER_REPORT_BOUNDS: 'browser:report-bounds',
  BROWSER_CREATE_TAB: 'browser:create-tab',
  BROWSER_CLOSE_TAB: 'browser:close-tab',
  BROWSER_ACTIVATE_TAB: 'browser:activate-tab',
  BROWSER_GET_TABS: 'browser:get-tabs',
  BROWSER_ADD_BOOKMARK: 'browser:add-bookmark',
  BROWSER_REMOVE_BOOKMARK: 'browser:remove-bookmark',
  BROWSER_GET_BOOKMARKS: 'browser:get-bookmarks',
  BROWSER_ZOOM_IN: 'browser:zoom-in',
  BROWSER_ZOOM_OUT: 'browser:zoom-out',
  BROWSER_ZOOM_RESET: 'browser:zoom-reset',
  BROWSER_FIND_IN_PAGE: 'browser:find-in-page',
  BROWSER_FIND_NEXT: 'browser:find-next',
  BROWSER_FIND_PREVIOUS: 'browser:find-previous',
  BROWSER_STOP_FIND: 'browser:stop-find',
  BROWSER_TOGGLE_DEVTOOLS: 'browser:toggle-devtools',
  BROWSER_GET_SETTINGS: 'browser:get-settings',
  BROWSER_UPDATE_SETTINGS: 'browser:update-settings',
  BROWSER_LOAD_EXTENSION: 'browser:load-extension',
  BROWSER_REMOVE_EXTENSION: 'browser:remove-extension',
  BROWSER_GET_EXTENSIONS: 'browser:get-extensions',
  BROWSER_GET_DOWNLOADS: 'browser:get-downloads',
  BROWSER_CANCEL_DOWNLOAD: 'browser:cancel-download',
  BROWSER_CLEAR_DOWNLOADS: 'browser:clear-downloads',
  BROWSER_STATE_UPDATE: 'browser:state-update',
  BROWSER_NAV_UPDATE: 'browser:nav-update',
  BROWSER_FIND_UPDATE: 'browser:find-update',

  TERMINAL_START_SESSION: 'terminal:start-session',
  TERMINAL_GET_SESSION: 'terminal:get-session',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_RESTART: 'terminal:restart',
  TERMINAL_OUTPUT: 'terminal:output',
  TERMINAL_STATUS: 'terminal:status',
  TERMINAL_EXIT: 'terminal:exit',
  TERMINAL_CAPTURE_SCROLLBACK: 'terminal:capture-scrollback',
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

  // Execution split control
  applyExecutionPreset(preset: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.APPLY_EXECUTION_PRESET, preset);
  },

  setSplitRatio(ratio: number) {
    return ipcRenderer.invoke(IPC_CHANNELS.SET_SPLIT_RATIO, ratio);
  },

  // Surface actions
  requestBrowserAction(action: string, taskId?: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.REQUEST_BROWSER_ACTION, action, taskId);
  },

  requestTerminalAction(action: string, taskId?: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.REQUEST_TERMINAL_ACTION, action, taskId);
  },

  updateSurfaceStatus(surface: string, status: any) {
    return ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SURFACE_STATUS, surface, status);
  },

  // Orchestrated surface actions
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

  browser: {
    getState() {
      return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_STATE);
    },
    navigate(url: string) {
      return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_NAVIGATE, url);
    },
    goBack() {
      return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GO_BACK);
    },
    goForward() {
      return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GO_FORWARD);
    },
    reload() {
      return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_RELOAD);
    },
    stop() {
      return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_STOP);
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
    createTab(url?: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CREATE_TAB, url); },
    closeTab(tabId: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLOSE_TAB, tabId); },
    activateTab(tabId: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_ACTIVATE_TAB, tabId); },
    getTabs() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_TABS); },
    addBookmark(url: string, title: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_ADD_BOOKMARK, url, title); },
    removeBookmark(bookmarkId: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_REMOVE_BOOKMARK, bookmarkId); },
    getBookmarks() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_BOOKMARKS); },
    zoomIn() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_ZOOM_IN); },
    zoomOut() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_ZOOM_OUT); },
    zoomReset() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_ZOOM_RESET); },
    findInPage(query: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_FIND_IN_PAGE, query); },
    findNext() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_FIND_NEXT); },
    findPrevious() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_FIND_PREVIOUS); },
    stopFind() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_STOP_FIND); },
    toggleDevTools() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_TOGGLE_DEVTOOLS); },
    getSettings() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_SETTINGS); },
    updateSettings(settings: any) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_UPDATE_SETTINGS, settings); },
    loadExtension(extPath: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_LOAD_EXTENSION, extPath); },
    removeExtension(extensionId: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_REMOVE_EXTENSION, extensionId); },
    getExtensions() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_EXTENSIONS); },
    getDownloads() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_GET_DOWNLOADS); },
    cancelDownload(downloadId: string) { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CANCEL_DOWNLOAD, downloadId); },
    clearDownloads() { return ipcRenderer.invoke(IPC_CHANNELS.BROWSER_CLEAR_DOWNLOADS); },
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
    restart() {
      return ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_RESTART);
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
