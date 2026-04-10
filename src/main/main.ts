import { app, BrowserWindow } from 'electron';
import { registerIpc } from './ipc/registerIpc';
import { initEventRouter } from './events/eventRouter';
import { createAllWindows, applyDefaultBounds, setAppQuitting, showAllWindows } from './windows/windowManager';
import { appStateStore } from './state/appStateStore';
import { terminalService } from './terminal/TerminalService';
import { browserService } from './browser/BrowserService';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showAllWindows();
  });
}

app.on('ready', () => {
  terminalService.init();
  registerIpc();
  initEventRouter();
  createAllWindows();
  applyDefaultBounds();
});

app.on('before-quit', () => {
  setAppQuitting();
  terminalService.setAppQuitting();
  terminalService.persistNow();
  browserService.dispose();
  terminalService.dispose();
  appStateStore.persistNow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createAllWindows();
    applyDefaultBounds();
  } else {
    showAllWindows();
  }
});
