import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SurfaceExecutionController, type ExecuteCallback } from './SurfaceExecutionController';
import type { SurfaceAction } from '../../shared/actions/surfaceActionTypes';
import type { ActionConcurrencyPolicy } from './surfaceActionPolicy';

type MockExecute = ReturnType<typeof vi.fn<ExecuteCallback>>;
type MockFail = ReturnType<typeof vi.fn<(action: SurfaceAction, err: unknown) => void>>;

function makeAction(overrides: Partial<SurfaceAction> = {}): SurfaceAction {
  return {
    id: `sa_test_${Math.random().toString(36).slice(2, 8)}`,
    target: 'browser',
    kind: 'browser.navigate',
    status: 'queued',
    origin: 'command-center',
    payload: { url: 'https://example.com' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    taskId: null,
    ...overrides,
  };
}

const SERIALIZE: ActionConcurrencyPolicy = { mode: 'serialize' };

describe('SurfaceExecutionController — serialize', () => {
  let executeFn: MockExecute;
  let onFail: MockFail;
  let controller: SurfaceExecutionController;

  beforeEach(() => {
    executeFn = vi.fn<ExecuteCallback>();
    onFail = vi.fn<(action: SurfaceAction, err: unknown) => void>();
    controller = new SurfaceExecutionController('browser', executeFn, onFail);
  });

  it('executes the first submitted action immediately', async () => {
    executeFn.mockResolvedValueOnce(undefined);
    const action = makeAction();

    controller.submit(action, SERIALIZE);

    expect(executeFn).toHaveBeenCalledTimes(1);
    expect(executeFn).toHaveBeenCalledWith(action);
  });

  it('queues second action while first is running', async () => {
    let resolveFirst!: () => void;
    executeFn.mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }));
    executeFn.mockResolvedValueOnce(undefined);

    const a1 = makeAction({ id: 'sa_1' });
    const a2 = makeAction({ id: 'sa_2' });

    controller.submit(a1, SERIALIZE);
    controller.submit(a2, SERIALIZE);

    // Only a1 should be executing
    expect(executeFn).toHaveBeenCalledTimes(1);
    expect(executeFn).toHaveBeenCalledWith(a1);

    // Complete a1 — a2 should drain
    resolveFirst();
    await vi.waitFor(() => expect(executeFn).toHaveBeenCalledTimes(2));
    expect(executeFn).toHaveBeenCalledWith(a2);
  });

  it('executes three actions in FIFO order', async () => {
    const order: string[] = [];
    executeFn.mockImplementation(async (action: SurfaceAction) => {
      order.push(action.id);
    });

    const a1 = makeAction({ id: 'sa_1' });
    const a2 = makeAction({ id: 'sa_2' });
    const a3 = makeAction({ id: 'sa_3' });

    controller.submit(a1, SERIALIZE);
    // a1 resolves synchronously in this mock, so slot clears immediately
    await vi.waitFor(() => expect(executeFn).toHaveBeenCalledTimes(1));

    controller.submit(a2, SERIALIZE);
    await vi.waitFor(() => expect(executeFn).toHaveBeenCalledTimes(2));

    controller.submit(a3, SERIALIZE);
    await vi.waitFor(() => expect(executeFn).toHaveBeenCalledTimes(3));

    expect(order).toEqual(['sa_1', 'sa_2', 'sa_3']);
  });

  it('drains after a failed action', async () => {
    executeFn.mockRejectedValueOnce(new Error('boom'));
    executeFn.mockResolvedValueOnce(undefined);

    const a1 = makeAction({ id: 'sa_1' });
    const a2 = makeAction({ id: 'sa_2' });

    controller.submit(a1, SERIALIZE);
    controller.submit(a2, SERIALIZE);

    await vi.waitFor(() => expect(executeFn).toHaveBeenCalledTimes(2));
    expect(executeFn).toHaveBeenCalledWith(a2);
  });

  it('drain with empty queue is a no-op', () => {
    executeFn.mockResolvedValueOnce(undefined);
    const a1 = makeAction();

    controller.submit(a1, SERIALIZE);

    // Only one call — no spurious drain
    expect(executeFn).toHaveBeenCalledTimes(1);
  });
});

const BYPASS: ActionConcurrencyPolicy = { mode: 'bypass' };

