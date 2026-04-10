// ═══════════════════════════════════════════════════════════════════════════
// Browser Service — Multi-tab browser runtime with full feature set
// ═══════════════════════════════════════════════════════════════════════════
//
// Manages multiple tabs (each a WebContentsView), bookmarks, extensions,
// settings, zoom, find-in-page, downloads, and permissions.

import { BrowserWindow, WebContentsView, session, DownloadItem, Event as ElectronEvent, Menu, MenuItem, clipboard } from 'electron';
import {
  BrowserState, BrowserNavigationState, BrowserSurfaceStatus,
  BrowserHistoryEntry, BrowserDownloadState, BrowserPermissionRequest,
  BrowserErrorInfo, BrowserProfile, TabInfo, BookmarkEntry, ExtensionInfo,
  FindInPageState, BrowserSettings,
  createDefaultBrowserState, createDefaultSettings,
} from '../../shared/types/browser';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { generateId } from '../../shared/utils/ids';
import {
  loadBrowserHistory, loadLastUrls, loadActiveTabIndex, saveBrowserHistory,
  loadBookmarks, saveBookmarks, loadSettings, saveSettings, flushAll,
} from './browserSessionStore';
import { resolvePermission, classifyPermission } from './browserPermissions';
import { createDownloadEntry, resolveDownloadPath } from './browserDownloads';

const PROFILE_ID = 'workspace-browser';
const PARTITION = 'persist:workspace-browser';
const MAX_HISTORY = 2000;
const MAX_RECENT_PERMISSIONS = 50;
const HISTORY_PERSIST_DEBOUNCE = 2000;
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5.0;

type TabEntry = {
  id: string;
  view: WebContentsView;
  info: TabInfo;
};

export class BrowserService {
  private tabs: Map<string, TabEntry> = new Map();
  private activeTabId: string = '';
  private hostWindow: BrowserWindow | null = null;
  private profile: BrowserProfile;
  private history: BrowserHistoryEntry[] = [];
  private bookmarks: BookmarkEntry[] = [];
  private activeDownloads: Map<string, { entry: BrowserDownloadState; item: DownloadItem }> = new Map();
  private completedDownloads: BrowserDownloadState[] = [];
  private recentPermissions: BrowserPermissionRequest[] = [];
  private extensions: ExtensionInfo[] = [];
  private findState: FindInPageState = { active: false, query: '', activeMatch: 0, totalMatches: 0 };
  private settings: BrowserSettings;
  private lastError: BrowserErrorInfo | null = null;
  private createdAt: number | null = null;
  private disposed = false;
  private historyPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private currentBounds = { x: 0, y: 0, width: 0, height: 0 };
  private sessionInstance: Electron.Session | null = null;

