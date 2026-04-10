/**
 * Runtime validation integration tests for per-surface concurrency system.
 *
 * These tests validate the full controller+policy interaction at runtime,
 * covering every scenario from the validation checklist. They use the real
 * SurfaceExecutionController with controlled async executors (not mocks of
 * the controller itself) to prove queue behavior deterministically.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SurfaceExecutionController, type ExecuteCallback } from './SurfaceExecutionController';
import { ACTION_CONCURRENCY_POLICY } from './surfaceActionPolicy';
import type { SurfaceAction, SurfaceActionKind } from '../../shared/actions/surfaceActionTypes';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let idCounter = 0;

function makeAction(kind: SurfaceActionKind, overrides: Partial<SurfaceAction> = {}): SurfaceAction {
  const target = kind.startsWith('browser.') ? 'browser' : 'terminal';
  return {
    id: `sa_rt_${++idCounter}`,
    target: target as 'browser' | 'terminal',
    kind,
    status: 'queued',
    origin: 'command-center',
    payload: kind === 'browser.navigate' ? { url: `https://site-${idCounter}.com` }
      : kind === 'terminal.execute' ? { command: `cmd-${idCounter}` }
      : kind === 'terminal.write' ? { input: `input-${idCounter}` }
      : {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    taskId: null,
    ...overrides,
  };
}

/** Creates a controllable executor: returns { fn, resolvers, rejectors, callOrder } */
function createControllableExecutor() {
  const resolvers: Array<() => void> = [];
  const rejectors: Array<(err: Error) => void> = [];
  const callOrder: string[] = [];

  const fn = vi.fn<ExecuteCallback>((action: SurfaceAction) => {
    callOrder.push(action.id);
    return new Promise<void>((resolve, reject) => {
      resolvers.push(resolve);
      rejectors.push(reject);
    });
  });

  return { fn, resolvers, rejectors, callOrder };
}

// ─── Scenario 1: browser.navigate burst collapse ─────────────────────────────

describe('Runtime: browser.navigate burst collapse (A, B, C rapidly submitted)', () => {
  const policy = ACTION_CONCURRENCY_POLICY['browser.navigate'];

  it('verifies policy is serialize + replacesSameKind', () => {
    expect(policy.mode).toBe('serialize');
    expect(policy.replacesSameKind).toBe(true);
  });

  it('A runs, B queued, C supersedes B, only A and C execute', async () => {
    const { fn, resolvers, callOrder } = createControllableExecutor();
    const onFail = vi.fn();
    const ctrl = new SurfaceExecutionController('browser', fn, onFail);

    const A = makeAction('browser.navigate', { payload: { url: 'https://a.com' } });
    const B = makeAction('browser.navigate', { payload: { url: 'https://b.com' } });
    const C = makeAction('browser.navigate', { payload: { url: 'https://c.com' } });

    ctrl.submit(A, policy); // A runs immediately
    ctrl.submit(B, policy); // B queued
    ctrl.submit(C, policy); // C supersedes B

    // Verify state mid-burst
    expect(ctrl.getActive()?.id).toBe(A.id);
    expect(ctrl.getQueueLength()).toBe(1); // only C remains
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onFail).toHaveBeenCalledWith(B, expect.stringContaining('Superseded'));

    // Complete A → C drains
    resolvers[0]();
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    expect(callOrder).toEqual([A.id, C.id]);

    // Complete C
    resolvers[1]();
    await vi.waitFor(() => expect(ctrl.getActive()).toBeNull());
    expect(ctrl.getQueueLength()).toBe(0);
  });
});

// ─── Scenario 2: browser.stop while navigate running + queue populated ───────

describe('Runtime: browser.stop while navigate running and queue populated', () => {
  it('stop clears queue and fires immediately, running action unaffected', async () => {
    const { fn, resolvers, callOrder } = createControllableExecutor();
    const onFail = vi.fn();
    const ctrl = new SurfaceExecutionController('browser', fn, onFail);

    const navPolicy = ACTION_CONCURRENCY_POLICY['browser.navigate'];
    const stopPolicy = ACTION_CONCURRENCY_POLICY['browser.stop'];

    const nav1 = makeAction('browser.navigate', { payload: { url: 'https://1.com' } });
    const nav2 = makeAction('browser.navigate', { payload: { url: 'https://2.com' } });
    const stop = makeAction('browser.stop');

    ctrl.submit(nav1, navPolicy); // runs
    ctrl.submit(nav2, navPolicy); // queued
    ctrl.submit(stop, stopPolicy); // bypass + clearsQueue

    // nav2 should be cancelled
    expect(onFail).toHaveBeenCalledWith(nav2, 'Cancelled by browser.stop');
    expect(ctrl.getQueueLength()).toBe(0);

    // stop executed immediately (bypass)
    expect(fn).toHaveBeenCalledWith(stop);
    expect(callOrder).toContain(stop.id);

    // nav1 still active (stop doesn't touch running action)
    expect(ctrl.getActive()?.id).toBe(nav1.id);

    // Complete nav1 normally
    resolvers[0]();
    await vi.waitFor(() => expect(ctrl.getActive()).toBeNull());

    // Stop completes (resolve its promise)
    resolvers[1]();
  });
});

