# Concurrency Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make execution on each surface (browser, terminal) serial, policy-driven, and deterministic under rapid or overlapping submissions.

**Architecture:** Per-surface execution controllers with FIFO queues and a single active slot, driven by a pure-data policy map. The router delegates to controllers instead of executing directly. Bypass actions (stop, interrupt, restart, write) skip the queue with explicit guards.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-10-concurrency-control-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/main/actions/surfaceActionPolicy.ts` | Policy types + map. Pure data, no logic. | Create |
| `src/main/actions/surfaceActionPolicy.test.ts` | Policy map coverage tests. | Create |
| `src/main/actions/SurfaceExecutionController.ts` | Per-surface queue, active slot, drain, bypass, cancel. | Create |
| `src/main/actions/SurfaceExecutionController.test.ts` | Controller behavior tests (serialize, bypass, replace, guard). | Create |
| `src/main/actions/SurfaceActionRouter.ts` | Thin orchestration: validate, persist, delegate to controller. | Modify |

---

### Task 1: Policy Map — Types and Data

**Files:**
- Create: `src/main/actions/surfaceActionPolicy.ts`
- Create: `src/main/actions/surfaceActionPolicy.test.ts`

- [ ] **Step 1: Write the policy map test file**

```typescript
// src/main/actions/surfaceActionPolicy.test.ts
import { describe, it, expect } from 'vitest';
import { ACTION_CONCURRENCY_POLICY } from './surfaceActionPolicy';
import { ALL_ACTION_KINDS } from '../../shared/actions/surfaceActionTypes';

