# Model-to-Surface Tool Wiring Implementation Plan (Updated)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the dual-model system into the app's browser and terminal surfaces through a tool-use loop, so models can navigate URLs, run commands, read results, and take follow-up actions.

**Key insight from audit:** The codebase already has a complete typed action system (`SurfaceActionKind`, `SurfaceActionPayloadMap`, `SurfaceActionResultMap`) with 12 deterministic actions, concurrency policies, and lifecycle events. The result types are defined but never returned — the executors return summary strings instead. The plan fixes that first, then maps the existing system directly to Anthropic tool definitions.

**Architecture:** Models request actions via tool-use content blocks. The app executes them through the existing `SurfaceActionRouter`, captures structured results, and feeds them back. No parallel execution path — models use the same system as the UI.

---

## Phase 1: Tool Definitions + Structured Results

**What:** Define Anthropic-compatible tool schemas from the existing `SurfaceActionKind` system, and fix the executors to return the structured result types that are already defined but unused.

**Why combined:** Tool definitions without structured results would give models useless `"Navigating to..."` strings. Structured results without tool definitions have no consumer. They're one unit of work.

### Task 1A: Fix executors to return structured results

**Files to modify:**
- `src/main/actions/browserActionExecutor.ts`
- `src/main/actions/terminalActionExecutor.ts`
- `src/main/actions/SurfaceActionRouter.ts`

The `SurfaceActionResultMap` types already exist in `surfaceActionTypes.ts`. The executors just need to return them instead of summary strings. The router stores `resultSummary: string` on `SurfaceActionRecord` — keep that for display, but also store a structured result for model consumption.

- [ ] **Step 1: Change `executeBrowserAction` to return structured objects**

Each case in the switch currently returns a string. Change each to return a `{ summary: string; data: Record<string, unknown> }` tuple — the summary stays for logging/display, the data is the structured result.

```typescript
// Before:
return `Navigating to ${state.navigation.url || url}`;

// After:
const nav = browserService.getState().navigation;
return {
  summary: `Navigating to ${nav.url || url}`,
  data: { url: nav.url || url, title: nav.title, isLoading: nav.isLoading, tabCount: browserService.getTabs().length },
};
```

Apply this pattern to all 8 browser action cases:
- `browser.navigate` → `{ url, title, isLoading, tabCount }`
- `browser.back` / `browser.forward` → `{ url, title, canGoBack, canGoForward }`
- `browser.reload` / `browser.stop` → `{ url, isLoading }`
- `browser.create-tab` → `{ tabId, url, totalTabs }`
- `browser.close-tab` → `{ closedTabId, remainingTabs }`
- `browser.activate-tab` → `{ tabId, url, title }`

- [ ] **Step 2: Change `executeTerminalAction` to return structured objects**

Same pattern for all 4 terminal action cases:
- `terminal.execute` → `{ command, sessionId, dispatched: true }`
- `terminal.write` → `{ sessionId, written: true }`
- `terminal.restart` → `{ sessionId, shell }`
- `terminal.interrupt` → `{ sessionId, sent: true }`

- [ ] **Step 3: Update `SurfaceActionRouter.executeAction` to handle the new return type**

The router currently does:
```typescript
resultSummary = await executeBrowserAction(action.kind, action.payload);
```

Change both executors' return type to `{ summary: string; data: Record<string, unknown> }`, then in the router:
```typescript
const result = await executeBrowserAction(action.kind, action.payload);
// Store summary for display
this.updateRecord(id, { status: 'completed', resultSummary: result.summary, updatedAt: Date.now() });
// Store structured data on a new field
```

Add a `resultData` field to `SurfaceActionRecord` for storing the structured result. This field is consumed by the tool executor in Phase 2.

- [ ] **Step 4: Add `resultData` to `SurfaceActionRecord`**

In `src/shared/actions/surfaceActionTypes.ts`, add to `SurfaceActionRecord`:
```typescript
  resultData: Record<string, unknown> | null;
```

Update the `UPDATE_SURFACE_ACTION` action type to include `resultData` in the updatable fields.

- [ ] **Step 5: Run tests, verify all 145+ existing tests pass**

### Task 1B: Tool definitions

