export {};
declare const Terminal: any;
declare const FitAddon: any;

// ─── DOM ────────────────────────────────────────────────────────────────────
const browserPane = document.getElementById('browserPane')!;
const tabList = document.getElementById('tabList')!;
const btnNewTab = document.getElementById('btnNewTab')!;
const addressInput = document.getElementById('addressInput') as HTMLInputElement;
const btnBack = document.getElementById('btnBack') as HTMLButtonElement;
const btnForward = document.getElementById('btnForward') as HTMLButtonElement;
const btnReload = document.getElementById('btnReload') as HTMLButtonElement;
const btnStop = document.getElementById('btnStop') as HTMLButtonElement;
const btnBookmark = document.getElementById('btnBookmark') as HTMLButtonElement;
const btnZoomIn = document.getElementById('btnZoomIn') as HTMLButtonElement;
const btnZoomOut = document.getElementById('btnZoomOut') as HTMLButtonElement;
const zoomLabel = document.getElementById('zoomLabel')!;
const btnDevTools = document.getElementById('btnDevTools') as HTMLButtonElement;
const btnMenu = document.getElementById('btnMenu') as HTMLButtonElement;
const findBar = document.getElementById('findBar')!;
const findInput = document.getElementById('findInput') as HTMLInputElement;
const findCount = document.getElementById('findCount')!;
const btnFindPrev = document.getElementById('btnFindPrev') as HTMLButtonElement;
const btnFindNext = document.getElementById('btnFindNext') as HTMLButtonElement;
const btnFindClose = document.getElementById('btnFindClose') as HTMLButtonElement;
const dropdownPanel = document.getElementById('dropdownPanel')!;
const dropdownContent = document.getElementById('dropdownContent')!;
const browserSurfaceArea = document.getElementById('browserSurfaceArea')!;
const terminalPane = document.getElementById('terminalPane')!;
const splitter = document.getElementById('splitter')!;
const terminalStatus = document.getElementById('terminalStatus')!;
const terminalMeta = document.getElementById('terminalMeta')!;
const termRestartBtn = document.getElementById('termRestartBtn') as HTMLButtonElement;
const terminalContainer = document.getElementById('terminalContainer')!;
const connectionDot = document.getElementById('connectionDot')!;
const connectionLabel = document.getElementById('connectionLabel')!;
const termSizeLabel = document.getElementById('termSizeLabel')!;
const splitLabel = document.getElementById('splitLabel')!;

// ─── State ──────────────────────────────────────────────────────────────────
let term: any = null;
let fitAddon: any = null;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
let boundsTimer: ReturnType<typeof setTimeout> | null = null;
let currentRatio = 0.5;
let isDragging = false;
let activePanel: string | null = null;
let lastBrowserState: BrowserState | null = null;

function escapeHtml(s: string): string {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}
function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Browser Bounds ─────────────────────────────────────────────────────────
function reportBrowserBounds(): void {
  if (boundsTimer) clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    const rect = browserSurfaceArea.getBoundingClientRect();
    workspaceAPI.browser.reportBounds({
      x: Math.round(rect.left), y: Math.round(rect.top),
      width: Math.round(rect.width), height: Math.round(rect.height),
    });
    boundsTimer = null;
  }, 50);
}

// ─── Tabs ───────────────────────────────────────────────────────────────────
function renderTabs(tabs: any[], activeTabId: string): void {
  tabList.innerHTML = tabs.map(tab => {
    const isActive = tab.id === activeTabId;
    const title = tab.navigation?.title || tab.navigation?.url || 'New Tab';
    const isLoading = tab.status === 'loading';
    const faviconHtml = isLoading
      ? '<span class="tab-loading"></span>'
      : tab.navigation?.favicon
        ? `<img class="tab-favicon" src="${escapeHtml(tab.navigation.favicon)}" onerror="this.style.display='none'">`
        : '';
    return `<div class="browser-tab ${isActive ? 'active' : ''}" data-tab-id="${tab.id}">
      ${faviconHtml}
      <span class="tab-title">${escapeHtml(title.substring(0, 40))}</span>
      <button class="tab-close" data-close-tab="${tab.id}">&#x2715;</button>
    </div>`;
  }).join('');
}