describe('SurfaceExecutionController — bypass', () => {
  let executeFn: MockExecute;
  let onFail: MockFail;
  let controller: SurfaceExecutionController;

  beforeEach(() => {
    executeFn = vi.fn<ExecuteCallback>();
    onFail = vi.fn<(action: SurfaceAction, err: unknown) => void>();
    controller = new SurfaceExecutionController('browser', executeFn, onFail);
  });

  it('bypass action executes immediately even with a serialized action running', async () => {
    let resolveFirst!: () => void;
    executeFn.mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }));
    executeFn.mockResolvedValueOnce(undefined);

    const serialized = makeAction({ id: 'sa_serial', kind: 'browser.navigate' });
    const bypass = makeAction({ id: 'sa_bypass', kind: 'browser.stop' });

    controller.submit(serialized, SERIALIZE);
    controller.submit(bypass, BYPASS);

    // Both should have been called
    expect(executeFn).toHaveBeenCalledTimes(2);
    expect(executeFn).toHaveBeenCalledWith(bypass);

    resolveFirst();
  });

  it('bypass action does not occupy the active slot', async () => {
    let resolveBypass!: () => void;
    executeFn.mockImplementationOnce(() => new Promise<void>(r => { resolveBypass = r; }));

    const bypass = makeAction({ id: 'sa_bypass', kind: 'browser.stop' });
    controller.submit(bypass, BYPASS);

    // Active slot should remain null (bypass doesn't occupy it)
    expect(controller.getActive()).toBeNull();

    resolveBypass();
  });

  it('bypass action does not affect queue drain', async () => {
    executeFn.mockResolvedValue(undefined);

    const a1 = makeAction({ id: 'sa_1', kind: 'browser.navigate' });
    const bypass = makeAction({ id: 'sa_bypass', kind: 'browser.stop' });
    const a2 = makeAction({ id: 'sa_2', kind: 'browser.navigate' });

    controller.submit(a1, SERIALIZE);
    await vi.waitFor(() => expect(executeFn).toHaveBeenCalledWith(a1));

    controller.submit(a2, SERIALIZE);
    controller.submit(bypass, BYPASS);

    await vi.waitFor(() => expect(executeFn).toHaveBeenCalledTimes(3));

    // bypass was called but queue still drains a2 after a1
    const callArgs = executeFn.mock.calls.map((c) => c[0].id);
    expect(callArgs).toContain('sa_bypass');
    expect(callArgs).toContain('sa_2');
  });
});

const SERIALIZE_REPLACE: ActionConcurrencyPolicy = { mode: 'serialize', replacesSameKind: true };

describe('SurfaceExecutionController — replacesSameKind', () => {
  let executeFn: MockExecute;
  let onFail: MockFail;
  let controller: SurfaceExecutionController;

  beforeEach(() => {
    executeFn = vi.fn<ExecuteCallback>();
    onFail = vi.fn<(action: SurfaceAction, err: unknown) => void>();
    controller = new SurfaceExecutionController('browser', executeFn, onFail);
  });

  it('supersedes queued action of same kind', async () => {
    let resolveFirst!: () => void;
    executeFn.mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }));
    executeFn.mockResolvedValueOnce(undefined);

    const a1 = makeAction({ id: 'sa_1', kind: 'browser.navigate' });
    const a2 = makeAction({ id: 'sa_2', kind: 'browser.navigate' });
    const a3 = makeAction({ id: 'sa_3', kind: 'browser.navigate' });

    controller.submit(a1, SERIALIZE_REPLACE); // runs immediately
    controller.submit(a2, SERIALIZE_REPLACE); // queued
    controller.submit(a3, SERIALIZE_REPLACE); // replaces a2

    // a2 should have been failed via onPolicyFail
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onFail).toHaveBeenCalledWith(a2, 'Superseded by newer browser.navigate');

    // Queue should have only a3
    expect(controller.getQueueLength()).toBe(1);

    // Complete a1 — a3 should drain (not a2)
    resolveFirst();
    await vi.waitFor(() => expect(executeFn).toHaveBeenCalledTimes(2));
    expect(executeFn).toHaveBeenCalledWith(a3);
  });

  it('does not supersede running action', async () => {
    let resolveFirst!: () => void;
    executeFn.mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }));
    executeFn.mockResolvedValueOnce(undefined);

    const a1 = makeAction({ id: 'sa_1', kind: 'browser.navigate' });
    const a2 = makeAction({ id: 'sa_2', kind: 'browser.navigate' });

    controller.submit(a1, SERIALIZE_REPLACE); // runs
    controller.submit(a2, SERIALIZE_REPLACE); // queued (a1 is running, not queued)

    // a1 should NOT be failed — it's running
    expect(onFail).not.toHaveBeenCalled();
    expect(controller.getActive()?.id).toBe('sa_1');

    resolveFirst();
    await vi.waitFor(() => expect(executeFn).toHaveBeenCalledTimes(2));
  });

  it('does not supersede queued actions of different kind', async () => {
    let resolveFirst!: () => void;
    executeFn.mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }));
    executeFn.mockResolvedValue(undefined);

    const a1 = makeAction({ id: 'sa_1', kind: 'browser.navigate' });
    const a2 = makeAction({ id: 'sa_2', kind: 'browser.create-tab' });
    const a3 = makeAction({ id: 'sa_3', kind: 'browser.navigate' });

    controller.submit(a1, SERIALIZE_REPLACE);       // runs
    controller.submit(a2, { mode: 'serialize' });    // queued (different kind)
    controller.submit(a3, SERIALIZE_REPLACE);         // queued — does NOT replace a2

    expect(onFail).not.toHaveBeenCalled();
    expect(controller.getQueueLength()).toBe(2);

    resolveFirst();
  });
});

