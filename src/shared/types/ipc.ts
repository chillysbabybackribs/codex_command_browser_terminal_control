import { AppState, ExecutionLayoutPreset, LogLevel, LogSource, TaskStatus } from './appState';
import { AppEventType } from './events';
import { PhysicalWindowRole } from './windowRoles';
import { TerminalSessionInfo } from './terminal';
import { BrowserState, BrowserHistoryEntry, BrowserNavigationState, TabInfo, BookmarkEntry, ExtensionInfo, BrowserSettings, BrowserDownloadState } from './browser';
import { SurfaceActionInput, SurfaceActionRecord, SurfaceActionKind } from '../actions/surfaceActionTypes';

export const IPC_CHANNELS = {
  GET_STATE: 'workspace:get-state',
  GET_ROLE: 'workspace:get-role',
  EMIT_EVENT: 'workspace:emit-event',
  STATE_UPDATE: 'workspace:state-update',
  EVENT_BROADCAST: 'workspace:event-broadcast',
  CREATE_TASK: 'workspace:create-task',
  UPDATE_TASK_STATUS: 'workspace:update-task-status',
  ADD_LOG: 'workspace:add-log',

  // Execution split control (replaces old layout channels)
  APPLY_EXECUTION_PRESET: 'workspace:apply-execution-preset',
  SET_SPLIT_RATIO: 'workspace:set-split-ratio',

  // Surface action channels
  SUBMIT_SURFACE_ACTION: 'workspace:submit-surface-action',
  GET_RECENT_ACTIONS: 'workspace:get-recent-actions',
  GET_ACTIONS_BY_TARGET: 'workspace:get-actions-by-target',
  GET_ACTIONS_BY_TASK: 'workspace:get-actions-by-task',
  SURFACE_ACTION_UPDATE: 'workspace:surface-action-update',

  // Browser runtime channels (queries, management, UI features)
  BROWSER_GET_STATE: 'browser:get-state',
  BROWSER_GET_HISTORY: 'browser:get-history',
  BROWSER_CLEAR_HISTORY: 'browser:clear-history',
  BROWSER_CLEAR_DATA: 'browser:clear-data',
  BROWSER_REPORT_BOUNDS: 'browser:report-bounds',
  BROWSER_GET_TABS: 'browser:get-tabs',

  // Bookmarks
  BROWSER_ADD_BOOKMARK: 'browser:add-bookmark',
  BROWSER_REMOVE_BOOKMARK: 'browser:remove-bookmark',
  BROWSER_GET_BOOKMARKS: 'browser:get-bookmarks',

  // Zoom
  BROWSER_ZOOM_IN: 'browser:zoom-in',
  BROWSER_ZOOM_OUT: 'browser:zoom-out',
  BROWSER_ZOOM_RESET: 'browser:zoom-reset',

  // Find in page
  BROWSER_FIND_IN_PAGE: 'browser:find-in-page',
  BROWSER_FIND_NEXT: 'browser:find-next',
  BROWSER_FIND_PREVIOUS: 'browser:find-previous',
  BROWSER_STOP_FIND: 'browser:stop-find',

  // DevTools
  BROWSER_TOGGLE_DEVTOOLS: 'browser:toggle-devtools',

  // Settings
  BROWSER_GET_SETTINGS: 'browser:get-settings',
  BROWSER_UPDATE_SETTINGS: 'browser:update-settings',

  // Extensions
  BROWSER_LOAD_EXTENSION: 'browser:load-extension',
  BROWSER_REMOVE_EXTENSION: 'browser:remove-extension',
  BROWSER_GET_EXTENSIONS: 'browser:get-extensions',

  // Downloads
  BROWSER_GET_DOWNLOADS: 'browser:get-downloads',
  BROWSER_CANCEL_DOWNLOAD: 'browser:cancel-download',
  BROWSER_CLEAR_DOWNLOADS: 'browser:clear-downloads',

  // Browser state push channels (main -> renderer)
  BROWSER_STATE_UPDATE: 'browser:state-update',
  BROWSER_NAV_UPDATE: 'browser:nav-update',
  BROWSER_FIND_UPDATE: 'browser:find-update',

  // Terminal session channels
  TERMINAL_START_SESSION: 'terminal:start-session',
  TERMINAL_GET_SESSION: 'terminal:get-session',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_OUTPUT: 'terminal:output',
  TERMINAL_STATUS: 'terminal:status',
  TERMINAL_EXIT: 'terminal:exit',
  TERMINAL_CAPTURE_SCROLLBACK: 'terminal:capture-scrollback',
} as const;

