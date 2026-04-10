import type { SurfaceAction, SurfaceTarget } from '../../shared/actions/surfaceActionTypes';
import type { ActionConcurrencyPolicy } from './surfaceActionPolicy';

export type ExecuteCallback = (action: SurfaceAction) => Promise<void>;
export type FailCallback = (action: SurfaceAction, reason: string) => void;

export class SurfaceExecutionController {
  private queue: SurfaceAction[] = [];
  private active: SurfaceAction | null = null;

  constructor(
    readonly surface: SurfaceTarget,
    private readonly execute: ExecuteCallback,
    private readonly onPolicyFail: FailCallback,
  ) {}

  submit(action: SurfaceAction, policy: ActionConcurrencyPolicy): void {
    if (policy.mode === 'bypass') {
      this.executeImmediate(action);
    } else {
      this.enqueue(action, policy);
    }
  }

  getActive(): SurfaceAction | null {
    return this.active;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  private executeImmediate(action: SurfaceAction): void {
    // Fire-and-forget — bypass does not occupy the active slot or touch the queue.
    // Errors are handled inside the execute callback (router).
    this.execute(action).catch(() => {});
  }

  private enqueue(action: SurfaceAction, _policy: ActionConcurrencyPolicy): void {
    this.queue.push(action);
    if (this.active === null) {
      this.drain();
    }
  }

  private drain(): void {
    if (this.active !== null) return;
    const next = this.queue.shift();
    if (!next) return;

    this.active = next;
    this.execute(next)
      .catch(() => {
        // Error handling is done inside the execute callback (router).
        // drain() just needs to advance regardless.
      })
      .finally(() => {
        this.active = null;
        this.drain();
      });
  }
}