tabList.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;
  const closeId = target.getAttribute('data-close-tab') || target.closest('[data-close-tab]')?.getAttribute('data-close-tab');
  if (closeId) { e.stopPropagation(); workspaceAPI.browser.closeTab(closeId); return; }
  const tabEl = target.closest('.browser-tab') as HTMLElement | null;
  if (tabEl) workspaceAPI.browser.activateTab(tabEl.dataset.tabId!);
});

btnNewTab.addEventListener('click', () => workspaceAPI.browser.createTab());

// ─── Navigation Controls ────────────────────────────────────────────────────
btnBack.addEventListener('click', () => workspaceAPI.browser.goBack());
btnForward.addEventListener('click', () => workspaceAPI.browser.goForward());
btnReload.addEventListener('click', () => workspaceAPI.browser.reload());
btnStop.addEventListener('click', () => workspaceAPI.browser.stop());

addressInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    const url = addressInput.value.trim();
    if (url) { workspaceAPI.browser.navigate(url); addressInput.blur(); }
  }
});
addressInput.addEventListener('focus', () => requestAnimationFrame(() => addressInput.select()));

// Bookmark
btnBookmark.addEventListener('click', () => {
  if (!lastBrowserState) return;
  const nav = lastBrowserState.navigation;
  if (nav.url) workspaceAPI.browser.addBookmark(nav.url, nav.title || nav.url);
});

// Zoom
btnZoomIn.addEventListener('click', () => workspaceAPI.browser.zoomIn());
btnZoomOut.addEventListener('click', () => workspaceAPI.browser.zoomOut());
zoomLabel.addEventListener('click', () => workspaceAPI.browser.zoomReset());

// DevTools
btnDevTools.addEventListener('click', () => workspaceAPI.browser.toggleDevTools());

// ─── Find Bar ───────────────────────────────────────────────────────────────
function showFindBar(): void {
  findBar.style.display = 'flex';
  findInput.focus();
  reportBrowserBounds();
}
function hideFindBar(): void {
  findBar.style.display = 'none';
  workspaceAPI.browser.stopFind();
  findInput.value = '';
  findCount.textContent = '0/0';
  reportBrowserBounds();
}

findInput.addEventListener('input', () => {
  const q = findInput.value;
  if (q) workspaceAPI.browser.findInPage(q);
  else workspaceAPI.browser.stopFind();
});
findInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') { e.shiftKey ? workspaceAPI.browser.findPrevious() : workspaceAPI.browser.findNext(); }
  if (e.key === 'Escape') hideFindBar();
});
btnFindNext.addEventListener('click', () => workspaceAPI.browser.findNext());
btnFindPrev.addEventListener('click', () => workspaceAPI.browser.findPrevious());
btnFindClose.addEventListener('click', () => hideFindBar());

workspaceAPI.browser.onFindUpdate((find: { activeMatch: number; totalMatches: number }) => {
  findCount.textContent = `${find.activeMatch}/${find.totalMatches}`;
});

// ─── Menu / Dropdown Panel ──────────────────────────────────────────────────
btnMenu.addEventListener('click', () => {
  if (dropdownPanel.style.display === 'none') {
    openPanel('history');
  } else {
    closePanel();
  }
});

function openPanel(panel: string): void {
  activePanel = panel;
  dropdownPanel.style.display = 'flex';
  // Update tab active state
  dropdownPanel.querySelectorAll('.dropdown-tab').forEach(t => {
    (t as HTMLElement).classList.toggle('active', (t as HTMLElement).dataset.panel === panel);
  });
  renderPanel(panel);
  reportBrowserBounds();
}

function closePanel(): void {
  activePanel = null;
  dropdownPanel.style.display = 'none';
  reportBrowserBounds();
}

dropdownPanel.querySelector('.dropdown-tabs')!.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;
  if (target.dataset.panel) openPanel(target.dataset.panel);
});

