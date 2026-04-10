# Concurrency Control / Surface Serialization

**Date:** 2026-04-10
**Status:** Approved
**Scope:** Per-surface execution serialization and concurrency policy enforcement

## Problem

Actions on the same surface can interleave with no execution serialization or concurrency policy. `SurfaceActionRouter.submit()` calls `executeAction()` without awaiting, so rapid submissions execute in parallel. This produces:

- Misleading action completion order
- Race conditions (e.g., two `browser.navigate` calls competing)
- "Last writer wins" on terminal PTY writes with no policy
- No deterministic answer to "what happens when two actions hit the same surface?"

## Design Decisions

1. **Per-surface queues, not global locking.** Browser and terminal operate independently.
2. **Single browser queue.** All browser actions (navigation + tab management) serialize through one queue. Tab ops are fast enough that separate queues add complexity without meaningful UX gain.
3. **Bypass actions for cancellation/interrupt.** `browser.stop`, `terminal.interrupt`, and `terminal.restart` bypass the queue and execute immediately — queueing a cancel behind the thing it's cancelling is nonsensical.
4. **`terminal.write` bypasses with a guard.** Write is stdin input, not a discrete command. Serializing it behind `terminal.execute` would deadlock (execute waits for stdin that's stuck in the queue). But write is rejected if no action is currently running — it needs a target.
5. **Queue-level replacement for same-kind actions.** Rapid-fire `navigate` calls collapse to the last one. The running action is never interrupted; only pending queue entries get replaced.
6. **No new lifecycle states.** `queued`, `running`, `completed`, `failed` are sufficient. Rejected actions throw before entering the lifecycle. Cancelled/superseded actions transition to `failed` with an explicit reason string.
7. **Controller provides queue/slot management; router retains lifecycle ownership.** The controller is pure execution ordering. The router still owns validation, state persistence, event emission, and logging.

## Concurrency Policy Map

Pure data. Each action kind maps to a policy:

```typescript
type ConcurrencyMode = 'serialize' | 'bypass';

type ActionConcurrencyPolicy = {
  mode: ConcurrencyMode;
  replacesSameKind?: boolean;
  clearsQueue?: boolean;
  requiresActiveAction?: boolean;
};
```

| Kind | mode | replacesSameKind | clearsQueue | requiresActiveAction |
|---|---|---|---|---|
| `browser.navigate` | serialize | true | | |
| `browser.back` | serialize | true | | |
| `browser.forward` | serialize | true | | |
| `browser.reload` | serialize | true | | |
| `browser.stop` | bypass | | true | |
| `browser.create-tab` | serialize | | | |
| `browser.close-tab` | serialize | | | |
| `browser.activate-tab` | serialize | | | |
| `terminal.execute` | serialize | true | | |
| `terminal.write` | bypass | | | true |
| `terminal.interrupt` | bypass | | true | |
| `terminal.restart` | bypass | | true | |

### Policy Behavior

**`serialize`**: Action enters the per-surface FIFO queue. If the active slot is empty, `drain()` picks it up immediately. Otherwise it waits.

**`bypass`**: Action executes immediately without touching the queue or active slot. Full lifecycle treatment still applies (queued -> running -> completed/failed in state).

**`replacesSameKind`**: Before enqueuing, scan the queue for entries with the same `kind`. Transition them to `failed` with reason `"Superseded by newer {kind}"`. Only affects queued entries, never the running action.

**`clearsQueue`**: Before executing, transition all queued actions on this surface to `failed` with reason `"Cancelled by {kind}"`. Then execute immediately.

**`requiresActiveAction`**: Before executing, check if the active slot is occupied. If not, reject the action. Rejection happens in the controller's `submit()` method by throwing an error. This throw propagates through the router's `submit()` back to the IPC caller. The action record has already been persisted to state as `queued` at this point (the router persists before delegating to the controller), so the router must catch the rejection and transition the record to `failed` with the rejection reason. This keeps the audit trail visible in the Command Center.

## SurfaceExecutionController

One class, two instances (browser, terminal).

### State

```
surface: 'browser' | 'terminal'
queue: SurfaceAction[]         // FIFO pending actions
active: SurfaceAction | null   // Currently executing
```

### Methods

**`submit(action, policy)`** — Entry point from router.

For `bypass` mode:
1. If `requiresActiveAction && active === null` -> throw with rejection reason
2. If `clearsQueue` -> fail all queued actions with `"Cancelled by {action.kind}"`, then execute immediately via `executeImmediate(action)`
3. Otherwise -> `executeImmediate(action)` (does not touch active slot or queue)

For `serialize` mode:
1. If `replacesSameKind` -> scan queue, fail entries with matching `kind` with `"Superseded by newer {action.kind}"`
2. Push action to queue
3. If `active === null` -> call `drain()`

**`drain()`** — If `active !== null`, return. Shift next from queue. If none, return. Set as `active`. Call the execution callback. On settle (complete or fail): clear `active`, call `drain()`.

**`executeImmediate(action)`** — For bypass actions. Calls the execution callback directly. Action gets full lifecycle (queued -> running -> completed/failed) but does not occupy the active slot or interact with the queue.

**`cancelQueued(reason)`** — Iterates queue, transitions each to `failed` with reason, emits lifecycle events, clears the queue.

### Execution Callback

The controller receives an execution callback at construction: `(action: SurfaceAction) => Promise<void>`. This is provided by the router and contains the current `executeAction()` body: status transitions, executor dispatch, terminal command state tracking, event emission, logging. The controller never touches state or events directly.

### Drain Safety

`drain()` is called from exactly two places:
1. After `submit()` when mode is `serialize` and `active === null`
2. After execution callback settles (complete or fail)

No other code path triggers drain. This prevents double execution.

## Router Changes

`SurfaceActionRouter` becomes thinner:

### New Fields
- `browserController: SurfaceExecutionController`
- `terminalController: SurfaceExecutionController`

### submit() Changes

Current:
```
validate -> create record -> persist -> emit -> executeAction() [fire-and-forget]
```

New:
```
validate -> create record -> persist -> emit -> lookup policy -> controller.submit(action, policy)
```

The router selects the controller by `action.target` and passes the action with its policy.

### executeAction() Extraction

The body of `executeAction()` becomes the execution callback provided to each controller. It retains:
- Status transition to `running`
- `SURFACE_ACTION_STARTED` event emission
- Terminal command state tracking
- Executor dispatch (`executeBrowserAction` / `executeTerminalAction`)
- Status transition to `completed`/`failed`
- Result/error capture
- `SURFACE_ACTION_COMPLETED`/`SURFACE_ACTION_FAILED` event emission
- Completion logging

The callback no longer manages `activeActions` map (replaced by controller's active slot).

### What Stays Unchanged
- `validatePayload()`
- `toRecord()`
- `getRecentActions()`, `getActionsByTarget()`, `getActionsByTask()`
- `updateStatus()`, `updateRecord()`, `getCurrentRecord()`

## Command Center Visibility

No structural UI changes. The existing split view (active + recent panels) already handles all lifecycle states:

- **Queued actions** appear in active panel (filtered by `status === 'queued' || status === 'running'`)
- **Cancelled/superseded actions** transition to `failed` with reason, move to recent panel via `patchActionInSplit()`
- **Error messages** render via existing `r.error` display in `buildActionRowHtml()`

Policy-driven error strings:
- `"Superseded by newer browser.navigate"`
- `"Cancelled by browser.stop"`
- `"Cancelled by terminal.restart"`
- `"Cancelled by terminal.interrupt"`
- `"No active terminal action to receive input"` (for rejected `terminal.write`)

No new DOM elements, CSS classes, or rendering logic needed.

## Deterministic Answers

### Browser

**`browser.navigate(A)` running, `browser.navigate(B)` submitted:**
B enters queue. No other navigates queued, so no replacement. When A completes, drain picks up B.

**`browser.navigate(A)` queued, `browser.navigate(B)` submitted:**
B replaces A. A transitions to `failed` with `"Superseded by newer browser.navigate"`. B takes A's queue position.

**`browser.reload` submitted while `browser.navigate` running:**
Reload enters queue (serialize). Executes after navigate completes.

**`browser.stop` submitted while browser queue has pending items:**
All queued actions fail with `"Cancelled by browser.stop"`. Stop executes immediately (bypass). Running action is not touched by the controller — `browser.stop` acts on the active tab's loading state via BrowserService.

### Terminal

**`terminal.execute("npm test")` then `terminal.execute("pwd")` submitted quickly:**
"npm test" starts executing (drain picks it up). "pwd" enters queue. If replacesSameKind applies, "npm test" is already running (not queued), so "pwd" stays queued. When "npm test" completes, "pwd" drains.

**`terminal.write("y\n")` submitted while `terminal.execute` is active:**
Write bypasses queue. Active slot is occupied (execute is running). `requiresActiveAction` check passes. Write executes immediately — sends "y\n" to PTY as stdin.

**`terminal.write("y\n")` submitted with no active action:**
Rejected. Throws `"No active terminal action to receive input"`. Action never enters state.

**`terminal.restart` submitted while terminal actions are queued/running:**
All queued terminal actions fail with `"Cancelled by terminal.restart"`. Restart executes immediately (bypass). The running action's PTY is destroyed by the restart — the execution callback for that action will receive an error from TerminalService, transitioning it to `failed`.

## Files

### Created

| File | Purpose | ~Lines |
|---|---|---|
| `src/main/actions/surfaceActionPolicy.ts` | Policy types + map. Pure data. | ~40 |
| `src/main/actions/SurfaceExecutionController.ts` | Controller class. Queue, slot, drain, bypass, cancel. | ~150 |

### Updated

| File | Change |
|---|---|
| `src/main/actions/SurfaceActionRouter.ts` | Remove direct execution. Add controller instances. Delegate via policy lookup. Extract execution callback. |

### Unchanged

- `surfaceActionTypes.ts` — no new lifecycle states
- `browserActionExecutor.ts` / `terminalActionExecutor.ts` — called the same way
- `BrowserService.ts` / `TerminalService.ts` — services unchanged
- `reducer.ts` / `appStateStore.ts` — state shape unchanged
- `eventBus.ts` — no new events
- `command.ts` — no structural UI changes

## Testing

### SurfaceExecutionController Tests

- **Serialize**: second action queues behind first, drains on completion
- **FIFO order**: three actions execute in submission order
- **Replace same-kind**: newer navigate supersedes queued navigate, running navigate untouched
- **Bypass**: stop executes immediately regardless of queue state
- **Clear queue**: stop/interrupt/restart cancel all queued actions with explicit failure reasons
- **`terminal.write` guard**: rejected when no active action, allowed when active action running
- **Drain safety**: no double execution, drain only called from correct paths
- **Completion triggers drain**: queued action starts when active action completes
- **Failure triggers drain**: queued action starts when active action fails
- **Empty queue**: drain with empty queue is a no-op

### Policy Map Tests

- Every action kind in `ALL_ACTION_KINDS` has a policy entry
- Policy values match the agreed table
- No action kind is missing from the map

### Integration Scenarios

- Rapid browser navigates collapse to last submitted
- `browser.stop` during pending queue clears everything
- `terminal.execute` -> `terminal.write` -> completion flows correctly
- `terminal.restart` while execute queued cancels the execute
- Browser and terminal controllers operate independently

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Double execution from drain | drain() only called from two code paths, guarded by `active !== null` check |
| Bypass actions triggering spurious drain | Bypass actions never touch active slot or queue, so drain is never triggered |
| Replacement touching running action | replacesSameKind only scans queue array, active slot is separate |
| Silently dropped actions | Every cancelled/superseded action gets explicit `failed` status + reason string, visible in UI |
| terminal.write interleaving with queued execute | requiresActiveAction guard rejects write when nothing is running; write only proceeds when there's a running action to receive it |

## Known Limitations

- No action cancellation from the UI (cancel a specific queued action by ID). This is the next milestone.
- `browser.stop` cancels queued actions but cannot abort the running navigation at the controller level — it relies on BrowserService.stop() to halt the active tab's loading.
- `terminal.restart` destroys the PTY, which will cause the running action's executor to error — this is correct but the error message may be confusing (service-level error rather than policy-level message).
- No priority ordering within the queue. FIFO only. No action kind gets priority over another in the serialize path.
