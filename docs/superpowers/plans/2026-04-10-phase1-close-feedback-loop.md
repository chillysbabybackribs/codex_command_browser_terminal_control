# Phase 1: Close the Feedback Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Haiku privileged, structured access to terminal output (with exit codes, CWD, command boundaries via shell integration) and browser page content (via executeJavaScript-based DOM tools).

**Architecture:** Two parallel tracks — (A) terminal shell integration using OSC 633 protocol injected at PTY spawn, with a command state machine and output ring buffer in TerminalService; (B) browser DOM access via `webContents.executeJavaScript()` methods on BrowserService, exposed as 6 new Haiku tools. Both tracks feed richer data into action results and observation tools.

**Tech Stack:** Electron 41 (`webContents.executeJavaScript`), node-pty, vitest, OSC 633 escape sequences, bash/zsh shell hooks

**Spec:** `docs/superpowers/specs/2026-04-10-phase1-close-feedback-loop.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/terminal/shellIntegration.ts` | CREATE | Shell integration script generation for bash/zsh |
| `src/main/terminal/shellIntegration.test.ts` | CREATE | Tests for script generation |
| `src/main/terminal/oscParser.ts` | CREATE | OSC 633 sequence parser + ANSI stripper |
| `src/main/terminal/oscParser.test.ts` | CREATE | Tests for parser |
| `src/main/terminal/TerminalService.ts` | MODIFY | Add command state, ring buffer, integration injection, `waitForCommandFinish` |
| `src/shared/types/terminal.ts` | MODIFY | Add `CommandState` type |
| `src/shared/types/events.ts` | MODIFY | Add `TERMINAL_COMMAND_FINISHED` event |
| `src/main/actions/terminalActionExecutor.ts` | MODIFY | Wait for command finish, return structured output |
| `src/main/browser/BrowserService.ts` | MODIFY | Add `getPageText`, `executeInPage`, `querySelectorAll`, `clickElement`, `typeInElement`, `getPageMetadata` |
| `src/main/browser/BrowserService.test.ts` | CREATE | Tests for new browser methods (mocked webContents) |
| `src/main/actions/browserActionExecutor.ts` | MODIFY | Add load-wait + preview in navigate, add click/type handlers |
| `src/shared/actions/surfaceActionTypes.ts` | MODIFY | Add `browser.click`, `browser.type` kinds + payloads |
| `src/main/actions/surfaceActionPolicy.ts` | MODIFY | Add policies for click/type |
| `src/main/models/tools/toolDefinitions.ts` | MODIFY | Add 7 new tool definitions |
| `src/main/models/tools/toolExecutor.ts` | MODIFY | Add handlers for 7 new tools |

---

## Task 1: CommandState Type + TERMINAL_COMMAND_FINISHED Event

**Files:**
- Modify: `src/shared/types/terminal.ts`
- Modify: `src/shared/types/events.ts`

- [ ] **Step 1: Add CommandState type to terminal.ts**

Add after line 44 (after `createDefaultTerminalCommandState`):

```typescript
// ─── Shell Integration State ─────────────────────────────────────────────

export type CommandPhase = 'idle' | 'executing';

export type CommandState = {
  phase: CommandPhase;
  startedAt: number | null;
  lastExitCode: number | null;
  cwd: string;
  outputSinceCommandStart: string;
};

export function createDefaultCommandState(cwd: string = ''): CommandState {
  return {
    phase: 'idle',
    startedAt: null,
    lastExitCode: null,
    cwd,
    outputSinceCommandStart: '',
  };
}

export type CommandFinishResult = {
  exitCode: number;
  output: string;
  cwd: string;
  durationMs: number;
  command: string;
};
```

- [ ] **Step 2: Add TERMINAL_COMMAND_FINISHED event to events.ts**

Add to the `AppEventType` enum, before the closing `}` on line 84:

```typescript
  TERMINAL_COMMAND_FINISHED = 'TERMINAL_COMMAND_FINISHED',
```

Add to `AppEventPayloads`, before the closing `};` on line 156:

```typescript
  [AppEventType.TERMINAL_COMMAND_FINISHED]: {
    sessionId: string;
    exitCode: number;
    output: string;
    cwd: string;
    durationMs: number;
    command: string;
  };
```

Add import for `CommandFinishResult` is not needed here — the payload is inline.

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to `CommandState` or `TERMINAL_COMMAND_FINISHED`

- [ ] **Step 4: Commit**

```bash
git add src/shared/types/terminal.ts src/shared/types/events.ts
git commit -m "feat: add CommandState type and TERMINAL_COMMAND_FINISHED event"
```

---

## Task 2: OSC 633 Parser

**Files:**
- Create: `src/main/terminal/oscParser.ts`
- Create: `src/main/terminal/oscParser.test.ts`

- [ ] **Step 1: Write tests for the OSC parser**