const BYPASS_CLEAR: ActionConcurrencyPolicy = { mode: 'bypass', clearsQueue: true };

describe('SurfaceExecutionController — clearsQueue', () => {
  let executeFn: MockExecute;
  let onFail: MockFail;
  let controller: SurfaceExecutionController;

  beforeEach(() => {
    executeFn = vi.fn<ExecuteCallback>();
    onFail = vi.fn<(action: SurfaceAction, err: unknown) => void>();
    controller = new SurfaceExecutionController('browser', executeFn, onFail);
  });

  it('cancels all queued actions and executes immediately', async () => {
    let resolveFirst!: () => void;
    executeFn.mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }));
    executeFn.mockResolvedValue(undefined);

    const a1 = makeAction({ id: 'sa_1', kind: 'browser.navigate' });
    const a2 = makeAction({ id: 'sa_2', kind: 'browser.reload' });
    const stop = makeAction({ id: 'sa_stop', kind: 'browser.stop' });

    controller.submit(a1, SERIALIZE);  // runs
    controller.submit(a2, SERIALIZE);  // queued

    controller.submit(stop, BYPASS_CLEAR);

    // a2 should have been cancelled
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onFail).toHaveBeenCalledWith(a2, 'Cancelled by browser.stop');

    // Queue should be empty
    expect(controller.getQueueLength()).toBe(0);

    // stop should have executed immediately (bypass)
    expect(executeFn).toHaveBeenCalledWith(stop);

    resolveFirst();
  });

  it('does not touch the running action', async () => {
    let resolveFirst!: () => void;
    executeFn.mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }));
    executeFn.mockResolvedValue(undefined);

    const a1 = makeAction({ id: 'sa_1', kind: 'browser.navigate' });
    const stop = makeAction({ id: 'sa_stop', kind: 'browser.stop' });

    controller.submit(a1, SERIALIZE);     // runs
    controller.submit(stop, BYPASS_CLEAR); // bypass + clear

    // a1 is running, should NOT be in onFail
    expect(onFail).not.toHaveBeenCalled();
    expect(controller.getActive()?.id).toBe('sa_1');

    resolveFirst();
  });

  it('works when queue is already empty', () => {
    executeFn.mockResolvedValue(undefined);

    const stop = makeAction({ id: 'sa_stop', kind: 'browser.stop' });
    controller.submit(stop, BYPASS_CLEAR);

    expect(onFail).not.toHaveBeenCalled();
    expect(executeFn).toHaveBeenCalledWith(stop);
  });
});

const BYPASS_REQUIRES_ACTIVE: ActionConcurrencyPolicy = { mode: 'bypass', requiresActiveAction: true };

