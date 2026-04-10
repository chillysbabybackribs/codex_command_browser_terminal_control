# Dual-Model Implementation Blueprint

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Codex CLI and Claude Haiku 4.5 API as dual model backends with app-owned routing, structured handoff, and future provider extensibility.

**Architecture:** Main process owns model lifecycle via `ModelRouter`. Two `ProviderGate` implementations (`CodexGate` wrapping `codex exec --json`, `HaikuGate` wrapping `@anthropic-ai/sdk`) are registered at startup. The `ContextManager` builds structured `HandoffPacket`s for cross-model continuity. No model has direct surface execution authority — the app mediates everything.

**Tech Stack:** Existing Electron 41 + TypeScript 5.8 + node-pty stack. New dependency: `@anthropic-ai/sdk`. Codex CLI via local install (`codex exec --json`).

**Codex invocation mode:** `codex exec --json --dangerously-bypass-approvals-and-sandbox` — the app is the sandbox boundary, not Codex's built-in sandbox. This gives unrestricted task completion. The `--json` flag provides structured JSONL events.

---

## Codex JSONL Event Schema (verified from live CLI)

```jsonl
// Lifecycle events
{"type":"thread.started","thread_id":"uuid"}
{"type":"turn.started"}
{"type":"turn.completed","usage":{"input_tokens":N,"cached_input_tokens":N,"output_tokens":N}}
{"type":"turn.failed","error":{"message":"..."}}

// Item events — three item types observed:
// 1. agent_message — text output from the model
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}

// 2. command_execution — shell command run by Codex
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/bash -lc 'cat .git/HEAD'","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/bash -lc 'cat .git/HEAD'","aggregated_output":"ref: refs/heads/master\n","exit_code":0,"status":"completed"}}

// 3. file_change — file created/modified/deleted by Codex
{"type":"item.started","item":{"id":"item_3","type":"file_change","changes":[{"path":"/abs/path/file.txt","kind":"add|update|delete"}],"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_3","type":"file_change","changes":[{"path":"/abs/path/file.txt","kind":"add"}],"status":"completed"}}

// 4. mcp_tool_call — MCP tool invocation (when sandbox blocks shell)
{"type":"item.started","item":{"id":"item_2","type":"mcp_tool_call","server":"local-agent","tool":"os_shell_exec","arguments":{...},"result":null,"error":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_2","type":"mcp_tool_call","server":"local-agent","tool":"...","arguments":{...},"result":null,"error":{"message":"..."},"status":"failed"}}
```

---

## File Structure

```
src/
  shared/
    types/
      model.ts                    # NEW — ProviderId, ProviderGate types, CodexEvent, HandoffPacket
  main/
    models/
      providerRegistry.ts         # NEW — Static provider definitions, default routing rules
      ModelRouter.ts              # NEW — Routing, dispatch, handoff orchestration
      codexGate.ts                # NEW — Codex CLI process management, JSONL parsing
      haikuGate.ts                # NEW — Anthropic SDK wrapper, streaming
      contextManager.ts           # NEW — HandoffPacket assembly, artifact tracking, persistence
```

---

### Task 1: Shared Model Types

**Files:**
- Create: `src/shared/types/model.ts`
- Modify: `src/shared/types/appState.ts`
- Modify: `src/shared/types/windowRoles.ts`
- Modify: `src/shared/types/events.ts`
- Modify: `src/main/state/actions.ts`
- Modify: `src/main/state/reducer.ts`

- [ ] **Step 1: Create `src/shared/types/model.ts`**

This is the entire shared type system for the model layer. Every other file imports from here.

```typescript
// src/shared/types/model.ts
// ═══════════════════════════════════════════════════════════════════════════
// Model Layer Types — Provider registry, routing, handoff, Codex events
// ═══════════════════════════════════════════════════════════════════════════

// ─── Provider Identity ────────────────────────────────────────────────────

export type ProviderId = 'codex' | 'haiku';

export type ProviderKind = 'cli-process' | 'api-streaming';

export type ProviderStatus = 'available' | 'unavailable' | 'busy' | 'error';

export type ProviderCapability =
  | 'code-generation'
  | 'code-editing'
  | 'shell-execution'
  | 'repo-analysis'
  | 'chat'
  | 'summarization'
  | 'intent-parsing'
  | 'planning'
  | 'synthesis';

// ─── Provider Definition (static, configured at startup) ──────────────────

export type ProviderDefinition = {
  id: ProviderId;
  displayName: string;
  kind: ProviderKind;
  capabilities: ProviderCapability[];
};

// ─── Provider Runtime (dynamic, changes per-request) ──────────────────────

export type ProviderRuntime = {
  id: ProviderId;
  status: ProviderStatus;
  activeTaskId: string | null;
  lastActivityAt: number | null;
  errorDetail: string | null;
};

export function createDefaultProviderRuntime(id: ProviderId): ProviderRuntime {
  return {
    id,
    status: 'unavailable',
    activeTaskId: null,
    lastActivityAt: null,
    errorDetail: null,
  };
}

// ─── Task Ownership ───────────────────────────────────────────────────────

export type ModelOwner = ProviderId | 'user';

// ─── Codex CLI Event Types (from `codex exec --json`) ─────────────────────

export type CodexEventType =
  | 'thread.started'
  | 'turn.started'
  | 'turn.completed'
  | 'turn.failed'
  | 'item.started'
  | 'item.completed';

export type CodexItemType = 'agent_message' | 'command_execution' | 'file_change' | 'mcp_tool_call';
export type CodexItemStatus = 'in_progress' | 'completed' | 'failed';
export type CodexFileChangeKind = 'add' | 'update' | 'delete';

export type CodexFileChange = {
  path: string;
  kind: CodexFileChangeKind;
};

export type CodexItem =
  | { id: string; type: 'agent_message'; text: string }
  | { id: string; type: 'command_execution'; command: string; aggregated_output: string; exit_code: number | null; status: CodexItemStatus }
  | { id: string; type: 'file_change'; changes: CodexFileChange[]; status: CodexItemStatus }
  | { id: string; type: 'mcp_tool_call'; server: string; tool: string; arguments: Record<string, unknown>; result: unknown; error: { message: string } | null; status: CodexItemStatus };

export type CodexUsage = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
};

export type CodexEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | { type: 'turn.completed'; usage: CodexUsage }
  | { type: 'turn.failed'; error: { message: string } }
  | { type: 'item.started'; item: CodexItem }
  | { type: 'item.completed'; item: CodexItem };

// ─── Invocation Types (shared by all gates) ───────────────────────────────

export type InvocationRequest = {
  taskId: string;
  prompt: string;
  context: HandoffPacket | null;
  systemPrompt?: string;
  cwd?: string;
  abortSignal: AbortSignal;
};

export type InvocationProgress = {
  taskId: string;
  providerId: ProviderId;
  type: 'stdout' | 'stderr' | 'token' | 'status' | 'item';
  data: string;
  codexItem?: CodexItem;
  timestamp: number;
};

export type InvocationResult = {
  taskId: string;
  providerId: ProviderId;
  success: boolean;
  output: string;
  artifacts: HandoffArtifact[];
  error?: string;
  usage: { inputTokens: number; outputTokens: number; durationMs: number };
  codexItems?: CodexItem[];
};

// ─── Handoff Types ────────────────────────────────────────────────────────

export type HandoffArtifactType = 'file_change' | 'command_output' | 'agent_message' | 'error';

export type HandoffArtifact = {
  type: HandoffArtifactType;
  label: string;
  content: string;
  path?: string;
};

export type HandoffPacket = {
  id: string;
  taskId: string;
  fromProvider: ProviderId;
  toProvider: ProviderId;
  summary: string;
  artifacts: HandoffArtifact[];
  recentDecisions: string[];
  tokenEstimate: number;
  createdAt: number;
};

// ─── Routing Types ────────────────────────────────────────────────────────

export type RoutingMatchType = 'capability' | 'explicit' | 'default';

export type RoutingRule = {
  match: RoutingMatch;
  assignTo: ProviderId;
  priority: number;
};

export type RoutingMatch =
  | { type: 'capability'; capability: ProviderCapability }
  | { type: 'explicit'; owner: ProviderId }
  | { type: 'default' };

// ─── Codex Configuration ──────────────────────────────────────────────────

export type CodexApprovalMode = 'full-auto' | 'dangerously-bypass';

export type CodexInvocationConfig = {
  approvalMode: CodexApprovalMode;
  sandbox: 'read-only' | 'workspace-write' | null;
  timeoutMs: number;
  ephemeral: boolean;
};

export const DEFAULT_CODEX_CONFIG: CodexInvocationConfig = {
  approvalMode: 'dangerously-bypass',
  sandbox: null,
  timeoutMs: 300_000,  // 5 minutes
  ephemeral: true,
};

// ─── Haiku Configuration ──────────────────────────────────────────────────

export type HaikuInvocationConfig = {
  modelId: string;
  maxTokens: number;
  streaming: boolean;
};

export const DEFAULT_HAIKU_CONFIG: HaikuInvocationConfig = {
  modelId: 'claude-haiku-4-5-20251001',
  maxTokens: 4096,
  streaming: true,
};
```