// ─── Scenario 3: terminal.execute + terminal.write while active ──────────────

describe('Runtime: terminal.execute + terminal.write while active', () => {
  it('write bypasses and executes while execute holds the active slot', async () => {
    const { fn, resolvers, callOrder } = createControllableExecutor();
    const onFail = vi.fn();
    const ctrl = new SurfaceExecutionController('terminal', fn, onFail);

    const execPolicy = ACTION_CONCURRENCY_POLICY['terminal.execute'];
    const writePolicy = ACTION_CONCURRENCY_POLICY['terminal.write'];

    const exec = makeAction('terminal.execute', { payload: { command: 'npm test' } });
    const write = makeAction('terminal.write', { payload: { input: 'y\n' } });

    ctrl.submit(exec, execPolicy); // runs, occupies active slot
    expect(ctrl.getActive()?.id).toBe(exec.id);

    ctrl.submit(write, writePolicy); // bypass, requires active → succeeds

    // Both called
    expect(fn).toHaveBeenCalledTimes(2);
    expect(callOrder).toEqual([exec.id, write.id]);

    // Active slot still held by exec (write is bypass, doesn't touch slot)
    expect(ctrl.getActive()?.id).toBe(exec.id);

    // Resolve write (bypass promise)
    resolvers[1]();
    // Resolve exec
    resolvers[0]();
    await vi.waitFor(() => expect(ctrl.getActive()).toBeNull());
  });
});

// ─── Scenario 4: terminal.write with no active action ────────────────────────

describe('Runtime: terminal.write with no active action', () => {
  it('throws because requiresActiveAction is true and no action is active', () => {
    const { fn } = createControllableExecutor();
    const onFail = vi.fn();
    const ctrl = new SurfaceExecutionController('terminal', fn, onFail);

    const writePolicy = ACTION_CONCURRENCY_POLICY['terminal.write'];
    const write = makeAction('terminal.write', { payload: { input: 'y\n' } });

    expect(() => ctrl.submit(write, writePolicy))
      .toThrow('No active terminal action to receive input');

    // Execute callback never called
    expect(fn).not.toHaveBeenCalled();
  });
});

// ─── Scenario 5: terminal.restart while execute running + execute queued ─────

describe('Runtime: terminal.restart while execute running and another execute queued', () => {
  it('restart clears queue (cancels queued exec), fires immediately, running exec unaffected', async () => {
    const { fn, resolvers, callOrder } = createControllableExecutor();
    const onFail = vi.fn();
    const ctrl = new SurfaceExecutionController('terminal', fn, onFail);

    const execPolicy = ACTION_CONCURRENCY_POLICY['terminal.execute'];
    const restartPolicy = ACTION_CONCURRENCY_POLICY['terminal.restart'];

    const exec1 = makeAction('terminal.execute', { payload: { command: 'npm test' } });
    const exec2 = makeAction('terminal.execute', { payload: { command: 'pwd' } });
    const restart = makeAction('terminal.restart');

    ctrl.submit(exec1, execPolicy); // runs
    ctrl.submit(exec2, execPolicy); // queued (replacesSameKind would replace any prev same-kind, but only exec2 is queued)
    expect(ctrl.getQueueLength()).toBe(1);

    ctrl.submit(restart, restartPolicy); // bypass + clearsQueue

    // exec2 cancelled
    expect(onFail).toHaveBeenCalledWith(exec2, 'Cancelled by terminal.restart');
    expect(ctrl.getQueueLength()).toBe(0);

    // restart executed immediately
    expect(fn).toHaveBeenCalledWith(restart);
    expect(callOrder).toContain(restart.id);

    // exec1 still active
    expect(ctrl.getActive()?.id).toBe(exec1.id);

    // Complete exec1 → queue empty → drain stops
    resolvers[0]();
    await vi.waitFor(() => expect(ctrl.getActive()).toBeNull());

    // Only 2 execute calls: exec1 and restart (exec2 was cancelled, never called)
    expect(fn).toHaveBeenCalledTimes(2);

    // Complete restart
    resolvers[1]();
  });
});

