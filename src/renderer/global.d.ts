interface SurfaceActionRecord {
  id: string;
  target: 'browser' | 'terminal';
  kind: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  origin: 'command-center' | 'system';
  payloadSummary: string;
  resultSummary: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  taskId: string | null;
}

interface TerminalSessionInfo {
  id: string; pid: number | null; shell: string; cwd: string;
  startedAt: number; lastActivityAt: number | null; status: string;
  exitCode: number | null; cols: number; rows: number;
  persistent: boolean; tmuxSession: string | null; restored: boolean;
}

interface BrowserNavigationState {
  url: string; title: string; canGoBack: boolean; canGoForward: boolean;
  isLoading: boolean; loadingProgress: number | null; favicon: string;
}
interface BrowserHistoryEntry { url: string; title: string; visitedAt: number; favicon: string; }
interface BookmarkEntry { id: string; url: string; title: string; favicon: string; createdAt: number; }
interface BrowserDownloadState {
  id: string; filename: string; url: string; savePath: string;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  receivedBytes: number; totalBytes: number; startedAt: number;
}
interface BrowserPermissionRequest { id: string; permission: string; origin: string; decision: string | null; requestedAt: number; resolvedAt: number | null; }
interface ExtensionInfo { id: string; name: string; version: string; path: string; enabled: boolean; }
interface FindInPageState { active: boolean; query: string; activeMatch: number; totalMatches: number; }
interface BrowserSettings { homepage: string; searchEngine: 'google' | 'duckduckgo' | 'bing'; defaultZoom: number; javascript: boolean; images: boolean; popups: boolean; }
interface TabInfo { id: string; navigation: BrowserNavigationState; status: string; zoomLevel: number; muted: boolean; isAudible: boolean; createdAt: number; }

interface BrowserState {
  surfaceStatus: 'idle' | 'loading' | 'ready' | 'error';
  navigation: BrowserNavigationState;
  profile: { id: string; partition: string; persistent: boolean; userAgent: string | null; };
  tabs: TabInfo[];
  activeTabId: string;
  history: BrowserHistoryEntry[];
  bookmarks: BookmarkEntry[];
  activeDownloads: BrowserDownloadState[];
  completedDownloads: BrowserDownloadState[];
  recentPermissions: BrowserPermissionRequest[];
  extensions: ExtensionInfo[];
  findInPage: FindInPageState;
  settings: BrowserSettings;
  lastError: { code: number; description: string; url: string; timestamp: number; } | null;
  createdAt: number | null;
}

interface WorkspaceAPI {
  getState(): Promise<any>;
  getRole(): Promise<string>;
  createTask(title: string): Promise<void>;
  updateTaskStatus(taskId: string, status: string): Promise<void>;
  addLog(level: string, source: string, message: string, taskId?: string): Promise<void>;
  applyExecutionPreset(preset: string): Promise<void>;
  setSplitRatio(ratio: number): Promise<void>;

  actions: {
    submit(input: { target: string; kind: string; payload: Record<string, unknown>; taskId?: string | null; origin?: string }): Promise<SurfaceActionRecord>;
    listRecent(limit?: number): Promise<SurfaceActionRecord[]>;
    listByTarget(target: string, limit?: number): Promise<SurfaceActionRecord[]>;
    listByTask(taskId: string): Promise<SurfaceActionRecord[]>;
    onUpdate(callback: (record: SurfaceActionRecord) => void): void;
  };

  onStateUpdate(callback: (state: any) => void): void;
  onEvent(callback: (type: string, payload: any) => void): void;

  browser: {
    getState(): Promise<BrowserState>;
    getHistory(): Promise<BrowserHistoryEntry[]>;
    clearHistory(): Promise<void>;
    clearData(): Promise<void>;
    reportBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<void>;
    getTabs(): Promise<TabInfo[]>;
    addBookmark(url: string, title: string): Promise<BookmarkEntry>;
    removeBookmark(bookmarkId: string): Promise<void>;
    getBookmarks(): Promise<BookmarkEntry[]>;
    zoomIn(): Promise<void>;
    zoomOut(): Promise<void>;
    zoomReset(): Promise<void>;
    findInPage(query: string): Promise<void>;
    findNext(): Promise<void>;
    findPrevious(): Promise<void>;
    stopFind(): Promise<void>;
    toggleDevTools(): Promise<void>;
    getSettings(): Promise<BrowserSettings>;
    updateSettings(settings: Partial<BrowserSettings>): Promise<void>;
    loadExtension(path: string): Promise<ExtensionInfo | null>;
    removeExtension(extensionId: string): Promise<void>;
    getExtensions(): Promise<ExtensionInfo[]>;
    getDownloads(): Promise<BrowserDownloadState[]>;
    cancelDownload(downloadId: string): Promise<void>;
    clearDownloads(): Promise<void>;
    onStateUpdate(callback: (state: BrowserState) => void): void;
    onNavUpdate(callback: (nav: BrowserNavigationState) => void): void;
    onFindUpdate(callback: (find: { activeMatch: number; totalMatches: number }) => void): void;
  };

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

interface Window { workspaceAPI: WorkspaceAPI; }
declare const workspaceAPI: WorkspaceAPI;
