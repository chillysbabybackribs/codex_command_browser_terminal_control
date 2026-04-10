// ═══════════════════════════════════════════════════════════════════════════
// Model Router — Task routing, dispatch, and handoff orchestration
// ═══════════════════════════════════════════════════════════════════════════

import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { generateId } from '../../shared/utils/ids';
import { contextManager } from './contextManager';
import { taskMemoryStore } from './taskMemoryStore';
import { getToolDefinitionsForBundles } from './tools/toolDefinitions';
import { resolveInvocationBundles } from './workflowRegistry';
import type { CodexGate } from './codexGate';
import type { HaikuGate } from './haikuGate';
import type {
  ProviderId, ProviderRuntime, ProviderCapability,
  InvocationRequest, InvocationResult,
  HandoffPacket, RoutingRule, ModelOwner,
} from '../../shared/types/model';

type Gate = CodexGate | HaikuGate;

export class ModelRouter {
  private gates = new Map<ProviderId, Gate>();
  private rules: RoutingRule[] = [];
  private readonly evaluativeLoopTasks = new Set<string>();

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

    const history = contextManager.getHistory(taskId);
    const lastPacket = history.length > 0 ? history[history.length - 1] : null;
    const context = (lastPacket && lastPacket.toProvider === owner) ? lastPacket : null;
    const memoryContext = taskMemoryStore.buildContext(taskId);
    const { workflowType, bundles: allowedToolBundles } = resolveInvocationBundles(prompt, owner);
    const allowedToolNames = getToolDefinitionsForBundles(allowedToolBundles).map(tool => tool.name);
    taskMemoryStore.recordUserPrompt(taskId, prompt);

    const request: InvocationRequest = {
      taskId,
      prompt,
      context: context ?? null,
      memoryContext,
      systemPrompt: options?.systemPrompt,
      cwd: options?.cwd,
      allowedToolNames,
      allowedToolBundles,
      workflowType,
      abortSignal: abortController.signal,
    };

    const result = await gate.invoke(request);
    contextManager.recordResult(result);
    taskMemoryStore.recordInvocationResult(result);

    if (this.shouldRunEvaluativeLoop(taskId, prompt, result)) {
      const repaired = await this.runEvaluativeLoop(taskId, prompt, owner, result, {
        systemPrompt: options?.systemPrompt,
        cwd: options?.cwd,
        abortController,
      });
      if (repaired) {
        return repaired;
      }
    }