Create `src/main/terminal/oscParser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseOscSequences, stripAnsi, type OscEvent } from './oscParser';

describe('parseOscSequences', () => {
  it('extracts command-started marker (633;C)', () => {
    const input = 'some text\x1b]633;C\x07more text';
    const { cleaned, events } = parseOscSequences(input);
    expect(cleaned).toBe('some textmore text');
    expect(events).toEqual([{ type: 'command-started' }]);
  });

  it('extracts prompt-started marker (633;B)', () => {
    const input = '\x1b]633;B\x07$ ';
    const { cleaned, events } = parseOscSequences(input);
    expect(cleaned).toBe('$ ');
    expect(events).toEqual([{ type: 'prompt-started' }]);
  });

  it('extracts exit code (633;E;<code>)', () => {
    const input = '\x1b]633;E;0\x07';
    const { cleaned, events } = parseOscSequences(input);
    expect(cleaned).toBe('');
    expect(events).toEqual([{ type: 'exit-code', code: 0 }]);
  });

  it('extracts non-zero exit code', () => {
    const input = '\x1b]633;E;127\x07';
    const { cleaned, events } = parseOscSequences(input);
    expect(events).toEqual([{ type: 'exit-code', code: 127 }]);
  });

  it('extracts cwd (633;D;<path>)', () => {
    const input = '\x1b]633;D;/home/user/project\x07';
    const { cleaned, events } = parseOscSequences(input);
    expect(cleaned).toBe('');
    expect(events).toEqual([{ type: 'cwd', path: '/home/user/project' }]);
  });

  it('handles multiple sequences in one chunk', () => {
    const input = '\x1b]633;E;0\x07\x1b]633;D;/tmp\x07\x1b]633;B\x07$ ';
    const { cleaned, events } = parseOscSequences(input);
    expect(cleaned).toBe('$ ');
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: 'exit-code', code: 0 });
    expect(events[1]).toEqual({ type: 'cwd', path: '/tmp' });
    expect(events[2]).toEqual({ type: 'prompt-started' });
  });

  it('passes through non-633 OSC sequences unchanged', () => {
    const input = '\x1b]0;window title\x07hello';
    const { cleaned, events } = parseOscSequences(input);
    expect(cleaned).toBe('\x1b]0;window title\x07hello');
    expect(events).toEqual([]);
  });

  it('handles data with no OSC sequences', () => {
    const input = 'plain text output\n';
    const { cleaned, events } = parseOscSequences(input);
    expect(cleaned).toBe('plain text output\n');
    expect(events).toEqual([]);
  });

  it('handles empty input', () => {
    const { cleaned, events } = parseOscSequences('');
    expect(cleaned).toBe('');
    expect(events).toEqual([]);
  });

  it('handles cwd with spaces', () => {
    const input = '\x1b]633;D;/home/user/my project\x07';
    const { cleaned, events } = parseOscSequences(input);
    expect(events).toEqual([{ type: 'cwd', path: '/home/user/my project' }]);
  });
});

describe('stripAnsi', () => {
  it('strips SGR sequences', () => {
    expect(stripAnsi('\x1b[32mgreen\x1b[0m')).toBe('green');
  });

  it('strips cursor movement', () => {
    expect(stripAnsi('\x1b[2Ahello\x1b[K')).toBe('hello');
  });

  it('strips complex sequences', () => {
    expect(stripAnsi('\x1b[1;32;40mcolored\x1b[0m')).toBe('colored');
  });

  it('preserves plain text', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('handles empty input', () => {
    expect(stripAnsi('')).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/terminal/oscParser.test.ts 2>&1 | tail -5`
Expected: FAIL — module `./oscParser` not found

- [ ] **Step 3: Implement the OSC parser**

Create `src/main/terminal/oscParser.ts`:

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// OSC 633 Parser — Extracts shell integration markers from PTY output
// Also strips ANSI escape sequences for model-readable output
// ═══════════════════════════════════════════════════════════════════════════

export type OscEvent =
  | { type: 'command-started' }
  | { type: 'prompt-started' }
  | { type: 'exit-code'; code: number }
  | { type: 'cwd'; path: string };

export type ParseResult = {
  cleaned: string;
  events: OscEvent[];
};

// Matches OSC 633 sequences: \x1b]633;<payload>\x07
const OSC_633_RE = /\x1b\]633;([^\x07]*)\x07/g;

// Matches ANSI escape sequences (SGR, cursor, erase, etc.)
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