function renderPanel(panel: string): void {
  if (!lastBrowserState) { dropdownContent.innerHTML = '<div class="panel-empty">Loading...</div>'; return; }
  const bs = lastBrowserState;

  if (panel === 'history') {
    const items = [...bs.history].reverse().slice(0, 100);
    if (items.length === 0) { dropdownContent.innerHTML = '<div class="panel-empty">No history</div>'; return; }
    dropdownContent.innerHTML = items.map(h => `
      <div class="panel-item" data-nav-url="${escapeHtml(h.url)}">
        ${h.favicon ? `<img class="item-favicon" src="${escapeHtml(h.favicon)}" onerror="this.style.display='none'">` : '<span class="item-favicon"></span>'}
        <span class="item-title">${escapeHtml(h.title)}</span>
        <span class="item-time">${formatDate(h.visitedAt)} ${formatTime(h.visitedAt)}</span>
      </div>
    `).join('');
  } else if (panel === 'bookmarks') {
    if (bs.bookmarks.length === 0) { dropdownContent.innerHTML = '<div class="panel-empty">No bookmarks</div>'; return; }
    dropdownContent.innerHTML = bs.bookmarks.map(b => `
      <div class="panel-item" data-nav-url="${escapeHtml(b.url)}">
        ${b.favicon ? `<img class="item-favicon" src="${escapeHtml(b.favicon)}" onerror="this.style.display='none'">` : '<span class="item-favicon"></span>'}
        <span class="item-title">${escapeHtml(b.title)}</span>
        <span class="item-url">${escapeHtml(b.url)}</span>
        <button class="item-action" data-remove-bookmark="${b.id}">&#x2715;</button>
      </div>
    `).join('');
  } else if (panel === 'downloads') {
    const all = [...bs.activeDownloads, ...bs.completedDownloads];
    if (all.length === 0) { dropdownContent.innerHTML = '<div class="panel-empty">No downloads</div>'; return; }
    dropdownContent.innerHTML = all.map(d => {
      const pct = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0;
      const sizeStr = d.totalBytes > 0 ? `${(d.receivedBytes / 1048576).toFixed(1)} / ${(d.totalBytes / 1048576).toFixed(1)} MB` : '';
      return `<div class="panel-item">
        <span class="item-title">${escapeHtml(d.filename)}</span>
        ${d.state === 'progressing' ? `<div class="panel-dl-progress"><div class="panel-dl-progress-fill" style="width:${pct}%"></div></div><span class="item-time">${pct}%</span>` : `<span class="item-time">${d.state}</span>`}
        ${d.state === 'progressing' ? `<button class="item-action" data-cancel-download="${d.id}">&#x2715;</button>` : ''}
        <span class="item-url">${sizeStr}</span>
      </div>`;
    }).join('');
  } else if (panel === 'extensions') {
    dropdownContent.innerHTML = bs.extensions.map(e => `
      <div class="ext-item">
        <span class="ext-name">${escapeHtml(e.name)}</span>
        <span class="ext-version">v${escapeHtml(e.version)}</span>
        <button class="item-action" data-remove-extension="${e.id}">&#x2715;</button>
      </div>
    `).join('') + `
      <div class="ext-load-row">
        <input type="text" class="ext-load-input" id="extPathInput" placeholder="Extension path...">
        <button class="ext-load-btn" id="btnLoadExt">Load</button>
      </div>
    `;
    if (bs.extensions.length === 0) {
      dropdownContent.insertAdjacentHTML('afterbegin', '<div class="panel-empty">No extensions loaded</div>');
    }
  } else if (panel === 'settings') {
    const s = bs.settings;
    dropdownContent.innerHTML = `
      <div class="settings-group">
        <div class="settings-label">General</div>
        <div class="settings-row"><label>Homepage</label><input type="text" id="settingsHomepage" value="${escapeHtml(s.homepage)}" style="width:200px"></div>
        <div class="settings-row"><label>Search Engine</label><select id="settingsSearchEngine">
          <option value="google" ${s.searchEngine === 'google' ? 'selected' : ''}>Google</option>
          <option value="duckduckgo" ${s.searchEngine === 'duckduckgo' ? 'selected' : ''}>DuckDuckGo</option>
          <option value="bing" ${s.searchEngine === 'bing' ? 'selected' : ''}>Bing</option>
        </select></div>
        <div class="settings-row"><label>Default Zoom</label><span>${Math.round(s.defaultZoom * 100)}%</span></div>
      </div>
      <div class="settings-group">
        <div class="settings-label">Content</div>
        <div class="settings-row"><label>JavaScript</label><button class="settings-toggle ${s.javascript ? 'on' : ''}" data-setting="javascript"></button></div>
        <div class="settings-row"><label>Images</label><button class="settings-toggle ${s.images ? 'on' : ''}" data-setting="images"></button></div>
        <div class="settings-row"><label>Pop-ups</label><button class="settings-toggle ${s.popups ? 'on' : ''}" data-setting="popups"></button></div>
      </div>
      <div class="settings-group">
        <div class="settings-label">Data</div>
        <div class="settings-row"><button class="ext-load-btn" id="btnClearHistory">Clear History</button><button class="ext-load-btn" id="btnClearData">Clear All Data</button></div>
      </div>
    `;
  }
}

// Delegated click handler for panel actions
dropdownContent.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement;

  // Navigate to URL
  const navItem = target.closest('[data-nav-url]') as HTMLElement | null;
  if (navItem && !target.hasAttribute('data-remove-bookmark')) {
    workspaceAPI.browser.navigate(navItem.dataset.navUrl!);
    closePanel();
    return;
  }

  // Remove bookmark
  const rmBm = target.getAttribute('data-remove-bookmark');
  if (rmBm) { workspaceAPI.browser.removeBookmark(rmBm); return; }

  // Cancel download
  const cancelDl = target.getAttribute('data-cancel-download');
  if (cancelDl) { workspaceAPI.browser.cancelDownload(cancelDl); return; }

  // Remove extension
  const rmExt = target.getAttribute('data-remove-extension');
  if (rmExt) { workspaceAPI.browser.removeExtension(rmExt); return; }

  // Load extension
  if (target.id === 'btnLoadExt') {
    const input = document.getElementById('extPathInput') as HTMLInputElement;
    if (input && input.value.trim()) {
      workspaceAPI.browser.loadExtension(input.value.trim());
      input.value = '';
    }
    return;
  }

  // Settings toggles
  const settingKey = target.getAttribute('data-setting');
  if (settingKey && lastBrowserState) {
    const current = (lastBrowserState.settings as any)[settingKey];
    workspaceAPI.browser.updateSettings({ [settingKey]: !current });
    return;
  }

  // Clear buttons
  if (target.id === 'btnClearHistory') { workspaceAPI.browser.clearHistory(); return; }
  if (target.id === 'btnClearData') { workspaceAPI.browser.clearData(); return; }
});

// Settings text inputs
dropdownContent.addEventListener('change', (e: Event) => {
  const target = e.target as HTMLElement;
  if (target.id === 'settingsHomepage') {
    workspaceAPI.browser.updateSettings({ homepage: (target as HTMLInputElement).value });
  }
  if (target.id === 'settingsSearchEngine') {
    workspaceAPI.browser.updateSettings({ searchEngine: (target as HTMLSelectElement).value as any });
  }
});

// ─── Browser State Updates ──────────────────────────────────────────────────
function updateBrowserState(state: BrowserState): void {
  lastBrowserState = state;
  renderTabs(state.tabs, state.activeTabId);

  const nav = state.navigation;
  if (document.activeElement !== addressInput) addressInput.value = nav.url;
  btnBack.disabled = !nav.canGoBack;
  btnForward.disabled = !nav.canGoForward;

  if (nav.isLoading) {
    btnReload.style.display = 'none'; btnStop.style.display = '';
  } else {
    btnReload.style.display = ''; btnStop.style.display = 'none';
  }

  // Zoom
  const activeTab = state.tabs.find(t => t.id === state.activeTabId);
  const zoom = activeTab ? activeTab.zoomLevel : 1;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;

  // Bookmark indicator
  const isBookmarked = state.bookmarks.some(b => b.url === nav.url);
  btnBookmark.textContent = isBookmarked ? '\u2605' : '\u2606';
  btnBookmark.title = isBookmarked ? 'Bookmarked' : 'Bookmark this page';

  // Re-render active panel if open
  if (activePanel) renderPanel(activePanel);
}

workspaceAPI.browser.onNavUpdate((nav: BrowserNavigationState) => {
  if (!lastBrowserState) return;
  lastBrowserState.navigation = nav;
  if (document.activeElement !== addressInput) addressInput.value = nav.url;
  btnBack.disabled = !nav.canGoBack;
  btnForward.disabled = !nav.canGoForward;
  if (nav.isLoading) { btnReload.style.display = 'none'; btnStop.style.display = ''; }
  else { btnReload.style.display = ''; btnStop.style.display = 'none'; }
});

workspaceAPI.browser.onStateUpdate((state: BrowserState) => { updateBrowserState(state); });

// ─── Split Management ──────────────────────────────────────────────────────
function applySplitRatio(ratio: number): void {
  currentRatio = Math.max(0.15, Math.min(0.85, ratio));
  const shell = browserPane.parentElement!;
  const totalWidth = shell.getBoundingClientRect().width - 5;
  const browserWidth = Math.round(totalWidth * currentRatio);
  const terminalWidth = totalWidth - browserWidth;
  browserPane.style.width = `${browserWidth}px`;
  terminalPane.style.width = `${terminalWidth}px`;
  splitLabel.textContent = `Split: ${Math.round(currentRatio * 100)}/${Math.round((1 - currentRatio) * 100)}`;
  requestAnimationFrame(() => { scheduleFit(); reportBrowserBounds(); });
}

window.addEventListener('resize', () => applySplitRatio(currentRatio));

function initSplitter(): void {
  let startX = 0, startRatio = 0, shellWidth = 0;
  const onMouseMove = (e: MouseEvent) => { if (!isDragging) return; applySplitRatio(startRatio + (e.clientX - startX) / shellWidth); };
  const onMouseUp = () => { if (!isDragging) return; isDragging = false; splitter.classList.remove('active'); document.body.style.cursor = ''; document.body.style.userSelect = ''; document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); workspaceAPI.setSplitRatio(currentRatio); };
  splitter.addEventListener('mousedown', (e: MouseEvent) => { e.preventDefault(); isDragging = true; startX = e.clientX; startRatio = currentRatio; shellWidth = browserPane.parentElement!.getBoundingClientRect().width - 5; splitter.classList.add('active'); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp); });
}

// ─── Terminal ──────────────────────────────────────────────────────────────
function initTerminal(): void {
  term = new Terminal({
    theme: { background: '#000000', foreground: '#ededed', cursor: '#ffffff', cursorAccent: '#000000', selectionBackground: 'rgba(255,255,255,0.12)', selectionForeground: '#ffffff', black: '#000000', red: '#ee4444', green: '#00d47b', yellow: '#ff9500', blue: '#3b82f6', magenta: '#a78bfa', cyan: '#22d3ee', white: '#ededed', brightBlack: '#555555', brightRed: '#ff6b6b', brightGreen: '#34d399', brightYellow: '#fbbf24', brightBlue: '#60a5fa', brightMagenta: '#c4b5fd', brightCyan: '#67e8f9', brightWhite: '#ffffff' },
    fontFamily: "'Geist Mono', 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
    fontSize: 13, lineHeight: 1.35, cursorBlink: true, cursorStyle: 'bar', allowTransparency: false, scrollback: 5000,
  });
  fitAddon = new FitAddon.FitAddon(); term.loadAddon(fitAddon); term.open(terminalContainer);
  requestAnimationFrame(() => fitTerminal());
  term.onData((data: string) => workspaceAPI.terminal.write(data));
  workspaceAPI.terminal.onOutput((data: string) => term.write(data));
  workspaceAPI.terminal.onStatus((session: TerminalSessionInfo) => updateTerminalMeta(session));
  workspaceAPI.terminal.onExit((exitCode: number) => { terminalStatus.textContent = `Exited (${exitCode})`; connectionDot.className = 'status-dot error'; connectionLabel.textContent = 'Disconnected'; });
  new ResizeObserver(() => scheduleFit()).observe(terminalContainer);
}

function scheduleFit(): void { if (resizeTimer) clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { fitTerminal(); resizeTimer = null; }, 80); }
function fitTerminal(): void {
  if (!fitAddon || !term) return;
  try { fitAddon.fit(); const dims = fitAddon.proposeDimensions(); if (dims && dims.cols > 0 && dims.rows > 0) { workspaceAPI.terminal.resize(dims.cols, dims.rows); termSizeLabel.textContent = `${dims.cols}x${dims.rows}`; } } catch {}
}
function updateTerminalMeta(session: TerminalSessionInfo): void {
  const m: Record<string, string> = { idle: 'Idle', starting: 'Starting', running: 'Running', exited: 'Exited', error: 'Error' };
  terminalStatus.textContent = m[session.status] || session.status;
  const p: string[] = []; if (session.shell) p.push(session.shell.split('/').pop() || session.shell); if (session.pid) p.push(`PID ${session.pid}`);
  if (session.persistent) p.push('tmux');
  else p.push('no persistence');
  terminalMeta.textContent = p.join(' | ');
  if (session.status === 'running') { connectionDot.className = 'status-dot done'; connectionLabel.textContent = session.restored ? 'Reconnected' : 'Connected'; }
}
termRestartBtn.addEventListener('click', async () => { termRestartBtn.disabled = true; try { const s = await workspaceAPI.terminal.restart(); updateTerminalMeta(s); term?.clear(); } finally { termRestartBtn.disabled = false; } });

// ─── State Sync ────────────────────────────────────────────────────────────
function renderState(state: any): void {
  if (state.terminalSession?.session) updateTerminalMeta(state.terminalSession.session);
  if (state.executionSplit) { const r = state.executionSplit.ratio; if (!isDragging && Math.abs(r - currentRatio) > 0.01) applySplitRatio(r); }
  if (state.browserRuntime) updateBrowserState(state.browserRuntime);
}
workspaceAPI.onStateUpdate((state: any) => renderState(state));

// ─── Keyboard Shortcuts ────────────────────────────────────────────────────
document.addEventListener('keydown', (e: KeyboardEvent) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'l') { e.preventDefault(); addressInput.focus(); addressInput.select(); }
  if (mod && e.key === 't') { e.preventDefault(); workspaceAPI.browser.createTab(); }
  if (mod && e.key === 'w') { e.preventDefault(); if (lastBrowserState) workspaceAPI.browser.closeTab(lastBrowserState.activeTabId); }
  if (mod && e.key === 'f') { e.preventDefault(); showFindBar(); }
  if (mod && e.key === '=') { e.preventDefault(); workspaceAPI.browser.zoomIn(); }
  if (mod && e.key === '-') { e.preventDefault(); workspaceAPI.browser.zoomOut(); }
  if (mod && e.key === '0') { e.preventDefault(); workspaceAPI.browser.zoomReset(); }
  if (mod && e.key === 'd') { e.preventDefault(); if (lastBrowserState) workspaceAPI.browser.addBookmark(lastBrowserState.navigation.url, lastBrowserState.navigation.title); }
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); workspaceAPI.browser.goBack(); }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); workspaceAPI.browser.goForward(); }
  if (e.key === 'F5') { e.preventDefault(); workspaceAPI.browser.reload(); }
  if (e.key === 'F12') { e.preventDefault(); workspaceAPI.browser.toggleDevTools(); }
  if (e.key === 'Escape') { if (findBar.style.display !== 'none') hideFindBar(); if (activePanel) closePanel(); }
});

// ─── Init ───────────────────────────────────────────────────────────────────
function initBrowserBoundsObserver(): void {
  new ResizeObserver(() => reportBrowserBounds()).observe(browserSurfaceArea);
  window.addEventListener('resize', () => reportBrowserBounds());
}

async function init(): Promise<void> {
  initSplitter(); initTerminal(); initBrowserBoundsObserver();
  const state = await workspaceAPI.getState();
  if (state.executionSplit) applySplitRatio(state.executionSplit.ratio); else applySplitRatio(0.5);
  renderState(state);
  const bs = await workspaceAPI.browser.getState();
  updateBrowserState(bs);
  requestAnimationFrame(() => reportBrowserBounds());

  const existing = await workspaceAPI.terminal.getSession();
  if (existing && existing.status === 'running') {
    updateTerminalMeta(existing);
    if (existing.restored) {
      connectionDot.className = 'status-dot running';
      connectionLabel.textContent = 'Reconnecting...';
      try {
        const scrollback = await workspaceAPI.terminal.captureScrollback();
        if (scrollback) {
          term.write(scrollback);
        }
      } catch {
        // scrollback capture failed — continue without it
      }
      connectionDot.className = 'status-dot done';
      connectionLabel.textContent = 'Reconnected';
    }
  } else {
    const s = await workspaceAPI.terminal.startSession();
    updateTerminalMeta(s);
  }
  workspaceAPI.addLog('info', 'system', 'Execution window initialized');
}
init();
