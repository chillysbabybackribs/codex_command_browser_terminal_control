# Concurrency Control / Surface Serialization — Implementation Report

**Date:** 2026-04-10
**Spec:** `docs/superpowers/specs/2026-04-10-concurrency-control-design.md`
**Plan:** `docs/superpowers/plans/2026-04-10-concurrency-control.md`
**Base:** `d39ab3a` | **Head:** `7c5272c`
**Tests:** 104/104 passing (29 new, 75 pre-existing)

---

## Executive Summary

The system now enforces deterministic, per-surface execution ordering for all 12 action kinds. Before this pass, `SurfaceActionRouter.submit()` called `executeAction()` without awaiting, allowing rapid submissions to execute in parallel on the same surface with no policy. After this pass, every action flows through a per-surface `SurfaceExecutionController` that enforces serialization, bypass, replacement, and guard policies defined in a pure-data policy map. The router is no longer responsible for execution ordering — it validates, persists, and delegates.

---

## Files Created

| File | Lines | Purpose |
|---|---|---|
| `src/main/actions/surfaceActionPolicy.ts` | 38 | Policy types (`ConcurrencyMode`, `ActionConcurrencyPolicy`) and the `ACTION_CONCURRENCY_POLICY` map covering all 12 action kinds. Pure data, no logic. Typed as `Record<SurfaceActionKind, ActionConcurrencyPolicy>` for compile-time exhaustiveness. |
| `src/main/actions/surfaceActionPolicy.test.ts` | 62 | 9 tests: completeness (every kind has a policy, no extra keys), and value verification for each policy group (navigation serialize+replace, tab serialize, stop bypass+clear, execute serialize+replace, write bypass+guard, interrupt/restart bypass+clear). |
| `src/main/actions/SurfaceExecutionController.ts` | 89 | Per-surface controller class. Manages a FIFO `queue: SurfaceAction[]` and an `active: SurfaceAction | null` slot. Methods: `submit(action, policy)`, `getActive()`, `getQueueLength()`. Private: `enqueue()`, `drain()`, `executeImmediate()`, `cancelQueued()`. Receives execute and fail callbacks from the router — never touches state or events directly. |
| `src/main/actions/SurfaceExecutionController.test.ts` | 500 | 20 tests across 6 describe blocks: serialize (5), bypass (3), replacesSameKind (3), clearsQueue (3), requiresActiveAction (3), integration scenarios (3). |

## Files Updated

| File | Change |
|---|---|
| `src/main/actions/SurfaceActionRouter.ts` | Removed `activeActions: Map<string, SurfaceAction>`. Added `browserController` and `terminalController` instances. Constructor wires execute callback (`this.executeAction`) and fail callback (`this.failActionByPolicy`). `submit()` now delegates to the correct controller with the looked-up policy. Added `failActionByPolicy()` for cancelled/superseded/rejected actions. Removed `finally { this.activeActions.delete(id) }` from `executeAction()`. Net: +46/-16 lines. |

## Files Unchanged

- `surfaceActionTypes.ts` — No new lifecycle states
- `browserActionExecutor.ts` / `terminalActionExecutor.ts` — Called the same way by the execution callback
- `BrowserService.ts` / `TerminalService.ts` — Services unchanged
- `reducer.ts` / `appStateStore.ts` — State shape unchanged; `ADD_SURFACE_ACTION` and `UPDATE_SURFACE_ACTION` handle everything
- `eventBus.ts` — No new events
- `command.ts` — No structural UI changes; error strings from policy failures render through existing `r.error` display

---

## Architecture Notes

### Separation of Concerns

```
Renderer (IPC)
    │
    ▼
SurfaceActionRouter ──── validates, persists record, emits SUBMITTED event
    │
    ├── looks up policy from ACTION_CONCURRENCY_POLICY[kind]
    │
    ▼
SurfaceExecutionController ──── queue/slot management, policy enforcement
    │
    ├── serialize: enqueue → drain when slot free
    ├── bypass: executeImmediate (no slot, no queue)
    ├── replacesSameKind: supersede queued same-kind before enqueue
    ├── clearsQueue: cancel all queued before bypass
    └── requiresActiveAction: reject if slot empty
    │
    ▼
executeAction callback ──── status transitions, executor dispatch, events, logging
    │
    ├── executeBrowserAction() ──── BrowserService methods
    └── executeTerminalAction() ──── TerminalService methods
```

