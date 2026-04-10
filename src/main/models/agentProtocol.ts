import type { InvocationRequest } from '../../shared/types/model';

export const AGENT_OPERATING_PROTOCOL = [
  'Work naturally and use your own judgment.',
  'Use tools when they help establish facts or take actions, but do not follow a mandatory reasoning template.',
  'Keep responses direct and useful. Do not expose private chain-of-thought.',
].join('\n');

export function buildTaskGuidance(prompt: string, workflowType?: string, providerId?: string): string | null {
  const p = prompt.toLowerCase();

  if (workflowType === 'browser-research' || /\b(search|results|research|source|evidence|compare|brief)\b/.test(p)) {
    return [
      '## Task Guidance',
      '- Prefer browser/search tools when the task depends on current external information.',
      '- Use only the tools that materially help with the task.',
    ].join('\n');
  }

  if (workflowType === 'code-task' || /\b(code|file|repo|bug|refactor|test|build|compile)\b/.test(p)) {
    return [
      '## Task Guidance',
      '- Prefer codebase, filesystem, and terminal tools relevant to the immediate coding objective.',
      providerId === 'codex' ? '- Use Codex as a high-agency implementation operator: inspect files, edit precisely, and verify.' : '- Use Haiku as a fast reviewer or verifier rather than the primary code editor.',
    ].join('\n');
  }

  if (workflowType === 'browser-control' || /\b(browser|tab|page|navigate|click|form|overlay)\b/.test(p)) {
    return [
      '## Task Guidance',
      '- Prefer browser state, snapshot, and interaction tools.',
      '- Re-check page state after browser actions instead of assuming the UI changed as expected.',
    ].join('\n');
  }

  if (workflowType === 'debug-task') {
    return [
      '## Task Guidance',
      '- Gather evidence before proposing fixes.',
      '- Prefer terminal observation/control plus targeted browser inspection when debugging spans multiple surfaces.',
      providerId === 'codex' ? '- Codex should drive implementation and command execution.' : '- Haiku should drive diagnosis, compression, and critique of possible causes.',
    ].join('\n');
  }

  if (workflowType === 'verification-task') {
    return [
      '## Task Guidance',
      '- Verify important claims before concluding.',
      '- Mark uncertainty when support is weak or conflicting.',
    ].join('\n');
  }

  return null;
}

export function buildAgentSystemPrompt(basePrompt?: string, taskPrompt?: string, workflowType?: string, providerId?: string): string {
  return [
    basePrompt || 'You are an AI assistant inside V1 Workspace.',
    AGENT_OPERATING_PROTOCOL,
    taskPrompt ? buildTaskGuidance(taskPrompt, workflowType, providerId) : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildInvocationContextBlocks(request: InvocationRequest): string[] {
  const blocks: string[] = [];

  if (request.memoryContext) {
    blocks.push(request.memoryContext);
  }

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

    blocks.push(contextBlock.join('\n'));
  }

  return blocks;
}