- [ ] **Step 2: Extend `LogSourceRole` in `src/shared/types/windowRoles.ts`**

Add `'codex' | 'haiku'` to the log source union.

Current:
```typescript
export type LogSourceRole = SurfaceRole | 'system';
```

Change to:
```typescript
export type LogSourceRole = SurfaceRole | 'system' | 'codex' | 'haiku';
```

- [ ] **Step 3: Add model events to `src/shared/types/events.ts`**

Add to the `AppEventType` enum:
```typescript
  // Model lifecycle events
  MODEL_PROVIDER_DETECTED = 'MODEL_PROVIDER_DETECTED',
  MODEL_PROVIDER_STATUS_CHANGED = 'MODEL_PROVIDER_STATUS_CHANGED',
  MODEL_INVOCATION_STARTED = 'MODEL_INVOCATION_STARTED',
  MODEL_INVOCATION_PROGRESS = 'MODEL_INVOCATION_PROGRESS',
  MODEL_INVOCATION_COMPLETED = 'MODEL_INVOCATION_COMPLETED',
  MODEL_INVOCATION_FAILED = 'MODEL_INVOCATION_FAILED',
  MODEL_HANDOFF = 'MODEL_HANDOFF',
```

Add to `AppEventPayloads`:
```typescript
  [AppEventType.MODEL_PROVIDER_DETECTED]: { providerId: ProviderId; available: boolean; detail: string };
  [AppEventType.MODEL_PROVIDER_STATUS_CHANGED]: { runtime: ProviderRuntime };
  [AppEventType.MODEL_INVOCATION_STARTED]: { taskId: string; providerId: ProviderId };
  [AppEventType.MODEL_INVOCATION_PROGRESS]: { progress: InvocationProgress };
  [AppEventType.MODEL_INVOCATION_COMPLETED]: { result: InvocationResult };
  [AppEventType.MODEL_INVOCATION_FAILED]: { taskId: string; providerId: ProviderId; error: string };
  [AppEventType.MODEL_HANDOFF]: { packet: HandoffPacket };
```

Add the imports from `../types/model` at the top of the file.

- [ ] **Step 4: Extend `AppState` in `src/shared/types/appState.ts`**

Add to `TaskRecord`:
```typescript
export type TaskRecord = {
  id: string;
  title: string;
  status: TaskStatus;
  owner: ModelOwner;       // NEW
  createdAt: number;
  updatedAt: number;
};
```

Add to `AppState`:
```typescript
export type AppState = {
  // ... all existing fields unchanged ...
  providers: Record<ProviderId, ProviderRuntime>;  // NEW
};
```

Update `createDefaultAppState()`:
```typescript
import { createDefaultProviderRuntime, type ProviderId } from './model';

export function createDefaultAppState(): AppState {
  return {
    // ... all existing fields unchanged ...
    providers: {
      codex: createDefaultProviderRuntime('codex'),
      haiku: createDefaultProviderRuntime('haiku'),
    },
  };
}
```

- [ ] **Step 5: Add model actions to `src/main/state/actions.ts`**

Add to `ActionType` enum:
```typescript
  SET_PROVIDER_RUNTIME = 'SET_PROVIDER_RUNTIME',
```

Add to `Action` union:
```typescript
  | { type: ActionType.SET_PROVIDER_RUNTIME; providerId: ProviderId; runtime: ProviderRuntime }
```

Add the import for `ProviderId` and `ProviderRuntime` from the shared model types.

Update the `ADD_TASK` action to require `owner`:
```typescript
  | { type: ActionType.ADD_TASK; task: TaskRecord }
```
(TaskRecord already includes `owner` from step 4.)

- [ ] **Step 6: Handle new actions in `src/main/state/reducer.ts`**

Add the new case to `appReducer`:
```typescript
    case ActionType.SET_PROVIDER_RUNTIME:
      return {
        ...state,
        providers: {
          ...state.providers,
          [action.providerId]: action.runtime,
        },
      };
```

- [ ] **Step 7: Write tests for extended state**

Create `src/main/models/modelState.test.ts`:

Test cases:
- Default provider runtimes are `unavailable`
- `SET_PROVIDER_RUNTIME` updates the correct provider
- `ADD_TASK` with `owner` field persists correctly
- `TaskRecord` with `owner: 'codex'` round-trips through reducer
- `TaskRecord` with `owner: 'user'` round-trips through reducer
- Provider runtime transitions: `unavailable` → `available` → `busy` → `available`

---

### Task 2: Provider Registry

**Files:**
- Create: `src/main/models/providerRegistry.ts`

- [ ] **Step 1: Create `src/main/models/providerRegistry.ts`**

