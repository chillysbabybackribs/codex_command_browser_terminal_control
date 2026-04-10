# Dual-Model Router Design: Codex CLI + Claude Haiku 4.5

**Date:** 2026-04-10
**Input:** Audit of `yasasbanukaofficial/claude-code` (1884 source files) cross-referenced against v1workspace codebase
**Goal:** Optimal dual-model implementation with future provider extensibility, informed by Claude Code's production patterns

---

## 1. What the Claude Code Repo Teaches Us

The claude-code repo is the full source of Anthropic's CLI tool. It is a **1884-file monolith built on Bun**, not Electron. Its patterns are instructive but not directly portable. Here's what matters:

### Patterns to Adopt

| Pattern | Where in claude-code | What to take |
|---|---|---|
| **Model config registry** | `src/utils/model/configs.ts` | `ModelConfig = Record<APIProvider, ModelName>` — each model has per-provider ID strings (firstParty, bedrock, vertex, foundry). We need the same: a single registry mapping canonical names to provider-specific IDs. |
| **Model aliases** | `src/utils/model/aliases.ts` | `'sonnet' | 'opus' | 'haiku' | 'best'` — user-facing shortcuts resolved to concrete model IDs. Simple, extensible. |
| **Provider detection** | `src/utils/model/providers.ts` | `APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry'` — determined from env vars. Clean pattern for determining which backend to use. |
| **QueryDeps injection** | `src/query/deps.ts` | `QueryDeps = { callModel, microcompact, autocompact, uuid }` — dependency injection for the query loop. Makes testing trivial. Adopt this for both Codex and Haiku invocation. |
| **Streaming tool executor** | `src/services/tools/StreamingToolExecutor.ts` | Concurrent-safe vs exclusive tools, queued execution with ordered result emission. Our `SurfaceExecutionController` already does this — validates the approach. |
| **Auto-compact / context management** | `src/services/compact/autoCompact.ts` | Context window monitoring, automatic summarization when approaching limits. Critical for our handoff design — Haiku should auto-summarize before hitting context limits. |
| **Agent summary** | `src/services/AgentSummary/agentSummary.ts` | Periodic 30s background summarization of sub-agent work via forked agent. We can use the same pattern: Haiku periodically summarizes Codex progress for UI display. |
| **Task type system** | `src/Task.ts` | `TaskType = 'local_bash' | 'local_agent' | 'remote_agent' | ...` with typed state per task type. We need equivalent: `'codex' | 'haiku' | 'user'`. |

### Patterns to NOT Adopt

| Pattern | Why not |
|---|---|
| Bun-specific `feature()` gates | We're on Electron/Node, not Bun. Use simple env vars or config. |
| Claude.ai OAuth / subscriber tier logic | We're calling APIs directly, not proxying through Claude.ai. |
| 600-line `claude.ts` API wrapper | Over-engineered for our needs. We need a thin wrapper, not the full production Claude Code client. |
| React/Ink rendering | Our renderer is vanilla HTML/CSS/JS. |
| MCP server infrastructure | Not needed for v1 — we have direct terminal/browser control. |
| Module-level memoized singletons everywhere | Claude Code is a CLI process — singletons make sense. We're a long-running Electron app — services with explicit lifecycle are better (which we already have). |

---

## 2. Optimal Dual-Model Router Architecture

### Core Insight

Claude Code's architecture is **single-model with the model being the agent loop driver** — the model decides what to do, calls tools, gets results, loops. Our architecture is fundamentally different: **the app is the control plane, and models are execution backends**. This is the correct inversion for a workspace app.

The optimal design borrows Claude Code's model registry and context management, but keeps our app-centric control flow.

### Architecture Overview

