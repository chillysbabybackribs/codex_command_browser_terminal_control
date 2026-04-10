import { describe, it, expect } from 'vitest';
import { createDefaultSettings, createDefaultBrowserState } from './browser';

describe('createDefaultSettings', () => {
  it('returns expected defaults', () => {
    const settings = createDefaultSettings();
    expect(settings.homepage).toBe('https://www.google.com');
    expect(settings.searchEngine).toBe('google');
    expect(settings.defaultZoom).toBe(1.0);
    expect(settings.javascript).toBe(true);
    expect(settings.images).toBe(true);
    expect(settings.popups).toBe(false);
    expect(settings.importChromeCookies).toBeNull();
  });
});

describe('createDefaultBrowserState', () => {
  it('starts idle with no tabs or history', () => {
    const state = createDefaultBrowserState();
    expect(state.surfaceStatus).toBe('idle');
    expect(state.tabs).toEqual([]);
    expect(state.history).toEqual([]);
    expect(state.bookmarks).toEqual([]);
    expect(state.activeTabId).toBe('');
    expect(state.createdAt).toBeNull();
  });

  it('has empty navigation', () => {
    const state = createDefaultBrowserState();
    expect(state.navigation.url).toBe('');
    expect(state.navigation.isLoading).toBe(false);
    expect(state.navigation.canGoBack).toBe(false);
  });

  it('has default settings with importChromeCookies', () => {
    const state = createDefaultBrowserState();
    expect(state.settings.importChromeCookies).toBeNull();
  });
});
