// ═══════════════════════════════════════════════════════════════════════════
// Model Layer — Initialization and singleton exports
// ═══════════════════════════════════════════════════════════════════════════

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