```typescript
// src/main/models/providerRegistry.ts
// ═══════════════════════════════════════════════════════════════════════════
// Provider Registry — Static definitions and default routing rules
// ═══════════════════════════════════════════════════════════════════════════

import type { ProviderDefinition, RoutingRule } from '../../shared/types/model';

export const CODEX_DEFINITION: ProviderDefinition = {
  id: 'codex',
  displayName: 'Codex CLI',
  kind: 'cli-process',
  capabilities: [
    'code-generation',
    'code-editing',
    'shell-execution',
    'repo-analysis',
  ],
};

export const HAIKU_DEFINITION: ProviderDefinition = {
  id: 'haiku',
  displayName: 'Claude Haiku 4.5',
  kind: 'api-streaming',
  capabilities: [
    'chat',
    'summarization',
    'intent-parsing',
    'planning',
    'synthesis',
  ],
};

export const ALL_PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  CODEX_DEFINITION,
  HAIKU_DEFINITION,
];

export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
  // Codex handles coding and shell work
  { match: { type: 'capability', capability: 'code-generation' }, assignTo: 'codex', priority: 100 },
  { match: { type: 'capability', capability: 'code-editing' }, assignTo: 'codex', priority: 100 },
  { match: { type: 'capability', capability: 'shell-execution' }, assignTo: 'codex', priority: 90 },
  { match: { type: 'capability', capability: 'repo-analysis' }, assignTo: 'codex', priority: 80 },

  // Haiku handles assistant work
  { match: { type: 'capability', capability: 'chat' }, assignTo: 'haiku', priority: 50 },
  { match: { type: 'capability', capability: 'summarization' }, assignTo: 'haiku', priority: 50 },
  { match: { type: 'capability', capability: 'intent-parsing' }, assignTo: 'haiku', priority: 50 },
  { match: { type: 'capability', capability: 'planning' }, assignTo: 'haiku', priority: 50 },
  { match: { type: 'capability', capability: 'synthesis' }, assignTo: 'haiku', priority: 50 },

  // Default: haiku handles everything unmatched
  { match: { type: 'default' }, assignTo: 'haiku', priority: 0 },
];
```

No tests needed — this is pure static data.

---

### Task 3: Context Manager

**Files:**
- Create: `src/main/models/contextManager.ts`

- [ ] **Step 1: Create `src/main/models/contextManager.ts`**

```typescript
// src/main/models/contextManager.ts
// ═══════════════════════════════════════════════════════════════════════════
// Context Manager — Handoff packet assembly, artifact tracking
// ═══════════════════════════════════════════════════════════════════════════

import { generateId } from '../../shared/utils/ids';
import type {
  ProviderId, HandoffPacket, HandoffArtifact, HandoffArtifactType,
  CodexItem, InvocationResult,
} from '../../shared/types/model';

const MAX_ARTIFACTS = 10;
const MAX_ARTIFACT_BYTES = 4096;
const MAX_SUMMARY_BYTES = 2048;

export class ContextManager {
  // Per-task: last invocation result from each provider
  private lastResults = new Map<string, InvocationResult>();
  // Per-task: handoff history
  private packets = new Map<string, HandoffPacket[]>();

  recordResult(result: InvocationResult): void {
    this.lastResults.set(result.taskId, result);
  }

  buildHandoffPacket(
    taskId: string,
    from: ProviderId,
    to: ProviderId,
  ): HandoffPacket {
    const result = this.lastResults.get(taskId);
    const artifacts: HandoffArtifact[] = [];
    let summary = '';

    if (result) {
      // Build summary from output
      summary = result.output.length > MAX_SUMMARY_BYTES
        ? result.output.slice(0, MAX_SUMMARY_BYTES) + '\n... [truncated]'
        : result.output;

      // Extract artifacts from Codex items if present
      if (result.codexItems) {
        for (const item of result.codexItems) {
          if (artifacts.length >= MAX_ARTIFACTS) break;
          const artifact = this.codexItemToArtifact(item);
          if (artifact) artifacts.push(artifact);
        }
      }
    }

    const packet: HandoffPacket = {
      id: generateId('hp'),
      taskId,
      fromProvider: from,
      toProvider: to,
      summary,
      artifacts,
      recentDecisions: [],
      tokenEstimate: Math.ceil(summary.length / 4),
      createdAt: Date.now(),
    };

    if (!this.packets.has(taskId)) this.packets.set(taskId, []);
    this.packets.get(taskId)!.push(packet);

    return packet;
  }

  getHistory(taskId: string): HandoffPacket[] {
    return this.packets.get(taskId) || [];
  }

  clear(taskId: string): void {
    this.lastResults.delete(taskId);
    this.packets.delete(taskId);
  }

  private codexItemToArtifact(item: CodexItem): HandoffArtifact | null {
    switch (item.type) {
      case 'agent_message':
        return null; // Messages go into summary, not artifacts
      case 'command_execution': {
        if (item.status !== 'completed') return null;
        const content = item.aggregated_output.length > MAX_ARTIFACT_BYTES
          ? item.aggregated_output.slice(0, MAX_ARTIFACT_BYTES) + '\n... [truncated]'
          : item.aggregated_output;
        return {
          type: 'command_output',
          label: `$ ${item.command.length > 80 ? item.command.slice(0, 80) + '...' : item.command}`,
          content,
        };
      }
      case 'file_change': {
        if (item.status !== 'completed' || item.changes.length === 0) return null;
        return {
          type: 'file_change',
          label: item.changes.map(c => `${c.kind}: ${c.path}`).join(', '),
          content: item.changes.map(c => `${c.kind} ${c.path}`).join('\n'),
          path: item.changes[0]?.path,
        };
      }
      case 'mcp_tool_call': {
        if (item.error) {
          return {
            type: 'error',
            label: `MCP ${item.tool} failed`,
            content: item.error.message,
          };
        }
        return null;
      }
      default:
        return null;
    }
  }
}

export const contextManager = new ContextManager();
```

- [ ] **Step 2: Write tests for ContextManager**

Create `src/main/models/contextManager.test.ts`:

Test cases:
- `recordResult` stores and `buildHandoffPacket` retrieves for a task
- Handoff packet summary is truncated at `MAX_SUMMARY_BYTES`
- Codex `command_execution` items become `command_output` artifacts
- Codex `file_change` items become `file_change` artifacts
- Codex `agent_message` items are NOT added as artifacts (they go in summary)
- Codex `mcp_tool_call` with error becomes `error` artifact
- `MAX_ARTIFACTS` cap is enforced
- `clear` removes all state for a task
- `getHistory` returns empty array for unknown task
- Multiple handoffs for same task accumulate in history

---

### Task 4: Codex Gate

**Files:**
- Create: `src/main/models/codexGate.ts`

- [ ] **Step 1: Create `src/main/models/codexGate.ts`**