```
                        ┌──────────────────────┐
                        │   Command Center UI   │
                        │   (renderer/command)  │
                        └──────────┬───────────┘
                                   │ IPC
                        ┌──────────▼───────────┐
                        │    ModelRouter        │
                        │  (owner assignment,   │
                        │   dispatch, handoff)  │
                        ├───────────┬──────────┤
                        │           │          │
               ┌────────▼──┐  ┌────▼─────┐   (future)
               │ CodexGate  │  │ HaikuGate │   │
               │ (CLI proc) │  │ (API)     │  ┌▼────────┐
               └────────┬──┘  └────┬─────┘  │ Provider │
                        │          │         │ N+1...   │
               ┌────────▼──┐  ┌────▼─────┐  └──────────┘
               │ CodexProc  │  │ Anthropic │
               │ child_proc │  │ SDK      │
               └────────────┘  └──────────┘
                        │          │
                        └────┬─────┘
                     ┌───────▼────────┐
                     │ ContextManager  │
                     │ (handoff pkts,  │
                     │  summaries,     │
                     │  artifacts)     │
                     └────────────────┘
```

### Key Design: The Provider Gate Pattern

Borrowed from Claude Code's `APIProvider` + `QueryDeps` pattern, adapted for our dual-model needs:

```typescript
// src/shared/types/model.ts

// ─── Provider Registry (extensible) ───────────────────────────────────

export type ProviderId = 'codex' | 'haiku';
// Future: | 'sonnet' | 'opus' | 'gemini' | 'local-llama' ...

export type ProviderKind = 'cli-process' | 'api-streaming' | 'api-batch';
// Future: | 'local-inference' | 'mcp-bridge' ...

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

export type ProviderStatus = 'available' | 'unavailable' | 'busy' | 'error';

// ─── Provider Definition (what a provider CAN do) ─────────────────────

export type ProviderDefinition = {
  id: ProviderId;
  displayName: string;
  kind: ProviderKind;
  capabilities: ProviderCapability[];
  // Static config — does not change at runtime
  config: ProviderConfig;
};

export type ProviderConfig =
  | CodexProviderConfig
  | HaikuProviderConfig;

export type CodexProviderConfig = {
  type: 'codex';
  binaryName: string;        // 'codex' — resolved via PATH
  defaultArgs: string[];     // e.g., ['--quiet', '--approval-mode', 'full-auto']
  timeoutMs: number;         // per-invocation timeout
  maxConcurrent: number;     // 1 for v1
};

export type HaikuProviderConfig = {
  type: 'haiku';
  modelId: string;           // 'claude-haiku-4-5-20251001'
  maxTokens: number;         // 4096 default
  streamingEnabled: boolean;
};

// ─── Provider Runtime (what a provider IS doing) ──────────────────────

export type ProviderRuntime = {
  id: ProviderId;
  status: ProviderStatus;
  activeTaskId: string | null;
  lastActivityAt: number | null;
  errorDetail: string | null;
};

// ─── Model Owner (task assignment) ─────────────────────────────────────

export type ModelOwner = ProviderId | 'user';

// ─── Routing (how tasks get assigned) ──────────────────────────────────

export type RoutingRule = {
  match: RoutingMatch;
  assignTo: ProviderId;
  priority: number;
};

export type RoutingMatch =
  | { type: 'capability'; capability: ProviderCapability }
  | { type: 'explicit'; owner: ProviderId }
  | { type: 'default' };
```

### Why This Design is Optimal for Future Providers

1. **`ProviderId` is a union, not an enum** — adding a new provider means adding a string to the union and a new `ProviderConfig` variant. No switch statements to update.

2. **`ProviderKind` separates invocation mechanics from capabilities** — Codex is `cli-process`, Haiku is `api-streaming`. A future local LLM would be `local-inference`. The router doesn't care about the kind — it routes based on capabilities.

3. **`ProviderCapability` is the routing key** — "this task needs code-generation" → route to a provider that has `code-generation`. If you add GPT-4 later, you just register its capabilities.

4. **`ProviderDefinition` is static, `ProviderRuntime` is dynamic** — definition is configured at startup, runtime changes per-request. This prevents coupling between config and state.

5. **Each provider gets its own "Gate" service** — `CodexGate` wraps child_process, `HaikuGate` wraps the Anthropic SDK. A future provider gets its own gate. The gates share a common interface but have provider-specific internals.