  constructor() {
    this.profile = { id: PROFILE_ID, partition: PARTITION, persistent: true, userAgent: null };
    this.settings = createDefaultSettings();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  createSurface(hostWindow: BrowserWindow): void {
    if (this.tabs.size > 0) return;
    this.hostWindow = hostWindow;

    this.history = loadBrowserHistory();
    this.bookmarks = loadBookmarks();
    this.settings = loadSettings();

    const ses = session.fromPartition(PARTITION);
    this.sessionInstance = ses;
    this.initSession(ses);

    this.createdAt = Date.now();

    eventBus.emit(AppEventType.BROWSER_SURFACE_CREATED, { profileId: PROFILE_ID, partition: PARTITION });
    this.emitLog('info', 'Browser runtime initialized with persistent session');

    // Restore tabs from last session or create a single default tab
    const lastUrls = loadLastUrls();
    const activeIdx = loadActiveTabIndex();
    if (lastUrls.length > 0) {
      const tabIds: string[] = [];
      for (const url of lastUrls) {
        const tab = this.createTabInternal(url, false);
        tabIds.push(tab.id);
      }
      const targetId = tabIds[Math.min(activeIdx, tabIds.length - 1)] || tabIds[0];
      this.activateTabInternal(targetId);
    } else {
      const tab = this.createTabInternal(this.settings.homepage, false);
      this.activateTabInternal(tab.id);
    }

    this.syncState();
  }

  private initSession(ses: Electron.Session): void {
    ses.setPermissionRequestHandler((webContents, permission, callback) => {
      const permType = classifyPermission(permission);
      const decision = resolvePermission(permType);
      const request: BrowserPermissionRequest = {
        id: generateId('perm'), permission: permType,
        origin: webContents.getURL(), decision,
        requestedAt: Date.now(), resolvedAt: Date.now(),
      };
      this.recentPermissions.push(request);
      if (this.recentPermissions.length > MAX_RECENT_PERMISSIONS) {
        this.recentPermissions = this.recentPermissions.slice(-MAX_RECENT_PERMISSIONS);
      }
      eventBus.emit(AppEventType.BROWSER_PERMISSION_REQUESTED, { request });
      eventBus.emit(AppEventType.BROWSER_PERMISSION_RESOLVED, { request });
      this.emitLog('info', `Permission ${permission}: ${decision} (${webContents.getURL()})`);
      callback(decision === 'granted');
      this.syncState();
    });

    ses.on('will-download', (_event: ElectronEvent, item: DownloadItem) => {
      const filename = item.getFilename();
      const savePath = resolveDownloadPath(filename);
      item.setSavePath(savePath);
      const entry = createDownloadEntry(item.getURL(), filename, savePath);
      this.activeDownloads.set(entry.id, { entry, item });
      eventBus.emit(AppEventType.BROWSER_DOWNLOAD_STARTED, { download: { ...entry } });
      this.emitLog('info', `Download started: ${filename}`);
      this.syncState();

      item.on('updated', (_e: ElectronEvent, state: string) => {
        entry.receivedBytes = item.getReceivedBytes();
        entry.totalBytes = item.getTotalBytes();
        entry.state = state === 'progressing' ? 'progressing' : 'interrupted';
        eventBus.emit(AppEventType.BROWSER_DOWNLOAD_UPDATED, { download: { ...entry } });
        this.syncState();
      });

      item.once('done', (_e: ElectronEvent, state: string) => {
        entry.receivedBytes = item.getReceivedBytes();
        entry.totalBytes = item.getTotalBytes();
        entry.state = state === 'completed' ? 'completed' : 'cancelled';
        eventBus.emit(AppEventType.BROWSER_DOWNLOAD_COMPLETED, { download: { ...entry } });
        this.emitLog(entry.state === 'completed' ? 'info' : 'warn', `Download ${entry.state}: ${filename}`);
        this.activeDownloads.delete(entry.id);
        this.completedDownloads.push({ ...entry });
        if (this.completedDownloads.length > 100) this.completedDownloads = this.completedDownloads.slice(-100);
        this.syncState();
      });
    });
  }

  // ─── Tab Management ──────────────────────────────────────────────────────

  createTab(url?: string): TabInfo {
    const tab = this.createTabInternal(url || this.settings.homepage, true);
    this.activateTabInternal(tab.id);
    this.syncState();
    return tab.info;
  }

  private createTabInternal(url: string, notify: boolean): TabEntry {
    if (!this.hostWindow || !this.sessionInstance) throw new Error('Browser not initialized');
    const id = generateId('tab');

    const view = new WebContentsView({
      webPreferences: {
        session: this.sessionInstance,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        spellcheck: true,
        javascript: this.settings.javascript,
        images: this.settings.images,
      },
    });

    // Set zoom from settings
    view.webContents.setZoomFactor(this.settings.defaultZoom);

    const info: TabInfo = {
      id,
      navigation: {
        url: '', title: 'New Tab', canGoBack: false, canGoForward: false,
        isLoading: false, loadingProgress: null, favicon: '', lastNavigationAt: null,
      },
      status: 'idle',
      zoomLevel: this.settings.defaultZoom,
      muted: false,
      isAudible: false,
      createdAt: Date.now(),
    };

    const entry: TabEntry = { id, view, info };
    this.tabs.set(id, entry);

    this.wireTabEvents(entry);

    // Don't add to contentView yet — only the active tab is visible
    if (url && url !== 'about:blank') {
      this.navigateTab(id, url);
    }

    if (notify) {
      eventBus.emit(AppEventType.BROWSER_TAB_CREATED, { tab: { ...info } });
      this.emitLog('info', `New tab created`);
    }

    return entry;
  }

  closeTab(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry) return;

    // Don't close last tab — create a new one instead
    if (this.tabs.size === 1) {
      this.navigateTab(tabId, this.settings.homepage);
      return;
    }

    // If closing the active tab, switch to an adjacent tab
    if (this.activeTabId === tabId) {
      const tabIds = Array.from(this.tabs.keys());
      const idx = tabIds.indexOf(tabId);
      const nextId = tabIds[idx + 1] || tabIds[idx - 1];
      if (nextId) this.activateTabInternal(nextId);
    }

    // Remove from contentView and destroy
    if (this.hostWindow && !this.hostWindow.isDestroyed()) {
      try { this.hostWindow.contentView.removeChildView(entry.view); } catch {}
    }
    entry.view.webContents.close();
    this.tabs.delete(tabId);

    eventBus.emit(AppEventType.BROWSER_TAB_CLOSED, { tabId });
    this.syncState();
  }