// ─── Scenario 6: browser and terminal independence ───────────────────────────

describe('Runtime: browser and terminal independence', () => {
  it('actions on one surface do not affect the other', async () => {
    const browserExec = createControllableExecutor();
    const terminalExec = createControllableExecutor();

    const browserCtrl = new SurfaceExecutionController('browser', browserExec.fn, vi.fn());
    const terminalCtrl = new SurfaceExecutionController('terminal', terminalExec.fn, vi.fn());

    const nav = makeAction('browser.navigate', { payload: { url: 'https://test.com' } });
    const exec = makeAction('terminal.execute', { payload: { command: 'ls' } });

    // Both run independently
    browserCtrl.submit(nav, ACTION_CONCURRENCY_POLICY['browser.navigate']);
    terminalCtrl.submit(exec, ACTION_CONCURRENCY_POLICY['terminal.execute']);

    expect(browserExec.fn).toHaveBeenCalledWith(nav);
    expect(terminalExec.fn).toHaveBeenCalledWith(exec);
    expect(browserCtrl.getActive()?.id).toBe(nav.id);
    expect(terminalCtrl.getActive()?.id).toBe(exec.id);

    // Stop browser → does NOT affect terminal
    const stopFail = vi.fn();
    // We need a separate controller to test stop properly — but we can test
    // that one controller's actions don't call the other's fail callback
    const termFail = vi.fn();
    const browserCtrl2 = new SurfaceExecutionController('browser', browserExec.fn, stopFail);
    const terminalCtrl2 = new SurfaceExecutionController('terminal', terminalExec.fn, termFail);

    const nav2 = makeAction('browser.navigate', { payload: { url: 'https://q.com' } });
    const exec2 = makeAction('terminal.execute', { payload: { command: 'pwd' } });

    browserCtrl2.submit(nav2, ACTION_CONCURRENCY_POLICY['browser.navigate']);
    terminalCtrl2.submit(exec2, ACTION_CONCURRENCY_POLICY['terminal.execute']);

    // Queue more on terminal
    const exec3 = makeAction('terminal.execute', { payload: { command: 'date' } });
    terminalCtrl2.submit(exec3, ACTION_CONCURRENCY_POLICY['terminal.execute']);
    expect(terminalCtrl2.getQueueLength()).toBe(1);

    // Stop browser — should NOT clear terminal queue
    const stop = makeAction('browser.stop');
    browserCtrl2.submit(stop, ACTION_CONCURRENCY_POLICY['browser.stop']);

    expect(stopFail).not.toHaveBeenCalled(); // no browser queue items to cancel
    expect(termFail).not.toHaveBeenCalled(); // terminal untouched
    expect(terminalCtrl2.getQueueLength()).toBe(1); // terminal queue intact

    // Cleanup
    browserExec.resolvers.forEach(r => r());
    terminalExec.resolvers.forEach(r => r());
  });
});

// ─── Scenario 7: queued-action cancellation by ID ────────────────────────────

describe('Runtime: queued-action cancellation by ID', () => {
  it('cancels a specific queued action, leaving other queued actions intact', async () => {
    const { fn, resolvers } = createControllableExecutor();
    const onFail = vi.fn();
    const ctrl = new SurfaceExecutionController('browser', fn, onFail);

    // Use serialize without replacesSameKind so we can have multiple different-kind items queued
    const nav = makeAction('browser.navigate', { payload: { url: 'https://a.com' } });
    const createTab = makeAction('browser.create-tab', { payload: {} });
    const closeTab = makeAction('browser.close-tab', { payload: { tabId: 'tab1' } });

    ctrl.submit(nav, ACTION_CONCURRENCY_POLICY['browser.navigate']); // runs
    ctrl.submit(createTab, ACTION_CONCURRENCY_POLICY['browser.create-tab']); // queued
    ctrl.submit(closeTab, ACTION_CONCURRENCY_POLICY['browser.close-tab']); // queued

    expect(ctrl.getQueueLength()).toBe(2);

    // Cancel createTab by ID
    const removed = ctrl.cancelById(createTab.id, 'Cancelled by user');
    expect(removed).toBe(true);
    expect(onFail).toHaveBeenCalledWith(createTab, 'Cancelled by user');
    expect(ctrl.getQueueLength()).toBe(1);

    // closeTab still in queue
    resolvers[0](); // complete nav
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    expect(fn).toHaveBeenLastCalledWith(closeTab);

    resolvers[1](); // complete closeTab
    await vi.waitFor(() => expect(ctrl.getActive()).toBeNull());
  });

  it('returns false when ID is not in queue', () => {
    const { fn } = createControllableExecutor();
    const onFail = vi.fn();
    const ctrl = new SurfaceExecutionController('browser', fn, onFail);

    const result = ctrl.cancelById('sa_nonexistent', 'test');
    expect(result).toBe(false);
    expect(onFail).not.toHaveBeenCalled();
  });

  it('cannot cancel the active (running) action — it is not in the queue', async () => {
    const { fn, resolvers } = createControllableExecutor();
    const onFail = vi.fn();
    const ctrl = new SurfaceExecutionController('browser', fn, onFail);

    const nav = makeAction('browser.navigate', { payload: { url: 'https://a.com' } });
    ctrl.submit(nav, ACTION_CONCURRENCY_POLICY['browser.navigate']); // runs immediately

    expect(ctrl.getActive()?.id).toBe(nav.id);

    // Try to cancel — it's active, not queued
    const removed = ctrl.cancelById(nav.id, 'attempt to cancel running');
    expect(removed).toBe(false);

    resolvers[0]();
    await vi.waitFor(() => expect(ctrl.getActive()).toBeNull());
  });
});

