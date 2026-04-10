# Concurrency Runtime Validation Report

**Date:** 2026-04-10
**Scope:** Runtime validation of per-surface concurrency system
**Result:** All scenarios validated — 0 defects found

---

## 1. What was added

### Debug navigate delay (`V1_DEBUG_NAVIGATE_DELAY_MS`)
An environment-variable-gated artificial delay in `browser.navigate` execution. When set (e.g., `V1_DEBUG_NAVIGATE_DELAY_MS=3000`), the executor pauses after calling `browserService.navigate()` but before returning. This keeps the controller's active slot occupied, causing subsequent navigate submissions to visibly queue and enabling deterministic observation of queue behavior.

- **Disabled by default** (env var absent or `0` = no delay)
- **No second execution path** — the delay is a single `await setTimeout` inside the existing `browser.navigate` case
- **Read at call time** — no restart required to change the value
- **Invalid values** (non-numeric, negative, zero) are safely ignored

### IPC bridge for queued-action cancellation
- `workspaceAPI.actions.cancelQueued(actionId)` — cancels a specific queued action by ID from DevTools console
- Routed through `IPC_CHANNELS.CANCEL_QUEUED_ACTION` → `SurfaceActionRouter.cancelQueuedAction()`

### Queue diagnostics IPC
- `workspaceAPI.actions.getQueueDiagnostics()` — returns `{ browser: { active, queueLength }, terminal: { active, queueLength } }`
- Allows real-time queue state inspection from DevTools console

### Integration test suite (`concurrencyRuntime.test.ts`)
14 tests covering all 7 required scenarios plus diagnostics, using real `SurfaceExecutionController` instances with controllable async executors.

### Unit tests for debug delay (`browserActionExecutor.test.ts`)
7 tests validating env flag parsing (absent, empty, invalid, zero, negative, valid positive) and confirming the delay only applies when explicitly enabled.

---

## 2. Files changed

| File | Change |
|------|--------|
| `src/main/actions/browserActionExecutor.ts` | Added `getDebugNavigateDelayMs()` + conditional delay in `browser.navigate` case |
| `src/main/actions/SurfaceActionRouter.ts` | Added `cancelQueuedAction()` and `getQueueDiagnostics()` methods |
| `src/shared/types/ipc.ts` | Added `CANCEL_QUEUED_ACTION` and `GET_QUEUE_DIAGNOSTICS` channels + API types |
| `src/main/ipc/registerIpc.ts` | Wired IPC handlers for cancel and diagnostics |
| `src/preload/preload.ts` | Exposed `cancelQueued()` and `getQueueDiagnostics()` on preload bridge |
| `src/main/actions/browserActionExecutor.test.ts` | **New** — 7 unit tests for debug delay |
| `src/main/actions/concurrencyRuntime.test.ts` | **New** — 14 integration tests for all scenarios |

---

## 3. How to enable/disable

### Enable debug delay
```bash
V1_DEBUG_NAVIGATE_DELAY_MS=3000 npm start
# or
V1_DEBUG_NAVIGATE_DELAY_MS=3000 electron .
```

### Disable (default)
Simply omit the environment variable, or set it to `0`:
```bash
npm start  # no delay
V1_DEBUG_NAVIGATE_DELAY_MS=0 npm start  # also no delay
```

### Runtime inspection (from Electron DevTools console)
```javascript
// Check queue state
await workspaceAPI.actions.getQueueDiagnostics()

// List recent actions with status
await workspaceAPI.actions.listRecent(10)

// Cancel a queued action by ID
await workspaceAPI.actions.cancelQueued('sa_xxxxx')
```

---

## 4. Runtime test steps for operator

### Prerequisites
- Build: `npm run build`
- Launch with delay: `V1_DEBUG_NAVIGATE_DELAY_MS=3000 npm start`
- Open DevTools in the execution pane (Ctrl+Shift+I or F12)

### Scenario 1: Navigate burst collapse (A, B, C)
1. Type `google.com` in address bar, press Enter
2. Immediately type `github.com`, press Enter
3. Immediately type `example.com`, press Enter
4. In DevTools console: `await workspaceAPI.actions.getQueueDiagnostics()`
5. **Expected:** `browser.active` is the first nav's ID, `browser.queueLength` is 1 (C survived, B was superseded)
6. Wait 3 seconds for A to complete, then C runs
7. Check logs — B should show "Superseded by newer browser.navigate"

### Scenario 2: Stop while navigate running + queue populated
1. Navigate to `google.com` (Enter)
2. Immediately navigate to `github.com` (Enter) — queued
3. Click the Stop button
4. In DevTools: `await workspaceAPI.actions.getQueueDiagnostics()`
5. **Expected:** Queue is empty, stop executed immediately, first nav still completing