  activateTab(tabId: string): void {
    this.activateTabInternal(tabId);
    this.syncState();
  }

  private activateTabInternal(tabId: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry || !this.hostWindow) return;

    // Hide current active tab
    if (this.activeTabId && this.activeTabId !== tabId) {
      const prev = this.tabs.get(this.activeTabId);
      if (prev && this.hostWindow && !this.hostWindow.isDestroyed()) {
        try { this.hostWindow.contentView.removeChildView(prev.view); } catch {}
      }
    }

    // Show new active tab
    this.activeTabId = tabId;
    this.hostWindow.contentView.addChildView(entry.view);
    entry.view.setBounds({
      x: Math.round(this.currentBounds.x),
      y: Math.round(this.currentBounds.y),
      width: Math.round(Math.max(1, this.currentBounds.width)),
      height: Math.round(Math.max(1, this.currentBounds.height)),
    });

    // Update find state to match active tab
    this.findState = { active: false, query: '', activeMatch: 0, totalMatches: 0 };

    eventBus.emit(AppEventType.BROWSER_TAB_ACTIVATED, { tabId });
  }

  getTabs(): TabInfo[] {
    return Array.from(this.tabs.values()).map(e => ({ ...e.info }));
  }

  private getActiveEntry(): TabEntry | undefined {
    return this.tabs.get(this.activeTabId);
  }

  private wireTabEvents(entry: TabEntry): void {
    const wc = entry.view.webContents;
    const info = entry.info;
    const nav = info.navigation;

    wc.on('did-start-loading', () => {
      nav.isLoading = true;
      nav.loadingProgress = 0.1;
      info.status = 'loading';
      this.syncTabAndMaybeNavigation(entry);
    });

    wc.on('did-stop-loading', () => {
      nav.isLoading = false;
      nav.loadingProgress = null;
      info.status = 'ready';
      this.syncTabAndMaybeNavigation(entry);
    });

    wc.on('did-navigate', (_e: ElectronEvent, url: string) => {
      nav.url = url;
      nav.canGoBack = wc.navigationHistory.canGoBack();
      nav.canGoForward = wc.navigationHistory.canGoForward();
      nav.lastNavigationAt = Date.now();
      this.addHistoryEntry(url, nav.title, nav.favicon);
      this.syncTabAndMaybeNavigation(entry);
    });

    wc.on('did-navigate-in-page', (_e: ElectronEvent, url: string) => {
      nav.url = url;
      nav.canGoBack = wc.navigationHistory.canGoBack();
      nav.canGoForward = wc.navigationHistory.canGoForward();
      this.syncTabAndMaybeNavigation(entry);
    });

    wc.on('page-title-updated', (_e: ElectronEvent, title: string) => {
      nav.title = title;
      const recent = this.history[this.history.length - 1];
      if (recent && recent.url === nav.url) recent.title = title;
      this.syncTabAndMaybeNavigation(entry);
      if (entry.id === this.activeTabId) {
        eventBus.emit(AppEventType.BROWSER_TITLE_UPDATED, { title, url: nav.url });
      }
    });

    wc.on('page-favicon-updated', (_e: ElectronEvent, favicons: string[]) => {
      if (favicons.length > 0) {
        nav.favicon = favicons[0];
        const recent = this.history[this.history.length - 1];
        if (recent && recent.url === nav.url) recent.favicon = favicons[0];
        this.syncTabAndMaybeNavigation(entry);
      }
    });

    wc.on('did-fail-load', (_e: ElectronEvent, errorCode: number, errorDescription: string, validatedURL: string) => {
      if (errorCode === -3) return; // aborted
      this.lastError = { code: errorCode, description: errorDescription, url: validatedURL, timestamp: Date.now() };
      info.status = 'error';
      this.syncTabAndMaybeNavigation(entry);
      this.emitLog('error', `Navigation failed: ${errorDescription} (${validatedURL})`);
    });

    wc.on('audio-state-changed', () => {
      info.isAudible = wc.isCurrentlyAudible();
      this.syncTabAndMaybeNavigation(entry);
    });

    wc.on('context-menu', (_e: ElectronEvent, params: Electron.ContextMenuParams) => {
      const menu = new Menu();

      // ── Text editing actions ──
      if (params.isEditable) {
        menu.append(new MenuItem({ label: 'Undo', role: 'undo', enabled: params.editFlags.canUndo }));
        menu.append(new MenuItem({ label: 'Redo', role: 'redo', enabled: params.editFlags.canRedo }));
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({ label: 'Cut', role: 'cut', enabled: params.editFlags.canCut }));
        menu.append(new MenuItem({ label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy }));
        menu.append(new MenuItem({ label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste }));
        menu.append(new MenuItem({ label: 'Delete', role: 'delete', enabled: params.editFlags.canDelete }));
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({ label: 'Select All', role: 'selectAll', enabled: params.editFlags.canSelectAll }));
      } else {
        // ── Selection actions (non-editable) ──
        if (params.selectionText) {
          menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
          menu.append(new MenuItem({ type: 'separator' }));
        }
        menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
      }

      // ── Link actions ──
      if (params.linkURL) {
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({
          label: 'Open Link in New Tab',
          click: () => this.createTab(params.linkURL),
        }));
        menu.append(new MenuItem({
          label: 'Copy Link Address',
          click: () => clipboard.writeText(params.linkURL),
        }));
      }

      // ── Image actions ──
      if (params.hasImageContents && params.srcURL) {
        menu.append(new MenuItem({ type: 'separator' }));
        menu.append(new MenuItem({
          label: 'Open Image in New Tab',
          click: () => this.createTab(params.srcURL),
        }));
        menu.append(new MenuItem({
          label: 'Copy Image Address',
          click: () => clipboard.writeText(params.srcURL),
        }));
      }

      // ── Page actions ──
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() }));
      menu.append(new MenuItem({ label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() }));
      menu.append(new MenuItem({ label: 'Reload', click: () => wc.reload() }));

      menu.popup();
    });

    wc.setWindowOpenHandler(({ url }) => {
      // Open in new tab
      this.createTab(url);
      return { action: 'deny' };
    });
  }

  private syncTabAndMaybeNavigation(entry: TabEntry): void {
    eventBus.emit(AppEventType.BROWSER_TAB_UPDATED, { tab: { ...entry.info } });
    if (entry.id === this.activeTabId) {
      this.syncNavigation();
    }
  }

  // ─── Navigation ──────────────────────────────────────────────────────────

  navigate(url: string): void {
    this.navigateTab(this.activeTabId, url);
  }

  private navigateTab(tabId: string, url: string): void {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    let normalized = url.trim();
    if (normalized && !normalized.match(/^[a-zA-Z]+:\/\//)) {
      if (normalized.includes('.') && !normalized.includes(' ')) {
        normalized = 'https://' + normalized;
      } else {
        const engines: Record<string, string> = {
          google: 'https://www.google.com/search?q=',
          duckduckgo: 'https://duckduckgo.com/?q=',
          bing: 'https://www.bing.com/search?q=',
        };
        normalized = (engines[this.settings.searchEngine] || engines.google) + encodeURIComponent(normalized);
      }
    }
    entry.info.navigation.url = normalized;
    entry.view.webContents.loadURL(normalized);
  }

  goBack(): void {
    const entry = this.getActiveEntry();
    if (!entry || !entry.view.webContents.navigationHistory.canGoBack()) return;
    entry.view.webContents.navigationHistory.goBack();
  }

  goForward(): void {
    const entry = this.getActiveEntry();
    if (!entry || !entry.view.webContents.navigationHistory.canGoForward()) return;
    entry.view.webContents.navigationHistory.goForward();
  }

  reload(): void {
    const entry = this.getActiveEntry();
    if (entry) entry.view.webContents.reload();
  }

  stop(): void {
    const entry = this.getActiveEntry();
    if (entry) entry.view.webContents.stop();
  }

  // ─── Zoom ────────────────────────────────────────────────────────────────

  zoomIn(): void {
    const entry = this.getActiveEntry();
    if (!entry) return;
    const current = entry.view.webContents.getZoomFactor();
    const next = Math.min(ZOOM_MAX, current + ZOOM_STEP);
    entry.view.webContents.setZoomFactor(next);
    entry.info.zoomLevel = next;
    this.syncState();
  }

  zoomOut(): void {
    const entry = this.getActiveEntry();
    if (!entry) return;
    const current = entry.view.webContents.getZoomFactor();
    const next = Math.max(ZOOM_MIN, current - ZOOM_STEP);
    entry.view.webContents.setZoomFactor(next);
    entry.info.zoomLevel = next;
    this.syncState();
  }

  zoomReset(): void {
    const entry = this.getActiveEntry();
    if (!entry) return;
    entry.view.webContents.setZoomFactor(1.0);
    entry.info.zoomLevel = 1.0;
    this.syncState();
  }

  // ─── Find In Page ────────────────────────────────────────────────────────

  findInPage(query: string): void {
    const entry = this.getActiveEntry();
    if (!entry || !query) return;
    this.findState = { active: true, query, activeMatch: 0, totalMatches: 0 };
    entry.view.webContents.findInPage(query);
    entry.view.webContents.on('found-in-page', (_e: ElectronEvent, result: Electron.FoundInPageResult) => {
      this.findState.activeMatch = result.activeMatchOrdinal;
      this.findState.totalMatches = result.matches;
      this.broadcastFind();
    });
    this.syncState();
  }

  findNext(): void {
    const entry = this.getActiveEntry();
    if (!entry || !this.findState.active || !this.findState.query) return;
    entry.view.webContents.findInPage(this.findState.query, { findNext: true, forward: true });
  }

  findPrevious(): void {
    const entry = this.getActiveEntry();
    if (!entry || !this.findState.active || !this.findState.query) return;
    entry.view.webContents.findInPage(this.findState.query, { findNext: true, forward: false });
  }

  stopFind(): void {
    const entry = this.getActiveEntry();
    if (entry) entry.view.webContents.stopFindInPage('clearSelection');
    this.findState = { active: false, query: '', activeMatch: 0, totalMatches: 0 };
    this.broadcastFind();
    this.syncState();
  }

  private broadcastFind(): void {
    // Broadcast via dedicated channel handled in eventRouter
    if (this.hostWindow && !this.hostWindow.isDestroyed()) {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send('browser:find-update', {
            activeMatch: this.findState.activeMatch,
            totalMatches: this.findState.totalMatches,
          });
        }
      }
    }
  }

  // ─── DevTools ────────────────────────────────────────────────────────────

  toggleDevTools(): void {
    const entry = this.getActiveEntry();
    if (!entry) return;
    if (entry.view.webContents.isDevToolsOpened()) {
      entry.view.webContents.closeDevTools();
    } else {
      entry.view.webContents.openDevTools({ mode: 'detach' });
    }
  }

  // ─── Bookmarks ──────────────────────────────────────────────────────────

  addBookmark(url: string, title: string): BookmarkEntry {
    const entry: BookmarkEntry = {
      id: generateId('bm'),
      url, title,
      favicon: '',
      createdAt: Date.now(),
    };
    // Get favicon from active tab if URL matches
    const active = this.getActiveEntry();
    if (active && active.info.navigation.url === url) {
      entry.favicon = active.info.navigation.favicon;
    }
    this.bookmarks.push(entry);
    saveBookmarks(this.bookmarks);
    eventBus.emit(AppEventType.BROWSER_BOOKMARK_ADDED, { bookmark: { ...entry } });
    this.emitLog('info', `Bookmark added: ${title}`);
    this.syncState();
    return { ...entry };
  }

  removeBookmark(bookmarkId: string): void {
    this.bookmarks = this.bookmarks.filter(b => b.id !== bookmarkId);
    saveBookmarks(this.bookmarks);
    eventBus.emit(AppEventType.BROWSER_BOOKMARK_REMOVED, { bookmarkId });
    this.syncState();
  }

  getBookmarks(): BookmarkEntry[] {
    return [...this.bookmarks];
  }

  // ─── History ──────────────────────────────────────────────────────────────

  private addHistoryEntry(url: string, title: string, favicon: string): void {
    if (!url || url === 'about:blank' || url.startsWith('devtools://')) return;
    const last = this.history[this.history.length - 1];
    if (last && last.url === url) return;
    this.history.push({ url, title: title || url, visitedAt: Date.now(), favicon: favicon || '' });
    if (this.history.length > MAX_HISTORY) this.history = this.history.slice(-MAX_HISTORY);
    this.scheduleHistoryPersist();
    eventBus.emit(AppEventType.BROWSER_HISTORY_UPDATED, { entries: this.getRecentHistory() });
  }

  getHistory(): BrowserHistoryEntry[] { return [...this.history]; }
  getRecentHistory(count: number = 50): BrowserHistoryEntry[] { return this.history.slice(-count); }

  clearHistory(): void {
    this.history = [];
    this.persistNow();
    eventBus.emit(AppEventType.BROWSER_HISTORY_UPDATED, { entries: [] });
    this.emitLog('info', 'Browser history cleared');
    this.syncState();
  }

  async clearData(): Promise<void> {
    const entry = this.getActiveEntry();
    if (!entry) return;
    const ses = entry.view.webContents.session;
    await ses.clearStorageData();
    await ses.clearCache();
    this.clearHistory();
    this.emitLog('info', 'Browser data cleared (cache, storage, history)');
  }

  private scheduleHistoryPersist(): void {
    if (this.historyPersistTimer) clearTimeout(this.historyPersistTimer);
    this.historyPersistTimer = setTimeout(() => {
      this.persistNow();
      this.historyPersistTimer = null;
    }, HISTORY_PERSIST_DEBOUNCE);
  }

  private persistNow(): void {
    const lastUrls = Array.from(this.tabs.values()).map(e => e.info.navigation.url).filter(u => u && u !== 'about:blank');
    const tabIds = Array.from(this.tabs.keys());
    const activeIdx = tabIds.indexOf(this.activeTabId);
    saveBrowserHistory(this.history, lastUrls, Math.max(0, activeIdx));
  }

  // ─── Settings ────────────────────────────────────────────────────────────

  getSettings(): BrowserSettings { return { ...this.settings }; }

  updateSettings(partial: Partial<BrowserSettings>): void {
    this.settings = { ...this.settings, ...partial };
    saveSettings(this.settings);
    this.emitLog('info', 'Browser settings updated');
    this.syncState();
  }

  // ─── Extensions ──────────────────────────────────────────────────────────

  async loadExtension(extPath: string): Promise<ExtensionInfo | null> {
    if (!this.sessionInstance) return null;
    try {
      const ext = await this.sessionInstance.loadExtension(extPath);
      const info: ExtensionInfo = {
        id: ext.id, name: ext.name, version: ext.version || '0.0.0',
        path: ext.path, enabled: true,
      };
      this.extensions.push(info);
      eventBus.emit(AppEventType.BROWSER_EXTENSION_LOADED, { extension: info });
      this.emitLog('info', `Extension loaded: ${ext.name}`);
      this.syncState();
      return info;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitLog('error', `Failed to load extension: ${msg}`);
      return null;
    }
  }

  async removeExtension(extensionId: string): Promise<void> {
    if (!this.sessionInstance) return;
    try {
      await this.sessionInstance.removeExtension(extensionId);
      this.extensions = this.extensions.filter(e => e.id !== extensionId);
      eventBus.emit(AppEventType.BROWSER_EXTENSION_REMOVED, { extensionId });
      this.emitLog('info', `Extension removed: ${extensionId}`);
      this.syncState();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitLog('error', `Failed to remove extension: ${msg}`);
    }
  }

  getExtensions(): ExtensionInfo[] {
    // Sync with session's actual loaded extensions
    if (this.sessionInstance) {
      const loaded = this.sessionInstance.getAllExtensions();
      this.extensions = loaded.map(e => ({
        id: e.id, name: e.name, version: e.version || '0.0.0',
        path: e.path, enabled: true,
      }));
    }
    return [...this.extensions];
  }

  // ─── Downloads ──────────────────────────────────────────────────────────

  getDownloads(): BrowserDownloadState[] {
    const active = Array.from(this.activeDownloads.values()).map(d => ({ ...d.entry }));
    return [...active, ...this.completedDownloads];
  }

  cancelDownload(downloadId: string): void {
    const dl = this.activeDownloads.get(downloadId);
    if (dl) {
      dl.item.cancel();
      this.activeDownloads.delete(downloadId);
      this.syncState();
    }
  }

  clearDownloads(): void {
    this.completedDownloads = [];
    this.syncState();
  }

  // ─── Bounds ──────────────────────────────────────────────────────────────

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.currentBounds = bounds;
    const entry = this.getActiveEntry();
    if (entry) {
      entry.view.setBounds({
        x: Math.round(bounds.x), y: Math.round(bounds.y),
        width: Math.round(Math.max(1, bounds.width)),
        height: Math.round(Math.max(1, bounds.height)),
      });
    }
  }

  // ─── State ────────────────────────────────────────────────────────────────

  getState(): BrowserState {
    const active = this.getActiveEntry();
    const nav = active ? { ...active.info.navigation } : {
      url: '', title: '', canGoBack: false, canGoForward: false,
      isLoading: false, loadingProgress: null, favicon: '', lastNavigationAt: null,
    };
    const status = active ? active.info.status : 'idle' as BrowserSurfaceStatus;
    return {
      surfaceStatus: status,
      navigation: nav,
      profile: { ...this.profile },
      tabs: this.getTabs(),
      activeTabId: this.activeTabId,
      history: this.getRecentHistory(),
      bookmarks: [...this.bookmarks],
      activeDownloads: Array.from(this.activeDownloads.values()).map(d => ({ ...d.entry })),
      completedDownloads: [...this.completedDownloads],
      recentPermissions: [...this.recentPermissions],
      extensions: [...this.extensions],
      findInPage: { ...this.findState },
      settings: { ...this.settings },
      lastError: this.lastError ? { ...this.lastError } : null,
      createdAt: this.createdAt,
    };
  }

  private syncState(): void {
    const state = this.getState();
    appStateStore.dispatch({ type: ActionType.SET_BROWSER_RUNTIME, browserRuntime: state });
    eventBus.emit(AppEventType.BROWSER_STATE_CHANGED, { state });
    eventBus.emit(AppEventType.BROWSER_STATUS_UPDATED, {
      status: state.surfaceStatus,
      detail: state.navigation.url,
    });
  }

  private syncNavigation(): void {
    const active = this.getActiveEntry();
    if (!active) return;
    const nav = { ...active.info.navigation };
    eventBus.emit(AppEventType.BROWSER_NAVIGATION_UPDATED, { navigation: nav });

    const surfaceMap: Record<BrowserSurfaceStatus, 'idle' | 'running' | 'done' | 'error'> = {
      idle: 'idle', loading: 'running', ready: 'done', error: 'error',
    };
    appStateStore.dispatch({
      type: ActionType.SET_SURFACE_STATUS,
      surface: 'browser',
      status: { status: surfaceMap[active.info.status], lastUpdatedAt: Date.now(), detail: nav.title || nav.url || '' },
    });
    this.syncState();
  }

  isCreated(): boolean { return this.tabs.size > 0; }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.historyPersistTimer) clearTimeout(this.historyPersistTimer);
    this.persistNow();
    flushAll();

    for (const [, entry] of this.tabs) {
      if (this.hostWindow && !this.hostWindow.isDestroyed()) {
        try { this.hostWindow.contentView.removeChildView(entry.view); } catch {}
      }
      entry.view.webContents.close();
    }
    this.tabs.clear();
    this.hostWindow = null;
  }

  private emitLog(level: 'info' | 'warn' | 'error', message: string): void {
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: { id: generateId('log'), timestamp: Date.now(), level, source: 'browser', message },
    });
  }
}

export const browserService = new BrowserService();
