// ═══════════════════════════════════════════════════════════════════════════
// Codex Gate — CLI process management with JSONL event parsing
// ═══════════════════════════════════════════════════════════════════════════

import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { getCoreToolDefinitions, searchToolDefinitions, summarizeToolInput, type ToolDefinition } from './tools/toolDefinitions';
import {
  executeHostToolCalls,
  serializeHostToolResults,
  summarizeHostToolResultForLog,
  type HostToolCall,
} from './tools/hostToolRuntime';
import { buildAgentSystemPrompt } from './agentProtocol';
import { ProviderGate, type ProgressListener } from './providerGate';
import type {
  ProviderId, ProviderDefinition, ProviderRuntime,
  InvocationRequest, InvocationResult,
  CodexEvent, CodexItem, CodexUsage,
  CodexInvocationConfig, CodexStatusMetrics,
} from '../../shared/types/model';
import { DEFAULT_CODEX_CONFIG } from '../../shared/types/model';

type CodexProtocolResponse =
  | { type: 'tool_calls'; calls: HostToolCall[] }
  | { type: 'final'; message: string };

const MAX_CODEX_TOOL_ITERATIONS = 24;

export class CodexGate extends ProviderGate {
  readonly id: ProviderId = 'codex';
  private binaryPath: string | null = null;
  private activeProcess: { taskId: string; proc: ChildProcess; timer: ReturnType<typeof setTimeout> } | null = null;
  private statusPollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly definition: ProviderDefinition,
    private config: CodexInvocationConfig = { ...DEFAULT_CODEX_CONFIG },
  ) {
    super('codex');
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
        this.startStatusPolling();
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

  // ─── Status Polling ────────────────────────────────────────────────

  startStatusPolling(intervalMs = 30_000): void {
    this.stopStatusPolling();
    this.fetchAndApplyStatus();
    this.statusPollTimer = setInterval(() => this.fetchAndApplyStatus(), intervalMs);
  }

  stopStatusPolling(): void {
    if (this.statusPollTimer) {
      clearInterval(this.statusPollTimer);
      this.statusPollTimer = null;
    }
  }

  private fetchAndApplyStatus(): void {
    try {
      const codexDir = join(homedir(), '.codex');
      const metrics: CodexStatusMetrics = {};

      // Read config.toml for model info
      try {
        const configRaw = readFileSync(join(codexDir, 'config.toml'), 'utf-8');
        const modelMatch = configRaw.match(/^model\s*=\s*"([^"]+)"/m);
        if (modelMatch) this.status.model = modelMatch[1];
        const effortMatch = configRaw.match(/^model_reasoning_effort\s*=\s*"([^"]+)"/m);
        if (effortMatch && this.status.model) {
          this.status.model = `${this.status.model} (${effortMatch[1]})`;
        }
      } catch {}

      // Read auth.json for account/session info
      try {
        const authRaw = readFileSync(join(codexDir, 'auth.json'), 'utf-8');
        const auth = JSON.parse(authRaw);
        if (auth.tokens?.account_id) {
          this.status.sessionId = auth.tokens.account_id.slice(0, 12);
        }
      } catch {}

      // Query usage data from Codex state SQLite database
      const dbPath = join(codexDir, 'state_5.sqlite');
      if (existsSync(dbPath)) {
        try {
          const now = Math.floor(Date.now() / 1000);
          const fiveHoursAgo = now - 18000;
          const oneWeekAgo = now - 604800;

          // 5h usage
          const raw5h = execFileSync('sqlite3', [dbPath,
            `SELECT COALESCE(SUM(tokens_used),0), COUNT(*) FROM threads WHERE updated_at > ${fiveHoursAgo} AND archived = 0;`,
          ], { encoding: 'utf-8', timeout: 5000 }).trim();
          const [tokens5h, threads5h] = raw5h.split('|').map(Number);

          // Weekly usage
          const rawWeek = execFileSync('sqlite3', [dbPath,
            `SELECT COALESCE(SUM(tokens_used),0), COUNT(*) FROM threads WHERE updated_at > ${oneWeekAgo} AND archived = 0;`,
          ], { encoding: 'utf-8', timeout: 5000 }).trim();
          const [tokensWeek, threadsWeek] = rawWeek.split('|').map(Number);

          // All-time
          const rawAll = execFileSync('sqlite3', [dbPath,
            `SELECT COALESCE(SUM(tokens_used),0), COUNT(*) FROM threads WHERE archived = 0;`,
          ], { encoding: 'utf-8', timeout: 5000 }).trim();
          const [tokensAll, threadsAll] = rawAll.split('|').map(Number);

          const formatTokens = (n: number): string => {
            if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
            if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
            if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
            return String(n);
          };

          metrics.contextWindow = {
            percentLeft: Math.max(0, Math.round(100 - (tokensAll / 4_000_000_000) * 100)),
            used: formatTokens(tokensAll),
            total: `${threadsAll} threads`,
          };

          metrics.limit5h = {
            percentLeft: Math.max(0, 100 - Math.round((tokens5h / 200_000_000) * 100)),
            resetsAt: `${formatTokens(tokens5h)} / ${threads5h} threads`,
          };

          metrics.limitWeekly = {
            percentLeft: Math.max(0, 100 - Math.round((tokensWeek / 1_000_000_000) * 100)),
            resetsAt: `${formatTokens(tokensWeek)} / ${threadsWeek} threads`,
          };

          metrics.credits = threadsAll;
        } catch (dbErr: unknown) {
          const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
          this.emitLog('warn', `SQLite query failed: ${msg}`);
        }
      }

      this.status.metrics = metrics;
      this.setStatus(this.status.status, this.status.errorDetail, this.status.activeTaskId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitLog('warn', `Status poll failed: ${msg}`);
    }
  }

  // ─── Invocation ─────────────────────────────────────────────────────

  async invoke(request: InvocationRequest): Promise<InvocationResult> {
    if (!this.binaryPath) throw new Error('Codex CLI not available');
    if (this.activeProcess) throw new Error('Codex is already running a task');

    const startTime = Date.now();
    const codexItems: CodexItem[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const transcript: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (request.memoryContext) {
      transcript.push({ role: 'user', content: request.memoryContext });
      transcript.push({ role: 'assistant', content: 'Task memory received.' });
    }

    if (request.context) {
      transcript.push({
        role: 'user',
        content: [
          `## Context from ${request.context.fromProvider}`,
          '',
          request.context.summary,
          '',
          ...request.context.artifacts.map(a => `Artifact: ${a.label}\n${a.content}`),
        ].join('\n'),
      });
      transcript.push({ role: 'assistant', content: 'Context received.' });
    }

    transcript.push({ role: 'user', content: request.prompt });
    this.setStatus('busy', null, request.taskId);

    eventBus.emit(AppEventType.MODEL_INVOCATION_STARTED, {
      taskId: request.taskId,
      providerId: 'codex',
    });

    try {
      for (let iteration = 0; iteration < MAX_CODEX_TOOL_ITERATIONS; iteration++) {
        const turn = await this.runCodexTurn(request, transcript);
        codexItems.push(...turn.codexItems);
        totalInputTokens += turn.usage?.input_tokens ?? 0;
        totalOutputTokens += turn.usage?.output_tokens ?? 0;

        const parsed = this.parseProtocolResponse(turn.output);
        transcript.push({ role: 'assistant', content: turn.output });
        if (!parsed) {
          const result: InvocationResult = {
            taskId: request.taskId,
            providerId: 'codex',
            success: true,
            output: turn.output.trim(),
            artifacts: [],
            usage: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              durationMs: Date.now() - startTime,
            },
            codexItems,
          };
          eventBus.emit(AppEventType.MODEL_INVOCATION_COMPLETED, { result });
          this.setStatus('available');
          return result;
        }

        if (parsed.type === 'final') {
          const result: InvocationResult = {
            taskId: request.taskId,
            providerId: 'codex',
            success: true,
            output: parsed.message,
            artifacts: [],
            usage: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              durationMs: Date.now() - startTime,
            },
            codexItems,
          };
          eventBus.emit(AppEventType.MODEL_INVOCATION_COMPLETED, { result });
          this.setStatus('available');
          return result;
        }

        const toolCalls = parsed.calls.map((call) => ({
          name: call.name,
          input: call.input || {},
        }));
        const toolResultMessages: string[] = [];
        for (const call of toolCalls) {
          this.emitProgress(request.taskId, 'status', `Calling ${call.name}...`);
          this.emitLog('info', `Tool call: ${call.name}(${JSON.stringify(call.input)})`);
        }
        const results = await executeHostToolCalls(toolCalls, request.taskId, {
          allowedToolNames: request.allowedToolNames,
        });
        for (const result of results) {
          this.emitLog(
            result.isError ? 'warn' : 'info',
            `Tool result: ${result.name} → ${summarizeHostToolResultForLog(result)}`,
          );
          this.emitProgress(
            request.taskId,
            'status',
            `Tool result: ${result.name} → ${summarizeHostToolResultForLog(result)}`,
          );
        }
        toolResultMessages.push(...serializeHostToolResults(results));

        transcript.push({
          role: 'user',
          content: `Tool results:\n${toolResultMessages.join('\n')}`,
        });
      }

      const result: InvocationResult = {
        taskId: request.taskId,
        providerId: 'codex',
        success: false,
        output: '',
        artifacts: [],
        error: `Codex tool loop reached maximum iterations (${MAX_CODEX_TOOL_ITERATIONS})`,
        usage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          durationMs: Date.now() - startTime,
        },
        codexItems,
      };
      eventBus.emit(AppEventType.MODEL_INVOCATION_FAILED, {
        taskId: request.taskId,
        providerId: 'codex',
        error: result.error || 'Unknown error',
      });
      this.setStatus('error', result.error || null);
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.setStatus('error', message);
      eventBus.emit(AppEventType.MODEL_INVOCATION_FAILED, {
        taskId: request.taskId,
        providerId: 'codex',
        error: message,
      });
      throw err;
    }
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
    this.stopStatusPolling();
    if (this.activeProcess) {
      clearTimeout(this.activeProcess.timer);
      this.activeProcess.proc.kill('SIGKILL');
      this.activeProcess = null;
    }
    this.progressListeners.clear();
  }

  // ─── Private ────────────────────────────────────────────────────────

  buildArgs(request: InvocationRequest): string[] {
    const args = ['exec', '--json'];

    if (this.config.ephemeral) {
      args.push('--ephemeral');
    }

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

    return args;
  }

  private async runCodexTurn(
    request: InvocationRequest,
    transcript: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<{ output: string; codexItems: CodexItem[]; usage: CodexUsage | null }> {
    const codexItems: CodexItem[] = [];
    const args = this.buildArgs(request);
    const prompt = this.buildPrompt(request, transcript);

    return new Promise((resolve, reject) => {
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

      let stdoutBuffer = '';
      let stderrBuffer = '';
      let lastUsage: CodexUsage | null = null;
      let agentOutput = '';

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as CodexEvent;
            this.handleCodexEvent(event, request.taskId, codexItems);
            if (event.type === 'turn.completed') lastUsage = event.usage;
            if (event.type === 'item.completed' && event.item.type === 'agent_message') {
              agentOutput += (agentOutput ? '\n' : '') + event.item.text;
            }
          } catch {
            this.emitProgress(request.taskId, 'stdout', line);
          }
        }
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        const data = chunk.toString();
        stderrBuffer += data;
        this.emitProgress(request.taskId, 'stderr', data);
      });

      const onAbort = () => { proc.kill('SIGTERM'); };
      request.abortSignal.addEventListener('abort', onAbort, { once: true });

      proc.on('close', (code) => {
        clearTimeout(timer);
        request.abortSignal.removeEventListener('abort', onAbort);
        this.activeProcess = null;
        if (code !== 0) {
          reject(new Error(`Exit code ${code}${stderrBuffer ? ': ' + stderrBuffer : ''}`));
          return;
        }
        resolve({ output: agentOutput.trim(), codexItems, usage: lastUsage });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        request.abortSignal.removeEventListener('abort', onAbort);
        this.activeProcess = null;
        reject(err);
      });

      if (proc.stdin) {
        proc.stdin.write(prompt);
        proc.stdin.end();
      }
    });
  }

  private buildPrompt(
    request: InvocationRequest,
    transcript: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): string {
    const promptTools = this.getPromptToolSet(request);
    const toolSpec = promptTools.map((tool) =>
      `- ${tool.name}: ${tool.description}${summarizeToolInput(tool) ? ` Input: ${summarizeToolInput(tool)}` : ''}`,
    ).join('\n');

    const transcriptBlock = transcript
      .map(turn => `${turn.role.toUpperCase()}:\n${turn.content}`)
      .join('\n\n');

    return [
      buildAgentSystemPrompt(request.systemPrompt || 'You are Codex operating inside V1 Workspace.', request.prompt, request.workflowType, this.id),
      '',
      'Respond naturally by default.',
      'If you want the app host to execute a tool, respond with exactly one JSON object in this shape:',
      '{"type":"tool_calls","calls":[{"name":"tool_name","input":{}}]}',
      'If you are not asking for a host tool, reply with normal user-facing text.',
      '',
      'Available tools:',
      toolSpec,
      '',
      'Conversation:',
      transcriptBlock,
    ].join('\n');
  }

  private getPromptToolSet(request: InvocationRequest): ToolDefinition[] {
    const byName = new Map<string, ToolDefinition>();
    const allowedToolNames = new Set(request.allowedToolNames || this.getAllowedPromptToolNames(request.prompt));
    for (const tool of getCoreToolDefinitions().filter(tool => allowedToolNames.has(tool.name))) {
      byName.set(tool.name, tool);
    }
    for (const tool of searchToolDefinitions(request.prompt, { limit: 10, allowedToolNames: Array.from(allowedToolNames) })) {
      byName.set(tool.name, tool);
    }
    return Array.from(byName.values());
  }

  private getAllowedPromptToolNames(prompt: string): string[] {
    return searchToolDefinitions(prompt, { limit: 64 }).map(tool => tool.name);
  }

  private parseProtocolResponse(output: string): CodexProtocolResponse | null {
    const trimmed = output.trim();
    if (!trimmed) return null;

    const candidates: string[] = [trimmed];
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) candidates.unshift(fenced[1].trim());
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (objectMatch?.[0]) candidates.push(objectMatch[0]);

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as CodexProtocolResponse;
        if (parsed && parsed.type === 'tool_calls') return parsed;
        if (parsed && parsed.type === 'final') return parsed;
      } catch {}
    }

    return null;
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

}