```typescript
// src/main/models/codexGate.ts
// ═══════════════════════════════════════════════════════════════════════════
// Codex Gate — CLI process management with JSONL event parsing
// ═══════════════════════════════════════════════════════════════════════════

import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { generateId } from '../../shared/utils/ids';
import type {
  ProviderId, ProviderDefinition, ProviderRuntime, ProviderStatus,
  InvocationRequest, InvocationResult, InvocationProgress,
  CodexEvent, CodexItem, CodexUsage,
  CodexInvocationConfig, DEFAULT_CODEX_CONFIG,
} from '../../shared/types/model';

type ProgressListener = (progress: InvocationProgress) => void;

export class CodexGate {
  readonly id: ProviderId = 'codex';
  private binaryPath: string | null = null;
  private activeProcess: { taskId: string; proc: ChildProcess; timer: ReturnType<typeof setTimeout> } | null = null;
  private progressListeners = new Set<ProgressListener>();
  private status: ProviderRuntime;

  constructor(
    readonly definition: ProviderDefinition,
    private config: CodexInvocationConfig = { ...DEFAULT_CODEX_CONFIG },
  ) {
    this.status = {
      id: 'codex',
      status: 'unavailable',
      activeTaskId: null,
      lastActivityAt: null,
      errorDetail: null,
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  detect(): boolean {
    try {
      const result = execFileSync('which', ['codex'], {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
      if (result) {
        this.binaryPath = result;
        this.setStatus('available');
        this.emitLog('info', `Codex CLI detected: ${result}`);
        eventBus.emit(AppEventType.MODEL_PROVIDER_DETECTED, {
          providerId: 'codex',
          available: true,
          detail: result,
        });
        return true;
      }
    } catch {}
    this.setStatus('unavailable', 'codex CLI not found in PATH');
    this.emitLog('warn', 'Codex CLI not found in PATH');
    eventBus.emit(AppEventType.MODEL_PROVIDER_DETECTED, {
      providerId: 'codex',
      available: false,
      detail: 'not found in PATH',
    });
    return false;
  }

  getStatus(): ProviderRuntime {
    return { ...this.status };
  }

  // ─── Invocation ─────────────────────────────────────────────────────

  async invoke(request: InvocationRequest): Promise<InvocationResult> {
    if (!this.binaryPath) throw new Error('Codex CLI not available');
    if (this.activeProcess) throw new Error('Codex is already running a task');

    const startTime = Date.now();
    const codexItems: CodexItem[] = [];
    const args = this.buildArgs(request);

    return new Promise<InvocationResult>((resolve, reject) => {
      const proc = spawn(this.binaryPath!, args, {
        cwd: request.cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 5000);
      }, this.config.timeoutMs);

      this.activeProcess = { taskId: request.taskId, proc, timer };
      this.setStatus('busy', null, request.taskId);

      eventBus.emit(AppEventType.MODEL_INVOCATION_STARTED, {
        taskId: request.taskId,
        providerId: 'codex',
      });

      let stdoutBuffer = '';
      let stderrBuffer = '';
      let lastUsage: CodexUsage | null = null;
      let agentOutput = '';
      let threadId: string | null = null;

      // ── Parse JSONL from stdout ──────────────────────────────────
      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as CodexEvent;
            this.handleCodexEvent(event, request.taskId, codexItems);

            if (event.type === 'thread.started') {
              threadId = event.thread_id;
            }
            if (event.type === 'turn.completed') {
              lastUsage = event.usage;
            }
            if (event.type === 'item.completed' && event.item.type === 'agent_message') {
              agentOutput += (agentOutput ? '\n' : '') + event.item.text;
            }
          } catch {
            // Non-JSON line from codex — emit as raw stdout
            this.emitProgress(request.taskId, 'stdout', line);
          }
        }
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        const data = chunk.toString();
        stderrBuffer += data;
        this.emitProgress(request.taskId, 'stderr', data);
      });

      // ── Abort signal ─────────────────────────────────────────────
      const onAbort = () => { proc.kill('SIGTERM'); };
      request.abortSignal.addEventListener('abort', onAbort, { once: true });

      // ── Process exit ─────────────────────────────────────────────
      proc.on('close', (code) => {
        clearTimeout(timer);
        request.abortSignal.removeEventListener('abort', onAbort);
        this.activeProcess = null;
        this.setStatus('available');

        const durationMs = Date.now() - startTime;
        const success = code === 0;

        const result: InvocationResult = {
          taskId: request.taskId,
          providerId: 'codex',
          success,
          output: agentOutput,
          artifacts: [],  // ContextManager extracts these from codexItems
          error: !success ? `Exit code ${code}${stderrBuffer ? ': ' + stderrBuffer.slice(0, 500) : ''}` : undefined,
          usage: {
            inputTokens: lastUsage?.input_tokens ?? 0,
            outputTokens: lastUsage?.output_tokens ?? 0,
            durationMs,
          },
          codexItems,
        };

        if (success) {
          eventBus.emit(AppEventType.MODEL_INVOCATION_COMPLETED, { result });
        } else {
          eventBus.emit(AppEventType.MODEL_INVOCATION_FAILED, {
            taskId: request.taskId,
            providerId: 'codex',
            error: result.error || 'Unknown error',
          });
        }

        resolve(result);
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        request.abortSignal.removeEventListener('abort', onAbort);
        this.activeProcess = null;
        this.setStatus('error', err.message);

        eventBus.emit(AppEventType.MODEL_INVOCATION_FAILED, {
          taskId: request.taskId,
          providerId: 'codex',
          error: err.message,
        });

        reject(err);
      });

      // ── Write prompt to stdin ────────────────────────────────────
      if (proc.stdin) {
        proc.stdin.write(request.prompt);
        proc.stdin.end();
      }
    });
  }

  // ─── Cancellation ───────────────────────────────────────────────────

  cancel(taskId: string): boolean {
    if (!this.activeProcess || this.activeProcess.taskId !== taskId) return false;
    this.activeProcess.proc.kill('SIGTERM');
    return true;
  }

  // ─── Progress ───────────────────────────────────────────────────────

  onProgress(callback: ProgressListener): () => void {
    this.progressListeners.add(callback);
    return () => { this.progressListeners.delete(callback); };
  }

  // ─── Cleanup ────────────────────────────────────────────────────────

  dispose(): void {
    if (this.activeProcess) {
      clearTimeout(this.activeProcess.timer);
      this.activeProcess.proc.kill('SIGKILL');
      this.activeProcess = null;
    }
    this.progressListeners.clear();
  }

  // ─── Private ────────────────────────────────────────────────────────

  private buildArgs(request: InvocationRequest): string[] {
    const args = ['exec', '--json', '--ephemeral'];

    if (this.config.approvalMode === 'dangerously-bypass') {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else {
      args.push('--full-auto');
      if (this.config.sandbox) {
        args.push('--sandbox', this.config.sandbox);
      }
    }

    if (request.cwd) {
      args.push('-C', request.cwd);
    }

    // Prompt comes via stdin, not as a CLI argument
    return args;
  }

  private handleCodexEvent(event: CodexEvent, taskId: string, items: CodexItem[]): void {
    switch (event.type) {
      case 'item.started':
        this.emitProgress(taskId, 'item', `[${event.item.type}] started`, event.item);
        break;
      case 'item.completed':
        items.push(event.item);
        this.emitProgress(taskId, 'item', `[${event.item.type}] completed`, event.item);
        break;
      case 'turn.completed':
        this.emitProgress(taskId, 'status', `Turn completed (${event.usage.output_tokens} tokens)`);
        break;
      case 'turn.failed':
        this.emitProgress(taskId, 'status', `Turn failed: ${event.error.message}`);
        break;
    }
  }

  private emitProgress(taskId: string, type: InvocationProgress['type'], data: string, codexItem?: CodexItem): void {
    const progress: InvocationProgress = {
      taskId,
      providerId: 'codex',
      type,
      data,
      codexItem,
      timestamp: Date.now(),
    };
    for (const listener of this.progressListeners) {
      listener(progress);
    }
    eventBus.emit(AppEventType.MODEL_INVOCATION_PROGRESS, { progress });
  }

  private setStatus(status: ProviderStatus, errorDetail?: string | null, activeTaskId?: string | null): void {
    this.status.status = status;
    if (errorDetail !== undefined) this.status.errorDetail = errorDetail;
    if (activeTaskId !== undefined) this.status.activeTaskId = activeTaskId;
    if (status === 'available' || status === 'busy') {
      this.status.lastActivityAt = Date.now();
      this.status.activeTaskId = activeTaskId ?? null;
    }
    appStateStore.dispatch({
      type: ActionType.SET_PROVIDER_RUNTIME,
      providerId: 'codex',
      runtime: { ...this.status },
    });
    eventBus.emit(AppEventType.MODEL_PROVIDER_STATUS_CHANGED, { runtime: { ...this.status } });
  }

  private emitLog(level: 'info' | 'warn' | 'error', message: string): void {
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level,
        source: 'codex',
        message,
      },
    });
  }
}
```