---

## 3. The Provider Gate Interface

The core abstraction that makes this extensible:

```typescript
// src/main/models/providerGate.ts

import { EventBus } from '../events/eventBus';

export type InvocationRequest = {
  taskId: string;
  prompt: string;               // The instruction/query
  context: HandoffPacket | null; // Prior context from another provider
  systemPrompt?: string;
  cwd?: string;                 // Working directory (for CLI providers)
  abortSignal: AbortSignal;
};

export type InvocationResult = {
  taskId: string;
  providerId: ProviderId;
  success: boolean;
  output: string;               // Primary output text
  artifacts: HandoffArtifact[]; // Structured outputs (files modified, etc.)
  error?: string;
  usage?: { inputTokens: number; outputTokens: number; durationMs: number };
};

export type InvocationProgress = {
  taskId: string;
  providerId: ProviderId;
  type: 'stdout' | 'stderr' | 'token' | 'status';
  data: string;
  timestamp: number;
};

// ─── The Gate Interface ───────────────────────────────────────────────

export interface ProviderGate {
  readonly id: ProviderId;
  readonly definition: ProviderDefinition;

  // Lifecycle
  detect(): Promise<boolean>;          // Is this provider available?
  getStatus(): ProviderRuntime;

  // Execution
  invoke(request: InvocationRequest): Promise<InvocationResult>;

  // Progress (for streaming/long-running)
  onProgress(callback: (progress: InvocationProgress) => void): () => void;

  // Cleanup
  cancel(taskId: string): void;
  dispose(): void;
}
```

### CodexGate Implementation Sketch

```typescript
// src/main/models/codexGate.ts

import { spawn, ChildProcess } from 'child_process';
import { execFileSync } from 'child_process';

export class CodexGate implements ProviderGate {
  readonly id = 'codex' as const;
  private processes = new Map<string, ChildProcess>();
  private progressListeners = new Set<(p: InvocationProgress) => void>();
  private binaryPath: string | null = null;
  private status: ProviderRuntime;

  constructor(readonly definition: ProviderDefinition) {
    this.status = {
      id: 'codex',
      status: 'unavailable',
      activeTaskId: null,
      lastActivityAt: null,
      errorDetail: null,
    };
  }

  async detect(): Promise<boolean> {
    try {
      const result = execFileSync('which', ['codex'], {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
      if (result) {
        this.binaryPath = result;
        this.status.status = 'available';
        return true;
      }
    } catch {}
    this.status.status = 'unavailable';
    this.status.errorDetail = 'codex CLI not found in PATH';
    return false;
  }

  async invoke(request: InvocationRequest): Promise<InvocationResult> {
    if (!this.binaryPath) throw new Error('Codex CLI not available');

    const config = this.definition.config as CodexProviderConfig;
    const args = [...config.defaultArgs, request.prompt];

    return new Promise((resolve, reject) => {
      const proc = spawn(this.binaryPath!, args, {
        cwd: request.cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      this.processes.set(request.taskId, proc);
      this.status.status = 'busy';
      this.status.activeTaskId = request.taskId;
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (chunk: Buffer) => {
        const data = chunk.toString();
        stdout += data;
        this.emitProgress({
          taskId: request.taskId,
          providerId: 'codex',
          type: 'stdout',
          data,
          timestamp: Date.now(),
        });
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        const data = chunk.toString();
        stderr += data;
        this.emitProgress({
          taskId: request.taskId,
          providerId: 'codex',
          type: 'stderr',
          data,
          timestamp: Date.now(),
        });
      });

      // Timeout
      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 5000);
      }, config.timeoutMs);

      // Abort signal
      request.abortSignal.addEventListener('abort', () => {
        proc.kill('SIGTERM');
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        this.processes.delete(request.taskId);
        this.status.status = 'available';
        this.status.activeTaskId = null;
        this.status.lastActivityAt = Date.now();

        resolve({
          taskId: request.taskId,
          providerId: 'codex',
          success: code === 0,
          output: stdout,
          artifacts: [], // Parse from Codex output in v2
          error: code !== 0 ? `Exit code ${code}: ${stderr}` : undefined,
          usage: { inputTokens: 0, outputTokens: 0, durationMs: Date.now() - startTime },
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.processes.delete(request.taskId);
        this.status.status = 'error';
        this.status.errorDetail = err.message;
        reject(err);
      });
    });
  }

  // ... cancel, dispose, onProgress, emitProgress
}
```

