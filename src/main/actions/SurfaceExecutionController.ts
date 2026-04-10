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
    if (policy.mode === 'serialize') {
      this.enqueue(action, policy);
    }
    // bypass mode added in Task 3
  }

  getActive(): SurfaceAction | null {
    return this.active;
  }

  getQueueLength(): number {
    return this.queue.length;
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
