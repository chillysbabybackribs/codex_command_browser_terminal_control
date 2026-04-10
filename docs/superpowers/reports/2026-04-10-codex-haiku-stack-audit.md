# Codex CLI + Claude Haiku 4.5 Stack: Implementation Audit Report

**Date:** 2026-04-10
**Scope:** Grounded audit of `/home/dp/Desktop/v1workspace` readiness for a dual-model stack (Codex CLI + Claude Haiku 4.5 API) with app-owned routing and handoff.

---

## 1. Executive Summary

The codebase is a production-grade Electron workspace with two physical windows (Command Center, Execution) managing two surfaces (browser, terminal) through a well-structured main-process control plane. The architecture is **highly compatible** with adding Codex CLI and Haiku 4.5 as model backends, but currently has **zero AI/LLM integration** — no provider abstraction, no model invocation, no conversation/context management, and no concept of task ownership by a model.

**Verdict:** This stack can be implemented cleanly. The existing architecture provides strong foundations — specifically the `SurfaceActionRouter`, `SurfaceExecutionController`, `EventBus`, `AppStateStore`, and typed IPC layer — that should be extended, not replaced. The narrowest safe path is: (1) add a `CodexService` as a new main-process service parallel to `TerminalService`, (2) add a `HaikuService` for Anthropic API calls, (3) add a lightweight `ModelRouter` that delegates tasks to either, and (4) extend `TaskRecord` with ownership and handoff metadata.

---

## 2. Current Readiness Assessment

### What Already Exists and Supports This

| Component | File(s) | Relevance |
|---|---|---|
| **Process execution layer** | `src/main/terminal/TerminalService.ts` | Spawns PTY via `node-pty`, manages lifecycle, emits events. Direct template for Codex CLI process management. |
| **tmux integration** | `src/main/terminal/tmuxManager.ts` | `execFileSync`/`execFile` wrappers for spawning external CLI processes. Pattern reusable for Codex CLI invocation. |
| **Action routing** | `src/main/actions/SurfaceActionRouter.ts` | Single authoritative execution path for surface actions. The routing pattern (validate → create → enqueue → execute → result) is directly extensible to model-dispatched actions. |
| **Concurrency control** | `src/main/actions/SurfaceExecutionController.ts`, `surfaceActionPolicy.ts` | Per-surface queue with serialize/bypass modes. Template for per-model execution controllers. |
| **Typed action system** | `src/shared/actions/surfaceActionTypes.ts` | Discriminated union of action kinds with typed payloads and results. Extensible to model action kinds (`codex.execute`, `haiku.chat`, etc.). |
| **State store** | `src/main/state/appStateStore.ts`, `reducer.ts`, `actions.ts` | Reducer-based central state with dispatch/subscribe. Ready to add model-related state. |
| **Event bus** | `src/main/events/eventBus.ts`, `eventRouter.ts` | Typed pub/sub with automatic renderer broadcast. Ready for model lifecycle events. |
| **Task system** | `TaskRecord` in `appState.ts` | Tasks have id, title, status, timestamps. Missing: owner, context, model attribution. |
| **Log system** | `LogRecord` in `appState.ts` | Source-tagged logs (`browser`, `terminal`, `system`). Trivially extensible to `codex`, `haiku` sources. |
| **IPC layer** | `src/shared/types/ipc.ts`, `registerIpc.ts`, `preload.ts` | Clean channel-based IPC with typed `WorkspaceAPI`. New model channels fit the same pattern. |
| **Persistence** | `src/main/state/persistence.ts`, `terminalSessionStore.ts` | JSON file persistence in `userData`. Pattern reusable for model context persistence. |
| **ID generation** | `src/shared/utils/ids.ts` | `generateId(prefix)` — trivially usable for `generateId('codex')`, `generateId('haiku')`, etc. |

### What Does NOT Exist

- **No LLM/AI provider abstraction** — zero imports of `@anthropic-ai/sdk`, `openai`, or any model library
- **No conversation/chat state** — no message history, no conversation turns, no prompt management
- **No model routing logic** — no concept of "which model handles this"
- **No context/handoff mechanism** — no structured summaries, no artifact passing between models
- **No task ownership** — `TaskRecord` has no `owner` or `modelId` field
- **No streaming support** — existing IPC pushes full state snapshots, no incremental token streaming
- **No API key/credential management** — no env/config for API keys
- **No `@anthropic-ai/sdk` dependency** — `package.json` has only `electron`, `node-pty`, `typescript`, `vitest`, `xterm`