### HaikuGate Implementation Sketch

```typescript
// src/main/models/haikuGate.ts

import Anthropic from '@anthropic-ai/sdk';

export class HaikuGate implements ProviderGate {
  readonly id = 'haiku' as const;
  private client: Anthropic | null = null;
  private activeAborts = new Map<string, AbortController>();
  private progressListeners = new Set<(p: InvocationProgress) => void>();
  private status: ProviderRuntime;

  constructor(readonly definition: ProviderDefinition) {
    this.status = {
      id: 'haiku',
      status: 'unavailable',
      activeTaskId: null,
      lastActivityAt: null,
      errorDetail: null,
    };
  }

  async detect(): Promise<boolean> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.status.status = 'unavailable';
      this.status.errorDetail = 'ANTHROPIC_API_KEY not set';
      return false;
    }
    this.client = new Anthropic({ apiKey });
    this.status.status = 'available';
    return true;
  }

  async invoke(request: InvocationRequest): Promise<InvocationResult> {
    if (!this.client) throw new Error('Haiku client not initialized');

    const config = this.definition.config as HaikuProviderConfig;
    const abort = new AbortController();
    this.activeAborts.set(request.taskId, abort);
    this.status.status = 'busy';
    this.status.activeTaskId = request.taskId;
    const startTime = Date.now();

    // Link external abort signal
    request.abortSignal.addEventListener('abort', () => abort.abort());

    try {
      const messages: Anthropic.MessageParam[] = [];

      // Inject handoff context if present
      if (request.context) {
        messages.push({
          role: 'user',
          content: `Context from previous work:\n${request.context.summary}\n\nArtifacts:\n${request.context.artifacts.map(a => `- ${a.label}: ${a.content}`).join('\n')}`,
        });
        messages.push({
          role: 'assistant',
          content: 'Understood. I have the context from the previous work phase.',
        });
      }

      messages.push({ role: 'user', content: request.prompt });

      if (config.streamingEnabled) {
        let fullText = '';
        const stream = this.client.messages.stream({
          model: config.modelId,
          max_tokens: config.maxTokens,
          messages,
          system: request.systemPrompt,
        }, { signal: abort.signal });

        stream.on('text', (text) => {
          fullText += text;
          this.emitProgress({
            taskId: request.taskId,
            providerId: 'haiku',
            type: 'token',
            data: text,
            timestamp: Date.now(),
          });
        });

        const message = await stream.finalMessage();

        this.status.status = 'available';
        this.status.activeTaskId = null;
        this.status.lastActivityAt = Date.now();

        return {
          taskId: request.taskId,
          providerId: 'haiku',
          success: true,
          output: fullText,
          artifacts: [],
          usage: {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            durationMs: Date.now() - startTime,
          },
        };
      } else {
        // Non-streaming fallback
        const message = await this.client.messages.create({
          model: config.modelId,
          max_tokens: config.maxTokens,
          messages,
          system: request.systemPrompt,
        }, { signal: abort.signal });

        const text = message.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('');

        this.status.status = 'available';
        this.status.activeTaskId = null;
        this.status.lastActivityAt = Date.now();

        return {
          taskId: request.taskId,
          providerId: 'haiku',
          success: true,
          output: text,
          artifacts: [],
          usage: {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            durationMs: Date.now() - startTime,
          },
        };
      }
    } catch (err: unknown) {
      this.status.status = 'error';
      this.status.errorDetail = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      this.activeAborts.delete(request.taskId);
    }
  }

  // ... cancel, dispose, onProgress, emitProgress
}
```

---

## 4. The ModelRouter