- [ ] **Step 2: Write tests for CodexGate**

Create `src/main/models/codexGate.test.ts`:

Test cases:
- `detect()` returns true when `codex` binary is in PATH
- `detect()` returns false and sets `unavailable` when binary missing
- `buildArgs` produces correct flags for `dangerously-bypass` mode
- `buildArgs` produces correct flags for `full-auto` mode with sandbox
- `buildArgs` includes `-C` when `cwd` is provided
- JSONL parsing: `thread.started` event parsed correctly
- JSONL parsing: `item.completed` with `agent_message` extracts text
- JSONL parsing: `item.completed` with `command_execution` captures output and exit code
- JSONL parsing: `item.completed` with `file_change` captures paths and kinds
- JSONL parsing: `turn.completed` captures usage tokens
- JSONL parsing: `turn.failed` captures error message
- Non-JSON stdout lines are emitted as raw `stdout` progress
- `cancel()` sends SIGTERM to active process
- `cancel()` returns false when no active process
- Timeout fires SIGTERM then SIGKILL
- `invoke()` rejects when binary not available
- `invoke()` rejects when another task is already running

Mock `child_process.spawn` and `execFileSync` in tests. Do NOT actually run `codex`.

---

### Task 5: Haiku Gate

**Files:**
- Create: `src/main/models/haikuGate.ts`
- Modify: `package.json` (add `@anthropic-ai/sdk`)

- [ ] **Step 1: Add `@anthropic-ai/sdk` dependency**

```bash
npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Create `src/main/models/haikuGate.ts`**

```typescript
// src/main/models/haikuGate.ts
// ═══════════════════════════════════════════════════════════════════════════
// Haiku Gate — Anthropic SDK wrapper with streaming support
// ═══════════════════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { generateId } from '../../shared/utils/ids';
import type {
  ProviderId, ProviderDefinition, ProviderRuntime, ProviderStatus,
  InvocationRequest, InvocationResult, InvocationProgress,
  HaikuInvocationConfig, DEFAULT_HAIKU_CONFIG,
} from '../../shared/types/model';

type ProgressListener = (progress: InvocationProgress) => void;

export class HaikuGate {
  readonly id: ProviderId = 'haiku';
  private client: Anthropic | null = null;
  private activeAborts = new Map<string, AbortController>();
  private progressListeners = new Set<ProgressListener>();
  private status: ProviderRuntime;

  constructor(
    readonly definition: ProviderDefinition,
    private config: HaikuInvocationConfig = { ...DEFAULT_HAIKU_CONFIG },
  ) {
    this.status = {
      id: 'haiku',
      status: 'unavailable',
      activeTaskId: null,
      lastActivityAt: null,
      errorDetail: null,
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  detect(): boolean {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.setStatus('unavailable', 'ANTHROPIC_API_KEY not set');
      this.emitLog('warn', 'ANTHROPIC_API_KEY not set — Haiku unavailable');
      eventBus.emit(AppEventType.MODEL_PROVIDER_DETECTED, {
        providerId: 'haiku',
        available: false,
        detail: 'ANTHROPIC_API_KEY not set',
      });
      return false;
    }
    this.client = new Anthropic({ apiKey });
    this.setStatus('available');
    this.emitLog('info', 'Haiku 4.5 API ready');
    eventBus.emit(AppEventType.MODEL_PROVIDER_DETECTED, {
      providerId: 'haiku',
      available: true,
      detail: this.config.modelId,
    });
    return true;
  }

  getStatus(): ProviderRuntime {
    return { ...this.status };
  }

  // ─── Invocation ─────────────────────────────────────────────────────

  async invoke(request: InvocationRequest): Promise<InvocationResult> {
    if (!this.client) throw new Error('Haiku client not initialized');

    const startTime = Date.now();
    const abort = new AbortController();
    this.activeAborts.set(request.taskId, abort);
    this.setStatus('busy', null, request.taskId);

    request.abortSignal.addEventListener('abort', () => abort.abort(), { once: true });

    eventBus.emit(AppEventType.MODEL_INVOCATION_STARTED, {
      taskId: request.taskId,
      providerId: 'haiku',
    });

    try {
      const messages = this.buildMessages(request);
      let fullText = '';
      let inputTokens = 0;
      let outputTokens = 0;

      if (this.config.streaming) {
        const stream = this.client.messages.stream({
          model: this.config.modelId,
          max_tokens: this.config.maxTokens,
          messages,
          ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
        }, { signal: abort.signal });

        stream.on('text', (text) => {
          fullText += text;
          this.emitProgress(request.taskId, 'token', text);
        });

        const message = await stream.finalMessage();
        inputTokens = message.usage.input_tokens;
        outputTokens = message.usage.output_tokens;
      } else {
        const message = await this.client.messages.create({
          model: this.config.modelId,
          max_tokens: this.config.maxTokens,
          messages,
          ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
        }, { signal: abort.signal });

        fullText = message.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('');
        inputTokens = message.usage.input_tokens;
        outputTokens = message.usage.output_tokens;
      }

      this.setStatus('available');

      const result: InvocationResult = {
        taskId: request.taskId,
        providerId: 'haiku',
        success: true,
        output: fullText,
        artifacts: [],
        usage: { inputTokens, outputTokens, durationMs: Date.now() - startTime },
      };

      eventBus.emit(AppEventType.MODEL_INVOCATION_COMPLETED, { result });
      return result;

    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isAbort = err instanceof Anthropic.APIUserAbortError ||
                      (err instanceof Error && err.name === 'AbortError');

      this.setStatus(isAbort ? 'available' : 'error', isAbort ? null : errorMsg);

      const result: InvocationResult = {
        taskId: request.taskId,
        providerId: 'haiku',
        success: false,
        output: '',
        artifacts: [],
        error: errorMsg,
        usage: { inputTokens: 0, outputTokens: 0, durationMs: Date.now() - startTime },
      };

      eventBus.emit(AppEventType.MODEL_INVOCATION_FAILED, {
        taskId: request.taskId,
        providerId: 'haiku',
        error: errorMsg,
      });

      return result;

    } finally {
      this.activeAborts.delete(request.taskId);
    }
  }

  // ─── Cancellation ───────────────────────────────────────────────────

  cancel(taskId: string): boolean {
    const abort = this.activeAborts.get(taskId);
    if (!abort) return false;
    abort.abort();
    return true;
  }

  // ─── Progress ───────────────────────────────────────────────────────

  onProgress(callback: ProgressListener): () => void {
    this.progressListeners.add(callback);
    return () => { this.progressListeners.delete(callback); };
  }

  // ─── Cleanup ────────────────────────────────────────────────────────

  dispose(): void {
    for (const abort of this.activeAborts.values()) {
      abort.abort();
    }
    this.activeAborts.clear();
    this.progressListeners.clear();
    this.client = null;
  }

  // ─── Private ────────────────────────────────────────────────────────

  private buildMessages(request: InvocationRequest): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = [];

    if (request.context) {
      const contextBlock = [
        `## Context from ${request.context.fromProvider}`,
        '',
        request.context.summary,
      ];

      if (request.context.artifacts.length > 0) {
        contextBlock.push('', '### Artifacts');
        for (const artifact of request.context.artifacts) {
          contextBlock.push(`- **${artifact.label}**: ${artifact.content}`);
        }
      }

      messages.push({ role: 'user', content: contextBlock.join('\n') });
      messages.push({ role: 'assistant', content: 'I have the context. How should I proceed?' });
    }

    messages.push({ role: 'user', content: request.prompt });
    return messages;
  }