export function parseOscSequences(data: string): ParseResult {
  const events: OscEvent[] = [];

  const cleaned = data.replace(OSC_633_RE, (_match, payload: string) => {
    const semi = payload.indexOf(';');
    const marker = semi === -1 ? payload : payload.slice(0, semi);
    const value = semi === -1 ? '' : payload.slice(semi + 1);

    switch (marker) {
      case 'C':
        events.push({ type: 'command-started' });
        break;
      case 'B':
        events.push({ type: 'prompt-started' });
        break;
      case 'E': {
        const code = parseInt(value, 10);
        if (!isNaN(code)) events.push({ type: 'exit-code', code });
        break;
      }
      case 'D':
        if (value) events.push({ type: 'cwd', path: value });
        break;
    }

    return ''; // strip the OSC sequence from output
  });

  return { cleaned, events };
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/terminal/oscParser.test.ts 2>&1 | tail -5`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/terminal/oscParser.ts src/main/terminal/oscParser.test.ts
git commit -m "feat: add OSC 633 parser and ANSI stripper for shell integration"
```

---

## Task 3: Shell Integration Script Generator

**Files:**
- Create: `src/main/terminal/shellIntegration.ts`
- Create: `src/main/terminal/shellIntegration.test.ts`

- [ ] **Step 1: Write tests for shell integration script generation**

Create `src/main/terminal/shellIntegration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getShellIntegrationScript } from './shellIntegration';

describe('getShellIntegrationScript', () => {
  it('returns a script for bash', () => {
    const script = getShellIntegrationScript('/bin/bash');
    expect(script).not.toBeNull();
    expect(script).toContain('__v1_precmd');
    expect(script).toContain('__v1_preexec');
    expect(script).toContain('633;C');
    expect(script).toContain('633;B');
    expect(script).toContain('633;E');
    expect(script).toContain('633;D');
  });

  it('returns a script for zsh', () => {
    const script = getShellIntegrationScript('/bin/zsh');
    expect(script).not.toBeNull();
    expect(script).toContain('precmd_functions');
    expect(script).toContain('preexec_functions');
    expect(script).toContain('633;C');
    expect(script).toContain('633;B');
    expect(script).toContain('633;E');
    expect(script).toContain('633;D');
  });

  it('returns a script for bash at non-standard path', () => {
    const script = getShellIntegrationScript('/usr/local/bin/bash');
    expect(script).not.toBeNull();
    expect(script).toContain('__v1_precmd');
  });

  it('returns null for unsupported shells', () => {
    expect(getShellIntegrationScript('/bin/sh')).toBeNull();
    expect(getShellIntegrationScript('/usr/bin/dash')).toBeNull();
    expect(getShellIntegrationScript('/bin/fish')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getShellIntegrationScript('')).toBeNull();
  });

  it('script does not contain bare newlines that would execute prematurely', () => {
    const script = getShellIntegrationScript('/bin/bash');
    expect(script).not.toBeNull();
    // The script should be a single block terminated by a newline
    // It should not have unescaped command separators that could break injection
    expect(script!.trim().length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/terminal/shellIntegration.test.ts 2>&1 | tail -5`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the shell integration script generator**

Create `src/main/terminal/shellIntegration.ts`:

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// Shell Integration — Injects OSC 633 hooks into bash/zsh at PTY spawn
// ═══════════════════════════════════════════════════════════════════════════

import * as path from 'path';

function detectShellType(shellPath: string): 'bash' | 'zsh' | null {
  const name = path.basename(shellPath);
  if (name === 'bash') return 'bash';
  if (name === 'zsh') return 'zsh';
  return null;
}

const BASH_INTEGRATION = `
__v1_preexec() { printf '\\x1b]633;C\\x07'; printf '\\x1b]633;D;%s\\x07' "$PWD"; }
__v1_precmd() { local ec=$?; printf '\\x1b]633;E;%d\\x07' "$ec"; printf '\\x1b]633;D;%s\\x07' "$PWD"; printf '\\x1b]633;B\\x07'; }
trap '__v1_preexec' DEBUG
PROMPT_COMMAND="__v1_precmd\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
`.trim();

const ZSH_INTEGRATION = `
__v1_precmd() { local ec=$?; printf '\\x1b]633;E;%d\\x07' "$ec"; printf '\\x1b]633;D;%s\\x07' "$PWD"; printf '\\x1b]633;B\\x07'; }
__v1_preexec() { printf '\\x1b]633;C\\x07'; printf '\\x1b]633;D;%s\\x07' "$PWD"; }
precmd_functions+=(__v1_precmd)
preexec_functions+=(__v1_preexec)
`.trim();

export function getShellIntegrationScript(shellPath: string): string | null {
  if (!shellPath) return null;
  const type = detectShellType(shellPath);
  switch (type) {
    case 'bash': return BASH_INTEGRATION;
    case 'zsh': return ZSH_INTEGRATION;
    default: return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/terminal/shellIntegration.test.ts 2>&1 | tail -5`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/terminal/shellIntegration.ts src/main/terminal/shellIntegration.test.ts
git commit -m "feat: add shell integration script generator for bash/zsh OSC 633"
```

---

## Task 4: Wire Shell Integration into TerminalService

**Files:**
- Modify: `src/main/terminal/TerminalService.ts`

This is the largest task — it adds the OSC parser pipeline, command state machine, output ring buffer, and `waitForCommandFinish` to TerminalService.

- [ ] **Step 1: Add imports and new state fields**

At the top of `TerminalService.ts`, add imports:

```typescript
import { CommandState, CommandFinishResult, createDefaultCommandState } from '../../shared/types/terminal';
import { parseOscSequences, stripAnsi, type OscEvent } from './oscParser';
import { getShellIntegrationScript } from './shellIntegration';
```

Add new private fields to the `TerminalService` class, after `private disposed = false;` (line 26):

```typescript
  private commandState: CommandState = createDefaultCommandState();
  private outputBuffer: string[] = [];
  private readonly MAX_BUFFER_LINES = 200;
  private readonly MAX_COMMAND_OUTPUT = 65536; // 64KB cap on per-command output
  private commandFinishResolvers: Array<(result: CommandFinishResult) => void> = [];
```

- [ ] **Step 2: Add public accessor methods**

Add after the existing `write()` method (after line 108):

```typescript
  getRecentOutput(lineCount: number = 50): string {
    const count = Math.min(Math.max(1, lineCount), this.MAX_BUFFER_LINES);
    return this.outputBuffer.slice(-count).join('\n');
  }

  getCommandState(): CommandState {
    return { ...this.commandState };
  }

  getCwd(): string {
    return this.commandState.cwd || this.session?.cwd || '';
  }

  waitForCommandFinish(timeoutMs: number = 10_000): Promise<CommandFinishResult | null> {
    // If already idle with a recent exit code, resolve immediately
    if (this.commandState.phase === 'idle' && this.commandState.lastExitCode !== null) {
      return Promise.resolve({
        exitCode: this.commandState.lastExitCode,
        output: this.commandState.outputSinceCommandStart,
        cwd: this.commandState.cwd,
        durationMs: this.commandState.startedAt ? Date.now() - this.commandState.startedAt : 0,
        command: '',
      });
    }

    return new Promise<CommandFinishResult | null>((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.commandFinishResolvers.indexOf(resolve as any);
        if (idx !== -1) this.commandFinishResolvers.splice(idx, 1);
        resolve(null);
      }, timeoutMs);

      const wrappedResolve = (result: CommandFinishResult) => {
        clearTimeout(timer);
        resolve(result);
      };

      this.commandFinishResolvers.push(wrappedResolve);
    });
  }
```

- [ ] **Step 3: Replace the wirePtyEvents onData handler**

Replace the existing `onData` handler in `wirePtyEvents()` (lines 177-181) with:

```typescript
    this.ptyProcess.onData((data: string) => {
      if (!this.session) return;
      this.session.lastActivityAt = Date.now();

      // Parse OSC 633 sequences — extract markers, clean output for renderer
      const { cleaned, events } = parseOscSequences(data);

      // Process shell integration events
      for (const event of events) {
        this.handleOscEvent(event);
      }

      // Append ANSI-stripped lines to ring buffer
      if (cleaned.length > 0) {
        const stripped = stripAnsi(cleaned);
        const lines = stripped.split('\n');
        this.outputBuffer.push(...lines);
        if (this.outputBuffer.length > this.MAX_BUFFER_LINES) {
          this.outputBuffer = this.outputBuffer.slice(-this.MAX_BUFFER_LINES);
        }

        // Accumulate output for current command
        if (this.commandState.phase === 'executing') {
          this.commandState.outputSinceCommandStart += stripped;
          if (this.commandState.outputSinceCommandStart.length > this.MAX_COMMAND_OUTPUT) {
            this.commandState.outputSinceCommandStart =
              this.commandState.outputSinceCommandStart.slice(-this.MAX_COMMAND_OUTPUT);
          }
        }
      }

      // Forward cleaned data to renderer (OSC 633 stripped, all else preserved)
      eventBus.emit(AppEventType.TERMINAL_SESSION_OUTPUT, { sessionId, data: cleaned || data });
    });
```

- [ ] **Step 4: Add handleOscEvent and resolveCommandFinish methods**

Add as private methods at the end of the class (before the closing `}`):

```typescript
  private handleOscEvent(event: OscEvent): void {
    switch (event.type) {
      case 'command-started':
        this.commandState.phase = 'executing';
        this.commandState.startedAt = Date.now();
        this.commandState.outputSinceCommandStart = '';
        break;

      case 'exit-code':
        this.commandState.lastExitCode = event.code;
        break;

      case 'cwd':
        this.commandState.cwd = event.path;
        if (this.session) {
          this.session.cwd = event.path;
          this.updateState();
        }
        break;

      case 'prompt-started': {
        if (this.commandState.phase === 'executing') {
          const result: CommandFinishResult = {
            exitCode: this.commandState.lastExitCode ?? 0,
            output: this.commandState.outputSinceCommandStart,
            cwd: this.commandState.cwd,
            durationMs: this.commandState.startedAt
              ? Date.now() - this.commandState.startedAt
              : 0,
            command: '',
          };

          this.commandState.phase = 'idle';

          // Emit event
          if (this.session) {
            eventBus.emit(AppEventType.TERMINAL_COMMAND_FINISHED, {
              sessionId: this.session.id,
              ...result,
            });
          }

          // Resolve any waiters
          this.resolveCommandFinish(result);
        }
        break;
      }
    }
  }

  private resolveCommandFinish(result: CommandFinishResult): void {
    const resolvers = this.commandFinishResolvers.splice(0);
    for (const resolve of resolvers) {
      resolve(result);
    }
  }
```

- [ ] **Step 5: Inject shell integration at PTY spawn**

In `startSession()`, after `this.wirePtyEvents();` (line 85), add:

```typescript
      // Inject shell integration for structured command tracking
      const integrationScript = getShellIntegrationScript(shell);
      if (integrationScript) {
        this.ptyProcess!.write(integrationScript + '\n');
        this.commandState = createDefaultCommandState(cwd);
        this.emitLog('info', 'Shell integration injected (OSC 633)');
      } else {
        this.commandState = createDefaultCommandState(cwd);
        this.emitLog('info', 'Shell integration unavailable for this shell — using fallback');
      }
```

- [ ] **Step 6: Clear buffer on restart, preserve on exit**

In `restart()` (line 125), add at the start of the method, before `const oldSessionId`:

```typescript
    this.outputBuffer = [];
    this.commandFinishResolvers = [];
```

- [ ] **Step 7: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/main/terminal/TerminalService.ts
git commit -m "feat: wire OSC 633 shell integration into TerminalService

Adds command state machine, output ring buffer, waitForCommandFinish,
and shell integration injection at PTY spawn."
```

---

## Task 5: Enhanced terminal_execute Action

**Files:**
- Modify: `src/main/actions/terminalActionExecutor.ts`

- [ ] **Step 1: Rewrite the terminal.execute case**

Replace the `terminal.execute` case (lines 15-26) with:

```typescript
    case 'terminal.execute': {
      const { command } = payload as TerminalExecutePayload;
      const session = terminalService.getSession();
      if (!session || session.status !== 'running') {
        throw new Error('Terminal session not running');
      }
      terminalService.write(command + '\n');

      // Wait for command to finish via shell integration (or timeout)
      const result = await terminalService.waitForCommandFinish(10_000);

      if (result) {
        return {
          summary: `Executed: ${command} (exit ${result.exitCode})`,
          data: {
            command,
            sessionId: session.id,
            exitCode: result.exitCode,
            output: result.output.slice(-8192),
            cwd: result.cwd,
            durationMs: result.durationMs,
          },
        };
      }

      // Fallback: shell integration not active or command timed out
      const output = terminalService.getRecentOutput(50);
      return {
        summary: `Executed: ${command} (no exit code — integration inactive or timeout)`,
        data: {
          command,
          sessionId: session.id,
          output: output.slice(-4096),
          cwd: terminalService.getCwd(),
        },
      };
    }
```

- [ ] **Step 2: Add import for terminalService methods**

The import `import { terminalService } from '../terminal/TerminalService';` already exists. No change needed.

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/main/actions/terminalActionExecutor.ts
git commit -m "feat: terminal.execute waits for command finish, returns structured output"
```

---

## Task 6: Browser DOM Methods on BrowserService

**Files:**
- Modify: `src/main/browser/BrowserService.ts`

- [ ] **Step 1: Add getPageText method**

Add after `isCreated()` (line 841):

```typescript
  async getPageText(maxLength: number = 8000): Promise<string> {
    const entry = this.getActiveEntry();
    if (!entry) return '';
    try {
      const text: string = await entry.view.webContents.executeJavaScript(
        'document.body ? document.body.innerText : ""',
      );
      return text.slice(0, maxLength);
    } catch {
      return '(unable to extract page text)';
    }
  }
```

- [ ] **Step 2: Add executeInPage method**

Add after `getPageText`:

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

- [ ] **Step 3: Add querySelectorAll method**

```typescript
  async querySelectorAll(
    selector: string,
    tabId?: string,
    limit: number = 20,
  ): Promise<Array<{ tag: string; text: string; href: string | null; id: string; classes: string[] }>> {
    const safeSelector = JSON.stringify(selector);
    const { result, error } = await this.executeInPage(`
      (() => {
        const els = Array.from(document.querySelectorAll(${safeSelector})).slice(0, ${Math.floor(limit)});
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

- [ ] **Step 4: Add clickElement method**

```typescript
  async clickElement(
    selector: string,
    tabId?: string,
  ): Promise<{ clicked: boolean; error: string | null }> {
    const safeSelector = JSON.stringify(selector);
    const { result, error } = await this.executeInPage(`
      (() => {
        const el = document.querySelector(${safeSelector});
        if (!el) return { clicked: false, reason: 'Element not found: ${selector}' };
        el.click();
        return { clicked: true };
      })()
    `, tabId);
    if (error) return { clicked: false, error };
    const r = result as { clicked?: boolean; reason?: string } | null;
    return { clicked: r?.clicked ?? false, error: r?.reason ?? null };
  }
```

- [ ] **Step 5: Add typeInElement method**

```typescript
  async typeInElement(
    selector: string,
    text: string,
    tabId?: string,
  ): Promise<{ typed: boolean; error: string | null }> {
    const safeSelector = JSON.stringify(selector);
    const safeText = JSON.stringify(text);
    const { result, error } = await this.executeInPage(`
      (() => {
        const el = document.querySelector(${safeSelector});
        if (!el) return { typed: false, reason: 'Element not found: ${selector}' };
        el.focus();
        el.value = ${safeText};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { typed: true };
      })()
    `, tabId);
    if (error) return { typed: false, error };
    const r = result as { typed?: boolean; reason?: string } | null;
    return { typed: r?.typed ?? false, error: r?.reason ?? null };
  }
```

- [ ] **Step 6: Add getPageMetadata method**

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

- [ ] **Step 7: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/main/browser/BrowserService.ts
git commit -m "feat: add privileged browser DOM methods — getPageText, executeInPage, querySelectorAll, clickElement, typeInElement, getPageMetadata"
```

---

## Task 7: Add browser.click and browser.type Action Kinds

**Files:**
- Modify: `src/shared/actions/surfaceActionTypes.ts`
- Modify: `src/main/actions/surfaceActionPolicy.ts`
- Modify: `src/main/actions/browserActionExecutor.ts`

- [ ] **Step 1: Add types to surfaceActionTypes.ts**

Add `'browser.click'` and `'browser.type'` to `BrowserActionKind` (line 17-25):

```typescript
export type BrowserActionKind =
  | 'browser.navigate'
  | 'browser.back'
  | 'browser.forward'
  | 'browser.reload'
  | 'browser.stop'
  | 'browser.create-tab'
  | 'browser.close-tab'
  | 'browser.activate-tab'
  | 'browser.click'
  | 'browser.type';
```

Add payload types after `BrowserEmptyPayload` (after line 45):

```typescript
export type BrowserClickPayload = { selector: string; tabId?: string };
export type BrowserTypePayload = { selector: string; text: string; tabId?: string };
```

Add to `SurfaceActionPayloadMap` (before the closing `};` of the map):

```typescript
  'browser.click': BrowserClickPayload;
  'browser.type': BrowserTypePayload;
```

Add result types after `BrowserActivateTabResult`:

```typescript
export type BrowserClickResult = { clicked: boolean; error?: string };
export type BrowserTypeResult = { typed: boolean; error?: string };
```

Add to `SurfaceActionResultMap`:

```typescript
  'browser.click': BrowserClickResult;
  'browser.type': BrowserTypeResult;
```

Add to `summarizePayload` switch:

```typescript
    case 'browser.click': return `Click: ${(payload as BrowserClickPayload).selector}`;
    case 'browser.type': return `Type in: ${(payload as BrowserTypePayload).selector}`;
```

Add to `BROWSER_ACTION_KINDS` array:

```typescript
export const BROWSER_ACTION_KINDS: BrowserActionKind[] = [
  'browser.navigate', 'browser.back', 'browser.forward', 'browser.reload', 'browser.stop',
  'browser.create-tab', 'browser.close-tab', 'browser.activate-tab',
  'browser.click', 'browser.type',
];
```

- [ ] **Step 2: Add concurrency policies**

Add to `ACTION_CONCURRENCY_POLICY` in `surfaceActionPolicy.ts`, after the `browser.activate-tab` entry:

```typescript
  // Browser — click and type serialize through same queue
  'browser.click':        { mode: 'serialize' },
  'browser.type':         { mode: 'serialize' },
```

- [ ] **Step 3: Add action handlers to browserActionExecutor.ts**

Add new cases in the switch statement (before the `default:` case):

```typescript
    case 'browser.click': {
      const { selector, tabId } = payload as BrowserClickPayload;
      const result = await browserService.clickElement(selector, tabId);
      if (!result.clicked) {
        throw new Error(result.error || `Click failed: ${selector}`);
      }
      return {
        summary: `Clicked: ${selector}`,
        data: { selector, clicked: true },
      };
    }

    case 'browser.type': {
      const { selector, text, tabId } = payload as BrowserTypePayload;
      const result = await browserService.typeInElement(selector, text, tabId);
      if (!result.typed) {
        throw new Error(result.error || `Type failed: ${selector}`);
      }
      return {
        summary: `Typed in: ${selector}`,
        data: { selector, typed: true, textLength: text.length },
      };
    }
```

Add the imports at the top of `browserActionExecutor.ts`:

```typescript
import { BrowserClickPayload, BrowserTypePayload } from '../../shared/actions/surfaceActionTypes';
```

- [ ] **Step 4: Add validation in SurfaceActionRouter**

In `SurfaceActionRouter.ts`, add validation cases to `validatePayload` (in the switch, before `default:`):

```typescript
      case 'browser.click': {
        const p = payload as BrowserClickPayload;
        if (!p.selector || typeof p.selector !== 'string' || p.selector.trim().length === 0) {
          throw new Error('browser.click requires a non-empty "selector" string');
        }
        break;
      }
      case 'browser.type': {
        const p = payload as BrowserTypePayload;
        if (!p.selector || typeof p.selector !== 'string' || p.selector.trim().length === 0) {
          throw new Error('browser.type requires a non-empty "selector" string');
        }
        if (typeof p.text !== 'string') {
          throw new Error('browser.type requires a "text" string');
        }
        break;
      }
```

Add the imports at the top:

```typescript
import { BrowserClickPayload, BrowserTypePayload } from '../../shared/actions/surfaceActionTypes';
```

(These may already be available if the file re-exports from the surfaceActionTypes barrel. Check if BrowserClickPayload is in scope — if not, add the import.)

- [ ] **Step 5: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/shared/actions/surfaceActionTypes.ts src/main/actions/surfaceActionPolicy.ts src/main/actions/browserActionExecutor.ts src/main/actions/SurfaceActionRouter.ts
git commit -m "feat: add browser.click and browser.type action kinds with validation and policies"
```

---

## Task 8: Enhanced browser_navigate with Load-Wait and Preview

**Files:**
- Modify: `src/main/actions/browserActionExecutor.ts`

- [ ] **Step 1: Add waitForBrowserLoad helper**

Add at the top of `browserActionExecutor.ts`, after imports:

```typescript
function waitForBrowserLoad(timeoutMs: number = 5000): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    function check(): void {
      const state = browserService.getState();
      if (!state.navigation.isLoading) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(); // timeout — return whatever state exists
        return;
      }
      setTimeout(check, 200);
    }
    check();
  });
}
```

- [ ] **Step 2: Update the browser.navigate case**

Replace the `browser.navigate` case (lines 34-52) with:

```typescript
    case 'browser.navigate': {
      const { url } = payload as BrowserNavigatePayload;
      browserService.navigate(url);

      const delayMs = getDebugNavigateDelayMs();
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      // Wait for page to finish loading (or timeout)
      await waitForBrowserLoad(5000);

      const state = browserService.getState();
      const metadata = await browserService.getPageMetadata();
      const preview = await browserService.getPageText(2000);

      return {
        summary: `Navigated to ${state.navigation.url || url}`,
        data: {
          url: state.navigation.url || url,
          title: state.navigation.title,
          isLoading: state.navigation.isLoading,
          tabCount: state.tabs.length,
          pagePreview: preview.slice(0, 2000),
          metadata,
        },
      };
    }
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/main/actions/browserActionExecutor.ts
git commit -m "feat: browser.navigate waits for load, returns page preview and metadata"
```

---

## Task 9: Add 7 New Tool Definitions

**Files:**
- Modify: `src/main/models/tools/toolDefinitions.ts`

- [ ] **Step 1: Add new tool definitions**

Add the following tool constants before the `// ─── Exports` section (before line 184):

```typescript
// ─── Terminal Observation Tools ──────────────────────────────────────────

const GET_TERMINAL_OUTPUT: ToolDefinition = {
  name: 'get_terminal_output',
  description: 'Get recent terminal output lines. Use after executing a command to see more output, or to check on a long-running process. Returns ANSI-stripped text.',
  input_schema: {
    type: 'object',
    properties: {
      lines: { type: 'number', description: 'Number of recent lines to return (default: 50, max: 200)' },
    },
  },
};

// ─── Browser Observation Tools ──────────────────────────────────────────

const GET_PAGE_TEXT: ToolDefinition = {
  name: 'get_page_text',
  description: 'Get the visible text content of the current browser page (document.body.innerText). Use after navigating to verify what loaded. Large pages are truncated.',
  input_schema: {
    type: 'object',
    properties: {
      maxLength: { type: 'number', description: 'Maximum characters to return (default: 8000, max: 16000)' },
    },
  },
};

const GET_PAGE_METADATA: ToolDefinition = {
  name: 'get_page_metadata',
  description: 'Get a structural overview of the current page: title, URL, meta description, headings, and counts of links, inputs, forms, and images. Use to understand page structure before interacting.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
    },
  },
};

const QUERY_SELECTOR: ToolDefinition = {
  name: 'query_selector',
  description: 'Find elements on the page by CSS selector. Returns an array of matching elements with their tag name, visible text (truncated), href, id, and CSS classes. Use to find buttons, links, inputs, or any element before clicking or typing.',
  input_schema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector (e.g., "button.submit", "a[href*=login]", "input[type=email]")' },
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
      limit: { type: 'number', description: 'Maximum elements to return (default: 20)' },
    },
    required: ['selector'],
  },
};

const CLICK_ELEMENT: ToolDefinition = {
  name: 'click_element',
  description: 'Click an element on the page by CSS selector. Use query_selector first to find the right selector. The first matching element is clicked.',
  input_schema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector for the element to click' },
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
    },
    required: ['selector'],
  },
};

const TYPE_IN_ELEMENT: ToolDefinition = {
  name: 'type_in_element',
  description: 'Type text into an input field or textarea by CSS selector. Sets the value, focuses the element, and dispatches input+change events. Use query_selector first to find the right selector.',
  input_schema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector for the input element' },
      text: { type: 'string', description: 'The text to type into the element' },
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
    },
    required: ['selector', 'text'],
  },
};

const EXECUTE_JS: ToolDefinition = {
  name: 'execute_js',
  description: 'Execute arbitrary JavaScript in the browser page context. Returns the expression result. Use for advanced page inspection or interaction not covered by other tools.',
  input_schema: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'JavaScript expression to evaluate in the page (e.g., "document.title", "document.querySelectorAll(\'li\').length")' },
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
    },
    required: ['expression'],
  },
};
```

- [ ] **Step 2: Update the TOOL_TO_ACTION_KIND map**

Add to the map (after `'browser.activate-tab'` entry):

```typescript
  'click_element': 'browser.click',
  'type_in_element': 'browser.type',
```

- [ ] **Step 3: Update the OBSERVATION_TOOLS tuple**

Replace:
```typescript
const OBSERVATION_TOOLS = ['get_browser_state', 'get_terminal_session', 'reimport_chrome_cookies'] as const;
```

With:
```typescript
const OBSERVATION_TOOLS = [
  'get_browser_state', 'get_terminal_session', 'reimport_chrome_cookies',
  'get_terminal_output', 'get_page_text', 'get_page_metadata', 'query_selector', 'execute_js',
] as const;
```

- [ ] **Step 4: Update ALL_TOOL_DEFINITIONS array**

Add the new tools to the array:

```typescript
export const ALL_TOOL_DEFINITIONS: ToolDefinition[] = [
  // Browser actions
  BROWSER_NAVIGATE,
  BROWSER_BACK,
  BROWSER_FORWARD,
  BROWSER_RELOAD,
  BROWSER_STOP,
  BROWSER_CREATE_TAB,
  BROWSER_CLOSE_TAB,
  BROWSER_ACTIVATE_TAB,
  CLICK_ELEMENT,
  TYPE_IN_ELEMENT,
  // Terminal actions
  TERMINAL_EXECUTE,
  TERMINAL_WRITE,
  TERMINAL_RESTART,
  TERMINAL_INTERRUPT,
  // Observation
  GET_BROWSER_STATE,
  GET_TERMINAL_SESSION,
  GET_TERMINAL_OUTPUT,
  GET_PAGE_TEXT,
  GET_PAGE_METADATA,
  QUERY_SELECTOR,
  EXECUTE_JS,
  // Session management
  REIMPORT_CHROME_COOKIES,
];
```

- [ ] **Step 5: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/main/models/tools/toolDefinitions.ts
git commit -m "feat: add 7 new tool definitions — terminal output, page text, metadata, querySelector, click, type, executeJS"
```

---

## Task 10: Wire Tool Handlers in toolExecutor

**Files:**
- Modify: `src/main/models/tools/toolExecutor.ts`

- [ ] **Step 1: Add import for terminalService**

Add at the top of the imports (if not already present):

```typescript
import { terminalService } from '../../terminal/TerminalService';
```

(Check: `terminalService` is already imported on line 8. Confirmed.)

- [ ] **Step 2: Add observation tool handlers**

Add new cases to the `executeObservationTool` switch (before the `default:` case):

```typescript
    case 'get_terminal_output': {
      const lines = typeof input.lines === 'number'
        ? Math.min(Math.max(1, Math.floor(input.lines)), 200)
        : 50;
      const output = terminalService.getRecentOutput(lines);
      return {
        result: {
          lines: output ? output.split('\n').length : 0,
          output: output || '(no recent output)',
        },
        isError: false,
      };
    }

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

    case 'get_page_metadata': {
      if (!browserService.isCreated()) {
        return { result: { error: 'Browser not initialized' }, isError: false };
      }
      const metadata = await browserService.getPageMetadata(input.tabId as string | undefined);
      return { result: metadata, isError: false };
    }

    case 'query_selector': {
      if (!browserService.isCreated()) {
        return { result: { elements: [] }, isError: false };
      }
      const selector = input.selector as string;
      if (!selector) return { result: { error: 'selector is required' }, isError: true };
      const limit = typeof input.limit === 'number' ? Math.min(Math.max(1, input.limit), 50) : 20;
      const elements = await browserService.querySelectorAll(
        selector,
        input.tabId as string | undefined,
        limit,
      );
      return {
        result: { selector, matchCount: elements.length, elements },
        isError: false,
      };
    }

    case 'execute_js': {
      if (!browserService.isCreated()) {
        return { result: { error: 'Browser not initialized' }, isError: true };
      }
      const expression = input.expression as string;
      if (!expression) return { result: { error: 'expression is required' }, isError: true };
      const { result, error } = await browserService.executeInPage(
        expression,
        input.tabId as string | undefined,
      );
      if (error) return { result: { error }, isError: true };
      return { result: { value: result }, isError: false };
    }
```

- [ ] **Step 3: Enhance get_terminal_session with shell integration data**

Replace the existing `get_terminal_session` case with:

```typescript
    case 'get_terminal_session': {
      const session = terminalService.getSession();
      if (!session) {
        return { result: { status: 'no_session', message: 'No terminal session is running' }, isError: false };
      }
      const cmdState = terminalService.getCommandState();
      const appCmdState = appStateStore.getState().terminalCommand;
      return {
        result: {
          id: session.id,
          pid: session.pid,
          shell: session.shell,
          cwd: cmdState.cwd || session.cwd,
          status: session.status,
          cols: session.cols,
          rows: session.rows,
          commandPhase: cmdState.phase,
          lastExitCode: cmdState.lastExitCode,
          lastCommand: appCmdState.lastDispatchedCommand,
          dispatching: appCmdState.dispatched,
          shellIntegrationActive: cmdState.cwd !== '',
        },
        isError: false,
      };
    }
```

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/main/models/tools/toolExecutor.ts
git commit -m "feat: wire 7 new tool handlers in toolExecutor — terminal output, page text, metadata, querySelector, click, type, executeJS"
```

---

## Task 11: Run Full Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npx vitest run 2>&1 | tail -20`
Expected: All tests pass. If any fail, investigate and fix before proceeding.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit --pretty 2>&1 | tail -10`
Expected: No type errors

- [ ] **Step 3: Verify the app builds**

Run: `npm run build 2>&1 | tail -10`
Expected: Build succeeds (or check the actual build script in package.json)

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve test/build issues from Phase 1 integration"
```

(Only run if fixes were needed. Skip if everything passed clean.)

---

## Summary

| Task | What It Builds | Files |
|------|---------------|-------|
| 1 | CommandState type + event | `terminal.ts`, `events.ts` |
| 2 | OSC 633 parser | `oscParser.ts` + test |
| 3 | Shell integration scripts | `shellIntegration.ts` + test |
| 4 | Wire integration into TerminalService | `TerminalService.ts` |
| 5 | Enhanced terminal_execute | `terminalActionExecutor.ts` |
| 6 | Browser DOM methods | `BrowserService.ts` |
| 7 | browser.click + browser.type kinds | `surfaceActionTypes.ts`, `surfaceActionPolicy.ts`, `browserActionExecutor.ts`, `SurfaceActionRouter.ts` |
| 8 | Enhanced browser_navigate | `browserActionExecutor.ts` |
| 9 | 7 new tool definitions | `toolDefinitions.ts` |
| 10 | Tool executor handlers | `toolExecutor.ts` |
| 11 | Full verification | — |

Total: 11 tasks, ~11 commits, 2 new files, 11 modified files.
