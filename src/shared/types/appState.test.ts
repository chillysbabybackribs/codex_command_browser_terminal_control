import { describe, it, expect } from 'vitest';
import { createDefaultWindowState, createDefaultAppState, presetToRatio } from './appState';

describe('createDefaultWindowState', () => {
  it('creates state with correct role', () => {
    const state = createDefaultWindowState('command');
    expect(state.role).toBe('command');
  });

  it('starts hidden and unfocused', () => {
    const state = createDefaultWindowState('execution');
    expect(state.isVisible).toBe(false);
    expect(state.isFocused).toBe(false);
  });

  it('has default bounds', () => {
    const state = createDefaultWindowState('command');
    expect(state.bounds).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });
});

describe('createDefaultAppState', () => {
  it('creates state with both window roles', () => {
    const state = createDefaultAppState();
    expect(state.windows.command).toBeDefined();
    expect(state.windows.execution).toBeDefined();
  });

  it('starts with balanced split', () => {
    const state = createDefaultAppState();
    expect(state.executionSplit.preset).toBe('balanced');
    expect(state.executionSplit.ratio).toBe(0.5);
  });

  it('starts with empty tasks and logs', () => {
    const state = createDefaultAppState();
    expect(state.tasks).toEqual([]);
    expect(state.logs).toEqual([]);
    expect(state.activeTaskId).toBeNull();
  });

  it('starts with idle surfaces', () => {
    const state = createDefaultAppState();
    expect(state.browser.status).toBe('idle');
    expect(state.terminal.status).toBe('idle');
  });
});

describe('presetToRatio', () => {
  it('maps balanced to 0.5', () => {
    expect(presetToRatio('balanced')).toBe(0.5);
  });

  it('maps focus-browser to 0.7', () => {
    expect(presetToRatio('focus-browser')).toBe(0.7);
  });

  it('maps focus-terminal to 0.3', () => {
    expect(presetToRatio('focus-terminal')).toBe(0.3);
  });
});