describe('SurfaceExecutionController — requiresActiveAction', () => {
  let executeFn: MockExecute;
  let onFail: MockFail;
  let controller: SurfaceExecutionController;

  beforeEach(() => {
    executeFn = vi.fn<ExecuteCallback>();
    onFail = vi.fn<(action: SurfaceAction, err: unknown) => void>();
    controller = new SurfaceExecutionController('terminal', executeFn, onFail);
  });

  it('throws when no action is active', () => {
    const write = makeAction({
      id: 'sa_write',
      target: 'terminal',
      kind: 'terminal.write',
      payload: { input: 'y\n' },
    });

    expect(() => controller.submit(write, BYPASS_REQUIRES_ACTIVE))
      .toThrow('No active terminal action to receive input');
  });

  it('executes when an action is active', async () => {
    let resolveExec!: () => void;
    executeFn.mockImplementationOnce(() => new Promise<void>(r => { resolveExec = r; }));
    executeFn.mockResolvedValueOnce(undefined);

    const exec = makeAction({
      id: 'sa_exec',
      target: 'terminal',
      kind: 'terminal.execute',
      payload: { command: 'npm test' },
    });
    const write = makeAction({
      id: 'sa_write',
      target: 'terminal',
      kind: 'terminal.write',
      payload: { input: 'y\n' },
    });

    controller.submit(exec, SERIALIZE);  // runs, occupies active slot
    controller.submit(write, BYPASS_REQUIRES_ACTIVE); // should succeed

    expect(executeFn).toHaveBeenCalledTimes(2);
    expect(executeFn).toHaveBeenCalledWith(write);

    resolveExec();
  });

  it('succeeds when an action is running even if others are queued', async () => {
    let resolveFirst!: () => void;
    executeFn.mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }));

    const a1 = makeAction({ id: 'sa_1', target: 'terminal', kind: 'terminal.execute' });
    const a2 = makeAction({ id: 'sa_2', target: 'terminal', kind: 'terminal.execute' });
    const write = makeAction({
      id: 'sa_write',
      target: 'terminal',
      kind: 'terminal.write',
      payload: { input: 'y\n' },
    });

    controller.submit(a1, SERIALIZE); // runs
    controller.submit(a2, SERIALIZE); // queued

    // a1 is running, so write should work
    expect(() => controller.submit(write, BYPASS_REQUIRES_ACTIVE)).not.toThrow();

    resolveFirst();
  });
});

