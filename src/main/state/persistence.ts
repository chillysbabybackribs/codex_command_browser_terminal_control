import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { AppState, createDefaultAppState } from '../../shared/types/appState';

const STATE_FILE = 'workspace-state.json';

function getStatePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE);
}

type PersistedState = {
  layoutPreset: AppState['layoutPreset'];
  windows: AppState['windows'];
};

export function loadPersistedState(): Partial<PersistedState> {
  try {
    const filePath = getStatePath();
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as PersistedState;
  } catch {
    return {};
  }
}

export function savePersistedState(state: AppState): void {
  try {
    const persisted: PersistedState = {
      layoutPreset: state.layoutPreset,
      windows: state.windows,
    };
    const filePath = getStatePath();
    fs.writeFileSync(filePath, JSON.stringify(persisted, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist state:', err);
  }
}

export function buildInitialState(): AppState {
  const defaults = createDefaultAppState();
  const persisted = loadPersistedState();
  return {
    ...defaults,
    layoutPreset: persisted.layoutPreset ?? defaults.layoutPreset,
    windows: persisted.windows
      ? { ...defaults.windows, ...persisted.windows }
      : defaults.windows,
  };
}
