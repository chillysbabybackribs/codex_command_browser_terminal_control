import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import { WindowRole, WINDOW_ROLES } from '../../shared/types/windowRoles';
import { LayoutPreset, WindowBounds } from '../../shared/types/appState';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { getLayoutBounds } from './layoutPresets';
import { generateId } from '../../shared/utils/ids';

const windows: Map<WindowRole, BrowserWindow> = new Map();
const roleByWebContentsId: Map<number, WindowRole> = new Map();

function getRendererPath(role: WindowRole): string {
  return path.join(__dirname, '..', '..', '..', 'renderer', role, 'index.html');
}

function getPreloadPath(): string {
  return path.join(__dirname, '..', '..', '..', 'preload', 'preload', 'preload.js');
}

function validateBounds(bounds: WindowBounds): WindowBounds {
  const displays = screen.getAllDisplays();
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  const onScreen = displays.some((d) => {
    const wa = d.workArea;
    return centerX >= wa.x && centerX < wa.x + wa.width &&
           centerY >= wa.y && centerY < wa.y + wa.height;
  });

  if (onScreen) return bounds;

  const primary = screen.getPrimaryDisplay();
  const wa = primary.workArea;
  return {
    x: wa.x + Math.floor((wa.width - bounds.width) / 2),
    y: wa.y + Math.floor((wa.height - bounds.height) / 2),
    width: Math.min(bounds.width, wa.width),
    height: Math.min(bounds.height, wa.height),
  };
}

function createRoleWindow(role: WindowRole): BrowserWindow {
  const state = appStateStore.getState();
  const winState = state.windows[role];
  const bounds = validateBounds(winState.bounds);

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 400,
    minHeight: 300,
    title: `V1 Workspace - ${role.charAt(0).toUpperCase() + role.slice(1)}`,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  windows.set(role, win);
  roleByWebContentsId.set(win.webContents.id, role);

  win.loadFile(getRendererPath(role));

  win.once('ready-to-show', () => {
    win.show();
    appStateStore.dispatch({ type: ActionType.SET_WINDOW_VISIBLE, role, isVisible: true });
  });

  // Debounced bounds tracking
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const onBoundsChanged = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const b = win.getBounds();
      const display = screen.getDisplayMatching(b);
      eventBus.emit(AppEventType.WINDOW_BOUNDS_CHANGED, {
        role,
        bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
        displayId: display.id,
      });
      boundsTimer = null;
    }, 300);
  };
  win.on('move', onBoundsChanged);
  win.on('resize', onBoundsChanged);

  win.on('focus', () => {
    eventBus.emit(AppEventType.WINDOW_FOCUSED, { role });
  });

  win.on('blur', () => {
    appStateStore.dispatch({ type: ActionType.SET_WINDOW_FOCUSED, role, isFocused: false });
  });

  // Hide on close instead of destroying (unless app is quitting)
  win.on('close', (e) => {
    if ((global as any).__appQuitting) return;
    e.preventDefault();
    win.hide();
    appStateStore.dispatch({ type: ActionType.SET_WINDOW_VISIBLE, role, isVisible: false });
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level: 'info',
        source: 'system',
        message: `${role} window hidden`,
      },
    });
  });

  return win;
}

export function createAllWindows(): void {
  for (const role of WINDOW_ROLES) {
    createRoleWindow(role);
  }
}

export function getWindowByRole(role: WindowRole): BrowserWindow | undefined {
  const win = windows.get(role);
  return win && !win.isDestroyed() ? win : undefined;
}

export function getRoleByWebContentsId(webContentsId: number): WindowRole | undefined {
  return roleByWebContentsId.get(webContentsId);
}

export function showAllWindows(): void {
  for (const [role, win] of windows) {
    if (!win.isDestroyed()) {
      win.show();
      appStateStore.dispatch({ type: ActionType.SET_WINDOW_VISIBLE, role, isVisible: true });
    }
  }
}

export function focusWindow(role: WindowRole): void {
  const win = windows.get(role);
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }
}

export function applyLayout(preset: LayoutPreset): void {
  const bounds = getLayoutBounds(preset);

  for (const role of WINDOW_ROLES) {
    const win = windows.get(role);
    if (win && !win.isDestroyed()) {
      const b = bounds[role];
      win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    }
  }

  eventBus.emit(AppEventType.WINDOW_LAYOUT_APPLIED, { preset });
  appStateStore.dispatch({
    type: ActionType.ADD_LOG,
    log: {
      id: generateId('log'),
      timestamp: Date.now(),
      level: 'info',
      source: 'system',
      message: `Layout applied: ${preset}`,
    },
  });
}

export function resetLayout(): void {
  applyLayout('default');
  eventBus.emit(AppEventType.WINDOW_LAYOUT_RESET, {});
}

export function setAppQuitting(): void {
  (global as any).__appQuitting = true;
}

export function destroyAllWindows(): void {
  for (const [, win] of windows) {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
  windows.clear();
  roleByWebContentsId.clear();
}