Inspired by Claude Code's `getMainLoopModel()` resolution chain but adapted for task-based routing:

```typescript
// src/main/models/ModelRouter.ts

export class ModelRouter {
  private gates = new Map<ProviderId, ProviderGate>();
  private rules: RoutingRule[] = [];

  register(gate: ProviderGate): void {
    this.gates.set(gate.id, gate);
  }

  addRule(rule: RoutingRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  // ─── Routing ────────────────────────────────────────────────────────

  resolve(task: ModelTask): ProviderId {
    // 1. Explicit owner (user said "use codex for this")
    if (task.owner && task.owner !== 'user') {
      return task.owner;
    }

    // 2. Match by routing rules
    for (const rule of this.rules) {
      switch (rule.match.type) {
        case 'explicit':
          if (task.owner === rule.match.owner) return rule.assignTo;
          break;
        case 'capability': {
          const gate = this.gates.get(rule.assignTo);
          if (gate && gate.definition.capabilities.includes(rule.match.capability)) {
            if (this.taskNeedsCapability(task, rule.match.capability)) {
              return rule.assignTo;
            }
          }
          break;
        }
        case 'default':
          return rule.assignTo;
      }
    }

    // 3. Default to haiku
    return 'haiku';
  }

  // ─── Dispatch ───────────────────────────────────────────────────────

  async dispatch(task: ModelTask, context: HandoffPacket | null): Promise<InvocationResult> {
    const providerId = this.resolve(task);
    const gate = this.gates.get(providerId);
    if (!gate) throw new Error(`Provider ${providerId} not registered`);
    if (gate.getStatus().status === 'unavailable') {
      throw new Error(`Provider ${providerId} is unavailable: ${gate.getStatus().errorDetail}`);
    }

    return gate.invoke({
      taskId: task.id,
      prompt: task.prompt,
      context,
      systemPrompt: task.systemPrompt,
      cwd: task.cwd,
      abortSignal: task.abortController.signal,
    });
  }

  // ─── Handoff ────────────────────────────────────────────────────────

  async handoff(
    taskId: string,
    from: ProviderId,
    to: ProviderId,
    contextManager: ContextManager,
  ): Promise<HandoffPacket> {
    return contextManager.buildHandoffPacket(taskId, from, to);
  }

  // ─── Introspection ──────────────────────────────────────────────────

  getProviderStatus(): Map<ProviderId, ProviderRuntime> {
    const statuses = new Map<ProviderId, ProviderRuntime>();
    for (const [id, gate] of this.gates) {
      statuses.set(id, gate.getStatus());
    }
    return statuses;
  }

  private taskNeedsCapability(task: ModelTask, cap: ProviderCapability): boolean {
    // v1: simple keyword matching on task prompt
    // Future: Haiku-powered intent classification
    const prompt = task.prompt.toLowerCase();
    switch (cap) {
      case 'code-generation':
      case 'code-editing':
        return /\b(write|create|implement|add|fix|refactor|edit|modify|update)\b.*\b(code|function|class|file|component|test)\b/.test(prompt);
      case 'shell-execution':
        return /\b(run|execute|install|build|deploy|npm|git|make)\b/.test(prompt);
      case 'summarization':
        return /\b(summarize|summary|explain|describe|what happened)\b/.test(prompt);
      default:
        return false;
    }
  }
}
```

### Default Routing Rules (v1)

```typescript
const DEFAULT_RULES: RoutingRule[] = [
  // Codex handles coding tasks
  { match: { type: 'capability', capability: 'code-generation' }, assignTo: 'codex', priority: 100 },
  { match: { type: 'capability', capability: 'code-editing' }, assignTo: 'codex', priority: 100 },
  { match: { type: 'capability', capability: 'shell-execution' }, assignTo: 'codex', priority: 90 },
  { match: { type: 'capability', capability: 'repo-analysis' }, assignTo: 'codex', priority: 80 },

  // Haiku handles everything else
  { match: { type: 'capability', capability: 'chat' }, assignTo: 'haiku', priority: 50 },
  { match: { type: 'capability', capability: 'summarization' }, assignTo: 'haiku', priority: 50 },
  { match: { type: 'capability', capability: 'intent-parsing' }, assignTo: 'haiku', priority: 50 },
  { match: { type: 'capability', capability: 'planning' }, assignTo: 'haiku', priority: 50 },
  { match: { type: 'capability', capability: 'synthesis' }, assignTo: 'haiku', priority: 50 },

  // Default fallback
  { match: { type: 'default' }, assignTo: 'haiku', priority: 0 },
];
```