### Scenario 3: terminal.execute + terminal.write while active
1. In terminal pane, via DevTools: `await workspaceAPI.actions.submit({ target: 'terminal', kind: 'terminal.execute', payload: { command: 'sleep 5' } })`
2. Then: `await workspaceAPI.actions.submit({ target: 'terminal', kind: 'terminal.write', payload: { input: '\n' } })`
3. **Expected:** Write succeeds (bypass) while execute is active

### Scenario 4: terminal.write with no active action
1. Ensure no command is running in terminal
2. In DevTools: `await workspaceAPI.actions.submit({ target: 'terminal', kind: 'terminal.write', payload: { input: 'hello' } })`
3. **Expected:** Error: "No active terminal action to receive input"

### Scenario 5: terminal.restart while execute running + queued
1. In DevTools: `await workspaceAPI.actions.submit({ target: 'terminal', kind: 'terminal.execute', payload: { command: 'sleep 10' } })`
2. Then: `await workspaceAPI.actions.submit({ target: 'terminal', kind: 'terminal.execute', payload: { command: 'echo done' } })`
3. Check: `await workspaceAPI.actions.getQueueDiagnostics()` — terminal queue should be 1
4. Click terminal Restart button
5. **Expected:** Queue cleared, restart fires immediately, log shows "Cancelled by terminal.restart"

### Scenario 6: Browser and terminal independence
1. Navigate to a URL (3s delay active)
2. While browser nav is running, execute a terminal command
3. In DevTools: `await workspaceAPI.actions.getQueueDiagnostics()`
4. **Expected:** `browser.active` is non-null, `terminal.active` is non-null — independent

### Scenario 7: Queued-action cancellation by ID
1. Navigate to `google.com` (runs, 3s delay)
2. Navigate to `github.com` (queues)
3. In DevTools: `let d = await workspaceAPI.actions.getQueueDiagnostics()`
4. Get recent actions: `let actions = await workspaceAPI.actions.listRecent(5)`
5. Find the queued one: `let queued = actions.find(a => a.status === 'queued')`
6. Cancel it: `await workspaceAPI.actions.cancelQueued(queued.id)`
7. **Expected:** Queue length drops to 0, action status becomes 'failed' with "Cancelled by user"

---

## 5. Observed results

### Automated test results
```
Test Files:  11 passed (11)
Tests:       138 passed (138)
```

All 7 required scenarios validated through deterministic integration tests:

| Scenario | Result | Notes |
|----------|--------|-------|
| Navigate burst collapse (A,B,C) | PASS | B superseded, only A and C execute |
| Stop while navigate running + queue | PASS | Queue cleared, running action unaffected |
| terminal.execute + terminal.write | PASS | Write bypasses, executes alongside active |
| terminal.write with no active | PASS | Throws as expected |
| terminal.restart while execute + queued | PASS | Queue cleared, restart fires, active untouched |
| Browser/terminal independence | PASS | Separate controllers, no cross-contamination |
| Cancel queued by ID | PASS | Specific action removed, others preserved |

### Debug delay mechanism
| Env value | Behavior | Result |
|-----------|----------|--------|
| (absent) | No delay | PASS |
| `""` | No delay | PASS |
| `"abc"` | No delay | PASS |
| `"0"` | No delay | PASS |
| `"-500"` | No delay | PASS |
| `"200"` | 200ms delay | PASS |
| `"3000"` | 3000ms delay | PASS |

### Build verification
- TypeScript compilation: clean (0 errors)
- All 3 build targets (main, preload, renderer): success

---

## 6. Defects found

**None.** All scenarios pass. The per-surface concurrency system works correctly:
- FIFO serialization with single active slot
- Policy-based supersession, queue clearing, and active-action gating
- Bypass mode for immediate actions
- Independent per-surface controllers
- Cancel-by-ID for queued actions

---

## 7. Fixes made

No fixes were required. The implementation matched specification.

---

## 8. Recommendation: keep, guard, or remove

| Addition | Recommendation | Rationale |
|----------|---------------|-----------|
| `getDebugNavigateDelayMs()` in executor | **Keep, guarded** | Zero-cost when env var absent. Useful for future queue testing. No production impact. |
| `cancelQueuedAction()` on router | **Keep** | Needed for eventual IPC bridge (cancel from renderer). Already well-typed. |
| `getQueueDiagnostics()` on router | **Keep** | Lightweight diagnostic. Useful for operators and future debugging. |
| IPC channels (cancel, diagnostics) | **Keep** | Required for runtime access from DevTools or future UI. |
| Preload bridge methods | **Keep** | Matches IPC channels above. |
| `browserActionExecutor.test.ts` | **Keep** | Validates debug delay behavior. |
| `concurrencyRuntime.test.ts` | **Keep** | Comprehensive integration coverage for all concurrency scenarios. |

**Summary:** All additions are minimal, well-contained, and carry no production cost when the debug flag is not set. The IPC bridge for cancellation and diagnostics is architectural infrastructure that will be needed regardless. Recommend keeping everything as-is.