    return result;
  }

  // ─── Handoff ────────────────────────────────────────────────────────

  handoff(taskId: string, from: ProviderId, to: ProviderId): HandoffPacket {
    const packet = contextManager.buildHandoffPacket(taskId, from, to);
    taskMemoryStore.recordHandoff(packet);
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

  getTaskMemory(taskId: string) {
    return taskMemoryStore.get(taskId);
  }

  // ─── Cleanup ────────────────────────────────────────────────────────

  dispose(): void {
    for (const gate of this.gates.values()) {
      gate.dispose();
    }
    this.gates.clear();
  }

  // ─── Private ────────────────────────────────────────────────────────

  promptMatchesCapability(prompt: string, capability: ProviderCapability): boolean {
    const p = prompt.toLowerCase();
    switch (capability) {
      case 'code-generation':
      case 'code-editing':
        return /\b(write|create|implement|add|fix|refactor|edit|modify|update|build|generate)\b.*\b(code|function|class|file|component|test|module|type|interface)\b/.test(p)
            || /\b(code|function|class|file|component|test|module)\b.*\b(write|create|implement|add|fix|refactor|edit|modify|build)\b/.test(p);
      case 'shell-execution':
        return /\b(run|execute|install|build|deploy|npm|git|make|compile|lint)\b/.test(p);
      case 'repo-analysis':
        return /\b(analyze|audit|review|inspect|check|find|search|grep|explore)\b.*\b(code|repo|codebase|files|directory|project)\b/.test(p);
      case 'summarization':
        return /\b(summarize|summary|explain|describe|what happened|recap|overview)\b/.test(p);
      case 'intent-parsing':
      case 'planning':
        return /\b(plan|design|architect|propose|strategy|approach|how should|what should)\b/.test(p);
      case 'chat':
        return false;
      case 'synthesis':
        return /\b(combine|merge|synthesize|integrate|consolidate)\b/.test(p);
      default:
        return false;
    }
  }

  private emitLog(level: 'info' | 'warn' | 'error', message: string): void {
    const line = `[${new Date().toISOString()}] [model-router] [${level}] ${message}`;
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
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

  private shouldRunEvaluativeLoop(taskId: string, prompt: string, result: InvocationResult): boolean {
    void taskId;
    void prompt;
    void result;
    return false;
  }

  private requiresEvaluation(prompt: string, output: string): boolean {
    const normalizedPrompt = prompt.trim().toLowerCase();
    const normalizedOutput = output.trim();
    if (!normalizedPrompt || normalizedPrompt.length < 12) return false;
    if (normalizedOutput.length < 80) return false;
    if (/^(hi|hello|thanks|thank you|ok|okay|yes|no|cool|nice)\b/.test(normalizedPrompt)) return false;
    return /\b(analyze|analysis|explain|compare|research|summarize|summary|plan|strategy|investigate|evaluate|review|brief|recommend|why|how|debug|diagnose|fix|assess|audit|check|verify|confirm|determine|identify|resolve|troubleshoot)\b/.test(normalizedPrompt)
      || normalizedOutput.length > 300;
  }

  private async runEvaluativeLoop(
    taskId: string,
    originalPrompt: string,
    owner: ProviderId,
    draftResult: InvocationResult,
    options?: { systemPrompt?: string; cwd?: string; abortController?: AbortController },
  ): Promise<InvocationResult | null> {
    this.evaluativeLoopTasks.add(taskId);
    this.emitLog('info', `Evaluative loop pass for task ${taskId}`);

    try {
      const consistencyIssues = taskMemoryStore.findEvidenceConsistencyIssues(taskId, draftResult.output);
      const critiquePrompt = [
        'Run a critique pass on the current draft answer before finalizing.',
        'Use record_task_critique to answer these questions explicitly:',
        '- Is this actually correct?',
        '- What would break this answer?',
        '- Am I overconfident?',
        'Also use record_task_verification with a verdict of pass, uncertain, contradicted, or needs_more_evidence.',
        'If critique reveals missing support, also record additional claim or evidence entries as needed.',
        consistencyIssues.length > 0 ? 'Treat unsupported specifics as a likely problem. If the draft includes details not present in recorded claim/evidence, either support them explicitly or remove/downgrade them.' : null,
        'Do not produce the final answer yet. Produce only a compact critique summary.',
        '',
        '## Original Task',
        originalPrompt,
        consistencyIssues.length > 0 ? '' : null,
        consistencyIssues.length > 0 ? '## Consistency Issues Detected' : null,
        ...(consistencyIssues.length > 0 ? consistencyIssues : []),
        '',
        '## Current Draft',
        draftResult.output || '[No draft output recorded]',
      ].filter(Boolean).join('\n');

      const critiqueResult = await this.dispatch(taskId, critiquePrompt, owner, options);
      const countsAfterCritique = taskMemoryStore.getCategoryCounts(taskId);
      if (countsAfterCritique.claim < 1 || countsAfterCritique.evidence < 1 || countsAfterCritique.critique < 1 || countsAfterCritique.verification < 1) {
        this.emitLog('warn', `Evaluative loop critique pass did not record full artifacts for task ${taskId}`);
      }

      const revisePrompt = [
        'Revise the draft answer using the critique and verification records now stored in task memory.',
        'Keep the strongest supported claims.',
        'Reduce overconfidence where support is weak.',
        'Address the most likely breakpoints or contradictions raised in critique.',
        'Return the revised final answer only.',
        '',
        '## Original Task',
        originalPrompt,
        '',
        '## Prior Draft',
        draftResult.output || '[No draft output recorded]',
        '',
        '## Critique Summary',
        critiqueResult.output || '[No critique summary recorded]',
      ].join('\n');

      const repaired = await this.dispatch(taskId, revisePrompt, owner, options);
      const remainingConsistencyIssues = taskMemoryStore.findEvidenceConsistencyIssues(taskId, repaired.output);
      if (remainingConsistencyIssues.length > 0) {
        this.emitLog('warn', `Final answer still contains evidence-consistency issues for task ${taskId}: ${remainingConsistencyIssues.join(' | ')}`);
      }
      const counts = taskMemoryStore.getCategoryCounts(taskId);
      if (counts.claim < 1 || counts.evidence < 1 || counts.critique < 1 || counts.verification < 1) {
        this.emitLog('warn', `Evaluative loop did not retain full claim/evidence/critique/verification artifacts for task ${taskId}`);
      }
      return repaired;
    } finally {
      this.evaluativeLoopTasks.delete(taskId);
    }
  }
}