describe('SurfaceExecutionController — integration scenarios', () => {
  let executeFn: MockExecute;
  let onFail: MockFail;

  it('browser: rapid navigates collapse, stop clears remainder', async () => {
    executeFn = vi.fn<ExecuteCallback>();
    onFail = vi.fn<(action: SurfaceAction, err: unknown) => void>();
    const controller = new SurfaceExecutionController('browser', executeFn, onFail);

    let resolveNav1!: () => void;
    executeFn.mockImplementationOnce(() => new Promise<void>(r => { resolveNav1 = r; }));
    executeFn.mockResolvedValue(undefined);

    const nav1 = makeAction({ id: 'nav1', kind: 'browser.navigate', payload: { url: 'https://a.com' } });
    const nav2 = makeAction({ id: 'nav2', kind: 'browser.navigate', payload: { url: 'https://b.com' } });
    const nav3 = makeAction({ id: 'nav3', kind: 'browser.navigate', payload: { url: 'https://c.com' } });
    const stop = makeAction({ id: 'stop', kind: 'browser.stop' });

    // nav1 runs, nav2 queued, nav3 replaces nav2
    controller.submit(nav1, { mode: 'serialize', replacesSameKind: true });
    controller.submit(nav2, { mode: 'serialize', replacesSameKind: true });
    controller.submit(nav3, { mode: 'serialize', replacesSameKind: true });

    expect(onFail).toHaveBeenCalledWith(nav2, 'Superseded by newer browser.navigate');
    expect(controller.getQueueLength()).toBe(1); // only nav3

    // stop clears nav3
    controller.submit(stop, { mode: 'bypass', clearsQueue: true });

    expect(onFail).toHaveBeenCalledWith(nav3, 'Cancelled by browser.stop');
    expect(controller.getQueueLength()).toBe(0);

    // stop executed immediately
    expect(executeFn).toHaveBeenCalledWith(stop);

    resolveNav1();
  });

  it('terminal: execute + write + restart sequence', async () => {
    executeFn = vi.fn<ExecuteCallback>();
    onFail = vi.fn<(action: SurfaceAction, err: unknown) => void>();
    const controller = new SurfaceExecutionController('terminal', executeFn, onFail);

    let resolveExec1!: () => void;
    executeFn.mockImplementationOnce(() => new Promise<void>(r => { resolveExec1 = r; }));
    executeFn.mockResolvedValue(undefined);

    const exec1 = makeAction({ id: 'exec1', target: 'terminal', kind: 'terminal.execute', payload: { command: 'npm test' } });
    const exec2 = makeAction({ id: 'exec2', target: 'terminal', kind: 'terminal.execute', payload: { command: 'pwd' } });
    const write = makeAction({ id: 'write', target: 'terminal', kind: 'terminal.write', payload: { input: 'y\n' } });
    const restart = makeAction({ id: 'restart', target: 'terminal', kind: 'terminal.restart' });

    // exec1 runs, exec2 queued
    controller.submit(exec1, { mode: 'serialize', replacesSameKind: true });
    controller.submit(exec2, { mode: 'serialize', replacesSameKind: true });

    // write succeeds — exec1 is active
    controller.submit(write, { mode: 'bypass', requiresActiveAction: true });
    expect(executeFn).toHaveBeenCalledWith(write);

    // restart clears exec2 from queue
    controller.submit(restart, { mode: 'bypass', clearsQueue: true });
    expect(onFail).toHaveBeenCalledWith(exec2, 'Cancelled by terminal.restart');
    expect(executeFn).toHaveBeenCalledWith(restart);

    resolveExec1();
  });

  it('browser and terminal controllers are independent', async () => {
    const browserExec = vi.fn();
    const terminalExec = vi.fn();
    const browserFail = vi.fn();
    const terminalFail = vi.fn();

    const browserCtrl = new SurfaceExecutionController('browser', browserExec, browserFail);
    const terminalCtrl = new SurfaceExecutionController('terminal', terminalExec, terminalFail);

    let resolveBrowser!: () => void;
    browserExec.mockImplementationOnce(() => new Promise<void>(r => { resolveBrowser = r; }));
    terminalExec.mockResolvedValue(undefined);

    const nav = makeAction({ id: 'nav', target: 'browser', kind: 'browser.navigate' });
    const exec = makeAction({ id: 'exec', target: 'terminal', kind: 'terminal.execute', payload: { command: 'ls' } });

    browserCtrl.submit(nav, SERIALIZE);
    terminalCtrl.submit(exec, SERIALIZE);

    // Both should execute — they're independent
    expect(browserExec).toHaveBeenCalledWith(nav);
    expect(terminalExec).toHaveBeenCalledWith(exec);

    // Stopping browser doesn't affect terminal
    const stop = makeAction({ id: 'stop', target: 'browser', kind: 'browser.stop' });
    browserCtrl.submit(stop, BYPASS_CLEAR);

    expect(terminalFail).not.toHaveBeenCalled();

    resolveBrowser();
  });
});

// ─── Blind-spot tests ────────────────────────────────────────────────────

describe('SurfaceExecutionController — bypass callback errors', () => {
  it('swallows errors from bypass execute callback without breaking queue', async () => {
    const executeFn = vi.fn<ExecuteCallback>();
    const onFail = vi.fn<(action: SurfaceAction, err: unknown) => void>();
    const controller = new SurfaceExecutionController('browser', executeFn, onFail);

    let resolveSerial!: () => void;
    executeFn
      .mockImplementationOnce(() => new Promise<void>(r => { resolveSerial = r; })) // serial a1
      .mockRejectedValueOnce(new Error('bypass kaboom'))  // bypass (will be swallowed)
      .mockResolvedValueOnce(undefined);                   // serial a2

    const a1 = makeAction({ id: 'sa_1', kind: 'browser.navigate' });
    const bypassAction = makeAction({ id: 'sa_bypass', kind: 'browser.stop' });
    const a2 = makeAction({ id: 'sa_2', kind: 'browser.reload' });

    controller.submit(a1, SERIALIZE);  // runs, occupies active
    controller.submit(a2, SERIALIZE);  // queued
    controller.submit(bypassAction, { mode: 'bypass' }); // fires, errors silently

    // Bypass error should not affect queue or active slot
    expect(controller.getActive()?.id).toBe('sa_1');
    expect(controller.getQueueLength()).toBe(1);

    // Complete a1 — a2 should still drain normally
    resolveSerial();
    await vi.waitFor(() => expect(executeFn).toHaveBeenCalledTimes(3));
    expect(executeFn).toHaveBeenCalledWith(a2);
  });

  it('swallows synchronous throw from bypass execute callback', () => {
    const executeFn = vi.fn<ExecuteCallback>();
    const onFail = vi.fn<(action: SurfaceAction, err: unknown) => void>();
    const controller = new SurfaceExecutionController('browser', executeFn, onFail);

    executeFn.mockImplementation(() => { throw new Error('sync boom'); });

    const bypassAction = makeAction({ id: 'sa_bypass', kind: 'browser.stop' });

    // Should not throw — bypass errors are swallowed
    expect(() => controller.submit(bypassAction, { mode: 'bypass' })).not.toThrow();
  });
});

