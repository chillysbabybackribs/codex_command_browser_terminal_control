# Phase 1: Close the Feedback Loop — Design Spec (v2)

## Problem

Haiku 4.5 is the workspace operator. It can navigate the browser and send terminal commands. But it operates blind:

- After `terminal_execute`, it receives `{dispatched: true}` — no command output, no exit code
- After `browser_navigate`, it receives `{url, title, isLoading}` — no page content
- `terminal.execute` actions are marked "completed" when the command is *sent to PTY*, not when it *finishes*

This makes Haiku unreliable for any workflow that requires verifying results.

## Key Design Principle

We own the browser (Electron `WebContentsView`) and the terminal (direct PTY via `node-pty`). The models should not interact with these surfaces at user level — they should get **privileged, structured access** that is better than what a human sees on screen. The terminal gives structured command results with exit codes, not scraped output. The browser gives DOM queries and JS execution, not just page text.

## Goals

1. Terminal commands return structured results: output, exit code, CWD, duration
2. Browser tools give the model `executeJavaScript` access to any tab's page context
3. Action completion semantics are honest — "completed" means the command finished
4. The model gets structured data, not visual approximation

## Non-Goals

- Chrome DevTools Protocol (CDP) integration — Phase 5, when full DOM automation is needed
- Screenshot/vision capabilities — Phase 5
- Chat persistence — Phase 4
- System prompt enhancement — Phase 2
- Codex workspace awareness — Phase 3
- Streaming terminal output to model in real-time

---

## Design

### Part A: Privileged Terminal Access via Shell Integration

#### A1. Shell Integration Script

**New file:** `src/main/terminal/shellIntegration.ts`

At PTY spawn time, inject a shell integration script that hooks into the shell's command lifecycle. This gives us structured command boundaries, exit codes, and CWD tracking — not heuristic scraping.

**Mechanism:** Write a shell hook to the PTY immediately after spawn, before any user interaction.

For **bash** (primary target):

```bash
# V1 Workspace Shell Integration — injected at PTY spawn
__v1_preexec() {
  printf '\x1b]633;C\x07'        # OSC 633 ; C — command started
  printf '\x1b]633;D;%s\x07' "$PWD"  # OSC 633 ; D — current directory
}
__v1_precmd() {
  local ec=$?
  printf '\x1b]633;E;%d\x07' "$ec"   # OSC 633 ; E — exit code
  printf '\x1b]633;D;%s\x07' "$PWD"  # OSC 633 ; D — current directory (post-command)
  printf '\x1b]633;B\x07'            # OSC 633 ; B — prompt started (command ended)
}
trap '__v1_preexec' DEBUG
PROMPT_COMMAND="__v1_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
```