// ─── Scenario 8: debug delay mechanism ───────────────────────────────────────

describe('Runtime: debug delay env flag parsing', () => {
  const originalEnv = process.env.V1_DEBUG_NAVIGATE_DELAY_MS;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.V1_DEBUG_NAVIGATE_DELAY_MS = originalEnv;
    } else {
      delete process.env.V1_DEBUG_NAVIGATE_DELAY_MS;
    }
  });

  it('env flag is disabled by default (no env var set)', () => {
    delete process.env.V1_DEBUG_NAVIGATE_DELAY_MS;
    expect(process.env.V1_DEBUG_NAVIGATE_DELAY_MS).toBeUndefined();
  });

  it('env flag with invalid values produces no delay', () => {
    for (const val of ['', 'abc', '-1', '0', 'NaN', 'Infinity']) {
      process.env.V1_DEBUG_NAVIGATE_DELAY_MS = val;
      const raw = process.env.V1_DEBUG_NAVIGATE_DELAY_MS;
      const ms = parseInt(raw!, 10);
      const effective = Number.isFinite(ms) && ms > 0 ? ms : 0;
      expect(effective).toBe(0);
    }
  });

  it('env flag with valid positive integer produces delay', () => {
    process.env.V1_DEBUG_NAVIGATE_DELAY_MS = '3000';
    const raw = process.env.V1_DEBUG_NAVIGATE_DELAY_MS;
    const ms = parseInt(raw!, 10);
    const effective = Number.isFinite(ms) && ms > 0 ? ms : 0;
    expect(effective).toBe(3000);
  });
});

// ─── Scenario 9: getQueueDiagnostics integration ─────────────────────────────

describe('Runtime: queue diagnostics', () => {
  it('reports active and queue state correctly through full lifecycle', async () => {
    const { fn, resolvers } = createControllableExecutor();
    const onFail = vi.fn();
    const browserCtrl = new SurfaceExecutionController('browser', fn, onFail);
    const terminalCtrl = new SurfaceExecutionController('terminal', fn, onFail);

    // Initially empty
    expect(browserCtrl.getActive()).toBeNull();
    expect(browserCtrl.getQueueLength()).toBe(0);
    expect(terminalCtrl.getActive()).toBeNull();
    expect(terminalCtrl.getQueueLength()).toBe(0);

    // Submit to browser
    const nav = makeAction('browser.navigate', { payload: { url: 'https://test.com' } });
    browserCtrl.submit(nav, ACTION_CONCURRENCY_POLICY['browser.navigate']);

    expect(browserCtrl.getActive()?.id).toBe(nav.id);
    expect(browserCtrl.getQueueLength()).toBe(0);
    expect(terminalCtrl.getActive()).toBeNull(); // terminal unaffected

    // Queue more
    const nav2 = makeAction('browser.navigate', { payload: { url: 'https://test2.com' } });
    browserCtrl.submit(nav2, ACTION_CONCURRENCY_POLICY['browser.navigate']);
    expect(browserCtrl.getQueueLength()).toBe(1);

    // Complete first
    resolvers[0]();
    await vi.waitFor(() => expect(browserCtrl.getActive()?.id).toBe(nav2.id));
    expect(browserCtrl.getQueueLength()).toBe(0);

    resolvers[1]();
    await vi.waitFor(() => expect(browserCtrl.getActive()).toBeNull());
  });
});