  private emitProgress(taskId: string, type: InvocationProgress['type'], data: string): void {
    const progress: InvocationProgress = {
      taskId,
      providerId: 'haiku',
      type,
      data,
      timestamp: Date.now(),
    };
    for (const listener of this.progressListeners) {
      listener(progress);
    }
    eventBus.emit(AppEventType.MODEL_INVOCATION_PROGRESS, { progress });
  }

  private setStatus(status: ProviderStatus, errorDetail?: string | null, activeTaskId?: string | null): void {
    this.status.status = status;
    if (errorDetail !== undefined) this.status.errorDetail = errorDetail;
    if (activeTaskId !== undefined) this.status.activeTaskId = activeTaskId;
    if (status === 'available' || status === 'busy') {
      this.status.lastActivityAt = Date.now();
      this.status.activeTaskId = activeTaskId ?? null;
    }
    appStateStore.dispatch({
      type: ActionType.SET_PROVIDER_RUNTIME,
      providerId: 'haiku',
      runtime: { ...this.status },
    });
    eventBus.emit(AppEventType.MODEL_PROVIDER_STATUS_CHANGED, { runtime: { ...this.status } });
  }

  private emitLog(level: 'info' | 'warn' | 'error', message: string): void {
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level,
        source: 'haiku',
        message,
      },
    });
  }
}
```

- [ ] **Step 3: Write tests for HaikuGate**

Create `src/main/models/haikuGate.test.ts`:

Test cases:
- `detect()` returns false when `ANTHROPIC_API_KEY` not set
- `detect()` returns true and creates client when key is set
- `buildMessages` with no context produces single user message
- `buildMessages` with handoff context produces context + acknowledgment + user message
- `cancel()` aborts the active request
- `cancel()` returns false when no active request for that task
- `invoke()` returns `success: false` on API error (not a thrown exception)
- `invoke()` treats abort as non-error (status returns to `available`)
- Streaming: `onProgress` callbacks receive token events
- Non-streaming: response text is extracted from content blocks
- `dispose()` aborts all active requests

Mock the `Anthropic` constructor and SDK methods in tests. Do NOT call the real API.

---

### Task 6: Model Router

**Files:**
- Create: `src/main/models/ModelRouter.ts`

- [ ] **Step 1: Create `src/main/models/ModelRouter.ts`**

```typescript
// src/main/models/ModelRouter.ts
// ═══════════════════════════════════════════════════════════════════════════
// Model Router — Task routing, dispatch, and handoff orchestration
// ═══════════════════════════════════════════════════════════════════════════

import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { generateId } from '../../shared/utils/ids';
import { contextManager } from './contextManager';
import type { CodexGate } from './codexGate';
import type { HaikuGate } from './haikuGate';
import type {
  ProviderId, ProviderRuntime, ProviderCapability,
  InvocationRequest, InvocationResult,
  HandoffPacket, RoutingRule, ModelOwner,
} from '../../shared/types/model';
import type { TaskRecord } from '../../shared/types/appState';

type Gate = CodexGate | HaikuGate;

export class ModelRouter {
  private gates = new Map<ProviderId, Gate>();
  private rules: RoutingRule[] = [];

  // ─── Registration ───────────────────────────────────────────────────

  registerGate(gate: Gate): void {
    this.gates.set(gate.id, gate);
  }

  setRules(rules: RoutingRule[]): void {
    this.rules = [...rules].sort((a, b) => b.priority - a.priority);
  }

  // ─── Detection ──────────────────────────────────────────────────────

  detectAll(): void {
    for (const gate of this.gates.values()) {
      gate.detect();
    }
  }

  // ─── Routing ────────────────────────────────────────────────────────

  resolve(prompt: string, explicitOwner?: ModelOwner): ProviderId {
    // 1. Explicit assignment
    if (explicitOwner && explicitOwner !== 'user') {
      const gate = this.gates.get(explicitOwner);
      if (gate && gate.getStatus().status !== 'unavailable') {
        return explicitOwner;
      }
      // Fallback if explicit provider unavailable
      this.emitLog('warn', `Requested provider ${explicitOwner} unavailable, falling back`);
    }

    // 2. Capability matching via routing rules
    for (const rule of this.rules) {
      if (rule.match.type === 'capability') {
        const gate = this.gates.get(rule.assignTo);
        if (!gate || gate.getStatus().status === 'unavailable') continue;
        if (this.promptMatchesCapability(prompt, rule.match.capability)) {
          return rule.assignTo;
        }
      } else if (rule.match.type === 'default') {
        const gate = this.gates.get(rule.assignTo);
        if (gate && gate.getStatus().status !== 'unavailable') {
          return rule.assignTo;
        }
      }
    }

    // 3. Last resort: return first available
    for (const gate of this.gates.values()) {
      if (gate.getStatus().status !== 'unavailable') return gate.id;
    }

    throw new Error('No model providers available');
  }

  // ─── Dispatch ───────────────────────────────────────────────────────

  async dispatch(
    taskId: string,
    prompt: string,
    owner: ProviderId,
    options?: { systemPrompt?: string; cwd?: string; abortController?: AbortController },
  ): Promise<InvocationResult> {
    const gate = this.gates.get(owner);
    if (!gate) throw new Error(`Provider ${owner} not registered`);

    const status = gate.getStatus();
    if (status.status === 'unavailable') {
      throw new Error(`Provider ${owner} is unavailable: ${status.errorDetail}`);
    }

    const abortController = options?.abortController ?? new AbortController();

    // Get handoff context if this task was previously worked on by another provider
    const history = contextManager.getHistory(taskId);
    const lastPacket = history.length > 0 ? history[history.length - 1] : null;
    const context = (lastPacket && lastPacket.toProvider === owner) ? lastPacket : null;

    const request: InvocationRequest = {
      taskId,
      prompt,
      context,
      systemPrompt: options?.systemPrompt,
      cwd: options?.cwd,
      abortSignal: abortController.signal,
    };

    const result = await gate.invoke(request);

    // Record result for future handoffs
    contextManager.recordResult(result);

    return result;
  }

  // ─── Handoff ────────────────────────────────────────────────────────