This uses the **OSC 633 protocol** (same convention used by VS Code's terminal shell integration). Markers:

| Sequence | Meaning |
|----------|---------|
| `\x1b]633;B\x07` | Prompt started (ready for input / command finished) |
| `\x1b]633;C\x07` | Command started executing |
| `\x1b]633;D;<path>\x07` | Current working directory |
| `\x1b]633;E;<code>\x07` | Exit code of last command |

**For zsh:** Use `precmd` and `preexec` hook arrays instead of `trap DEBUG` / `PROMPT_COMMAND`. Same OSC sequences.

**For other shells (sh, dash):** Fall back to `PROMPT_COMMAND` if available, otherwise no integration (graceful degradation — the output buffer from v1 spec remains as fallback).

**Export:**
```typescript
export function getShellIntegrationScript(shell: string): string | null
```

Returns the appropriate script for the detected shell, or `null` if unsupported.

#### A2. OSC 633 Parser in TerminalService

**Location:** `src/main/terminal/TerminalService.ts`

Add a parser that intercepts PTY output *before* forwarding to renderers and extracts OSC 633 sequences.

**New private state:**
```typescript
private commandState: {
  phase: 'idle' | 'executing';
  startedAt: number | null;
  lastExitCode: number | null;
  cwd: string;
  outputSinceCommandStart: string;
} = { phase: 'idle', startedAt: null, lastExitCode: null, cwd: '', outputSinceCommandStart: '' };

private outputBuffer: string[] = [];
private readonly MAX_BUFFER_LINES = 200;
```

**In `wirePtyEvents`, modify the `onData` handler:**

1. Feed raw data through the OSC 633 parser
2. On `633;C` (command started): set `phase = 'executing'`, record `startedAt`, clear `outputSinceCommandStart`
3. On `633;E;<code>` (exit code): record `lastExitCode`
4. On `633;D;<path>` (CWD): update `cwd` and `this.session.cwd`
5. On `633;B` (prompt/command ended): set `phase = 'idle'`, emit a new event `TERMINAL_COMMAND_FINISHED` with `{ exitCode, output, cwd, durationMs }`
6. While `phase === 'executing'`: accumulate ANSI-stripped output into `outputSinceCommandStart`
7. Always: append ANSI-stripped lines to `outputBuffer` (ring buffer, max 200 lines)
8. Always: forward raw (unmodified) data to existing `TERMINAL_SESSION_OUTPUT` event for xterm.js — the renderer sees everything unchanged

**The parser strips OSC 633 sequences from the forwarded output.** The user never sees the markers in xterm.js. The model gets structured data. Both get what they need.

**New public methods:**
```typescript
getRecentOutput(lineCount?: number): string   // last N lines from ring buffer
getCommandState(): CommandState               // current phase, exit code, cwd
getCwd(): string                              // current working directory
```

**New event:** `TERMINAL_COMMAND_FINISHED`
```typescript
{ sessionId: string; exitCode: number; output: string; cwd: string; durationMs: number; command: string }
```

The `command` field is captured from the output between `633;B` (prompt) and `633;C` (execution start) — this is the text the user typed. If unavailable (integration not active), falls back to `lastDispatchedCommand` from `terminalCommand` state.

#### A3. Integration Injection in TerminalService

**In `startSession()`**, after successful PTY spawn and event wiring:

```typescript
const integrationScript = getShellIntegrationScript(shell);
if (integrationScript) {
  this.ptyProcess.write(integrationScript + '\n');
  this.commandState.cwd = cwd;  // initialize from startup CWD
}
```

**On `restart()`**: re-inject the script.

#### A4. Revised `terminal_execute` Action

**Location:** `src/main/actions/terminalActionExecutor.ts`

The current executor writes to PTY and returns immediately. With shell integration, we can wait for the real `TERMINAL_COMMAND_FINISHED` event.

```typescript
case 'terminal.execute': {
  const { command } = payload as TerminalExecutePayload;
  const session = terminalService.getSession();
  if (!session || session.status !== 'running') {
    throw new Error('Terminal session not running');
  }

  terminalService.write(command + '\n');

  // Wait for the command to actually finish (via shell integration)
  const result = await terminalService.waitForCommandFinish(10_000);

  if (result) {
    return {
      summary: `Executed: ${command} (exit ${result.exitCode})`,
      data: {
        command,
        sessionId: session.id,
        exitCode: result.exitCode,
        output: result.output.slice(-8192),  // cap at 8KB
        cwd: result.cwd,
        durationMs: result.durationMs,
      },
    };
  }

  // Fallback: shell integration not active or command timed out
  const output = terminalService.getRecentOutput(50);
  return {
    summary: `Executed: ${command} (no exit code — shell integration inactive or timeout)`,
    data: {
      command,
      sessionId: session.id,
      output: output.slice(-4096),
      cwd: terminalService.getCwd(),
    },
  };
}
```

**`waitForCommandFinish(timeoutMs)`** — new method on TerminalService:
- Returns a `Promise<CommandFinishResult | null>`
- Listens for `TERMINAL_COMMAND_FINISHED` event on eventBus
- Resolves when event fires for the current session
- Returns `null` on timeout (graceful degradation)
- If `commandState.phase` is already `'idle'` and `lastExitCode` is fresh, resolves immediately

**Timeout:** Default 10s. Long-running commands (builds, deploys) can be checked afterward via `get_terminal_output`. The 10s covers the vast majority of interactive commands.

#### A5. `get_terminal_output` Observation Tool

Same as v1 spec — reads from the ring buffer. This is the fallback/supplementary path for when commands run longer than the wait timeout or the model wants to inspect history.

**Tool definition:**
```typescript
{
  name: 'get_terminal_output',
  description: 'Get recent terminal output lines. Use after executing a command to see more output, or to check on a long-running process. Returns ANSI-stripped text.',
  input_schema: {
    type: 'object',
    properties: {
      lines: { type: 'number', description: 'Number of recent lines (default: 50, max: 200)' }
    }
  }
}
```

#### A6. `get_terminal_state` Enhanced Observation Tool

Rename/enhance the existing `get_terminal_session` to return richer state:

```typescript
case 'get_terminal_session': {
  const session = terminalService.getSession();
  if (!session) {
    return { result: { status: 'no_session' }, isError: false };
  }
  const cmdState = terminalService.getCommandState();
  const appCmdState = appStateStore.getState().terminalCommand;
  return {
    result: {
      id: session.id,
      pid: session.pid,
      shell: session.shell,
      cwd: cmdState.cwd || session.cwd,         // live CWD from integration
      status: session.status,
      cols: session.cols,
      rows: session.rows,
      commandPhase: cmdState.phase,               // 'idle' or 'executing'
      lastExitCode: cmdState.lastExitCode,        // from shell integration
      lastCommand: appCmdState.lastDispatchedCommand,
      shellIntegrationActive: cmdState.cwd !== '', // whether integration is working
    },
    isError: false,
  };
}
```

This gives Haiku: live CWD, last exit code, whether a command is currently running, and whether shell integration is active.

---

### Part B: Privileged Browser Access via executeJavaScript

#### B1. `getPageText()` on BrowserService

**Location:** `src/main/browser/BrowserService.ts`

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

#### B2. `executeInPage()` on BrowserService — General JS Execution

**Location:** `src/main/browser/BrowserService.ts`

The key privileged capability. The model can run arbitrary JavaScript in any tab's page context.

```typescript
async executeInPage(
  expression: string,
  tabId?: string,
): Promise<{ result: unknown; error: string | null }> {
  const entry = tabId ? this.tabs.get(tabId) : this.getActiveEntry();
  if (!entry) return { result: null, error: 'No active tab' };
  try {
    const result = await entry.view.webContents.executeJavaScript(expression);
    return { result, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { result: null, error: message };
  }
}
```

This is the foundation for all browser observation. Higher-level tools call this.

#### B3. `querySelectorAll()` on BrowserService — Structured DOM Query

```typescript
async querySelectorAll(
  selector: string,
  tabId?: string,
  limit: number = 20,
): Promise<Array<{ tag: string; text: string; href: string | null; id: string; classes: string[] }>> {
  const { result, error } = await this.executeInPage(`
    (() => {
      const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).slice(0, ${limit});
      return els.map(el => ({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.textContent || '').slice(0, 200),
        href: el.getAttribute('href'),
        id: el.id || '',
        classes: Array.from(el.classList),
      }));
    })()
  `, tabId);
  if (error || !Array.isArray(result)) return [];
  return result;
}
```