The controller never touches `appStateStore`, `eventBus`, or lifecycle events. It only calls:
- `execute(action)` — the router's `executeAction()` method, which handles running → completed/failed transitions
- `onPolicyFail(action, reason)` — the router's `failActionByPolicy()` method, which transitions to failed with the reason string

This makes the controller independently testable with mocked callbacks.

### Per-Surface Independence

Two controller instances exist: `browserController` and `terminalController`. They share no state. Browser serialization does not block terminal execution and vice versa. This is verified by the "browser and terminal controllers are independent" integration test.

### Policy Map as Single Source of Truth

The `ACTION_CONCURRENCY_POLICY` map is the only place concurrency rules are defined. The controller is policy-agnostic — it reads the policy struct passed to `submit()` and executes the appropriate code path. Adding or changing a policy for an action kind requires editing exactly one line in the map.

The map is typed as `Record<SurfaceActionKind, ActionConcurrencyPolicy>`, which means:
- Adding a new action kind to `SurfaceActionKind` causes a compile error until a policy entry is added
- The policy test "has a policy for every action kind" provides runtime verification as a second guard

---

## Policy Decisions

### Browser Surface

| Kind | Policy | Behavior |
|---|---|---|
| `browser.navigate` | serialize, replacesSameKind | Queues. If another navigate is already queued, supersedes it. Running navigate is untouched. |
| `browser.back` | serialize, replacesSameKind | Queues. Supersedes queued same-kind. |
| `browser.forward` | serialize, replacesSameKind | Queues. Supersedes queued same-kind. |
| `browser.reload` | serialize, replacesSameKind | Queues. Supersedes queued same-kind. |
| `browser.stop` | bypass, clearsQueue | Executes immediately. Cancels all queued browser actions. Does not touch the running action (relies on BrowserService.stop() to halt loading). |
| `browser.create-tab` | serialize | Queues. No replacement — each create is distinct. |
| `browser.close-tab` | serialize | Queues. No replacement — each close targets a specific tab. |
| `browser.activate-tab` | serialize | Queues. No replacement — each activation targets a specific tab. |

All browser actions share a single queue. Tab operations serialize alongside navigation operations. This avoids edge cases like close-tab racing with navigate on the same tab.

### Terminal Surface

| Kind | Policy | Behavior |
|---|---|---|
| `terminal.execute` | serialize, replacesSameKind | Queues. If another execute is queued, supersedes it. Running execute is untouched. |
| `terminal.write` | bypass, requiresActiveAction | Executes immediately if an action is running (expected stdin for a command). Rejected if no action is running — there is no target for the input. Does not occupy the active slot. |
| `terminal.interrupt` | bypass, clearsQueue | Executes immediately. Cancels all queued terminal actions. Sends Ctrl+C to the PTY. |
| `terminal.restart` | bypass, clearsQueue | Executes immediately. Cancels all queued terminal actions. Destroys and recreates the PTY session. |

### terminal.write Guard Detail

The `requiresActiveAction` guard prevents a specific class of bugs:
- **With active action**: Write delivers stdin (e.g., answering a y/n prompt from `npm test`). This is the expected use case.
- **Without active action**: Write has no target. Sending input to an idle shell could execute unintended commands. The write is rejected with `"No active terminal action to receive input"`.
- **With only queued actions**: The guard checks `this.active`, not the queue. If actions are queued but none is running, the write is still allowed because the active slot IS occupied by the currently executing action. Queued actions are waiting; the active action is the one receiving PTY output. This is correct.

---

## Implementation Detail

### SurfaceExecutionController (89 lines)

```typescript
class SurfaceExecutionController {
  private queue: SurfaceAction[] = [];
  private active: SurfaceAction | null = null;

  constructor(
    readonly surface: SurfaceTarget,
    private readonly execute: ExecuteCallback,    // (action) => Promise<void>
    private readonly onPolicyFail: FailCallback,  // (action, reason) => void
  ) {}
```

**`submit(action, policy)`** — The entry point. Branches on `policy.mode`:

For `bypass`:
1. If `policy.requiresActiveAction && this.active === null` → throw (rejected)
2. If `policy.clearsQueue` → `cancelQueued("Cancelled by {kind}")`
3. `executeImmediate(action)` — fire-and-forget, no slot/queue interaction