  handoff(taskId: string, from: ProviderId, to: ProviderId): HandoffPacket {
    const packet = contextManager.buildHandoffPacket(taskId, from, to);
    eventBus.emit(AppEventType.MODEL_HANDOFF, { packet });
    this.emitLog('info', `Handoff: ${from} → ${to} for task ${taskId}`);
    return packet;
  }

  // ─── Cancellation ──────────────────────────────────────────────────

  cancel(taskId: string): boolean {
    for (const gate of this.gates.values()) {
      if (gate.getStatus().activeTaskId === taskId) {
        return gate.cancel(taskId);
      }
    }
    return false;
  }

  // ─── Introspection ──────────────────────────────────────────────────

  getProviderStatuses(): Record<ProviderId, ProviderRuntime> {
    const statuses: Record<string, ProviderRuntime> = {};
    for (const [id, gate] of this.gates) {
      statuses[id] = gate.getStatus();
    }
    return statuses as Record<ProviderId, ProviderRuntime>;
  }

  getAvailableProviders(): ProviderId[] {
    const available: ProviderId[] = [];
    for (const [id, gate] of this.gates) {
      if (gate.getStatus().status !== 'unavailable') available.push(id);
    }
    return available;
  }

  // ─── Cleanup ────────────────────────────────────────────────────────

  dispose(): void {
    for (const gate of this.gates.values()) {
      gate.dispose();
    }
    this.gates.clear();
  }

  // ─── Private ────────────────────────────────────────────────────────

  private promptMatchesCapability(prompt: string, capability: ProviderCapability): boolean {
    const p = prompt.toLowerCase();
    switch (capability) {
      case 'code-generation':
      case 'code-editing':
        return /\b(write|create|implement|add|fix|refactor|edit|modify|update|build|generate)\b.*\b(code|function|class|file|component|test|module|type|interface)\b/.test(p)
            || /\b(code|function|class|file|component|test|module)\b.*\b(write|create|implement|add|fix|refactor|edit|modify|build)\b/.test(p);
      case 'shell-execution':
        return /\b(run|execute|install|build|deploy|npm|git|make|compile|lint|test)\b/.test(p);
      case 'repo-analysis':
        return /\b(analyze|audit|review|inspect|check|find|search|grep|explore)\b.*\b(code|repo|codebase|files|directory|project)\b/.test(p);
      case 'summarization':
        return /\b(summarize|summary|explain|describe|what happened|recap|overview)\b/.test(p);
      case 'intent-parsing':
      case 'planning':
        return /\b(plan|design|architect|propose|strategy|approach|how should|what should)\b/.test(p);
      case 'chat':
        return false; // Chat is the default fallback, not a positive match
      case 'synthesis':
        return /\b(combine|merge|synthesize|integrate|consolidate)\b/.test(p);
      default:
        return false;
    }
  }

  private emitLog(level: 'info' | 'warn' | 'error', message: string): void {
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level,
        source: 'system',
        message: `[ModelRouter] ${message}`,
      },
    });
  }
}
```

- [ ] **Step 2: Write tests for ModelRouter**

Create `src/main/models/ModelRouter.test.ts`:

Test cases:
- `resolve()` returns explicit owner when specified and available
- `resolve()` falls back when explicit owner is unavailable
- `resolve()` matches coding prompts to codex via capability rules
- `resolve()` matches summary prompts to haiku via capability rules
- `resolve()` returns default (haiku) for unmatched prompts
- `resolve()` throws when no providers available
- `dispatch()` calls correct gate's `invoke()`
- `dispatch()` passes handoff context when available from prior handoff
- `dispatch()` records result to contextManager
- `handoff()` builds packet and emits `MODEL_HANDOFF` event
- `cancel()` delegates to the gate that owns the active task
- `cancel()` returns false when no gate has the task
- `getAvailableProviders()` returns only non-unavailable providers
- Rules are sorted by priority (highest first)

Use mock gate objects that implement the same interface. No real CLI or API calls.

---

### Task 7: IPC + Event Wiring

**Files:**
- Modify: `src/shared/types/ipc.ts`
- Modify: `src/main/ipc/registerIpc.ts`
- Modify: `src/main/events/eventRouter.ts`
- Modify: `src/preload/preload.ts`
- Modify: `src/renderer/global.d.ts`

- [ ] **Step 1: Add model IPC channels to `src/shared/types/ipc.ts`**

Add to `IPC_CHANNELS`:
```typescript
  // Model channels
  MODEL_INVOKE: 'model:invoke',
  MODEL_CANCEL: 'model:cancel',
  MODEL_GET_PROVIDERS: 'model:get-providers',
  MODEL_RESOLVE: 'model:resolve',
  MODEL_HANDOFF: 'model:handoff',
```

Add to `WorkspaceAPI`:
```typescript
  model: {
    invoke(taskId: string, prompt: string, owner?: string, options?: { systemPrompt?: string; cwd?: string }): Promise<any>;
    cancel(taskId: string): Promise<boolean>;
    getProviders(): Promise<Record<string, any>>;
    resolve(prompt: string, explicitOwner?: string): Promise<string>;
    handoff(taskId: string, from: string, to: string): Promise<any>;
  };
```

- [ ] **Step 2: Register model IPC handlers in `src/main/ipc/registerIpc.ts`**

Add import of `modelRouter` (created in Task 8) and add handlers:

```typescript
  // ── Model IPC handlers ────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.MODEL_INVOKE, async (_event, taskId: string, prompt: string, owner?: string, options?: { systemPrompt?: string; cwd?: string }) => {
    const resolvedOwner = owner
      ? owner as ProviderId
      : modelRouter.resolve(prompt);
    return modelRouter.dispatch(taskId, prompt, resolvedOwner, options);
  });

  ipcMain.handle(IPC_CHANNELS.MODEL_CANCEL, (_event, taskId: string) => {
    return modelRouter.cancel(taskId);
  });

  ipcMain.handle(IPC_CHANNELS.MODEL_GET_PROVIDERS, () => {
    return modelRouter.getProviderStatuses();
  });

  ipcMain.handle(IPC_CHANNELS.MODEL_RESOLVE, (_event, prompt: string, explicitOwner?: string) => {
    return modelRouter.resolve(prompt, explicitOwner as ModelOwner | undefined);
  });

  ipcMain.handle(IPC_CHANNELS.MODEL_HANDOFF, (_event, taskId: string, from: string, to: string) => {
    return modelRouter.handoff(taskId, from as ProviderId, to as ProviderId);
  });
```

- [ ] **Step 3: Wire model events in `src/main/events/eventRouter.ts`**

Add to `initEventRouter()`:
```typescript
  // ── Model events ──────────────────────────────────────────────────

  eventBus.on(AppEventType.MODEL_PROVIDER_DETECTED, (event) => {
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level: event.payload.available ? 'info' : 'warn',
        source: 'system',
        message: `Provider ${event.payload.providerId}: ${event.payload.available ? 'available' : 'unavailable'} (${event.payload.detail})`,
      },
    });
  });

  eventBus.on(AppEventType.MODEL_INVOCATION_PROGRESS, (event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.webContents) {
        win.webContents.send('model:progress', event.payload.progress);
      }
    }
  });
