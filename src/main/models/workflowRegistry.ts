import type { ProviderId } from '../../shared/types/model';
import type { ToolBundleName } from './tools/toolDefinitions';

export type WorkflowType =
  | 'code-task'
  | 'browser-research'
  | 'browser-control'
  | 'debug-task'
  | 'verification-task'
  | 'general-chat';

const DEFAULT_PROVIDER_BUNDLES: Record<ProviderId, ToolBundleName[]> = {
  codex: ['core', 'browser-control', 'browser-observation', 'terminal-control', 'terminal-observation'],
  haiku: ['core', 'browser-observation', 'browser-research', 'browser-strategy'],
};

const WORKFLOW_BUNDLES: Record<WorkflowType, ToolBundleName[]> = {
  'code-task': ['core', 'terminal-control', 'terminal-observation'],
  'browser-research': ['core', 'browser-observation', 'browser-research'],
  'browser-control': ['core', 'browser-control', 'browser-observation'],
  'debug-task': ['core', 'browser-observation', 'terminal-control', 'terminal-observation'],
  'verification-task': ['core', 'browser-observation', 'browser-research'],
  'general-chat': ['core'],
};

export function inferWorkflowType(prompt: string): WorkflowType {
  const p = prompt.toLowerCase();

  if (/\b(debug|diagnose|troubleshoot|why .* fail|failure|broken|error|stack trace)\b/.test(p)) {
    return 'debug-task';
  }
  if (/\b(verify|verification|critique|audit|assess|check if|confirm whether)\b/.test(p)) {
    return 'verification-task';
  }
  if (/\b(search|results|research|sources|compare tabs|brief|investigate|evidence)\b/.test(p)) {
    return 'browser-research';
  }
  if (/\b(browser|tab|page|navigate|click|form|overlay|open page)\b/.test(p)) {
    return 'browser-control';
  }
  if (/\b(code|file|repo|repository|function|class|component|test|refactor|implement|fix)\b/.test(p)) {
    return 'code-task';
  }
  return 'general-chat';
}

export function getProviderDefaultBundles(owner: ProviderId): ToolBundleName[] {
  return DEFAULT_PROVIDER_BUNDLES[owner];
}

export function getWorkflowBundles(workflowType: WorkflowType): ToolBundleName[] {
  return WORKFLOW_BUNDLES[workflowType];
}

export function resolveInvocationBundles(prompt: string, owner: ProviderId): {
  workflowType: WorkflowType;
  bundles: ToolBundleName[];
} {
  const workflowType = inferWorkflowType(prompt);
  const merged = new Set<ToolBundleName>([
    ...getProviderDefaultBundles(owner),
    ...getWorkflowBundles(workflowType),
  ]);
  return {
    workflowType,
    bundles: Array.from(merged),
  };
}
