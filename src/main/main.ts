import { app, BrowserWindow } from 'electron';
import { registerIpc } from './ipc/registerIpc';
import { initEventRouter } from './events/eventRouter';
import { createAllWindows, applyLayout, setAppQuitting, showAllWindows } from './windows/windowManager';
import { appStateStore } from './state/appStateStore';

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showAllWindows();
  });
}

app.on('ready', () => {
  registerIpc();
  initEventRouter();
  createAllWindows();

  const state = appStateStore.getState();
  applyLayout(state.layoutPreset);
});

app.on('before-quit', () => {
  setAppQuitting();
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
    const state = appStateStore.getState();
    applyLayout(state.layoutPreset);
  } else {
    showAllWindows();
  }
});