```

- [ ] **Step 4: Expose model API in `src/preload/preload.ts`**

Add `model` namespace to the `api` object:
```typescript
  model: {
    invoke(taskId: string, prompt: string, owner?: string, options?: { systemPrompt?: string; cwd?: string }) {
      return ipcRenderer.invoke(IPC_CHANNELS.MODEL_INVOKE, taskId, prompt, owner, options);
    },
    cancel(taskId: string) {
      return ipcRenderer.invoke(IPC_CHANNELS.MODEL_CANCEL, taskId);
    },
    getProviders() {
      return ipcRenderer.invoke(IPC_CHANNELS.MODEL_GET_PROVIDERS);
    },
    resolve(prompt: string, explicitOwner?: string) {
      return ipcRenderer.invoke(IPC_CHANNELS.MODEL_RESOLVE, prompt, explicitOwner);
    },
    handoff(taskId: string, from: string, to: string) {
      return ipcRenderer.invoke(IPC_CHANNELS.MODEL_HANDOFF, taskId, from, to);
    },
  },
```

Add `'model:progress'` to `removeAllListeners()`.

- [ ] **Step 5: Add model types to `src/renderer/global.d.ts`**

Add to `WorkspaceAPI`:
```typescript
  model: {
    invoke(taskId: string, prompt: string, owner?: string, options?: { systemPrompt?: string; cwd?: string }): Promise<any>;
    cancel(taskId: string): Promise<boolean>;
    getProviders(): Promise<Record<string, { id: string; status: string; activeTaskId: string | null; lastActivityAt: number | null; errorDetail: string | null }>>;
    resolve(prompt: string, explicitOwner?: string): Promise<string>;
    handoff(taskId: string, from: string, to: string): Promise<any>;
  };
```

---

### Task 8: Main Process Initialization

**Files:**
- Modify: `src/main/main.ts`

- [ ] **Step 1: Create and export the singleton `modelRouter`**

Create `src/main/models/index.ts`:
```typescript
// src/main/models/index.ts

import { ModelRouter } from './ModelRouter';
import { CodexGate } from './codexGate';
import { HaikuGate } from './haikuGate';
import { CODEX_DEFINITION, HAIKU_DEFINITION, DEFAULT_ROUTING_RULES } from './providerRegistry';

export const modelRouter = new ModelRouter();

export function initModelLayer(): void {
  const codexGate = new CodexGate(CODEX_DEFINITION);
  const haikuGate = new HaikuGate(HAIKU_DEFINITION);

  modelRouter.registerGate(codexGate);
  modelRouter.registerGate(haikuGate);
  modelRouter.setRules(DEFAULT_ROUTING_RULES);
  modelRouter.detectAll();
}

export function disposeModelLayer(): void {
  modelRouter.dispose();
}
```

- [ ] **Step 2: Wire into `src/main/main.ts`**

Add import:
```typescript
import { initModelLayer, disposeModelLayer } from './models/index';
```

In `app.on('ready')`, add after `terminalService.init()`:
```typescript
  initModelLayer();
```

In `app.on('before-quit')`, add before `appStateStore.persistNow()`:
```typescript
  disposeModelLayer();
```

- [ ] **Step 3: Update `registerIpc.ts` import**

Add:
```typescript
import { modelRouter } from '../models/index';
```

---

### Task 9: Command Center UI (Minimal)

**Files:**
- Modify: `src/renderer/command/command.ts`
- Modify: `src/renderer/command/command.css`

- [ ] **Step 1: Add provider status display to Command Center**

In `command.ts`, add after the existing surface state rendering:

```typescript
// ─── Provider State Rendering ──────────────────────────────────────────

function renderProviderStates(state: any): void {
  const providers = state.providers;
  if (!providers) return;

  const codex = providers.codex;
  const haiku = providers.haiku;

  const codexEl = document.getElementById('codexProviderStatus');
  const haikuEl = document.getElementById('haikuProviderStatus');
  if (!codexEl || !haikuEl) return;

  codexEl.textContent = codex?.status || 'unknown';
  codexEl.className = `provider-status ${codex?.status || 'unavailable'}`;
  haikuEl.textContent = haiku?.status || 'unknown';
  haikuEl.className = `provider-status ${haiku?.status || 'unavailable'}`;
}
```

Call `renderProviderStates(state)` from the existing `renderState()` function.

- [ ] **Step 2: Add provider status HTML to `src/renderer/command/index.html`**

Add a small status section (exact placement depends on existing layout):

```html
<div class="provider-bar">
  <span class="provider-label">codex</span>
  <span id="codexProviderStatus" class="provider-status unavailable">unavailable</span>
  <span class="provider-label">haiku</span>
  <span id="haikuProviderStatus" class="provider-status unavailable">unavailable</span>
</div>
```

- [ ] **Step 3: Add provider status CSS to `src/renderer/command/command.css`**

```css
.provider-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 4px 8px;
  font-size: 11px;
  border-bottom: 1px solid var(--border);
}
.provider-label {
  color: var(--text-secondary);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.provider-status {
  padding: 1px 6px;
  border-radius: 3px;
  font-family: var(--font-mono);
}
.provider-status.available { color: #4ade80; }
.provider-status.unavailable { color: #6b7280; }
.provider-status.busy { color: #facc15; }
.provider-status.error { color: #f87171; }
```

- [ ] **Step 4: Add task owner badge in task rendering**

Modify the `renderTasks` function in `command.ts` to show owner:

In the task item HTML template, add after the status span:
```typescript
const ownerBadge = t.owner && t.owner !== 'user'
  ? `<span class="task-owner-badge ${t.owner}">${t.owner}</span>`
  : '';
```

Insert `${ownerBadge}` between the status and title spans.

Add CSS:
```css
.task-owner-badge {
  font-size: 9px;
  padding: 0 4px;
  border-radius: 2px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.task-owner-badge.codex { background: #1e3a5f; color: #60a5fa; }
.task-owner-badge.haiku { background: #3b1f2b; color: #f0abfc; }
```

---

### Task 10: Fix Existing Task Creation

**Files:**
- Modify: `src/main/ipc/registerIpc.ts`

- [ ] **Step 1: Update task creation to include `owner: 'user'` default**

In the `CREATE_TASK` handler, add `owner: 'user'`:
```typescript
  ipcMain.handle(IPC_CHANNELS.CREATE_TASK, (_event, title: string) => {
    const task: TaskRecord = {
      id: generateId('task'),
      title,
      status: 'queued',
      owner: 'user',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    eventBus.emit(AppEventType.TASK_CREATED, { task });
  });
```

---

## Implementation Sequence

```
Task 1 (types)         ← zero risk, all other tasks depend on this
  ↓
Task 2 (registry)      ← pure data, no dependencies
  ↓
Task 3 (context mgr)   ← depends on types only
  ↓
Task 4 (codex gate)    ← depends on types + events
Task 5 (haiku gate)    ← depends on types + events (parallel with Task 4)
  ↓
Task 6 (router)        ← depends on gates + context manager
  ↓
Task 7 (IPC wiring)    ← depends on router
Task 8 (main init)     ← depends on router (parallel with Task 7)
  ↓
Task 9 (UI)            ← depends on IPC wiring
Task 10 (fix tasks)    ← depends on types only (can run anytime after Task 1)
```

Tasks 4 and 5 can be implemented in parallel. Tasks 7 and 8 can be implemented in parallel.