#### B4. `clickElement()` on BrowserService

```typescript
async clickElement(selector: string, tabId?: string): Promise<{ clicked: boolean; error: string | null }> {
  const { result, error } = await this.executeInPage(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { clicked: false, reason: 'Element not found' };
      el.click();
      return { clicked: true };
    })()
  `, tabId);
  if (error) return { clicked: false, error };
  return { clicked: (result as any)?.clicked ?? false, error: (result as any)?.reason ?? null };
}
```

#### B5. `typeInElement()` on BrowserService

```typescript
async typeInElement(
  selector: string,
  text: string,
  tabId?: string,
): Promise<{ typed: boolean; error: string | null }> {
  const { result, error } = await this.executeInPage(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { typed: false, reason: 'Element not found' };
      el.focus();
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { typed: true };
    })()
  `, tabId);
  if (error) return { typed: false, error };
  return { typed: (result as any)?.typed ?? false, error: (result as any)?.reason ?? null };
}
```

#### B6. `getPageMetadata()` on BrowserService

```typescript
async getPageMetadata(tabId?: string): Promise<Record<string, unknown>> {
  const { result, error } = await this.executeInPage(`
    (() => ({
      title: document.title,
      url: location.href,
      description: document.querySelector('meta[name="description"]')?.content || '',
      h1: Array.from(document.querySelectorAll('h1')).map(el => el.innerText).slice(0, 5),
      links: document.querySelectorAll('a[href]').length,
      inputs: document.querySelectorAll('input, textarea, select').length,
      forms: document.querySelectorAll('form').length,
      images: document.querySelectorAll('img').length,
    }))()
  `, tabId);
  if (error) return { error };
  return (result as Record<string, unknown>) || {};
}
```