---

## 3. Files/Systems Likely Involved

### Must Touch (Modifications)

| File | Change |
|---|---|
| `src/shared/types/appState.ts` | Extend `TaskRecord` with `owner: ModelOwner`, add `ModelContextState` |
| `src/shared/types/events.ts` | Add model lifecycle events (`MODEL_ACTION_SUBMITTED`, `CODEX_OUTPUT`, `HAIKU_RESPONSE`, etc.) |
| `src/shared/actions/surfaceActionTypes.ts` | Add `codex.*` and `haiku.*` action kinds (or new parallel type system) |
| `src/main/state/actions.ts` | Add action types for model state mutations |
| `src/main/state/reducer.ts` | Handle new model-related action types |
| `src/main/events/eventRouter.ts` | Wire model events to state + renderer broadcast |
| `src/main/ipc/registerIpc.ts` | Register model IPC handlers |
| `src/preload/preload.ts` | Expose model API methods to renderer |
| `src/shared/types/ipc.ts` | Add model IPC channels and `WorkspaceAPI` extensions |
| `src/renderer/global.d.ts` | Add model API type declarations |
| `src/main/main.ts` | Initialize `codexService` and `haikuService` |
| `package.json` | Add `@anthropic-ai/sdk` dependency |

### Must Create (New Files)

| File | Purpose |
|---|---|
| `src/main/models/CodexService.ts` | Codex CLI process spawning, lifecycle, stdout/stderr capture |
| `src/main/models/HaikuService.ts` | Anthropic API client, streaming, error handling |
| `src/main/models/ModelRouter.ts` | Owner-based task routing between Codex and Haiku |
| `src/main/models/modelTypes.ts` | `ModelOwner`, `ModelAction`, `HandoffPacket` types |
| `src/main/models/contextManager.ts` | Handoff packet assembly, summary persistence |
| `src/shared/types/model.ts` | Shared model types (owner enum, context shape) |

### Should NOT Touch

| File | Reason |
|---|---|
| `src/main/browser/BrowserService.ts` | Browser runtime is independent of model stack |
| `src/main/browser/browserPermissions.ts` | Unrelated |
| `src/main/browser/chromeCookieCrypto.ts` | Unrelated |
| `src/main/browser/chromeCookieImporter.ts` | Unrelated |
| `src/main/windows/windowManager.ts` | Window layout is orthogonal (no new windows needed for v1) |
| `src/main/windows/layoutPresets.ts` | Unrelated |
| `src/renderer/execution/execution.ts` | Execution pane manages browser+terminal; model output display is deferred |
| `src/renderer/command/command.css` | Minimal CSS changes only if UI indicators are added |

---

## 4. Missing Pieces (Grouped)

### 4A. Required for Codex CLI Integration

**Where it should live:** `src/main/models/CodexService.ts` — a new service parallel to `TerminalService`, initialized in `main.ts`.

**Why not inside TerminalService:** TerminalService manages the user's interactive shell PTY. Codex CLI is a different process with different lifecycle semantics (command → long-running agent → output → exit). Mixing them would create confused lifecycle states and competing PTY ownership.

**Process execution model:**
- Spawn via `child_process.spawn('codex', [...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })` — NOT via node-pty
- Codex CLI is a command-response tool, not an interactive terminal. It writes structured output to stdout, progress to stderr, and exits with a code
- The `tmuxManager.ts` pattern of `execFileSync`/`execFile` is reusable for synchronous detection (`which codex`), but execution itself must be async with streaming capture

**Lifecycle mapping to existing control plane:**
- `status: 'idle' | 'starting' | 'running' | 'completed' | 'failed'` — maps to existing `SurfaceStatus`
- stdout/stderr streaming → emit via `EventBus` on new event types (e.g., `CODEX_OUTPUT`, `CODEX_ERROR`)
- Exit/error → emit completion event, update task record
- Cancellation → `process.kill(pid, 'SIGTERM')` with fallback to `SIGKILL` after timeout

