# Phase 1: Close the Feedback Loop — Design Spec

## Problem

Haiku 4.5 is the workspace operator. It can navigate the browser and send terminal commands. But it operates blind:

- After `terminal_execute`, it receives `{dispatched: true}` — no command output, no exit code
- After `browser_navigate`, it receives `{url, title, isLoading}` — no page content
- `terminal.execute` actions are marked "completed" when the command is *sent to PTY*, not when it *finishes*

This makes Haiku unreliable for any workflow that requires verifying results. The user sees output in xterm.js and page content in the browser, but the model that controls those surfaces cannot.

## Goals

1. Haiku can read terminal output after executing a command
2. Haiku can read page text after navigating
3. Action completion semantics are honest — "completed" means the operation finished, not just that it was dispatched

## Non-Goals

- DOM interaction (click, type, form fill) — Phase 5
- Screenshot/vision capabilities — Phase 5
- Chat persistence — Phase 4
- System prompt enhancement — Phase 2
- Codex workspace awareness — Phase 3
- Shell prompt detection or exit code parsing — too fragile, not required
- Streaming terminal output to model in real-time — overkill for this phase

---

## Design

### 1. Terminal Output Ring Buffer

**Location:** `src/main/terminal/TerminalService.ts`

Add a ring buffer that captures recent PTY output:

```typescript
private outputBuffer: string[] = [];
private readonly MAX_BUFFER_LINES = 200;
```

On every `onData` event (inside `wirePtyEvents`), append incoming data to the buffer. Split on newlines. When buffer exceeds `MAX_BUFFER_LINES`, drop oldest lines.

Strip ANSI escape sequences before storage using the standard regex `// eslint-disable-next-line no-control-regex` / `/\x1b\[[0-9;]*[a-zA-Z]/g` (covers SGR, cursor movement, and erase sequences). Raw ANSI codes are useless to the model and waste tokens. No external dependency needed.

Expose a new public method:

```typescript
getRecentOutput(lineCount: number = 50): string
```

Returns the last N lines from the buffer, joined with newlines. Default 50 lines. Capped at `MAX_BUFFER_LINES`. Returns empty string if no output captured.

**On session restart:** Clear the buffer.

**On session exit:** Preserve the buffer (the last output before exit is often the most useful).

### 2. New Tool: `get_terminal_output`

**Location:** `src/main/models/tools/toolDefinitions.ts`

```typescript
{
  name: 'get_terminal_output',
  description: 'Get recent terminal output. Returns the last N lines of terminal output. Use this after executing a command to see what happened. Strips ANSI escape codes for readability.',
  input_schema: {
    type: 'object',
    properties: {
      lines: {
        type: 'number',
        description: 'Number of recent lines to return (default: 50, max: 200)'
      }
    }
  }
}
```

**Location:** `src/main/models/tools/toolExecutor.ts`

Add `get_terminal_output` to the observation tool handler:

```typescript
case 'get_terminal_output': {
  const lines = typeof input.lines === 'number'
    ? Math.min(Math.max(1, Math.floor(input.lines)), 200)
    : 50;
  const output = terminalService.getRecentOutput(lines);
  return {
    result: {
      lines: output.split('\n').length,
      output: output || '(no recent output)',
    },
    isError: false,
  };
}
```

Register `'get_terminal_output'` in the `OBSERVATION_TOOLS` tuple.

### 3. Enhanced `terminal_execute` Tool Result

**Location:** `src/main/actions/terminalActionExecutor.ts`

After writing the command to PTY, wait briefly for initial output, then return it in the result.

Current behavior:
```typescript
terminalService.write(command + '\n');
return { summary: `Command sent: ${command}`, data: { dispatched: true } };
```

New behavior:
```typescript
terminalService.write(command + '\n');

// Wait for output to settle (command echo + initial output)
await waitForOutputSettle(500, 3000);

const output = terminalService.getRecentOutput(50);
return {
  summary: `Executed: ${command}`,
  data: {
    command,
    sessionId: session.id,
    output: output.slice(-4096),  // cap at 4KB for token budget
  },
};
```

**`waitForOutputSettle` logic:**
- Poll `terminalService.getSession().lastActivityAt` every 100ms
- If no new activity for 500ms (settle time), return
- Hard timeout at 3000ms regardless
- This is a best-effort heuristic — not shell-aware, but catches the common case where a command produces output and then the prompt returns

This means `terminal_execute` now blocks until output settles or timeout, and returns the captured output directly. The tool executor (`waitForActionCompletion`) already waits 30s for action completion, so the 3s settle time fits within budget.

### 4. New Tool: `get_page_text`

**Location:** `src/main/models/tools/toolDefinitions.ts`

```typescript
{
  name: 'get_page_text',
  description: 'Get the visible text content of the current browser page. Returns the page text (document.body.innerText). Use this after navigating to verify what loaded. Large pages are truncated.',
  input_schema: {
    type: 'object',
    properties: {
      maxLength: {
        type: 'number',
        description: 'Maximum characters to return (default: 8000, max: 16000)'
      }
    }
  }
}
```

**Location:** `src/main/browser/BrowserService.ts`

Add a new public method:

```typescript
async getPageText(maxLength: number = 8000): Promise<string> {
  const entry = this.getActiveEntry();
  if (!entry) return '';
  try {
    const text: string = await entry.view.webContents.executeJavaScript(
      'document.body ? document.body.innerText : ""'
    );
    return text.slice(0, maxLength);
  } catch {
    return '(unable to extract page text)';
  }
}
```

