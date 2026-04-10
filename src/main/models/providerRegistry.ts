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
    'repo-analysis',
    'planning',
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
    'shell-execution',
  ],
};

export const ALL_PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  CODEX_DEFINITION,
  HAIKU_DEFINITION,
];

export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
  // Codex is the primary high-agency operator for code, repo work, and implementation.
  { match: { type: 'capability', capability: 'code-generation' }, assignTo: 'codex', priority: 100 },
  { match: { type: 'capability', capability: 'code-editing' }, assignTo: 'codex', priority: 100 },
  { match: { type: 'capability', capability: 'repo-analysis' }, assignTo: 'codex', priority: 95 },
  { match: { type: 'capability', capability: 'planning' }, assignTo: 'haiku', priority: 90 },
  { match: { type: 'capability', capability: 'synthesis' }, assignTo: 'haiku', priority: 90 },
  { match: { type: 'capability', capability: 'summarization' }, assignTo: 'haiku', priority: 85 },
  { match: { type: 'capability', capability: 'intent-parsing' }, assignTo: 'haiku', priority: 85 },

  // Haiku is the default fast reasoning, routing, and verification layer.
  { match: { type: 'capability', capability: 'shell-execution' }, assignTo: 'haiku', priority: 90 },
  { match: { type: 'capability', capability: 'chat' }, assignTo: 'haiku', priority: 50 },

  // Default: Haiku handles unmatched tasks unless a high-agency coding capability matched above.
  { match: { type: 'default' }, assignTo: 'haiku', priority: 0 },
];