**Incompatible assumptions:**
1. **TerminalService assumes a single session.** Codex invocations are per-task, potentially concurrent. The `CodexService` must support multiple active processes, keyed by task ID.
2. **SurfaceActionRouter assumes two surfaces** (`browser`, `terminal`). Codex is a third execution context. Option: add `codex` as a new `SurfaceTarget`, or create a parallel `ModelActionRouter`. Recommendation: parallel router to avoid contaminating the surface action type system.
3. **No stdout capture infrastructure.** The existing terminal streams raw PTY data to renderers. Codex output needs structured capture (for handoff) and optional raw display. Needs a separate output buffer per invocation.

**Minimum integration path:**
1. Create `CodexService` with `detect()`, `invoke(args, cwd, taskId)`, `cancel(taskId)`, `getStatus(taskId)`
2. Wire to `EventBus` with new event types
3. Add IPC handlers for `codex:invoke`, `codex:cancel`, `codex:status`
4. Store per-invocation state in a `Map<taskId, CodexInvocation>`
5. Do NOT integrate into `SurfaceActionRouter` — keep model execution separate from surface execution

### 4B. Required for Claude Haiku 4.5 API Integration

**Where it should live:** `src/main/models/HaikuService.ts`

**No existing LLM abstraction to reuse.** The codebase has zero AI/model code. This is the first provider integration.

**Minimum provider abstraction:**
```typescript
// src/main/models/modelTypes.ts
export type ModelOwner = 'codex' | 'haiku';
export type ModelMessage = { role: 'user' | 'assistant'; content: string; };
export type ModelRequest = { messages: ModelMessage[]; systemPrompt?: string; maxTokens?: number; };
export type ModelResponse = { content: string; stopReason: string; usage: { input: number; output: number }; };
```
This is intentionally minimal. Do NOT build a generic multi-provider abstraction — there are only two backends, and they have fundamentally different invocation models (CLI process vs HTTP API).

**HaikuService requirements:**
1. `@anthropic-ai/sdk` as dependency (adds ~2MB)
2. API key from environment (`ANTHROPIC_API_KEY`) or persisted config
3. Streaming via SDK's `stream()` method — emit partial tokens via EventBus for optional UI display
4. Retry on 429/500 with exponential backoff (SDK handles this if configured)
5. Error classification: auth error (fatal, surface to user), rate limit (retry), server error (retry), network error (retry with backoff)
6. Request cancellation via `AbortController`

**What parts of the current app suit a non-Codex assistant:**
- The Command Center (`src/renderer/command/`) is already the human-facing control panel. Haiku responses (chat, summaries, intent parsing) would display here.
- The task system (`TaskRecord`) can track Haiku-generated tasks.
- The log system can capture Haiku interactions as `source: 'haiku'`.
- The IPC pattern (invoke → handle → respond) maps directly to request/response with Haiku.

### 4C. Required for Shared Context / Handoff

**Current conversation/context state: NONE.** There is no conversation history, message store, or context management anywhere in the codebase. This is the largest gap.

**What currently stores task-relevant state:**
- `TaskRecord` — id, title, status, timestamps (no content, no context)
- `SurfaceActionRecord` — action kind, payload summary, result summary, timestamps (no raw output)
- `LogRecord` — source-tagged text messages (not structured for handoff)
- `BrowserState` — current URL, navigation, tabs (ephemeral runtime state)
- `TerminalCommandState` — last dispatched command (no output capture)

**What's missing for handoff:**
1. **Conversation/message history** — needed for Haiku chat context
2. **Structured output capture** — Codex stdout needs to be stored as structured artifacts, not just streamed
3. **Handoff packet format** — a serializable snapshot that either model can receive as context
4. **Summary generation** — when switching owners, the outgoing model's context must be summarized (by Haiku, since it's the assistant model)

**Minimum handoff packet:**
```typescript
export type HandoffPacket = {
  taskId: string;
  fromOwner: ModelOwner;
  toOwner: ModelOwner;
  summary: string;                    // Natural language summary of what was done
  artifacts: HandoffArtifact[];       // Files modified, commands run, URLs visited
  recentDecisions: string[];          // Key decisions made during the outgoing phase
  timestamp: number;
};

export type HandoffArtifact = {
  type: 'file' | 'command_output' | 'url' | 'code_snippet';
  label: string;
  content: string;                    // Truncated if large
  path?: string;                      // File path or URL
};
```