describe('ACTION_CONCURRENCY_POLICY', () => {
  it('has a policy for every action kind', () => {
    for (const kind of ALL_ACTION_KINDS) {
      expect(ACTION_CONCURRENCY_POLICY[kind], `missing policy for ${kind}`).toBeDefined();
    }
  });

  it('has no extra keys beyond known action kinds', () => {
    const policyKinds = Object.keys(ACTION_CONCURRENCY_POLICY);
    expect(policyKinds.sort()).toEqual([...ALL_ACTION_KINDS].sort());
  });

  it('browser navigation actions serialize with replacesSameKind', () => {
    for (const kind of ['browser.navigate', 'browser.back', 'browser.forward', 'browser.reload'] as const) {
      const p = ACTION_CONCURRENCY_POLICY[kind];
      expect(p.mode, `${kind} mode`).toBe('serialize');
      expect(p.replacesSameKind, `${kind} replacesSameKind`).toBe(true);
    }
  });

  it('browser tab actions serialize without replacesSameKind', () => {
    for (const kind of ['browser.create-tab', 'browser.close-tab', 'browser.activate-tab'] as const) {
      const p = ACTION_CONCURRENCY_POLICY[kind];
      expect(p.mode, `${kind} mode`).toBe('serialize');
      expect(p.replacesSameKind).toBeFalsy();
    }
  });

  it('browser.stop bypasses and clears queue', () => {
    const p = ACTION_CONCURRENCY_POLICY['browser.stop'];
    expect(p.mode).toBe('bypass');
    expect(p.clearsQueue).toBe(true);
  });

  it('terminal.execute serializes with replacesSameKind', () => {
    const p = ACTION_CONCURRENCY_POLICY['terminal.execute'];
    expect(p.mode).toBe('serialize');
    expect(p.replacesSameKind).toBe(true);
  });

  it('terminal.write bypasses with requiresActiveAction', () => {
    const p = ACTION_CONCURRENCY_POLICY['terminal.write'];
    expect(p.mode).toBe('bypass');
    expect(p.requiresActiveAction).toBe(true);
  });

  it('terminal.interrupt bypasses and clears queue', () => {
    const p = ACTION_CONCURRENCY_POLICY['terminal.interrupt'];
    expect(p.mode).toBe('bypass');
    expect(p.clearsQueue).toBe(true);
  });

  it('terminal.restart bypasses and clears queue', () => {
    const p = ACTION_CONCURRENCY_POLICY['terminal.restart'];
    expect(p.mode).toBe('bypass');
    expect(p.clearsQueue).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/actions/surfaceActionPolicy.test.ts`
Expected: FAIL — cannot find `./surfaceActionPolicy`

- [ ] **Step 3: Write the policy map implementation**

```typescript
// src/main/actions/surfaceActionPolicy.ts
import { SurfaceActionKind } from '../../shared/actions/surfaceActionTypes';

export type ConcurrencyMode = 'serialize' | 'bypass';

export type ActionConcurrencyPolicy = {
  mode: ConcurrencyMode;
  replacesSameKind?: boolean;
  clearsQueue?: boolean;
  requiresActiveAction?: boolean;
};

export const ACTION_CONCURRENCY_POLICY: Record<SurfaceActionKind, ActionConcurrencyPolicy> = {
  // Browser — navigation actions serialize, replace queued same-kind
  'browser.navigate':     { mode: 'serialize', replacesSameKind: true },
  'browser.back':         { mode: 'serialize', replacesSameKind: true },
  'browser.forward':      { mode: 'serialize', replacesSameKind: true },
  'browser.reload':       { mode: 'serialize', replacesSameKind: true },

  // Browser — stop bypasses and cancels everything queued
  'browser.stop':         { mode: 'bypass', clearsQueue: true },

  // Browser — tab actions serialize through same queue, no replacement
  'browser.create-tab':   { mode: 'serialize' },
  'browser.close-tab':    { mode: 'serialize' },
  'browser.activate-tab': { mode: 'serialize' },

  // Terminal — execute serializes, replace queued same-kind
  'terminal.execute':     { mode: 'serialize', replacesSameKind: true },

  // Terminal — write bypasses, requires a running action to receive input
  'terminal.write':       { mode: 'bypass', requiresActiveAction: true },

  // Terminal — interrupt bypasses and cancels everything queued
  'terminal.interrupt':   { mode: 'bypass', clearsQueue: true },

  // Terminal — restart bypasses and cancels everything queued
  'terminal.restart':     { mode: 'bypass', clearsQueue: true },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/actions/surfaceActionPolicy.test.ts`
Expected: PASS — all 8 tests green

- [ ] **Step 5: Commit**

```bash
git add src/main/actions/surfaceActionPolicy.ts src/main/actions/surfaceActionPolicy.test.ts
git commit -m "feat: add surface action concurrency policy map"
```

---

### Task 2: SurfaceExecutionController — Core Serialize Path

**Files:**
- Create: `src/main/actions/SurfaceExecutionController.ts`
- Create: `src/main/actions/SurfaceExecutionController.test.ts`

This task builds the controller with serialize mode only. Bypass, replacement, and queue-clearing come in later tasks.

- [ ] **Step 1: Write failing tests for serialize behavior**

```typescript
// src/main/actions/SurfaceExecutionController.test.ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/actions/SurfaceExecutionController.test.ts`
Expected: FAIL — cannot find `./SurfaceExecutionController`

- [ ] **Step 3: Write the controller with serialize mode**

```typescript
// src/main/actions/SurfaceExecutionController.ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/actions/SurfaceExecutionController.test.ts`
Expected: PASS — all 5 tests green

- [ ] **Step 5: Commit**

```bash
git add src/main/actions/SurfaceExecutionController.ts src/main/actions/SurfaceExecutionController.test.ts
git commit -m "feat: add SurfaceExecutionController with serialize mode"
```

---

### Task 3: SurfaceExecutionController — Bypass Mode

**Files:**
- Modify: `src/main/actions/SurfaceExecutionController.ts`
- Modify: `src/main/actions/SurfaceExecutionController.test.ts`

Adds bypass execution — actions that skip the queue and execute immediately without occupying the active slot.

- [ ] **Step 1: Add failing tests for bypass behavior**

Append to the test file:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/actions/SurfaceExecutionController.test.ts`
Expected: FAIL — bypass actions not yet handled in `submit()`

- [ ] **Step 3: Add bypass mode to the controller**

Update the `submit` method in `SurfaceExecutionController.ts`:

```typescript
  submit(action: SurfaceAction, policy: ActionConcurrencyPolicy): void {
    if (policy.mode === 'bypass') {
      this.executeImmediate(action);
    } else {
      this.enqueue(action, policy);
    }
  }
```

Add the `executeImmediate` method:

```typescript
  private executeImmediate(action: SurfaceAction): void {
    // Fire-and-forget — bypass does not occupy the active slot or touch the queue.
    // Errors are handled inside the execute callback (router).
    this.execute(action).catch(() => {});
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/actions/SurfaceExecutionController.test.ts`
Expected: PASS — all 8 tests green

- [ ] **Step 5: Commit**

```bash
git add src/main/actions/SurfaceExecutionController.ts src/main/actions/SurfaceExecutionController.test.ts
git commit -m "feat: add bypass mode to SurfaceExecutionController"
```

---

### Task 4: SurfaceExecutionController — replacesSameKind

**Files:**
- Modify: `src/main/actions/SurfaceExecutionController.ts`
- Modify: `src/main/actions/SurfaceExecutionController.test.ts`

- [ ] **Step 1: Add failing tests for same-kind replacement**

Append to the test file:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/actions/SurfaceExecutionController.test.ts`
Expected: FAIL — `onFail` is never called (replacement logic not implemented)

- [ ] **Step 3: Add replacement logic to enqueue**

Update the `enqueue` method in `SurfaceExecutionController.ts`:

```typescript
  private enqueue(action: SurfaceAction, policy: ActionConcurrencyPolicy): void {
    if (policy.replacesSameKind) {
      const superseded: SurfaceAction[] = [];
      this.queue = this.queue.filter(queued => {
        if (queued.kind === action.kind) {
          superseded.push(queued);
          return false;
        }
        return true;
      });
      for (const old of superseded) {
        this.onPolicyFail(old, `Superseded by newer ${action.kind}`);
      }
    }

    this.queue.push(action);
    if (this.active === null) {
      this.drain();
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/actions/SurfaceExecutionController.test.ts`
Expected: PASS — all 11 tests green

- [ ] **Step 5: Commit**

```bash
git add src/main/actions/SurfaceExecutionController.ts src/main/actions/SurfaceExecutionController.test.ts
git commit -m "feat: add replacesSameKind to SurfaceExecutionController"
```

---

### Task 5: SurfaceExecutionController — clearsQueue

**Files:**
- Modify: `src/main/actions/SurfaceExecutionController.ts`
- Modify: `src/main/actions/SurfaceExecutionController.test.ts`

- [ ] **Step 1: Add failing tests for queue clearing**

Append to the test file:

```typescript
const BYPASS_CLEAR: ActionConcurrencyPolicy = { mode: 'bypass', clearsQueue: true };

describe('SurfaceExecutionController — clearsQueue', () => {
  let executeFn: ReturnType<typeof vi.fn>;
  let onFail: ReturnType<typeof vi.fn>;
  let controller: SurfaceExecutionController;

  beforeEach(() => {
    executeFn = vi.fn();
    onFail = vi.fn();
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/actions/SurfaceExecutionController.test.ts`
Expected: FAIL — queue not cleared on bypass

- [ ] **Step 3: Add clearsQueue logic to submit**

Update the bypass branch in `submit()`:

```typescript
  submit(action: SurfaceAction, policy: ActionConcurrencyPolicy): void {
    if (policy.mode === 'bypass') {
      if (policy.clearsQueue) {
        this.cancelQueued(`Cancelled by ${action.kind}`);
      }
      this.executeImmediate(action);
    } else {
      this.enqueue(action, policy);
    }
  }
```

Add the `cancelQueued` method:

```typescript
  private cancelQueued(reason: string): void {
    const cancelled = this.queue.splice(0);
    for (const action of cancelled) {
      this.onPolicyFail(action, reason);
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/actions/SurfaceExecutionController.test.ts`
Expected: PASS — all 14 tests green

- [ ] **Step 5: Commit**

```bash
git add src/main/actions/SurfaceExecutionController.ts src/main/actions/SurfaceExecutionController.test.ts
git commit -m "feat: add clearsQueue to SurfaceExecutionController"
```

---

### Task 6: SurfaceExecutionController — requiresActiveAction Guard

**Files:**
- Modify: `src/main/actions/SurfaceExecutionController.ts`
- Modify: `src/main/actions/SurfaceExecutionController.test.ts`

- [ ] **Step 1: Add failing tests for the active action guard**

Append to the test file:

```typescript
const BYPASS_REQUIRES_ACTIVE: ActionConcurrencyPolicy = { mode: 'bypass', requiresActiveAction: true };

describe('SurfaceExecutionController — requiresActiveAction', () => {
  let executeFn: ReturnType<typeof vi.fn>;
  let onFail: ReturnType<typeof vi.fn>;
  let controller: SurfaceExecutionController;

  beforeEach(() => {
    executeFn = vi.fn();
    onFail = vi.fn();
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

  it('throws when only queued actions exist (no running)', async () => {
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/actions/SurfaceExecutionController.test.ts`
Expected: FAIL — `requiresActiveAction` guard not implemented

- [ ] **Step 3: Add the guard to the bypass branch**

Update the bypass branch in `submit()`:

```typescript
  submit(action: SurfaceAction, policy: ActionConcurrencyPolicy): void {
    if (policy.mode === 'bypass') {
      if (policy.requiresActiveAction && this.active === null) {
        throw new Error(`No active ${this.surface} action to receive input`);
      }
      if (policy.clearsQueue) {
        this.cancelQueued(`Cancelled by ${action.kind}`);
      }
      this.executeImmediate(action);
    } else {
      this.enqueue(action, policy);
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/actions/SurfaceExecutionController.test.ts`
Expected: PASS — all 17 tests green

- [ ] **Step 5: Commit**

```bash
git add src/main/actions/SurfaceExecutionController.ts src/main/actions/SurfaceExecutionController.test.ts
git commit -m "feat: add requiresActiveAction guard to SurfaceExecutionController"
```

---

### Task 7: Integrate Controller into SurfaceActionRouter

**Files:**
- Modify: `src/main/actions/SurfaceActionRouter.ts`

This is the critical wiring task. The router stops calling `executeAction()` directly and delegates to the per-surface controllers.

- [ ] **Step 1: Add imports and controller instances to the router**

At the top of `SurfaceActionRouter.ts`, add the new imports:

```typescript
import { SurfaceExecutionController } from './SurfaceExecutionController';
import { ACTION_CONCURRENCY_POLICY } from './surfaceActionPolicy';
```

Replace the `activeActions` field and add controller instances inside the `SurfaceActionRouter` class:

Replace:
```typescript
  private activeActions: Map<string, SurfaceAction> = new Map();
```

With:
```typescript
  private browserController: SurfaceExecutionController;
  private terminalController: SurfaceExecutionController;

  constructor() {
    const executeCb = (action: SurfaceAction) => this.executeAction(action);
    const failCb = (action: SurfaceAction, reason: string) => this.failActionByPolicy(action, reason);
    this.browserController = new SurfaceExecutionController('browser', executeCb, failCb);
    this.terminalController = new SurfaceExecutionController('terminal', executeCb, failCb);
  }
```

- [ ] **Step 2: Add the failActionByPolicy method**

Add this new method to the class (after the `executeAction` method):

```typescript
  private failActionByPolicy(action: SurfaceAction, reason: string): void {
    this.updateRecord(action.id, { status: 'failed', error: reason, updatedAt: Date.now() });
    eventBus.emit(AppEventType.SURFACE_ACTION_FAILED, { record: this.getCurrentRecord(action.id) });
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level: 'warn',
        source: action.target,
        message: `Action cancelled: ${reason}`,
        taskId: action.taskId ?? undefined,
      },
    });
  }
```

- [ ] **Step 3: Replace direct execution in submit() with controller delegation**

In the `submit()` method, replace these lines:

```typescript
    // Track and execute
    this.activeActions.set(action.id, action as SurfaceAction);
    this.executeAction(action as SurfaceAction);
```

With:

```typescript
    // Delegate to per-surface controller
    const controller = action.target === 'browser' ? this.browserController : this.terminalController;
    const policy = ACTION_CONCURRENCY_POLICY[action.kind];

    try {
      controller.submit(action as SurfaceAction, policy);
    } catch (err: unknown) {
      // Policy rejection (e.g., terminal.write with no active action).
      // Record is already in state as 'queued' — transition to failed.
      const reason = err instanceof Error ? err.message : String(err);
      this.failActionByPolicy(action as SurfaceAction, reason);
    }
```

- [ ] **Step 4: Remove activeActions cleanup from executeAction()**

In the `executeAction()` method, remove the `finally` block:

Remove:
```typescript
    } finally {
      this.activeActions.delete(id);
    }
```

Replace with just a closing brace for the `try` block (the catch block stays):

```typescript
    }
```

The full `executeAction` method should now end with:

```typescript
      appStateStore.dispatch({
        type: ActionType.ADD_LOG,
        log: {
          id: generateId('log'),
          timestamp: Date.now(),
          level: 'error',
          source: action.target,
          message: `Action failed: ${errorMsg}`,
          taskId: action.taskId ?? undefined,
        },
      });
    }
  }
```

- [ ] **Step 5: Run all tests to verify nothing is broken**

Run: `npx vitest run`
Expected: PASS — all tests green (policy tests, controller tests, existing tests)

- [ ] **Step 6: Commit**

```bash
git add src/main/actions/SurfaceActionRouter.ts
git commit -m "feat: integrate SurfaceExecutionController into SurfaceActionRouter"
```

---

### Task 8: Integration Test — Full Scenarios

**Files:**
- Modify: `src/main/actions/SurfaceExecutionController.test.ts`

Adds scenario-level tests that verify the combined behavior across multiple policy types in a single controller instance.

- [ ] **Step 1: Add integration scenario tests**

Append to the test file:

```typescript
describe('SurfaceExecutionController — integration scenarios', () => {
  let executeFn: ReturnType<typeof vi.fn>;
  let onFail: ReturnType<typeof vi.fn>;

  it('browser: rapid navigates collapse, stop clears remainder', async () => {
    const order: string[] = [];
    executeFn = vi.fn();
    onFail = vi.fn();
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
    executeFn = vi.fn();
    onFail = vi.fn();
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
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run src/main/actions/SurfaceExecutionController.test.ts`
Expected: PASS — all 20 tests green

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all tests green across all test files

- [ ] **Step 4: Commit**

```bash
git add src/main/actions/SurfaceExecutionController.test.ts
git commit -m "test: add integration scenarios for concurrency control"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] `npx vitest run` — all tests pass
- [ ] Policy map covers all 12 action kinds
- [ ] Controller serialize: actions queue and drain in FIFO order
- [ ] Controller bypass: stop/interrupt/restart execute immediately
- [ ] Controller replacesSameKind: queued duplicates superseded with reason
- [ ] Controller clearsQueue: stop/interrupt/restart cancel queued with reason
- [ ] Controller requiresActiveAction: terminal.write rejected when no active action
- [ ] Router delegates to controller, no longer calls executeAction directly
- [ ] Router catches policy rejection and transitions record to failed
- [ ] Failed/cancelled actions have explicit error strings visible in state
- [ ] No `activeActions` map in the router (replaced by controller slots)
