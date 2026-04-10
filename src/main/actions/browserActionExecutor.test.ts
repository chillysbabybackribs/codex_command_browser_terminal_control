import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock browserService before importing executor
vi.mock('../browser/BrowserService', () => ({
  browserService: {
    isCreated: vi.fn(() => true),
    navigate: vi.fn(),
    getState: vi.fn(() => ({
      navigation: { url: 'https://example.com', title: 'Example', isLoading: false, canGoBack: false, canGoForward: false },
      tabs: [{ id: 'tab_1' }],
    })),
    getTabs: vi.fn(() => [{ id: 'tab_1' }]),
    getPageText: vi.fn(async () => 'Example page text'),
    getPageMetadata: vi.fn(async () => ({ title: 'Example', url: 'https://example.com', links: 5, inputs: 0, forms: 0, images: 1, h1: ['Example'], description: '' })),
  },
}));

import { executeBrowserAction } from './browserActionExecutor';

describe('browserActionExecutor — debug navigate delay', () => {
  const originalEnv = process.env.V1_DEBUG_NAVIGATE_DELAY_MS;

  beforeEach(() => {
    delete process.env.V1_DEBUG_NAVIGATE_DELAY_MS;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.V1_DEBUG_NAVIGATE_DELAY_MS = originalEnv;
    } else {
      delete process.env.V1_DEBUG_NAVIGATE_DELAY_MS;
    }
  });

  it('completes quickly when env flag is not set', async () => {
    const start = Date.now();
    await executeBrowserAction('browser.navigate', { url: 'https://example.com' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it('completes quickly when env flag is empty string', async () => {
    process.env.V1_DEBUG_NAVIGATE_DELAY_MS = '';
    const start = Date.now();
    await executeBrowserAction('browser.navigate', { url: 'https://example.com' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it('completes quickly when env flag is invalid', async () => {
    process.env.V1_DEBUG_NAVIGATE_DELAY_MS = 'abc';
    const start = Date.now();
    await executeBrowserAction('browser.navigate', { url: 'https://example.com' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it('completes quickly when env flag is zero', async () => {
    process.env.V1_DEBUG_NAVIGATE_DELAY_MS = '0';
    const start = Date.now();
    await executeBrowserAction('browser.navigate', { url: 'https://example.com' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it('completes quickly when env flag is negative', async () => {
    process.env.V1_DEBUG_NAVIGATE_DELAY_MS = '-500';
    const start = Date.now();
    await executeBrowserAction('browser.navigate', { url: 'https://example.com' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it('delays execution when env flag is a positive number', async () => {
    process.env.V1_DEBUG_NAVIGATE_DELAY_MS = '200';
    const start = Date.now();
    await executeBrowserAction('browser.navigate', { url: 'https://example.com' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(180);
    expect(elapsed).toBeLessThan(1000);
  });

  it('returns structured result with summary, data, preview and metadata', async () => {
    const result = await executeBrowserAction('browser.navigate', { url: 'https://test.com' });
    expect(result.summary).toBe('Navigated to https://example.com');
    expect(result.data.url).toBe('https://example.com');
    expect(result.data.title).toBe('Example');
    expect(result.data.isLoading).toBe(false);
    expect(result.data.tabCount).toBe(1);
    expect(result.data.pagePreview).toBe('Example page text');
    expect(result.data.metadata).toBeDefined();
  });
});
