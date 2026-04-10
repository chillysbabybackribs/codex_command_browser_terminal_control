# Terminal Persistence via tmux — Design Spec

## Problem

The terminal surface loses all state on window close or app restart. Running CLIs (claude-code, codex, dev servers) are killed. Scrollback, working directory, and in-progress work are gone. The browser surface already persists tabs, history, bookmarks, and settings — the terminal should match.

## Solution

Back the terminal PTY with a tmux session. On window close/reopen or app restart, reattach to the existing tmux session and restore full terminal state including scrollback, colors, and cursor position. Fall back gracefully to a plain PTY if tmux is not installed, with a visible suggestion to install it.

## Architecture

### Session Lifecycle

```
App Start
  ├─ tmux available?
  │   ├─ YES: existing v1workspace session alive?
  │   │   ├─ YES → reattach (capture scrollback → write to xterm → attach stream)
  │   │   └─ NO  → create new tmux session, spawn shell inside it
  │   └─ NO: spawn plain PTY (current behavior), log suggestion to install tmux
  │
App Window Close (hide-on-close)
  ├─ tmux mode: detach from session (session stays alive in background)
  └─ plain mode: PTY keeps running (already works — process tied to app, not window)
  │
App Quit (before-quit)
  ├─ tmux mode: save session metadata (cwd, session name) to disk, leave tmux running
  └─ plain mode: kill PTY (current behavior)
  │
App Restart
  ├─ tmux mode: find existing session → reattach with scrollback restoration
  └─ plain mode: fresh shell
```

### tmux Session Management

- **Session name:** `v1workspace` (deterministic, one session per app instance)
- **Detection:** `which tmux` or `command -v tmux` at service init
- **Create:** `tmux new-session -d -s v1workspace -x {cols} -y {rows}`
- **Attach (for PTY pipe):** Don't use `tmux attach`. Instead, spawn a PTY running `tmux attach-session -t v1workspace`. This gives node-pty a process to manage while tmux owns the actual shell.
- **Scrollback capture:** `tmux capture-pane -t v1workspace -p -e -S -` captures the full scrollback with ANSI escapes intact
- **Detach:** Just kill the PTY process (the `tmux attach` wrapper). The tmux session survives.
- **Session alive check:** `tmux has-session -t v1workspace` (exit code 0 = alive)
- **Resize:** `tmux resize-window -t v1workspace -x {cols} -y {rows}` in addition to PTY resize

### Scrollback Restoration Flow

On reattach:
1. Run `tmux capture-pane -t v1workspace -p -e -S -` to get full scrollback with colors
2. Write captured content into xterm.js via `term.write()`
3. Then spawn `tmux attach-session -t v1workspace` via node-pty
4. Pipe live output from that PTY into xterm.js as normal
5. Renderer shows "Reconnecting..." during steps 1-3, then transitions to normal

### Persistence Store

New file: `terminal-data.json` in userData, following the browser pattern.

```ts
type PersistedTerminalData = {
  tmuxSession: string | null;    // session name if tmux-backed
  lastCwd: string | null;        // working directory at last save
  shell: string;                 // shell path
  persistent: boolean;           // was this a tmux session?
};
```

Saved on:
- App quit (before-quit)
- Periodic cwd tracking (read via `tmux display-message -t v1workspace -p '#{pane_current_path}'`)

### CWD Tracking

In tmux mode, periodically (every 5s while session is running) query:
```
tmux display-message -t v1workspace -p '#{pane_current_path}'
```
Store in persistence file. Used for:
- Updating `TerminalSessionInfo.cwd` for UI display
- Restoring cwd on fresh session creation if tmux session died

### Fallback Behavior (no tmux)

Identical to current behavior, plus:
- On startup: log `info` message to Command Center: "Terminal persistence unavailable — install tmux for session survival across restarts"
- Show in terminal status meta area: "(no persistence)"
- On restart: attempt to restore last known cwd from persistence file when spawning new shell

### TerminalSessionInfo Changes

Add fields to track persistence mode:

```ts
type TerminalSessionInfo = {
  // ... existing fields ...
  persistent: boolean;           // true if tmux-backed
  tmuxSession: string | null;    // tmux session name
  restored: boolean;             // true if this was a reattach
};
```

### TerminalService Changes

- New `tmuxAvailable` boolean, set once at init
- `startSession()` branches: tmux path vs plain path
- New `reattachSession()` method for reconnecting to existing tmux session
- New `captureScrollback()` method that returns the full pane content
- `restart()` in tmux mode: kill tmux session, create fresh one
- `dispose()` in tmux mode: detach only (don't kill tmux session) unless app is quitting
- New `getCwd()` method using tmux query
- CWD polling timer (5s interval, only in tmux mode)

### IPC/Preload Changes

- New channel: `TERMINAL_CAPTURE_SCROLLBACK` → returns string content
- New field in session info exposed to renderer
- Renderer needs to handle the reattach flow (show reconnecting state, write scrollback, then attach live)

### Renderer Changes

- On init: check if session is `restored` — if so, request scrollback capture, write to xterm, then start receiving live output
- "Reconnecting..." overlay during restoration
- Terminal meta shows "(persistent)" or "(no persistence)" badge

### Event Additions

- `TERMINAL_SESSION_REATTACHED` — emitted when successfully reconnecting to existing tmux session
- Payload: `{ session: TerminalSessionInfo; scrollbackLength: number }`

## Security

- tmux session name is hardcoded, not user-supplied (no injection)
- Shell commands to tmux use `execFile`/`spawn` with argument arrays, not string interpolation
- No new preload surface beyond what already exists (just a new IPC channel returning a string)

## Edge Cases

- **tmux installed after app start:** Won't be detected until app restart. Acceptable.
- **tmux session killed externally:** `has-session` check fails → create new session, log notice
- **Multiple app instances:** Single-instance lock prevents this (already enforced)
- **tmux crashes:** PTY `onExit` fires → treated as session death → offer restart
- **Very large scrollback:** `capture-pane` output could be large. Cap at what tmux has (tmux default is 2000 lines, app doesn't change this). If needed later, can set `set-option -g history-limit`.

## Out of Scope

- tmux configuration customization (`.tmux.conf` integration)
- Multiple tmux panes/windows within the terminal surface
- tmux key bindings (the app owns the terminal, not tmux's UI)
- Auto-installing tmux

## Files to Create

- `src/main/terminal/terminalSessionStore.ts` — persistence (following browser pattern)
- `src/main/terminal/tmuxManager.ts` — tmux detection, session create/attach/detach/capture

## Files to Modify

- `src/main/terminal/TerminalService.ts` — major refactor for tmux-backed sessions
- `src/shared/types/terminal.ts` — add persistence fields to session info
- `src/shared/types/events.ts` — add TERMINAL_SESSION_REATTACHED event
- `src/shared/types/ipc.ts` — add scrollback capture channel
- `src/preload/preload.ts` — expose scrollback capture
- `src/renderer/global.d.ts` — update TerminalSessionInfo type
- `src/renderer/execution/execution.ts` — reattach flow with scrollback restoration + reconnecting UI
- `src/renderer/command/command.ts` — show persistence badge in terminal panel
- `src/main/ipc/registerIpc.ts` — register new handler
- `src/main/events/eventRouter.ts` — wire new event
- `src/main/main.ts` — adjust dispose behavior for tmux mode