For `serialize`:
1. If `policy.replacesSameKind` → filter queue, fail same-kind entries with `"Superseded by newer {kind}"`
2. Push to queue
3. If `active === null` → `drain()`

**`drain()`** — The queue pump. Called from two locations only:
1. After `enqueue()` when `active === null`
2. After execution callback settles (in `.finally()`)

Guards: returns immediately if `active !== null` or queue is empty. Shifts the next action, sets it as active, calls `execute(action)`. On settle: clears active, calls `drain()` recursively. The recursion is safe because `active` is cleared before the recursive call, and the first line of `drain()` returns if `active !== null`.

**`executeImmediate(action)`** — For bypass actions. Calls `execute(action)` directly. Does not set `active` or touch the queue. Errors are caught and ignored at this level — the execute callback (router) handles error semantics.

**`cancelQueued(reason)`** — Atomically drains the queue via `splice(0)`, then calls `onPolicyFail` for each cancelled action with the reason string.

### SurfaceActionRouter Changes

**Before (broken flow):**
```
submit() → validate → create record → persist → emit → this.activeActions.set() → this.executeAction() [fire-and-forget]
```

**After (serialized flow):**
```
submit() → validate → create record → persist → emit → lookup policy → controller.submit(action, policy)
```

The router's `submit()` catches controller throws (from `requiresActiveAction` guard):
```typescript
try {
  controller.submit(action, policy);
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  this.failActionByPolicy(action, reason);
}
```

Since the action record is already persisted as `queued` before delegation, the catch transitions it to `failed` with the rejection reason. This preserves the audit trail — the operator sees the rejected action in the Command Center with a clear error message.

**`failActionByPolicy(action, reason)`** — New method. Handles cancelled, superseded, and rejected actions:
1. Updates record: `status: 'failed'`, `error: reason`
2. Emits `SURFACE_ACTION_FAILED` event
3. Logs at `warn` level: `"Action cancelled: {reason}"`

This is the `onPolicyFail` callback wired into both controllers.

**`executeAction(action)`** — Unchanged in logic. Still handles:
- Status transition to `running`
- `SURFACE_ACTION_STARTED` event
- Terminal command state tracking
- Executor dispatch
- Status transition to `completed`/`failed`
- Event emission and logging

The only structural change: the `finally { this.activeActions.delete(id) }` block was removed. The controller's `drain()` method now owns lifecycle advancement via its `.finally()` handler.

---

## Deterministic Answers

These scenarios are now encoded in the system and verified by tests:

### Browser

**Q: `browser.navigate(A)` is running and `browser.navigate(B)` is submitted. What happens?**
A: B enters the queue. A continues running. When A completes (or fails), drain picks up B. Both execute in order. (Tested: "queues second action while first is running")

**Q: `browser.navigate(A)` is queued and `browser.navigate(B)` is submitted. What happens?**
A: B supersedes A. A transitions to `failed` with `"Superseded by newer browser.navigate"`. B takes A's queue position. (Tested: "supersedes queued action of same kind")

**Q: Three navigates submitted rapidly: A, B, C?**
A: A runs immediately. B queues. C supersedes B (`"Superseded by newer browser.navigate"`). When A completes, C drains. B is visible in Command Center as failed with the supersession reason. (Tested: "browser: rapid navigates collapse, stop clears remainder")

**Q: `browser.reload` submitted while `browser.navigate` is running?**
A: Reload enters queue (serialize). Executes after navigate completes. Both actions are different kinds — no replacement.

**Q: `browser.stop` submitted while browser queue has pending items?**
A: All queued actions fail with `"Cancelled by browser.stop"`. Stop executes immediately (bypass). Running action is not touched by the controller — BrowserService.stop() halts the active tab's loading. (Tested: "cancels all queued actions and executes immediately")

### Terminal

**Q: `terminal.execute("npm test")` then `terminal.execute("pwd")` submitted immediately after?**
A: "npm test" starts executing (drain picks it up). "pwd" enters queue. When "npm test" completes, "pwd" drains. If a third execute were submitted while "pwd" is queued, it would supersede "pwd". (Tested: "queues second action while first is running" + "supersedes queued action of same kind")