describe('SurfaceExecutionController — terminal.restart lifecycle', () => {
  it('restart clears queue and executes while running action completes independently', async () => {
    const executeFn = vi.fn<ExecuteCallback>();
    const onFail = vi.fn<(action: SurfaceAction, err: unknown) => void>();
    const controller = new SurfaceExecutionController('terminal', executeFn, onFail);

    let resolveExec1!: () => void;
    executeFn
      .mockImplementationOnce(() => new Promise<void>(r => { resolveExec1 = r; })) // exec1
      .mockResolvedValueOnce(undefined)  // restart (bypass)
      .mockResolvedValueOnce(undefined); // exec3 should NOT drain — queue was cleared

    const exec1 = makeAction({ id: 'exec1', target: 'terminal', kind: 'terminal.execute', payload: { command: 'npm test' } });
    const exec2 = makeAction({ id: 'exec2', target: 'terminal', kind: 'terminal.execute', payload: { command: 'pwd' } });
    const restart = makeAction({ id: 'restart', target: 'terminal', kind: 'terminal.restart' });

    controller.submit(exec1, { mode: 'serialize', replacesSameKind: true }); // runs
    controller.submit(exec2, { mode: 'serialize', replacesSameKind: true }); // queued

    expect(controller.getActive()?.id).toBe('exec1');
    expect(controller.getQueueLength()).toBe(1);

    // Restart: clears queue (exec2 cancelled), fires restart immediately
    controller.submit(restart, { mode: 'bypass', clearsQueue: true });

    expect(onFail).toHaveBeenCalledWith(exec2, 'Cancelled by terminal.restart');
    expect(controller.getQueueLength()).toBe(0);
    expect(executeFn).toHaveBeenCalledWith(restart);

    // exec1 is STILL the active action — restart didn't touch it
    expect(controller.getActive()?.id).toBe('exec1');

    // Complete exec1 — drain finds empty queue, stops
    resolveExec1();
    await vi.waitFor(() => expect(controller.getActive()).toBeNull());

    // Only 3 calls: exec1, restart (bypass), no more — queue was cleared
    expect(executeFn).toHaveBeenCalledTimes(2);
  });

  it('restart when running action fails still leaves clean state', async () => {
    const executeFn = vi.fn<ExecuteCallback>();
    const onFail = vi.fn<(action: SurfaceAction, err: unknown) => void>();
    const controller = new SurfaceExecutionController('terminal', executeFn, onFail);

    let rejectExec1!: (err: Error) => void;
    executeFn
      .mockImplementationOnce(() => new Promise<void>((_, rej) => { rejectExec1 = rej; }))
      .mockResolvedValueOnce(undefined); // restart

    const exec1 = makeAction({ id: 'exec1', target: 'terminal', kind: 'terminal.execute' });
    const exec2 = makeAction({ id: 'exec2', target: 'terminal', kind: 'terminal.execute' });
    const restart = makeAction({ id: 'restart', target: 'terminal', kind: 'terminal.restart' });

    controller.submit(exec1, { mode: 'serialize', replacesSameKind: true });
    controller.submit(exec2, { mode: 'serialize', replacesSameKind: true });
    controller.submit(restart, { mode: 'bypass', clearsQueue: true });

    // exec1 fails after restart already cleared queue
    rejectExec1(new Error('PTY destroyed'));
    await vi.waitFor(() => expect(controller.getActive()).toBeNull());

    // State should be fully clean — no active, no queue
    expect(controller.getQueueLength()).toBe(0);
    expect(controller.getActive()).toBeNull();
  });
});