**Files to create:**
- `src/main/models/tools/toolDefinitions.ts`

- [ ] **Step 1: Create tool definitions that map 1:1 to SurfaceActionKinds**

Each definition uses the Anthropic tool schema format:
```typescript
{ name: string, description: string, input_schema: { type: 'object', properties: {...}, required: [...] } }
```

Define tools for:
- 8 browser action tools (map from `BrowserActionKind`)
- 4 terminal action tools (map from `TerminalActionKind`)
- 2 observation tools (no side effects):
  - `get_browser_state` — returns current URL, title, tabs, loading, navigation state
  - `get_terminal_session` — returns session info, last command, status

- [ ] **Step 2: Create `toolNameToActionKind` mapping**

A simple lookup that converts tool names (`browser_navigate`) to `SurfaceActionKind` (`browser.navigate`). This is the bridge between the Anthropic tool protocol and the existing action system.

- [ ] **Step 3: Verify definitions compile and match expected schema**

**Manual test:** Import the definitions, log them, confirm they're valid Anthropic tool objects.

---

## Phase 2: Haiku Tool-Use Loop

**What:** Modify HaikuGate to send tool definitions, parse tool_use blocks, execute tools through SurfaceActionRouter, feed results back, and loop until text response.

**Files to create:**
- `src/main/models/tools/toolExecutor.ts` — executes a tool call, routes actions or queries

**Files to modify:**
- `src/main/models/haikuGate.ts` — tool-use conversation loop
- `src/shared/types/model.ts` — add `ToolCall` / `ToolResult` types

- [ ] **Step 1: Create `toolExecutor.ts`**

```typescript
async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  taskId: string,
): Promise<{ result: Record<string, unknown>; isError: boolean }>
```

For action tools: maps tool name → `SurfaceActionKind` → `surfaceActionRouter.submit()` → returns `resultData`.
For observation tools: calls `browserService.getState()` or `terminalService.getSession()` directly.

- [ ] **Step 2: Modify `HaikuGate.invoke()` to implement the tool-use loop**

The loop:
1. Build messages array (with tool definitions)
2. Call API
3. If response contains `tool_use` blocks:
   a. Execute each tool via `toolExecutor`
   b. Build `tool_result` message blocks
   c. Append assistant turn + tool results to messages
   d. Re-call API (loop back to step 2)
4. If response is text only: return as `InvocationResult`
5. Cap at 15 iterations to prevent runaway

- [ ] **Step 3: Add `origin: 'model'` to `SurfaceActionOrigin`**

In `surfaceActionTypes.ts`, extend:
```typescript
export type SurfaceActionOrigin = 'command-center' | 'system' | 'model';
```

The toolExecutor submits actions with `origin: 'model'` so they're distinguishable in the UI and logs.

- [ ] **Step 4: Run tests + manual test**

**Manual test:** Set owner to `haiku`, type "navigate to wikipedia.org" → verify:
1. Haiku calls `browser_navigate` tool
2. SurfaceActionRouter executes the navigation
3. Structured result fed back to Haiku
4. Haiku responds with confirmation text
5. Browser actually shows Wikipedia

---

## Phase 3: Codex Workspace Context

**What:** Inject current workspace state into Codex prompts so it knows what the browser and terminal are doing.

**Files to modify:**
- `src/main/models/codexGate.ts` — prepend workspace state block to prompt

- [ ] **Step 1: Build workspace context summary**

Before sending prompt to Codex stdin, prepend:
```
[Workspace State]
Browser: https://en.wikipedia.org | Wikipedia | 3 tabs | idle
Terminal: /bin/bash PID 12345 | /home/dp/Desktop/v1workspace | running
Last command: npm test
```

Read from `browserService.getState()` and `terminalService.getSession()` + `appStateStore.getState().terminalCommand`.

- [ ] **Step 2: Manual test**

Set owner to `codex`, type "what page is the browser on?" → Codex receives the context and answers correctly.

---

## Phase 4: Page Content Extraction + Terminal Output Capture

**What:** Add two high-value observation tools that require new service capabilities:
- `get_page_text` — extract visible text from active browser tab
- `get_terminal_output` — capture recent terminal output