**Q: `terminal.write("y\n")` submitted while `terminal.execute` is active?**
A: Write bypasses the queue. Active slot is occupied (execute is running). `requiresActiveAction` check passes. Write executes immediately — sends "y\n" to PTY as stdin. (Tested: "executes when an action is active")

**Q: `terminal.write("y\n")` submitted with no active action?**
A: Rejected. Controller throws `"No active terminal action to receive input"`. Router catches the throw and transitions the already-persisted record to `failed` with this reason. Visible in Command Center. (Tested: "throws when no action is active")

**Q: `terminal.restart` submitted while terminal actions are queued/running?**
A: All queued terminal actions fail with `"Cancelled by terminal.restart"`. Restart executes immediately (bypass). The running action's PTY is destroyed by the restart — the execution callback for that action will receive an error from TerminalService, transitioning it to `failed`. (Tested: "terminal: execute + write + restart sequence")

---

## Testing Validation

### Test Suite Summary

```
 Test Files  9 passed (9)
      Tests  104 passed (104)
   Duration  849ms
```

### Concurrency Control Tests: 29 total

#### Policy Map Tests (9)

| # | Test | Validates |
|---|---|---|
| 1 | has a policy for every action kind | Completeness: all 12 kinds covered |
| 2 | has no extra keys beyond known action kinds | No stale or phantom entries |
| 3 | browser navigation actions serialize with replacesSameKind | navigate, back, forward, reload policies correct |
| 4 | browser tab actions serialize without replacesSameKind | create-tab, close-tab, activate-tab policies correct |
| 5 | browser.stop bypasses and clears queue | Stop is a bypass+clear action |
| 6 | terminal.execute serializes with replacesSameKind | Execute serializes with replacement |
| 7 | terminal.write bypasses with requiresActiveAction | Write bypasses with guard |
| 8 | terminal.interrupt bypasses and clears queue | Interrupt is bypass+clear |
| 9 | terminal.restart bypasses and clears queue | Restart is bypass+clear |

#### Serialize Path Tests (5)

| # | Test | Validates |
|---|---|---|
| 1 | executes the first submitted action immediately | Empty slot → immediate execution |
| 2 | queues second action while first is running | Occupied slot → queue, drain on completion |
| 3 | executes three actions in FIFO order | Ordering guarantee across multiple actions |
| 4 | drains after a failed action | Failure does not stall the queue |
| 5 | drain with empty queue is a no-op | No spurious execution calls |

#### Bypass Path Tests (3)

| # | Test | Validates |
|---|---|---|
| 1 | bypass executes immediately even with serialized action running | Bypass ignores the active slot |
| 2 | bypass does not occupy the active slot | `getActive()` returns null during bypass |
| 3 | bypass does not affect queue drain | Serialize pipeline continues unaffected |

#### replacesSameKind Tests (3)

| # | Test | Validates |
|---|---|---|
| 1 | supersedes queued action of same kind | Queued same-kind → failed with reason, new action takes position |
| 2 | does not supersede running action | Active slot is never touched by replacement |
| 3 | does not supersede queued actions of different kind | Only same-kind entries are replaced |

#### clearsQueue Tests (3)

| # | Test | Validates |
|---|---|---|
| 1 | cancels all queued actions and executes immediately | Queue emptied, all entries failed with reason, bypass executes |
| 2 | does not touch the running action | Active slot untouched by clear |
| 3 | works when queue is already empty | No crash on empty queue clear |

#### requiresActiveAction Tests (3)

| # | Test | Validates |
|---|---|---|
| 1 | throws when no action is active | Empty slot → rejection with reason |
| 2 | executes when an action is active | Occupied slot → bypass succeeds |
| 3 | succeeds when an action is running even if others are queued | Active + queued → bypass succeeds (active slot is the gate, not queue) |

#### Integration Scenario Tests (3)

| # | Test | Validates |
|---|---|---|
| 1 | browser: rapid navigates collapse, stop clears remainder | replacesSameKind + clearsQueue compose correctly: nav2 superseded, nav3 cancelled by stop |
| 2 | terminal: execute + write + restart sequence | serialize + bypass/guard + bypass/clear compose correctly: exec1 runs, write bypasses to stdin, restart clears exec2 |
| 3 | browser and terminal controllers are independent | Cross-surface isolation: stopping browser does not trigger terminal failures |

### Correctness Validation