describe('SurfaceExecutionController — policy-cleared queued actions call onPolicyFail', () => {
  it('every cleared action receives an onPolicyFail call with the reason', () => {
    const executeFn = vi.fn<ExecuteCallback>();
    const onFail = vi.fn<(action: SurfaceAction, err: unknown) => void>();
    const controller = new SurfaceExecutionController('browser', executeFn, onFail);

    let resolveFirst!: () => void;
    executeFn.mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }));
    executeFn.mockResolvedValue(undefined);

    const running = makeAction({ id: 'running', kind: 'browser.navigate' });
    const q1 = makeAction({ id: 'q1', kind: 'browser.navigate' });
    const q2 = makeAction({ id: 'q2', kind: 'browser.create-tab' });
    const q3 = makeAction({ id: 'q3', kind: 'browser.reload' });

    controller.submit(running, SERIALIZE);           // runs
    controller.submit(q1, SERIALIZE);                // queued
    controller.submit(q2, SERIALIZE);                // queued
    controller.submit(q3, SERIALIZE);                // queued

    expect(controller.getQueueLength()).toBe(3);

    // Stop clears all 3 queued actions
    const stop = makeAction({ id: 'stop', kind: 'browser.stop' });
    controller.submit(stop, { mode: 'bypass', clearsQueue: true });

    expect(onFail).toHaveBeenCalledTimes(3);
    expect(onFail).toHaveBeenCalledWith(q1, 'Cancelled by browser.stop');
    expect(onFail).toHaveBeenCalledWith(q2, 'Cancelled by browser.stop');
    expect(onFail).toHaveBeenCalledWith(q3, 'Cancelled by browser.stop');

    expect(controller.getQueueLength()).toBe(0);

    resolveFirst();
  });
});

describe('SurfaceExecutionController — requiresActiveAction after queued record creation', () => {
  it('rejects after active action completes and slot clears', async () => {
    // The router persists a queued record BEFORE delegating to the controller.
    // This tests that the controller correctly rejects based on active slot state,
    // even after an action has just completed.
    const executeFn = vi.fn<ExecuteCallback>().mockResolvedValue(undefined);
    const onFail = vi.fn<(action: SurfaceAction, err: unknown) => void>();
    const controller = new SurfaceExecutionController('terminal', executeFn, onFail);

    const exec = makeAction({ id: 'exec', target: 'terminal', kind: 'terminal.execute' });
    controller.submit(exec, SERIALIZE);

    // Wait for the Promise microtask chain to clear active slot
    await vi.waitFor(() => expect(controller.getActive()).toBeNull());

    const write = makeAction({
      id: 'write', target: 'terminal', kind: 'terminal.write', payload: { input: 'y\n' },
    });

    // Active slot is now null — requiresActiveAction must reject
    expect(() => controller.submit(write, { mode: 'bypass', requiresActiveAction: true }))
      .toThrow('No active terminal action to receive input');
  });

  it('accepts when an active action exists regardless of queue depth', async () => {
    const executeFn = vi.fn<ExecuteCallback>();
    const onFail = vi.fn<(action: SurfaceAction, err: unknown) => void>();
    const controller = new SurfaceExecutionController('terminal', executeFn, onFail);

    let resolveExec!: () => void;
    executeFn.mockImplementationOnce(() => new Promise<void>(r => { resolveExec = r; }));

    const exec = makeAction({ id: 'exec', target: 'terminal', kind: 'terminal.execute' });
    controller.submit(exec, SERIALIZE); // runs, blocks

    // Queue 2 more
    controller.submit(makeAction({ id: 'q1', target: 'terminal', kind: 'terminal.execute' }), SERIALIZE);
    controller.submit(makeAction({ id: 'q2', target: 'terminal', kind: 'terminal.execute' }), SERIALIZE);

    const write = makeAction({
      id: 'write', target: 'terminal', kind: 'terminal.write', payload: { input: 'y\n' },
    });

    // Should succeed — exec is active
    expect(() => controller.submit(write, { mode: 'bypass', requiresActiveAction: true })).not.toThrow();

    resolveExec();
  });
});

// ─── Cancel by ID ────────────────────────────────────────────────────────