#### B7. New Browser Tools for Haiku

**Location:** `src/main/models/tools/toolDefinitions.ts`

```
get_page_text        — extract visible text content (innerText), truncated
get_page_metadata    — page structure overview: title, headings, link/form/input counts
query_selector       — find elements by CSS selector, return tag/text/href/id/classes
click_element        — click an element by CSS selector
type_in_element      — type text into an input/textarea by CSS selector
execute_js           — run arbitrary JavaScript in the page context (power tool)
```

**Tool definitions (6 new tools):**

| Tool | Input | Returns |
|------|-------|---------|
| `get_page_text` | `{ maxLength?: number }` | `{ url, title, text, truncated, charCount }` |
| `get_page_metadata` | `{ tabId?: string }` | `{ title, url, description, h1[], links, inputs, forms, images }` |
| `query_selector` | `{ selector: string, tabId?: string, limit?: number }` | `Array<{ tag, text, href, id, classes }>` |
| `click_element` | `{ selector: string, tabId?: string }` | `{ clicked: boolean, error? }` |
| `type_in_element` | `{ selector: string, text: string, tabId?: string }` | `{ typed: boolean, error? }` |
| `execute_js` | `{ expression: string, tabId?: string }` | `{ result, error }` |

Tool classification:
- **Observation tools** (no side effects, direct service calls): `get_page_text`, `get_page_metadata`, `query_selector`, `execute_js`
- **Action tools** (side effects, route through SurfaceActionRouter): `click_element`, `type_in_element`

Register observation tools in `OBSERVATION_TOOLS` tuple. Action tools go in `TOOL_TO_ACTION_KIND` map as `'browser.click'` and `'browser.type'`.

#### B8. Enhanced `browser_navigate` Action Result

After navigation, wait for load and return page metadata + text preview:

```typescript
await waitForBrowserLoad(5000);

const state = browserService.getState();
const metadata = await browserService.getPageMetadata();
const preview = await browserService.getPageText(2000);

return {
  summary: `Navigated to ${state.navigation.url}`,
  data: {
    url: state.navigation.url,
    title: state.navigation.title,
    isLoading: state.navigation.isLoading,
    tabCount: state.tabs.length,
    pagePreview: preview.slice(0, 2000),
    metadata,
  },
};
```

#### B9. New Browser Action Kinds for click/type

**Location:** `src/shared/actions/surfaceActionTypes.ts`

Add to `BrowserActionKind`:
```typescript
| 'browser.click'
| 'browser.type'
```

Add to `SurfaceActionPayloadMap`:
```typescript
'browser.click': { selector: string; tabId?: string }
'browser.type': { selector: string; text: string; tabId?: string }
```

**Location:** `src/main/actions/browserActionExecutor.ts`

Add handlers that delegate to `browserService.clickElement()` / `browserService.typeInElement()`.

**Location:** `src/main/actions/surfaceActionPolicy.ts`

Both use `serialize` mode (standard queuing, no replacement).

---

## Files Touched

| File | Change |
|------|--------|
| `src/main/terminal/shellIntegration.ts` | **NEW** — shell integration scripts for bash/zsh, OSC 633 protocol |
| `src/main/terminal/TerminalService.ts` | Add OSC 633 parser, command state tracking, output ring buffer, `getRecentOutput()`, `getCommandState()`, `getCwd()`, `waitForCommandFinish()`, integration injection at spawn |
| `src/main/actions/terminalActionExecutor.ts` | Wait for command finish, return structured result with exit code + output |
| `src/main/browser/BrowserService.ts` | Add `getPageText()`, `executeInPage()`, `querySelectorAll()`, `clickElement()`, `typeInElement()`, `getPageMetadata()` |
| `src/main/actions/browserActionExecutor.ts` | Add load-wait + metadata/preview in navigate result, add click/type action handlers |
| `src/main/models/tools/toolDefinitions.ts` | Add 7 new tools: `get_terminal_output`, `get_page_text`, `get_page_metadata`, `query_selector`, `click_element`, `type_in_element`, `execute_js` |
| `src/main/models/tools/toolExecutor.ts` | Add handlers for all 7 new tools |
| `src/shared/actions/surfaceActionTypes.ts` | Add `browser.click` and `browser.type` action kinds + payloads |
| `src/main/actions/surfaceActionPolicy.ts` | Add concurrency policies for click/type |
| `src/shared/types/events.ts` | Add `TERMINAL_COMMAND_FINISHED` event type + payload |
| `src/shared/types/terminal.ts` | Add `CommandState` type |