**Where to persist:** `src/main/models/contextManager.ts` — stores handoff packets and conversation state per task. In-memory with periodic flush to `userData/model-context/`.

**Avoiding raw transcript replay:** The handoff packet is the explicit mechanism. When Codex finishes and Haiku resumes, the app builds a handoff packet from Codex's output, not by replaying the full Codex stdout. The `contextManager` owns this — neither model sees the other's raw session.

### 4D. Required for Minimal Routing

**Current routing:** `SurfaceActionRouter` routes surface actions (`browser.*`, `terminal.*`) to executors based on `targetForKind()`. There is no concept of "which model should handle this task."

**Minimum owner-based routing:**
```typescript
// src/main/models/ModelRouter.ts
export class ModelRouter {
  route(task: TaskRecord): ModelOwner {
    // v1: static rules, no smart routing
    if (task.owner) return task.owner;       // Explicit assignment
    return 'haiku';                           // Default: assistant model
  }

  escalate(taskId: string, from: ModelOwner, to: ModelOwner, reason: string): void {
    // Build handoff packet, switch owner, resume with new model
  }
}
```

**Task owner split (v1):**

| Owner | Responsibilities |
|---|---|
| **Codex CLI** | Code generation, file editing, repo inspection, shell commands, complex multi-step workspace operations, git operations |
| **Haiku 4.5** | Chat/Q&A, intent parsing, task decomposition, result synthesis, summaries, lightweight planning, error explanation, user-facing responses |

**What code paths need to know the current owner:**
1. `registerIpc.ts` — new IPC handlers for model invocation need to route through `ModelRouter`
2. `eventRouter.ts` — model lifecycle events need to be wired
3. `reducer.ts` — task updates need to include owner changes
4. Command Center renderer — needs to know which model is active (for display, not routing)

**Minimum escalation behavior (v1):**
- User explicitly requests handoff ("let Codex handle this" / "summarize this")
- Haiku detects a coding task and suggests escalation (display suggestion, user confirms)
- Codex completes and returns to Haiku for synthesis
- No automatic bidirectional handoff — always user-initiated or completion-triggered

**What to explicitly avoid:**
- "Smart routing" that tries to classify every input — v1 uses explicit ownership
- Automatic context replay between models — use handoff packets
- Model-to-model direct communication — the app mediates everything

### 4E. UI / Operator Implications

**Current UI components needing model-owner awareness:**

| Component | File | Change Needed |
|---|---|---|
| Task summary | `command.ts` L461 | Show `[codex]` or `[haiku]` badge next to active task |
| Log stream | `command.ts` L335-343 | Already supports source tagging — add `codex`/`haiku` as `LogSource` |
| Active actions | `command.ts` L346-397 | Add model action rows alongside surface action rows |
| Task list | `command.ts` L325-332 | Show owner badge per task |

**What should be displayed (v1):**
- Model owner badge on active task (`[codex]` / `[haiku]`)
- Log entries tagged by model source (already supported by `LogSourceRole` — just add new source values)
- Active model operation indicator (similar to existing terminal dispatch state)
- Handoff events in the log stream

