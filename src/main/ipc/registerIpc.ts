import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { appStateStore } from '../state/appStateStore';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { getRoleByWebContentsId } from '../windows/windowManager';
import { generateId } from '../../shared/utils/ids';
import { TaskRecord, SurfaceExecutionState, ExecutionLayoutPreset, TaskStatus, LogLevel, LogSource } from '../../shared/types/appState';
import { terminalService } from '../terminal/TerminalService';
import { browserService } from '../browser/BrowserService';
import { surfaceActionRouter } from '../actions/SurfaceActionRouter';
import { SurfaceActionInput } from '../../shared/actions/surfaceActionTypes';

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

  // Execution split control
  ipcMain.handle(IPC_CHANNELS.APPLY_EXECUTION_PRESET, (_event, preset: ExecutionLayoutPreset) => {
    eventBus.emit(AppEventType.EXECUTION_LAYOUT_APPLIED, { preset });
  });

  ipcMain.handle(IPC_CHANNELS.SET_SPLIT_RATIO, (_event, ratio: number) => {
    const clamped = Math.max(0.15, Math.min(0.85, ratio));
    eventBus.emit(AppEventType.EXECUTION_SPLIT_CHANGED, { ratio: clamped });
  });

  // Surface actions
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

  // ── Orchestrated surface action IPC handlers ────────────────────────────

  ipcMain.handle(IPC_CHANNELS.SUBMIT_SURFACE_ACTION, async (_event, input: SurfaceActionInput) => {
    return surfaceActionRouter.submit(input);
  });

  ipcMain.handle(IPC_CHANNELS.GET_RECENT_ACTIONS, (_event, limit?: number) => {
    return surfaceActionRouter.getRecentActions(limit);
  });

  ipcMain.handle(IPC_CHANNELS.GET_ACTIONS_BY_TARGET, (_event, target: 'browser' | 'terminal', limit?: number) => {
    return surfaceActionRouter.getActionsByTarget(target, limit);
  });

  ipcMain.handle(IPC_CHANNELS.GET_ACTIONS_BY_TASK, (_event, taskId: string) => {
    return surfaceActionRouter.getActionsByTask(taskId);
  });

  // Terminal session IPC handlers
  ipcMain.handle(IPC_CHANNELS.TERMINAL_START_SESSION, () => {
    return terminalService.startSession();
  });

  ipcMain.handle(IPC_CHANNELS.TERMINAL_GET_SESSION, () => {
    return terminalService.getSession();
  });

  ipcMain.handle(IPC_CHANNELS.TERMINAL_WRITE, (_event, data: string) => {
    terminalService.write(data);
  });

  ipcMain.handle(IPC_CHANNELS.TERMINAL_RESIZE, (_event, cols: number, rows: number) => {
    terminalService.resize(cols, rows);
  });

  ipcMain.handle(IPC_CHANNELS.TERMINAL_RESTART, () => {
    return terminalService.restart();
  });

  ipcMain.handle(IPC_CHANNELS.TERMINAL_CAPTURE_SCROLLBACK, () => {
    return terminalService.captureScrollback();
  });

  // ── Browser runtime IPC handlers ─────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_STATE, () => {
    return browserService.getState();
  });

  ipcMain.handle(IPC_CHANNELS.BROWSER_NAVIGATE, (_event, url: string) => {
    browserService.navigate(url);
  });

  ipcMain.handle(IPC_CHANNELS.BROWSER_GO_BACK, () => {
    browserService.goBack();
  });

  ipcMain.handle(IPC_CHANNELS.BROWSER_GO_FORWARD, () => {
    browserService.goForward();
  });

  ipcMain.handle(IPC_CHANNELS.BROWSER_RELOAD, () => {
    browserService.reload();
  });

  ipcMain.handle(IPC_CHANNELS.BROWSER_STOP, () => {
    browserService.stop();
  });

  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_HISTORY, () => {
    return browserService.getHistory();
  });

  ipcMain.handle(IPC_CHANNELS.BROWSER_CLEAR_HISTORY, () => {
    browserService.clearHistory();
  });

  ipcMain.handle(IPC_CHANNELS.BROWSER_CLEAR_DATA, async () => {
    await browserService.clearData();
  });

  ipcMain.handle(IPC_CHANNELS.BROWSER_REPORT_BOUNDS, (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    browserService.setBounds(bounds);
  });

  // Tabs
  ipcMain.handle(IPC_CHANNELS.BROWSER_CREATE_TAB, (_event, url?: string) => {
    return browserService.createTab(url);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_CLOSE_TAB, (_event, tabId: string) => {
    browserService.closeTab(tabId);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_ACTIVATE_TAB, (_event, tabId: string) => {
    browserService.activateTab(tabId);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_TABS, () => {
    return browserService.getTabs();
  });

  // Bookmarks
  ipcMain.handle(IPC_CHANNELS.BROWSER_ADD_BOOKMARK, (_event, url: string, title: string) => {
    return browserService.addBookmark(url, title);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_REMOVE_BOOKMARK, (_event, bookmarkId: string) => {
    browserService.removeBookmark(bookmarkId);
  });
  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_BOOKMARKS, () => {
    return browserService.getBookmarks();
  });

  // Zoom
  ipcMain.handle(IPC_CHANNELS.BROWSER_ZOOM_IN, () => { browserService.zoomIn(); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_ZOOM_OUT, () => { browserService.zoomOut(); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_ZOOM_RESET, () => { browserService.zoomReset(); });

  // Find in page
  ipcMain.handle(IPC_CHANNELS.BROWSER_FIND_IN_PAGE, (_event, query: string) => { browserService.findInPage(query); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_FIND_NEXT, () => { browserService.findNext(); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_FIND_PREVIOUS, () => { browserService.findPrevious(); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_STOP_FIND, () => { browserService.stopFind(); });

  // DevTools
  ipcMain.handle(IPC_CHANNELS.BROWSER_TOGGLE_DEVTOOLS, () => { browserService.toggleDevTools(); });

  // Settings
  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_SETTINGS, () => { return browserService.getSettings(); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_UPDATE_SETTINGS, (_event, settings: any) => { browserService.updateSettings(settings); });

  // Extensions
  ipcMain.handle(IPC_CHANNELS.BROWSER_LOAD_EXTENSION, async (_event, extPath: string) => { return browserService.loadExtension(extPath); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_REMOVE_EXTENSION, async (_event, extensionId: string) => { browserService.removeExtension(extensionId); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_EXTENSIONS, () => { return browserService.getExtensions(); });

  // Downloads
  ipcMain.handle(IPC_CHANNELS.BROWSER_GET_DOWNLOADS, () => { return browserService.getDownloads(); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_CANCEL_DOWNLOAD, (_event, downloadId: string) => { browserService.cancelDownload(downloadId); });
  ipcMain.handle(IPC_CHANNELS.BROWSER_CLEAR_DOWNLOADS, () => { browserService.clearDownloads(); });
}