## Types Changed

| Type | Location | Change |
|------|----------|--------|
| `CommandState` | `terminal.ts` | **NEW** — `{ phase, startedAt, lastExitCode, cwd, outputSinceCommandStart }` |
| `BrowserActionKind` | `surfaceActionTypes.ts` | Add `'browser.click'`, `'browser.type'` |
| `SurfaceActionPayloadMap` | `surfaceActionTypes.ts` | Add payloads for click/type |
| `AppEventType` | `events.ts` | Add `TERMINAL_COMMAND_FINISHED` |
| `AppEventPayloads` | `events.ts` | Add payload type for `TERMINAL_COMMAND_FINISHED` |

## IPC NOT Changed

No new IPC channels. All new capabilities are used internally by the tool executor and action executor. Renderers are unaffected — xterm.js still receives raw PTY output (OSC sequences stripped), browser still renders normally.

## Testing Strategy

### Unit Tests

1. **Shell integration script generation** — correct bash/zsh output, null for unsupported shells
2. **OSC 633 parser** — correctly extracts markers from mixed PTY output, handles partial sequences, doesn't corrupt forwarded data
3. **Command state machine** — idle→executing→idle transitions, exit code capture, CWD tracking, output accumulation
4. **Ring buffer** — line accumulation, max cap, ANSI stripping, clear on restart
5. **`executeInPage`** — returns result, catches errors, handles missing tab
6. **`querySelectorAll`** — returns structured data, respects limit, handles no-match
7. **`clickElement` / `typeInElement`** — returns success/failure, handles missing element

### Integration Tests

1. Execute `echo hello && echo $?` → verify output contains "hello", exit code is 0
2. Execute `false` → verify exit code is 1
3. Execute `cd /tmp && pwd` → verify CWD updates to `/tmp`
4. Navigate to a page → verify `pagePreview` contains page text
5. `get_page_text` on loaded page → verify text content
6. `query_selector('a')` → verify returns link elements with href
7. `click_element` on a button → verify click fires
8. `execute_js('document.title')` → verify returns page title
9. Long-running command (sleep 15) → verify `waitForCommandFinish` times out, `get_terminal_output` still works
10. Shell integration inactive (unsupported shell) → verify graceful fallback to output buffer

## Risks

| Risk | Mitigation |
|------|------------|
| Shell integration script conflicts with user's `.bashrc` | Use unique function names (`__v1_*`), append to `PROMPT_COMMAND` instead of replacing |
| OSC 633 parser has edge cases with binary output | Only parse sequences starting with `\x1b]633;`, pass everything else through unchanged |
| `executeJavaScript` can hang on heavy pages | Set timeout on the JS execution (Electron supports this) |
| `clickElement` on SPAs may trigger navigation | This is expected behavior — the action result will reflect the new state |
| Commands that produce massive output fill buffer | Ring buffer capped at 200 lines; `outputSinceCommandStart` capped at 64KB |
| zsh users have different hook mechanism | Separate script path for zsh using `precmd`/`preexec` hooks |

## Success Criteria

After this phase, Haiku should be able to:

1. Run `ls -la` and see the file listing **with exit code 0** in the structured result
2. Run `npm test` and read whether tests passed or failed, with the actual exit code
3. Navigate to a URL and read the page text, headings, and link count
4. Find a button by CSS selector and click it
5. Fill in a form field and submit
6. Run arbitrary JS to extract data from a page
7. Know the current working directory at all times
8. Know whether a command is currently running or the shell is idle
9. Fall back gracefully to output buffer scraping when shell integration isn't available

The model moves from "steering blind" to having **structured, privileged access to both execution surfaces** — better than what a human can see on screen.