---

## 5. Context Manager (Handoff Design)

Inspired by Claude Code's `compact.ts` auto-compaction and `agentSummary.ts` periodic summarization:

```typescript
// src/main/models/contextManager.ts

export type HandoffPacket = {
  id: string;
  taskId: string;
  fromProvider: ProviderId;
  toProvider: ProviderId;
  summary: string;
  artifacts: HandoffArtifact[];
  recentDecisions: string[];
  tokenEstimate: number;       // Estimated tokens when injected as context
  createdAt: number;
};

export type HandoffArtifact = {
  type: 'file' | 'command_output' | 'url' | 'code_snippet' | 'error';
  label: string;
  content: string;              // Truncated to MAX_ARTIFACT_CONTENT_BYTES
  path?: string;
};

const MAX_ARTIFACTS = 10;
const MAX_ARTIFACT_CONTENT_BYTES = 4096;
const MAX_SUMMARY_BYTES = 2048;

export class ContextManager {
  private packets = new Map<string, HandoffPacket[]>();  // taskId → history
  private invocationOutputs = new Map<string, string>(); // taskId → last output

  recordOutput(taskId: string, output: string): void {
    // Keep only last output per task (not accumulating)
    this.invocationOutputs.set(taskId, output);
  }

  async buildHandoffPacket(
    taskId: string,
    from: ProviderId,
    to: ProviderId,
  ): Promise<HandoffPacket> {
    const output = this.invocationOutputs.get(taskId) || '';

    // If handing off TO haiku, Haiku will summarize itself from the output
    // If handing off FROM haiku TO codex, use the output directly (it's already concise)
    const summary = output.length > MAX_SUMMARY_BYTES
      ? output.slice(0, MAX_SUMMARY_BYTES) + '... [truncated]'
      : output;

    const packet: HandoffPacket = {
      id: generateId('hp'),
      taskId,
      fromProvider: from,
      toProvider: to,
      summary,
      artifacts: [],
      recentDecisions: [],
      tokenEstimate: Math.ceil(summary.length / 4), // rough chars-to-tokens
      createdAt: Date.now(),
    };

    // Store for history
    if (!this.packets.has(taskId)) this.packets.set(taskId, []);
    this.packets.get(taskId)!.push(packet);

    return packet;
  }

  getHistory(taskId: string): HandoffPacket[] {
    return this.packets.get(taskId) || [];
  }

  clear(taskId: string): void {
    this.packets.delete(taskId);
    this.invocationOutputs.delete(taskId);
  }
}
```

---

## 6. Integration Into v1workspace

### New Files

```
src/
  shared/
    types/
      model.ts              # ProviderId, ProviderDefinition, ProviderCapability, etc.
  main/
    models/
      providerGate.ts       # ProviderGate interface, InvocationRequest/Result/Progress
      codexGate.ts          # CodexGate implementation
      haikuGate.ts          # HaikuGate implementation
      ModelRouter.ts        # Routing, dispatch, handoff orchestration
      contextManager.ts     # HandoffPacket, artifact tracking
      providerRegistry.ts   # Static provider definitions + default routing rules
```

### Modified Files

