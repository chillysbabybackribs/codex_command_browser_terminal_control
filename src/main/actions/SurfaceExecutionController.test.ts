import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SurfaceExecutionController } from './SurfaceExecutionController';
import type { SurfaceAction } from '../../shared/actions/surfaceActionTypes';
import type { ActionConcurrencyPolicy } from './surfaceActionPolicy';

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
  let executeFn: ReturnType<typeof vi.fn>;
  let onFail: ReturnType<typeof vi.fn>;
  let controller: SurfaceExecutionController;

  beforeEach(() => {
    executeFn = vi.fn();
    onFail = vi.fn();
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
  let executeFn: ReturnType<typeof vi.fn>;
  let onFail: ReturnType<typeof vi.fn>;
  let controller: SurfaceExecutionController;

  beforeEach(() => {
    executeFn = vi.fn();
    onFail = vi.fn();
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
    const callArgs = executeFn.mock.calls.map((c: [SurfaceAction]) => c[0].id);
    expect(callArgs).toContain('sa_bypass');
    expect(callArgs).toContain('sa_2');
  });
});

const SERIALIZE_REPLACE: ActionConcurrencyPolicy = { mode: 'serialize', replacesSameKind: true };

describe('SurfaceExecutionController — replacesSameKind', () => {
  let executeFn: ReturnType<typeof vi.fn>;
  let onFail: ReturnType<typeof vi.fn>;
  let controller: SurfaceExecutionController;

  beforeEach(() => {
    executeFn = vi.fn();
    onFail = vi.fn();
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
