// ═══════════════════════════════════════════════════════════════════════════
// Haiku Gate — Anthropic SDK wrapper with tool-use loop
// ═══════════════════════════════════════════════════════════════════════════

import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { ALL_TOOL_DEFINITIONS } from './tools/toolDefinitions';
import {
  anthropicToolBlockToHostCall,
  executeHostToolCalls,
  summarizeHostToolResultForLog,
} from './tools/hostToolRuntime';
import { buildAgentSystemPrompt, buildInvocationContextBlocks } from './agentProtocol';
import { ProviderGate, type ProgressListener } from './providerGate';
import type {
  ProviderId, ProviderDefinition, ProviderRuntime,
  InvocationRequest, InvocationResult,
  HaikuInvocationConfig,
} from '../../shared/types/model';
import { DEFAULT_HAIKU_CONFIG } from '../../shared/types/model';

const MAX_TOOL_LOOP_ITERATIONS = 50;

export class HaikuGate extends ProviderGate {
  readonly id: ProviderId = 'haiku';
  private client: Anthropic | null = null;
  private activeAborts = new Map<string, AbortController>();

  constructor(
    readonly definition: ProviderDefinition,
    private config: HaikuInvocationConfig = { ...DEFAULT_HAIKU_CONFIG },
  ) {
    super('haiku');
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  detect(): boolean {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      this.setStatus('unavailable', 'ANTHROPIC_API_KEY not set — set env var or add to .env file');
      this.emitLog('warn', 'ANTHROPIC_API_KEY not found in environment or .env file');
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

  // ─── Invocation (with tool-use loop) ────────────────────────────────

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

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    try {
      const messages: Anthropic.MessageParam[] = this.buildMessages(request);
      const tools = ALL_TOOL_DEFINITIONS
        .filter(tool => !request.allowedToolNames || request.allowedToolNames.includes(tool.name)) as Anthropic.Tool[];
      const toolCallLog: Array<{ tool: string; input: Record<string, unknown>; result: Record<string, unknown>; isError: boolean }> = [];

      let finalText = '';
      let iterations = 0;

      // ── Tool-use loop ──────────────────────────────────────────────
      while (iterations < MAX_TOOL_LOOP_ITERATIONS) {
        iterations++;

        const response = await this.client.messages.create({
          model: this.config.modelId,
          max_tokens: this.config.maxTokens,
          messages,
          tools,
          system: buildAgentSystemPrompt(request.systemPrompt, request.prompt, request.workflowType, this.id),
        }, { signal: abort.signal });

        totalInputTokens += response.usage.input_tokens;
        totalOutputTokens += response.usage.output_tokens;

        // Extract text blocks from this response
        const textParts: string[] = [];
        const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

        for (const block of response.content) {
          if (block.type === 'text') {
            textParts.push(block.text);
            this.emitProgress(request.taskId, 'token', block.text);
          } else if (block.type === 'tool_use') {
            toolUseBlocks.push(block);
          }
        }

        // If no tool calls, we're done — collect text and exit loop
        if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
          finalText = textParts.join('');
          break;
        }

        // ── Execute tool calls ─────────────────────────────────────
        // Append the assistant message (with tool_use blocks) to conversation
        messages.push({ role: 'assistant', content: response.content });

        // Build tool_result blocks
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolBlock of toolUseBlocks) {
          this.emitProgress(request.taskId, 'status', `Calling ${toolBlock.name}...`);
          this.emitLog('info', `Tool call: ${toolBlock.name}(${JSON.stringify(toolBlock.input)})`);

          const [execResult] = await executeHostToolCalls(
            [anthropicToolBlockToHostCall(toolBlock)],
            request.taskId,
            { allowedToolNames: request.allowedToolNames },
          );

          toolCallLog.push({
            tool: execResult.name,
            input: execResult.input,
            result: execResult.result,
            isError: execResult.isError,
          });

          this.emitLog(
            execResult.isError ? 'warn' : 'info',
            `Tool result: ${toolBlock.name} → ${summarizeHostToolResultForLog(execResult)}`,
          );
          this.emitProgress(
            request.taskId,
            'status',
            `Tool result: ${toolBlock.name} → ${summarizeHostToolResultForLog(execResult)}`,
          );

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: JSON.stringify(execResult.result),
            is_error: execResult.isError,
          });
        }

        // Append tool results as user message and loop
        messages.push({ role: 'user', content: toolResults });

        // If stop_reason was 'tool_use', continue the loop
        // If it was anything else with tool blocks (unlikely), also continue
      }

      // If we exhausted iterations, grab whatever text we got
      if (iterations >= MAX_TOOL_LOOP_ITERATIONS && !finalText) {
        finalText = '[Tool loop reached maximum iterations]';
        this.emitLog('warn', `Tool loop hit max iterations (${MAX_TOOL_LOOP_ITERATIONS}) for task ${request.taskId}`);
      }

      this.setStatus('available');

      const result: InvocationResult = {
        taskId: request.taskId,
        providerId: 'haiku',
        success: true,
        output: finalText,
        artifacts: [],
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, durationMs: Date.now() - startTime },
      };

      eventBus.emit(AppEventType.MODEL_INVOCATION_COMPLETED, { result });
      return result;

    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isAbort = (err instanceof Error && err.name === 'AbortError') ||
                      (typeof Anthropic !== 'undefined' && 'APIUserAbortError' in Anthropic && err instanceof (Anthropic as any).APIUserAbortError);

      this.setStatus(isAbort ? 'available' : 'error', isAbort ? null : errorMsg);

      const result: InvocationResult = {
        taskId: request.taskId,
        providerId: 'haiku',
        success: false,
        output: '',
        artifacts: [],
        error: errorMsg,
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, durationMs: Date.now() - startTime },
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

  buildMessages(request: InvocationRequest): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = [];

    for (const block of buildInvocationContextBlocks(request)) {
      messages.push({ role: 'user', content: block });
      messages.push({ role: 'assistant', content: 'Context received.' });
    }

    messages.push({ role: 'user', content: request.prompt });
    return messages;
  }

  private resolveApiKey(): string | null {
    if (process.env.ANTHROPIC_API_KEY) {
      return process.env.ANTHROPIC_API_KEY;
    }

    const envPaths = [
      path.join(process.cwd(), '.env'),
      path.join(process.env.HOME || '', '.env'),
    ];

    for (const envPath of envPaths) {
      try {
        if (!fs.existsSync(envPath)) continue;
        const content = fs.readFileSync(envPath, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
          const eqIdx = trimmed.indexOf('=');
          const key = trimmed.slice(0, eqIdx).trim();
          if (key === 'ANTHROPIC_API_KEY') {
            let value = trimmed.slice(eqIdx + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
              value = value.slice(1, -1);
            }
            if (value) {
              process.env.ANTHROPIC_API_KEY = value;
              this.emitLog('info', `Loaded ANTHROPIC_API_KEY from ${envPath}`);
              return value;
            }
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return null;
  }

}
