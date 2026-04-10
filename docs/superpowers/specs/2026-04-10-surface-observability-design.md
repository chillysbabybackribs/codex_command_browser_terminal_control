# Command Center Surface Observability — Design Spec

## Overview

Upgrade the Command Center from action sender + logs into an operator console that reflects real-time browser and terminal state. This is a projection and visibility pass on top of the existing orchestration layer — no new services, no new execution paths, no architectural changes.

## Goals

The Command Center must clearly show:

- What the browser is doing now
- What the terminal is doing now
- What actions are currently running
- What actions just completed or failed
- What failed and why

## Data Model Changes

### New Type: TerminalCommandState

Location: `src/shared/types/terminal.ts`

```typescript
type TerminalCommandState = {
  isRunning: boolean;
  lastCommand: string | null;
  lastExitCode: number | null;
  lastUpdatedAt: number;
};
```

This is a dedicated field in `AppState`, separate from `TerminalSessionInfo`. Session info describes the PTY (shell, PID, dimensions, tmux). Command state describes what orchestration knows about current command execution.

### Extend BrowserNavigationState

Location: `src/shared/types/browser.ts`

Add `lastNavigationAt: number | null` to `BrowserNavigationState`.

### Extend AppState

Location: `src/shared/types/appState.ts`

Add field: `terminalCommand: TerminalCommandState`

Default: `{ isRunning: false, lastCommand: null, lastExitCode: null, lastUpdatedAt: 0 }`

### Extend Reducer Actions

Location: `src/main/state/actions.ts`

Add `SET_TERMINAL_COMMAND` action type carrying `TerminalCommandState`.

### Extend Reducer

Location: `src/main/state/reducer.ts`

Handle `SET_TERMINAL_COMMAND` — replace `terminalCommand` field.

## State Synchronization

### Browser

Already wired. `BrowserService` pushes `SET_BROWSER_RUNTIME` on navigation, title, and loading events. The only addition: set `lastNavigationAt = Date.now()` in the navigation-completed path within `BrowserService`.

### Terminal

`SurfaceActionRouter` manages action lifecycle. On `terminal.execute`:

- **Action starts**: dispatch `SET_TERMINAL_COMMAND` with `isRunning: true`, `lastCommand: payload.command`
- **Action completes**: dispatch with `isRunning: false`, `lastExitCode: null` (PTY does not provide per-command exit codes; explicitly unknown)
- **Action fails**: dispatch with `isRunning: false`; error details preserved in the action record, not in command state

No shell parsing. No heuristic prompt detection. Command state is strictly what orchestration knows.

## Command Center UI

### Layout (top to bottom)

1. **Surface State Panel** (NEW) — browser + terminal live state at the top
2. **Task section** — existing, unchanged
3. **Action Composer** — existing, unchanged
4. **Active Actions** (NEW split) — queued + running actions only
5. **Recent Actions** (NEW split) — completed + failed actions, errors visually elevated
6. **Log Stream** — existing, pushed to bottom

### Surface State Panel

Displays:

**Browser:**
- Current URL
- Page title
- Loading indicator (visual, not just text)
- Back/forward navigation capability

**Terminal:**
- Ready / not ready
- Running / idle
- Last command executed
- Last exit code (or "unknown")

### Active vs Recent Actions Split

Current UI shows all 30 most recent actions in a single list. Replace with:

- **Active Actions**: only `queued` and `running` status. Shows target, kind, payload summary.
- **Recent Actions**: only `completed` and `failed` status. Shows target, kind, status, result summary, error summary.

### Error Visibility

Failed actions get distinct visual treatment in Recent Actions — not just a status dot, but a visible error message and highlighted row (border or background color). Errors must not require scrolling through logs to discover.

### Status Dots

The existing header status dots for browser/terminal are removed. The Surface State Panel replaces their function with richer information.

## Events and IPC

No new event types. Uses existing:

- `BROWSER_STATE_CHANGED`
- `TERMINAL_STATUS_UPDATED`

No new IPC channels. Uses existing:

- `workspaceAPI.onStateUpdate()` — for full state including new `terminalCommand` field
- `workspaceAPI.actions.onUpdate()` — for action lifecycle
- `workspaceAPI.browser.onStateUpdate()` — for browser state

## Files Touched

| File | Change |
|------|--------|
| `src/shared/types/terminal.ts` | Add `TerminalCommandState` type and default factory |
| `src/shared/types/browser.ts` | Add `lastNavigationAt` to `BrowserNavigationState` |
| `src/shared/types/appState.ts` | Add `terminalCommand` field to `AppState`, update default |
| `src/main/state/actions.ts` | Add `SET_TERMINAL_COMMAND` action |
| `src/main/state/reducer.ts` | Handle `SET_TERMINAL_COMMAND` |
| `src/main/actions/SurfaceActionRouter.ts` | Dispatch terminal command state on `terminal.execute` lifecycle |
| `src/main/browser/BrowserService.ts` | Set `lastNavigationAt` on navigation complete |
| `src/renderer/command/command.html` | Restructure layout with Surface State Panel at top |
| `src/renderer/command/command.ts` | Render Surface State Panel, split active/recent actions, error visibility |
| `src/renderer/command/command.css` | Styles for new panels (or inline in HTML if no separate CSS) |

## Explicit Non-Goals

- No new event types
- No new IPC channels
- No shell parsing or PTY introspection
- No new services or execution paths
- No chat, automation, or LLM integration
- No duplicate state types

## Validation

### Browser
- Navigating updates URL, title, loading indicator in Surface State Panel
- State matches actual browser view
- lastNavigationAt updates on navigation complete

### Terminal
- Executing a command via action composer updates running/idle state
- lastCommand reflects the executed command
- Exit code shows "unknown" (PTY limitation acknowledged)

### Actions
- Active vs recent separation works correctly
- Failed actions are immediately visible with error details
- Action completion aligns with state changes

### Consistency
- No mismatch between action results and displayed surface state
- No duplicate or conflicting state fields in AppState

## Success Standard

The Command Center accurately reflects real-time browser and terminal state using existing runtime models, without introducing duplicate state systems.