**Files to create:**
- `src/main/browser/pageContentExtractor.ts`

**Files to modify:**
- `src/main/browser/BrowserService.ts` — add `getPageText()` method
- `src/main/terminal/TerminalService.ts` — implement `captureScrollback()` (currently stub returning `''`)
- `src/main/models/tools/toolDefinitions.ts` — add the two new tool definitions
- `src/main/models/tools/toolExecutor.ts` — add execution for new tools

- [ ] **Step 1: Implement `BrowserService.getPageText()`**

Use `webContents.executeJavaScript('document.body.innerText')` on the active tab's WebContentsView to extract page text. Truncate to 8000 chars.

- [ ] **Step 2: Implement terminal output capture**

Add an output ring buffer to TerminalService that captures the last N bytes of PTY output (e.g., 16KB). The existing `onData` handler already receives all output — tap into it to fill the buffer. Then `captureScrollback()` returns the buffer contents.

- [ ] **Step 3: Add tool definitions + executor cases**

- [ ] **Step 4: Manual test**

Navigate to a Wikipedia article, ask Haiku "what does this page say about X?" → extracts text, answers.
Run `ls -la` in terminal, ask "what files are in the directory?" → reads output, answers.

---

## Phase 5: Multi-Turn Chat History

**What:** Maintain conversation history so the model remembers previous turns.

**Files to create:**
- `src/main/models/chatSession.ts`

**Files to modify:**
- `src/main/models/haikuGate.ts` — accept/return message history
- `src/main/ipc/registerIpc.ts` — pass history through MODEL_INVOKE
- `src/renderer/command/command.ts` — maintain and send history

- [ ] **Step 1: Create `ChatMessage` type and `ChatSession` class**

```typescript
type ChatMessage = { role: 'user' | 'assistant'; content: string | ContentBlock[] };
```

`ChatSession` stores messages per session, handles truncation when approaching context limits.

- [ ] **Step 2: Wire into HaikuGate**

Instead of building messages from scratch each invoke, accept the full history and append the new turn.

- [ ] **Step 3: Wire into renderer**

The chat UI maintains a `ChatMessage[]` and sends it with each invoke. Tool use/result blocks are included in the history so the model sees the full conversation including actions taken.

- [ ] **Step 4: Manual test**

Multi-turn: "search for electron tutorials" → Haiku navigates → "what's on the page?" → reads text → "open the second link" → navigates based on context. Verify 5+ turns maintain coherence.

---

## Phase 6: Streaming Token Display

**What:** Show Haiku's response tokens in real-time as they stream.

**Files to modify:**
- `src/main/models/haikuGate.ts` — emit token events during streaming
- `src/renderer/command/command.ts` — listen for progress events, append tokens live

- [ ] **Step 1: Wire streaming events to chat bubble**

The HaikuGate already emits `MODEL_INVOCATION_PROGRESS` with `type: 'token'`. The renderer needs to listen on the `model:progress` IPC channel and append each token to the active message element.

- [ ] **Step 2: Handle tool-use streaming**

During the tool loop, show "calling browser_navigate..." status in the chat while tools execute, then resume streaming the next API response.

- [ ] **Step 3: Manual test**

Ask a long question → see words appear incrementally instead of loading then full text.

---

## Implementation Sequence

```
Phase 1 (structured results + tool defs)  ← fixes existing gap + builds foundation
    ↓
Phase 2 (haiku tool loop)                  ← THE core feature — models control surfaces
    ↓
Phase 3 (codex context)                    ← lightweight, completes dual-model story
    ↓
Phase 4 (page text + terminal output)      ← high-value observation tools
    ↓
Phase 5 (chat history)                     ← multi-turn memory
    ↓
Phase 6 (streaming display)                ← UX polish
```

**Manual test checkpoints:**
- After Phase 1: Tool definitions log correctly, executors return structured data, existing tests pass
- After Phase 2: "navigate to google.com" triggers actual browser navigation through tool loop
- After Phase 3: Codex knows the current browser URL from workspace context
- After Phase 4: "what does this page say?" extracts and returns page text
- After Phase 5: Multi-turn conversations maintain context across 5+ turns
- After Phase 6: Streaming tokens appear in real-time in chat