**What should remain invisible/internal:**
- Raw handoff packets (internal plumbing, not user-facing)
- Model routing decisions (log them but don't surface in UI)
- API request/response details (log at debug level only)
- Token usage (v1 doesn't need a cost dashboard)

**Minimum UI changes:**
1. Extend `LogSourceRole` to include `'codex' | 'haiku'`
2. Add a small model indicator in the task summary area
3. Add CSS for model-source log entries (different colors/icons)
4. That's it for v1. No new windows, no new panels, no chat interface yet.

---

## 5. Risk Audit

### 5F1. Local Codex CLI Process Management

| Risk | Severity | Mitigation |
|---|---|---|
| Codex CLI not installed or not in PATH | High (blocks feature) | `detectCodex()` check at startup + graceful degradation |
| Codex CLI hangs or doesn't exit | High | Timeout + `SIGTERM` → `SIGKILL` escalation; expose cancel in UI |
| Codex CLI writes to files unexpectedly | Medium | Run in a controlled CWD; consider sandboxing in future |
| Multiple concurrent Codex invocations contend on workspace | Medium | v1: serialize Codex invocations per workspace (one at a time) |
| Codex CLI auth/session expires mid-task | Medium | Detect auth errors from stderr, surface to user |
| stdout/stderr interleaving creates garbled output | Low | Capture on separate streams, buffer per-line |

**Must solve before implementation:** Detection + graceful degradation. Timeout + cancellation.

**Can defer:** Sandboxing, concurrent invocation, auth session management.

### 5F2. Anthropic API Integration

| Risk | Severity | Mitigation |
|---|---|---|
| No API key configured | High (blocks feature) | Check on startup, surface error in UI, refuse to route to Haiku |
| Rate limiting (429) | Medium | SDK has built-in retry; add backoff config |
| Network failure / timeout | Medium | Retry with exponential backoff; surface error after N retries |
| Streaming response interrupted | Medium | Handle partial responses, surface incomplete result |
| Large context overflows model window | Medium | Handoff packet size limits; truncation strategy |
| API cost runaway | Low (Haiku is cheap) | Log usage per request; add optional per-session budget (deferred) |

**Must solve before implementation:** API key management, error surfacing.

**Can defer:** Budget controls, advanced retry configuration.

### 5F3. Task-Owner Switching

| Risk | Severity | Mitigation |
|---|---|---|
| Stale owner after model crash | Medium | Set ownership at dispatch time, clear on failure |
| Race between user input and model response during handoff | Medium | Lock task during handoff transition |
| Unclear which model is "active" to the user | Medium | Always show owner badge; log handoff events |
| Infinite handoff loop (Haiku escalates to Codex, Codex escalates back) | Low | v1: no automatic re-escalation; user confirms all handoffs |

**Must solve before implementation:** Owner state management, handoff locking.

**Can defer:** Loop detection, automatic re-escalation.

### 5F4. Stale or Bloated Handoff Context

| Risk | Severity | Mitigation |
|---|---|---|
| Handoff packet grows unbounded over many switches | High | Cap artifact content size (e.g., 4K per artifact, 10 artifacts max) |
| Summary quality degrades context | Medium | Haiku generates summaries — quality is decent but verify with testing |
| Context mismatch after file edits | Medium | Include file paths + timestamps in artifacts; receiver can re-read |
| Old handoff packets consumed instead of current state | Medium | Handoff packets are timestamped; receiver checks freshness |

**Must solve before implementation:** Size limits on handoff packets.

**Can defer:** Summary quality tuning, freshness verification.

### 5F5. Duplicated Execution Authority

| Risk | Severity | Mitigation |
|---|---|---|
| Both Codex and the user's terminal edit the same file simultaneously | High | v1: Codex runs on its own tasks; user terminal is independent. Document this boundary. |
| ModelRouter and SurfaceActionRouter both try to execute a terminal command | High | Strict separation: SurfaceActionRouter handles surface actions from UI. ModelRouter handles model-initiated actions through separate code paths. They MUST NOT share execution paths. |
| Renderer submits a surface action while a model owns the task | Medium | v1: allow it — user always has override authority. Log the conflict. |

**Must solve before implementation:** Clear boundary between surface execution and model execution. No shared execution paths.

**Can defer:** Conflict detection, automatic locking.

---

## 6. Recommended Implementation Order

### Phase 1: Foundation (No AI Yet)
1. **Create `src/shared/types/model.ts`** — `ModelOwner`, `HandoffPacket`, `HandoffArtifact` types
2. **Extend `TaskRecord`** — add `owner: ModelOwner | null` field (null = unassigned/user)
3. **Extend `LogSourceRole`** — add `'codex' | 'haiku'` to the union
4. **Add model event types** to `events.ts` — `CODEX_STARTED`, `CODEX_OUTPUT`, `CODEX_COMPLETED`, `HAIKU_REQUEST`, `HAIKU_RESPONSE`, etc.
5. **Update reducer** to handle new task/model action types
6. **Write tests** for the extended state management

### Phase 2: Codex CLI Service
1. **Create `src/main/models/CodexService.ts`** — detection, invocation, lifecycle, cancellation
2. **Wire to EventBus** — emit events on stdout, stderr, exit, error
3. **Add IPC handlers** — `codex:invoke`, `codex:cancel`, `codex:status`
4. **Initialize in `main.ts`** — `codexService.detect()` at startup
5. **Write tests** for CodexService (mock child_process)

### Phase 3: Haiku API Service
1. **Add `@anthropic-ai/sdk`** to `package.json` dependencies
2. **Create `src/main/models/HaikuService.ts`** — API client, streaming, error handling
3. **Add API key management** — read from env or persisted config
4. **Wire to EventBus** — emit events on request/response/error
5. **Add IPC handlers** — `haiku:chat`, `haiku:summarize`, `haiku:status`
6. **Write tests** for HaikuService (mock SDK)

### Phase 4: Routing + Handoff
1. **Create `src/main/models/ModelRouter.ts`** — static owner-based routing
2. **Create `src/main/models/contextManager.ts`** — handoff packet assembly + persistence
3. **Wire handoff to TaskRecord updates** — owner changes trigger handoff packet creation
4. **Add IPC handlers** — `model:route`, `model:handoff`, `model:get-context`
5. **Write integration tests** — Codex → Haiku handoff, Haiku → Codex escalation

### Phase 5: Minimal UI
1. **Add model owner badge** to Command Center task display
2. **Add log source colors** for `codex` and `haiku`
3. **Add model status indicator** (idle/working badge)
4. **Update `preload.ts`** and `global.d.ts` with model API surface

---

## 7. Explicit Non-Goals for V1

1. **No chat interface** — Haiku responses display in the log stream, not a dedicated chat panel
2. **No smart/ML-based routing** — static rules only
3. **No model-to-model direct communication** — app mediates all handoffs
4. **No full transcript replay** — handoff packets only
5. **No multi-provider abstraction** — only Codex CLI + Haiku 4.5, no pluggable provider system
6. **No token streaming to renderer** — Haiku responses arrive complete (v1), or stream to log
7. **No cost tracking dashboard** — log usage, don't display
8. **No concurrent Codex invocations** — serialize per workspace
9. **No browser automation by models** — Codex and Haiku cannot submit browser surface actions
10. **No new windows or panels** — reuse existing Command Center and log system
11. **No automatic escalation** — all handoffs user-initiated or completion-triggered
12. **No persistent conversation history across sessions** — in-memory per session, handoff packets persist

---

## 8. Final Verdict

### Can this stack be implemented cleanly in the current codebase?

**Yes.** The architecture is well-structured with clear separation of concerns:
- Services own runtime behavior (`TerminalService`, `BrowserService` → new `CodexService`, `HaikuService`)
- The action system owns execution flow (`SurfaceActionRouter` → new `ModelRouter`)
- The state store owns data (`appStateStore` → extended with model state)
- The event bus owns communication (`eventBus` → extended with model events)
- IPC owns the main↔renderer bridge (same pattern, new channels)

No existing system needs to be replaced. Every new component follows an established pattern.

### What is the narrowest safe path?

1. **Phase 1** (types + state) — ~4 files modified, ~2 files created. Zero risk. Can test immediately.
2. **Phase 2** (CodexService) — 1 new service + IPC wiring. Isolated from existing code. Can test with mock CLI.
3. **Phase 3** (HaikuService) — 1 new service + 1 new dependency. Isolated. Can test with mock API.
4. **Phase 4** (routing + handoff) — connects Phase 2 + 3. This is the only phase that introduces cross-cutting complexity.
5. **Phase 5** (UI) — minimal, additive CSS + badge rendering. No structural UI changes.

Each phase is independently testable and deployable. The app remains fully functional after each phase — model features are additive, never breaking.

### Critical constraint

**The `SurfaceActionRouter` must remain the sole authority for surface actions.** Models must NOT submit surface actions through the router — they operate on their own execution paths. If Codex needs to run a terminal command, it does so through its own subprocess, not through `terminal.execute` in the `SurfaceActionRouter`. This prevents duplicated execution authority and preserves the existing surface control plane's integrity.
