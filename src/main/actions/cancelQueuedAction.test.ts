import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────────────
// The router is a singleton that depends on appStateStore, eventBus, and
// executor modules. We mock the heavy dependencies so we can drive the router
// through submit() → cancelQueuedAction() and validate the full flow.

// Persistence — prevent filesystem access
vi.mock('../state/persistence', () => ({
  buildInitialState: () => ({
    tasks: [],
    activeTaskId: null,
    logs: [],
    surfaceActions: [],
    windows: {
      command: { bounds: null, displayId: 0, isFocused: false, isVisible: false },
      execution: { bounds: null, displayId: 0, isFocused: false, isVisible: false },
    },
    executionSplit: { preset: 'balanced', ratio: 0.5 },
    surfaces: { browser: 'idle', terminal: 'idle' },
    terminalSession: null,
    terminalCommand: null,
    browserRuntime: null,
  }),
  savePersistedState: vi.fn(),
}));

// Event bus — stub emit so lifecycle events don't break
vi.mock('../events/eventBus', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

// Browser executor — never actually drives a real browser
vi.mock('./browserActionExecutor', () => ({
  executeBrowserAction: vi.fn(async () => 'mock result'),
}));

// Terminal executor — never actually drives a real terminal
vi.mock('./terminalActionExecutor', () => ({
  executeTerminalAction: vi.fn(async () => 'mock result'),
}));

// Now import the real router (which instantiates controllers internally)
import { surfaceActionRouter } from './SurfaceActionRouter';
import { executeBrowserAction } from './browserActionExecutor';
import type { SurfaceActionRecord } from '../../shared/actions/surfaceActionTypes';

// ─── Helpers ───────────────────────────────────────────────────────────────

async function submitBrowserNav(url: string): Promise<SurfaceActionRecord> {
  return surfaceActionRouter.submit({
    target: 'browser',
    kind: 'browser.navigate',
    payload: { url },
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('SurfaceActionRouter — cancelQueuedAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cancels a queued action and returns a failed record', async () => {
    // Make the first action hang so the second stays queued
    let resolveFirst!: () => void;
    (executeBrowserAction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<string>(r => { resolveFirst = () => r('done'); }),
    );

    const first = await submitBrowserNav('https://a.com');
    const second = await submitBrowserNav('https://b.com');

    expect(first.status).toBe('queued');
    expect(second.status).toBe('queued');

    const cancelled = surfaceActionRouter.cancelQueuedAction(second.id);

    expect(cancelled.status).toBe('failed');
    expect(cancelled.error).toBe('Cancelled by user');
    expect(cancelled.id).toBe(second.id);

    // Clean up
    resolveFirst();
  });

  it('throws for a non-existent action ID', () => {
    expect(() => surfaceActionRouter.cancelQueuedAction('sa_nonexistent'))
      .toThrow('Action sa_nonexistent not found');
  });

  it('throws for a running action', async () => {
    let resolveFirst!: () => void;
    (executeBrowserAction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<string>(r => { resolveFirst = () => r('done'); }),
    );

    const running = await submitBrowserNav('https://a.com');

    // The router submits → controller runs immediately (slot was empty).
    // The state record transitions to 'running' inside executeAction(),
    // but the controller's cancelById returns false for the active action,
    // so the router throws regardless of the state-store status.

    // Wait a tick for the executeAction microtask to fire
    await new Promise<void>(r => setTimeout(r, 10));

    expect(() => surfaceActionRouter.cancelQueuedAction(running.id))
      .toThrow(/running|already running/i);

    resolveFirst();
  });

  it('throws for a completed action', async () => {
    (executeBrowserAction as ReturnType<typeof vi.fn>).mockResolvedValueOnce('done');

    const action = await submitBrowserNav('https://a.com');

    // Let the action complete
    await new Promise<void>(r => setTimeout(r, 10));

    expect(() => surfaceActionRouter.cancelQueuedAction(action.id))
      .toThrow(/completed.*not queued/i);
  });

  it('throws for an already-cancelled (failed) action', async () => {
    let resolveFirst!: () => void;
    (executeBrowserAction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<string>(r => { resolveFirst = () => r('done'); }),
    );

    await submitBrowserNav('https://a.com');
    const second = await submitBrowserNav('https://b.com');

    // Cancel it once — should succeed
    surfaceActionRouter.cancelQueuedAction(second.id);

    // Cancel it again — should throw (status is now 'failed')
    expect(() => surfaceActionRouter.cancelQueuedAction(second.id))
      .toThrow(/failed.*not queued/i);

    resolveFirst();
  });

  it('cancelled action record has correct shape', async () => {
    let resolveFirst!: () => void;
    (executeBrowserAction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<string>(r => { resolveFirst = () => r('done'); }),
    );

    await submitBrowserNav('https://a.com');
    const queued = await submitBrowserNav('https://b.com');
    const cancelled = surfaceActionRouter.cancelQueuedAction(queued.id);

    expect(cancelled).toMatchObject({
      id: queued.id,
      target: 'browser',
      kind: 'browser.navigate',
      status: 'failed',
      error: 'Cancelled by user',
      origin: 'command-center',
      resultSummary: null,
    });
    expect(cancelled.updatedAt).toBeGreaterThanOrEqual(cancelled.createdAt);

    resolveFirst();
  });

  it('does not affect the running action when cancelling a queued one', async () => {
    let resolveFirst!: () => void;
    (executeBrowserAction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<string>(r => { resolveFirst = () => r('done'); }),
    );
    (executeBrowserAction as ReturnType<typeof vi.fn>).mockResolvedValue('done');

    const first = await submitBrowserNav('https://a.com');
    const second = await submitBrowserNav('https://b.com');

    surfaceActionRouter.cancelQueuedAction(second.id);

    // The first action should still be running (or queued→running by now)
    const diag = surfaceActionRouter.getQueueDiagnostics();
    expect(diag.browser.queueLength).toBe(0);
    // The active action is first's ID (it's still running)
    expect(diag.browser.active).toBe(first.id);

    resolveFirst();
  });
});