**Location:** `src/main/models/tools/toolExecutor.ts`

Add `get_page_text` to the observation tool handler:

```typescript
case 'get_page_text': {
  if (!browserService.isCreated()) {
    return { result: { text: '', error: 'Browser not initialized' }, isError: false };
  }
  const maxLen = typeof input.maxLength === 'number'
    ? Math.min(Math.max(100, Math.floor(input.maxLength)), 16000)
    : 8000;
  const text = await browserService.getPageText(maxLen);
  const state = browserService.getState();
  return {
    result: {
      url: state.navigation.url,
      title: state.navigation.title,
      text,
      truncated: text.length >= maxLen,
      charCount: text.length,
    },
    isError: false,
  };
}
```

Register `'get_page_text'` in the `OBSERVATION_TOOLS` tuple.

### 5. Enhanced `browser_navigate` Tool Result

After navigation, include a snippet of page text in the result so Haiku gets immediate feedback without a separate tool call.

**Location:** `src/main/actions/browserActionExecutor.ts`

Current `browser.navigate` result:
```typescript
return { summary, data: { url, title, isLoading, tabCount } };
```

New behavior — after calling `browserService.navigate(url)`, wait for page load:

```typescript
// Wait for page to finish loading (or timeout)
await waitForBrowserLoad(5000);

const state = browserService.getState();
const preview = await browserService.getPageText(2000);
return {
  summary: `Navigated to ${state.navigation.url}`,
  data: {
    url: state.navigation.url,
    title: state.navigation.title,
    isLoading: state.navigation.isLoading,
    tabCount: state.tabs.length,
    pagePreview: preview.slice(0, 2000),
  },
};
```

**`waitForBrowserLoad` logic:**
- Poll `browserService.getState().navigation.isLoading` every 200ms
- Return when `isLoading === false`
- Hard timeout at 5000ms (returns whatever state exists)

This gives Haiku a 2KB text preview of every page it navigates to, inline with the action result. For deeper inspection, it can call `get_page_text` with a larger limit.

### 6. Action Completion Semantics Fix

The current issue: `terminal.execute` marks the action "completed" immediately after `terminalService.write()`. With the settle-wait from section 3, the action now blocks until output settles.

This naturally fixes the completion semantics — the action status transitions to "completed" only after the settle period, meaning "completed" now reflects "command was sent and initial output was received" rather than just "bytes written to PTY."

No additional changes needed beyond section 3.

---

## Files Touched

| File | Change |
|------|--------|
| `src/main/terminal/TerminalService.ts` | Add output ring buffer, `getRecentOutput()` method, ANSI stripping |
| `src/main/actions/terminalActionExecutor.ts` | Add settle-wait, return output in `terminal.execute` result |
| `src/main/browser/BrowserService.ts` | Add `getPageText()` method using `executeJavaScript` |
| `src/main/actions/browserActionExecutor.ts` | Add load-wait, return page preview in `browser.navigate` result |
| `src/main/models/tools/toolDefinitions.ts` | Add `get_terminal_output` and `get_page_text` tool definitions |
| `src/main/models/tools/toolExecutor.ts` | Add handlers for both new observation tools |

## Types NOT Changed

No new types in `appState.ts`, `terminal.ts`, `browser.ts`, or `events.ts`. The ring buffer is internal to `TerminalService`. The tools are observation-only. Action results use the existing `{summary, data}` shape — `data` just carries more fields.

## IPC NOT Changed

No new IPC channels. `getPageText()` is called internally by the tool executor, not exposed to renderers. `getRecentOutput()` is called internally by the tool executor. Renderers continue to receive terminal output via the existing `terminal:output` event for xterm.js display.

## Testing Strategy

### Unit Tests

1. **Ring buffer** — test line accumulation, max cap, ANSI stripping, clear on restart, preserve on exit
2. **`get_terminal_output` tool** — test line count clamping, empty buffer, default lines
3. **`get_page_text` tool** — test maxLength clamping, browser-not-initialized case, truncation flag
4. **Settle-wait** — test that it resolves when activity stops, respects timeout, returns output
5. **Load-wait** — test that it resolves when loading completes, respects timeout

### Integration Tests

1. Execute a terminal command via tool → verify output appears in result
2. Navigate browser via tool → verify page preview appears in result
3. Call `get_terminal_output` after a command → verify recent output returned
4. Call `get_page_text` on a loaded page → verify text content returned
5. Terminal command that produces no output → verify settle-wait times out gracefully
6. Navigation to slow/failing page → verify load-wait times out and returns partial state

## Risks

| Risk | Mitigation |
|------|------------|
| ANSI stripping regex misses edge cases | Use a well-tested pattern; raw output is still available in xterm.js |
| Settle-wait heuristic guesses wrong | 500ms settle + 3s timeout is conservative; commands that run longer can be inspected via `get_terminal_output` afterward |
| `executeJavaScript` throws on special pages | Catch and return "(unable to extract page text)" |
| Large page text blows token budget | Capped at 2KB in navigate result, 16KB max in `get_page_text` |
| Output buffer memory | 200 lines is negligible; cleared on restart |

## Success Criteria

After this phase, Haiku should be able to:

1. Run `ls -la` and see the file listing in the tool result
2. Navigate to a URL and know what text is on the page
3. Run `npm test` and read whether tests passed or failed
4. Inspect terminal output from a previous command without re-running it
5. Verify that a page loaded correctly before proceeding with the next step

The feedback loop — act, observe, decide — becomes real.
