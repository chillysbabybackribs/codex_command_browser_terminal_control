import { describe, it, expect } from 'vitest';
import {
  targetForKind, summarizePayload,
  BROWSER_ACTION_KINDS, TERMINAL_ACTION_KINDS, ALL_ACTION_KINDS,
} from './surfaceActionTypes';

describe('targetForKind', () => {
  it('maps browser actions to browser target', () => {
    expect(targetForKind('browser.navigate')).toBe('browser');
    expect(targetForKind('browser.back')).toBe('browser');
    expect(targetForKind('browser.create-tab')).toBe('browser');
  });

  it('maps terminal actions to terminal target', () => {
    expect(targetForKind('terminal.execute')).toBe('terminal');
    expect(targetForKind('terminal.write')).toBe('terminal');
    expect(targetForKind('terminal.restart')).toBe('terminal');
  });
});

describe('summarizePayload', () => {
  it('summarizes browser.navigate', () => {
    expect(summarizePayload('browser.navigate', { url: 'https://example.com' }))
      .toBe('Navigate to https://example.com');
  });

  it('summarizes browser.back/forward/reload/stop', () => {
    expect(summarizePayload('browser.back', {})).toBe('Go back');
    expect(summarizePayload('browser.forward', {})).toBe('Go forward');
    expect(summarizePayload('browser.reload', {})).toBe('Reload page');
    expect(summarizePayload('browser.stop', {})).toBe('Stop loading');
  });

  it('summarizes browser.create-tab with and without url', () => {
    expect(summarizePayload('browser.create-tab', { url: 'https://x.com' }))
      .toBe('Open tab: https://x.com');
    expect(summarizePayload('browser.create-tab', {}))
      .toBe('Open new tab');
  });

  it('summarizes browser.close-tab and activate-tab', () => {
    expect(summarizePayload('browser.close-tab', { tabId: 'tab_1' }))
      .toBe('Close tab tab_1');
    expect(summarizePayload('browser.activate-tab', { tabId: 'tab_2' }))
      .toBe('Switch to tab tab_2');
  });

  it('summarizes terminal.execute', () => {
    expect(summarizePayload('terminal.execute', { command: 'ls -la' }))
      .toBe('Execute: ls -la');
  });

  it('summarizes terminal.write', () => {
    expect(summarizePayload('terminal.write', { input: 'hello' }))
      .toBe('Write: hello');
  });

  it('summarizes terminal.restart and interrupt', () => {
    expect(summarizePayload('terminal.restart', {})).toBe('Restart terminal');
    expect(summarizePayload('terminal.interrupt', {})).toBe('Send interrupt (Ctrl+C)');
  });
});

describe('action kind constants', () => {
  it('BROWSER_ACTION_KINDS has 15 entries', () => {
    expect(BROWSER_ACTION_KINDS).toHaveLength(15);
    expect(BROWSER_ACTION_KINDS.every(k => k.startsWith('browser.'))).toBe(true);
  });

  it('TERMINAL_ACTION_KINDS has 4 entries', () => {
    expect(TERMINAL_ACTION_KINDS).toHaveLength(4);
    expect(TERMINAL_ACTION_KINDS.every(k => k.startsWith('terminal.'))).toBe(true);
  });

  it('ALL_ACTION_KINDS is the union', () => {
    expect(ALL_ACTION_KINDS).toHaveLength(19);
    expect(ALL_ACTION_KINDS).toEqual([...BROWSER_ACTION_KINDS, ...TERMINAL_ACTION_KINDS]);
  });
});