export interface WorkspaceAPI {
  getState(): Promise<AppState>;
  getRole(): Promise<PhysicalWindowRole>;

  createTask(title: string): Promise<void>;
  updateTaskStatus(taskId: string, status: TaskStatus): Promise<void>;

  addLog(level: LogLevel, source: LogSource, message: string, taskId?: string): Promise<void>;

  // Execution split control
  applyExecutionPreset(preset: ExecutionLayoutPreset): Promise<void>;
  setSplitRatio(ratio: number): Promise<void>;

  // Surface actions
  actions: {
    submit(input: SurfaceActionInput): Promise<SurfaceActionRecord>;
    listRecent(limit?: number): Promise<SurfaceActionRecord[]>;
    listByTarget(target: 'browser' | 'terminal', limit?: number): Promise<SurfaceActionRecord[]>;
    listByTask(taskId: string): Promise<SurfaceActionRecord[]>;
    onUpdate(callback: (record: SurfaceActionRecord) => void): void;
  };

  onStateUpdate(callback: (state: AppState) => void): void;
  onEvent(callback: (type: AppEventType, payload: unknown) => void): void;

  // Browser runtime API (queries, management, UI features, subscriptions)
  browser: {
    getState(): Promise<BrowserState>;
    getHistory(): Promise<BrowserHistoryEntry[]>;
    clearHistory(): Promise<void>;
    clearData(): Promise<void>;
    reportBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<void>;
    getTabs(): Promise<TabInfo[]>;
    // Bookmarks
    addBookmark(url: string, title: string): Promise<BookmarkEntry>;
    removeBookmark(bookmarkId: string): Promise<void>;
    getBookmarks(): Promise<BookmarkEntry[]>;
    // Zoom
    zoomIn(): Promise<void>;
    zoomOut(): Promise<void>;
    zoomReset(): Promise<void>;
    // Find in page
    findInPage(query: string): Promise<void>;
    findNext(): Promise<void>;
    findPrevious(): Promise<void>;
    stopFind(): Promise<void>;
    // DevTools
    toggleDevTools(): Promise<void>;
    // Settings
    getSettings(): Promise<BrowserSettings>;
    updateSettings(settings: Partial<BrowserSettings>): Promise<void>;
    // Extensions
    loadExtension(path: string): Promise<ExtensionInfo | null>;
    removeExtension(extensionId: string): Promise<void>;
    getExtensions(): Promise<ExtensionInfo[]>;
    // Downloads
    getDownloads(): Promise<BrowserDownloadState[]>;
    cancelDownload(downloadId: string): Promise<void>;
    clearDownloads(): Promise<void>;
    // Subscriptions
    onStateUpdate(callback: (state: BrowserState) => void): void;
    onNavUpdate(callback: (nav: BrowserNavigationState) => void): void;
    onFindUpdate(callback: (find: { activeMatch: number; totalMatches: number }) => void): void;
  };

  // Terminal session API (raw PTY I/O, queries, subscriptions)
  terminal: {
    startSession(): Promise<TerminalSessionInfo>;
    getSession(): Promise<TerminalSessionInfo | null>;
    write(data: string): Promise<void>;
    resize(cols: number, rows: number): Promise<void>;
    captureScrollback(): Promise<string>;
    onOutput(callback: (data: string) => void): void;
    onStatus(callback: (session: TerminalSessionInfo) => void): void;
    onExit(callback: (exitCode: number) => void): void;
  };

  removeAllListeners(): void;
}