| File | Change |
|---|---|
| `src/shared/types/appState.ts` | Add `providers: Record<ProviderId, ProviderRuntime>` to `AppState`; extend `TaskRecord` with `owner: ModelOwner` |
| `src/shared/types/events.ts` | Add `MODEL_INVOCATION_STARTED`, `MODEL_PROGRESS`, `MODEL_INVOCATION_COMPLETED`, `MODEL_HANDOFF` events |
| `src/shared/types/windowRoles.ts` | Add `'codex' | 'haiku'` to `LogSourceRole` |
| `src/main/state/actions.ts` | Add `SET_PROVIDER_STATUS`, `SET_TASK_OWNER` action types |
| `src/main/state/reducer.ts` | Handle new action types |
| `src/main/events/eventRouter.ts` | Wire model events |
| `src/main/ipc/registerIpc.ts` | Add `model:invoke`, `model:cancel`, `model:status`, `model:handoff` handlers |
| `src/preload/preload.ts` | Expose `model` namespace |
| `src/renderer/global.d.ts` | Add model API types |
| `src/main/main.ts` | Initialize ModelRouter, CodexGate, HaikuGate at startup |
| `package.json` | Add `@anthropic-ai/sdk` |

### Untouched

- `SurfaceActionRouter` — stays sole surface authority
- `BrowserService` — unrelated
- `SurfaceExecutionController` — surface execution only
- `renderer/execution/` — no changes for v1

---

## 7. How Adding a Future Provider Works

Say you want to add Sonnet 4.6 as a third provider:

1. Add `'sonnet'` to the `ProviderId` union in `model.ts`
2. Add `SonnetProviderConfig` to the `ProviderConfig` union
3. Create `src/main/models/sonnetGate.ts` implementing `ProviderGate`
4. Register it in `providerRegistry.ts` with capabilities
5. Add routing rules (e.g., `{ capability: 'planning', assignTo: 'sonnet', priority: 70 }`)
6. Done. No changes to `ModelRouter`, `ContextManager`, or any existing gate.

For a local LLM (llama.cpp, ollama):
1. Add `'local'` to `ProviderId`, `'local-inference'` to `ProviderKind`
2. Create `localGate.ts` that talks to localhost:11434 or wherever
3. Register with capabilities
4. Routing rules handle the rest

---

## 8. Implementation Order

### Phase 1: Type Foundation
- Create `src/shared/types/model.ts` with all type definitions
- Extend `AppState` with `providers` field
- Extend `TaskRecord` with `owner`
- Update reducer and events

### Phase 2: Provider Gate Infrastructure
- Create `providerGate.ts` interface
- Create `providerRegistry.ts` with static definitions
- Create `contextManager.ts`

### Phase 3: CodexGate
- Implement detection, invocation, cancellation
- Wire to EventBus
- Test with mock CLI

### Phase 4: HaikuGate
- Add `@anthropic-ai/sdk`
- Implement API calling, streaming, error handling
- Wire to EventBus
- Test with mock SDK

### Phase 5: ModelRouter
- Implement routing rules
- Implement dispatch
- Implement handoff
- Wire IPC handlers
- Integration test: Codex → Haiku handoff

### Phase 6: Minimal UI
- Provider status badges
- Log source colors for codex/haiku
- Task owner indicator

---

## 9. Key Decisions Made

| Decision | Rationale |
|---|---|
| **ProviderGate is an interface, not a base class** | Providers have fundamentally different internals (CLI process vs HTTP API). Inheritance would force shared structure where none exists. |
| **Capabilities are the routing key, not task content analysis** | v1 uses simple keyword matching. Future can plug in Haiku-powered classification without changing the routing interface. |
| **Context manager stores handoff packets, not conversation history** | Conversation history is provider-internal. The app only manages the structured handoff between providers. |
| **ModelRouter is separate from SurfaceActionRouter** | Model execution and surface execution are orthogonal. Models don't submit surface actions (v1). Surface actions don't involve models. |
| **ProviderId is a string union, not a numeric enum** | Readable, grep-able, serializable, extensible without breaking existing values. |
| **One gate instance per provider, not per invocation** | Gates manage their own concurrency. CodexGate serializes internally (one process at a time). HaikuGate could support concurrent requests. |
| **Streaming is provider-internal, exposed via progress callbacks** | The router doesn't need to know about streaming. It dispatches and waits for a result. Progress is optional for UI. |