**Lifecycle Semantics:**
- `queued` → only when action is in the controller's queue or just persisted to state
- `running` → only when `executeAction()` is called (inside the execute callback)
- `completed` → only after executor returns successfully
- `failed` → only after executor throws, or policy cancels/supersedes/rejects
- No action skips states. No action enters `running` without being in `queued` first (the record is created as `queued` by the router before the controller sees it).
- Verified by: all serialize tests check execution order; all policy tests check `onFail` calls with exact reason strings.

**Drain Safety:**
- `drain()` is guarded by `if (this.active !== null) return` — prevents double execution
- `drain()` is called from exactly two locations: `enqueue()` when slot is free, and `.finally()` after execution settles
- Bypass actions never call `drain()` — they use `executeImmediate()` which does not touch the slot or queue
- `cancelQueued()` uses `splice(0)` for atomic queue clearing — no partial iteration
- Verified by: "drain with empty queue is a no-op", "bypass does not affect queue drain", "drains after a failed action"

**Edge Cases Covered:**
- Rapid same-kind submissions (replacement collapses queue)
- Stop/interrupt/restart while queue is empty (no-op clear, bypass still executes)
- Write with active action and queued actions (passes — active slot is the gate)
- Write with no actions at all (rejected)
- Failure in execution callback (queue advances to next action)
- Mixed policy types in single sequence (integration tests)
- Two independent controllers (cross-surface isolation test)

### Edge Cases NOT Covered (Known Limitations)

1. **No UI-initiated cancellation of specific queued actions by ID.** The controller has no `cancel(actionId)` method. This is documented as the next milestone.
2. **No queue size limit.** The controller's queue can grow unbounded if many unique-kind serialize actions are submitted rapidly. In practice, the 12 action kinds with `replacesSameKind` on navigation/execute means the queue will rarely exceed 3-4 entries. The pre-existing `MAX_ACTIONS = 200` constant in the router is unused.
3. **`browser.stop` does not abort the running navigation at the controller level.** It bypasses and executes BrowserService.stop(), which halts tab loading. The running action's executor may still complete or fail independently. This is correct behavior but means the running action's lifecycle depends on the service, not the controller.
4. **`terminal.restart` destroys the PTY while a terminal action is running.** The running action's execution callback will receive a service-level error from TerminalService. The error message will be from the service (e.g., "Terminal session not running") rather than a policy-level message. This is correct but the error string may be less clear than "Cancelled by terminal.restart".
5. **No test for bypass execution errors being swallowed.** The `executeImmediate()` method uses `.catch(() => {})`. The execute callback handles error semantics, so this is correct, but no test explicitly verifies that a bypass action's error does not propagate.

---

## Verification Checklist

- [x] `npx vitest run` — 104/104 tests pass
- [x] Policy map covers all 12 action kinds (compile-time + runtime verified)
- [x] Controller serialize: actions queue and drain in FIFO order
- [x] Controller bypass: stop/interrupt/restart execute immediately
- [x] Controller replacesSameKind: queued duplicates superseded with reason
- [x] Controller clearsQueue: stop/interrupt/restart cancel queued with reason
- [x] Controller requiresActiveAction: terminal.write rejected when no active action
- [x] Router delegates to controller, no longer calls executeAction directly
- [x] Router catches policy rejection and transitions record to failed
- [x] Failed/cancelled actions have explicit error strings visible in state
- [x] No `activeActions` map in the router (replaced by controller slots)
- [x] No new lifecycle states introduced
- [x] Browser and terminal controllers operate independently
- [x] Existing 75 pre-existing tests unaffected (no regressions)

---

## Commit History

```
3cec172 feat: add surface action concurrency policy map
12c1465 feat: add SurfaceExecutionController with serialize mode
534b2e6 feat: add bypass mode to SurfaceExecutionController
db6e66f feat: add replacesSameKind to SurfaceExecutionController
7e38144 feat: add clearsQueue to SurfaceExecutionController
40185d3 feat: add requiresActiveAction guard to SurfaceExecutionController
586b525 feat: integrate SurfaceExecutionController into SurfaceActionRouter
52878d5 test: add integration scenarios for concurrency control
5edeef5 test: add integration scenarios for concurrency control
7c5272c fix: rename misleading test name for requiresActiveAction guard
```

Each commit is atomic: one concern per commit, tests pass at every point, TDD throughout.
