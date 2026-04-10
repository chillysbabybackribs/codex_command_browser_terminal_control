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