describe('SurfaceExecutionController — cancelById', () => {
  let executeFn: MockExecute;
  let onFail: MockFail;
  let controller: SurfaceExecutionController;

  beforeEach(() => {
    executeFn = vi.fn<ExecuteCallback>();
    onFail = vi.fn<(action: SurfaceAction, err: unknown) => void>();
    controller = new SurfaceExecutionController('browser', executeFn, onFail);
  });

  it('removes a queued action by ID and calls onPolicyFail', async () => {
    let resolveFirst!: () => void;
    executeFn.mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }));
    executeFn.mockResolvedValue(undefined);

    const a1 = makeAction({ id: 'sa_1' });
    const a2 = makeAction({ id: 'sa_2' });
    const a3 = makeAction({ id: 'sa_3' });

    controller.submit(a1, SERIALIZE); // runs
    controller.submit(a2, SERIALIZE); // queued
    controller.submit(a3, SERIALIZE); // queued

    expect(controller.getQueueLength()).toBe(2);

    const removed = controller.cancelById('sa_2', 'Cancelled by user');

    expect(removed).toBe(true);
    expect(controller.getQueueLength()).toBe(1);
    expect(onFail).toHaveBeenCalledWith(a2, 'Cancelled by user');

    // a1 completes → a3 drains (not a2)
    resolveFirst();
    await vi.waitFor(() => expect(executeFn).toHaveBeenCalledTimes(2));
    expect(executeFn).toHaveBeenCalledWith(a3);
  });

  it('returns false for an ID not in the queue', () => {
    executeFn.mockResolvedValue(undefined);

    const a1 = makeAction({ id: 'sa_1' });
    controller.submit(a1, SERIALIZE);

    const removed = controller.cancelById('sa_nonexistent', 'Cancelled by user');
    expect(removed).toBe(false);
    expect(onFail).not.toHaveBeenCalled();
  });

  it('returns false for the running action (active slot, not in queue)', async () => {
    let resolveFirst!: () => void;
    executeFn.mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }));

    const a1 = makeAction({ id: 'sa_1' });
    controller.submit(a1, SERIALIZE); // runs

    expect(controller.getActive()?.id).toBe('sa_1');

    // a1 is active, not queued — cancelById should not find it
    const removed = controller.cancelById('sa_1', 'Cancelled by user');
    expect(removed).toBe(false);
    expect(onFail).not.toHaveBeenCalled();

    // a1 still running
    expect(controller.getActive()?.id).toBe('sa_1');

    resolveFirst();
  });

  it('preserves FIFO order when middle item is cancelled', async () => {
    let resolveFirst!: () => void;
    executeFn.mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }));
    executeFn.mockResolvedValue(undefined);

    const a1 = makeAction({ id: 'sa_1', kind: 'browser.navigate' });
    const a2 = makeAction({ id: 'sa_2', kind: 'browser.create-tab' });
    const a3 = makeAction({ id: 'sa_3', kind: 'browser.reload' });
    const a4 = makeAction({ id: 'sa_4', kind: 'browser.navigate' });

    controller.submit(a1, SERIALIZE);
    controller.submit(a2, SERIALIZE);
    controller.submit(a3, SERIALIZE);
    controller.submit(a4, SERIALIZE);

    // Cancel a3 from the middle
    controller.cancelById('sa_3', 'Cancelled by user');
    expect(controller.getQueueLength()).toBe(2); // a2, a4

    resolveFirst();
    await vi.waitFor(() => expect(executeFn).toHaveBeenCalledTimes(3)); // a1, a2, a4

    // Verify a2 and a4 drained in order (a3 skipped)
    const drainedIds = executeFn.mock.calls.slice(1).map(c => c[0].id);
    expect(drainedIds).toEqual(['sa_2', 'sa_4']);
  });

  it('audit trail: cancelled action gets explicit reason via onPolicyFail', () => {
    let resolveFirst!: () => void;
    executeFn.mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }));

    const a1 = makeAction({ id: 'sa_1' });
    const a2 = makeAction({ id: 'sa_2' });

    controller.submit(a1, SERIALIZE);
    controller.submit(a2, SERIALIZE);

    controller.cancelById('sa_2', 'Cancelled by user');

    // Verify onPolicyFail was called with the exact action object and reason
    expect(onFail).toHaveBeenCalledTimes(1);
    const [failedAction, reason] = onFail.mock.calls[0];
    expect(failedAction.id).toBe('sa_2');
    expect(reason).toBe('Cancelled by user');

    resolveFirst();
  });

  it('cancel on empty queue returns false', () => {
    const removed = controller.cancelById('sa_anything', 'Cancelled by user');
    expect(removed).toBe(false);
    expect(onFail).not.toHaveBeenCalled();
  });
});
