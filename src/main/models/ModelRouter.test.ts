import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelRouter } from './ModelRouter';
import { DEFAULT_ROUTING_RULES } from './providerRegistry';
import type { ProviderId, ProviderRuntime, ProviderDefinition, InvocationRequest, InvocationResult } from '../../shared/types/model';

// Mock electron app
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-v1' },
}));

// ─── Mock Gate ──────────────────────────────────────────────────────────

function createMockGate(id: ProviderId, status: ProviderRuntime['status'] = 'available') {
  const runtime: ProviderRuntime = {
    id,
    status,
    activeTaskId: null,
    lastActivityAt: null,
    errorDetail: status === 'unavailable' ? 'not available' : null,
  };

  return {
    id,
    definition: { id, displayName: id, kind: 'cli-process' as const, capabilities: [] } as ProviderDefinition,
    detect: vi.fn().mockReturnValue(status !== 'unavailable'),
    getStatus: vi.fn().mockReturnValue(runtime),
    invoke: vi.fn().mockResolvedValue({
      taskId: 'task_1',
      providerId: id,
      success: true,
      output: `Response from ${id}`,
      artifacts: [],
      usage: { inputTokens: 10, outputTokens: 5, durationMs: 100 },
    } as InvocationResult),
    cancel: vi.fn().mockReturnValue(true),
    onProgress: vi.fn().mockReturnValue(() => {}),
    dispose: vi.fn(),
  };
}

describe('ModelRouter', () => {
  let router: ModelRouter;

  beforeEach(() => {
    router = new ModelRouter();
  });

  describe('resolve', () => {
    it('returns explicit owner when specified and available', () => {
      const codex = createMockGate('codex');
      const haiku = createMockGate('haiku');
      router.registerGate(codex as any);
      router.registerGate(haiku as any);
      router.setRules(DEFAULT_ROUTING_RULES);

      expect(router.resolve('anything', 'codex')).toBe('codex');
    });

    it('falls back when explicit owner is unavailable', () => {
      const codex = createMockGate('codex', 'unavailable');
      const haiku = createMockGate('haiku');
      router.registerGate(codex as any);
      router.registerGate(haiku as any);
      router.setRules(DEFAULT_ROUTING_RULES);

      // Should fall through to default rule (haiku)
      expect(router.resolve('hello world', 'codex')).toBe('haiku');
    });

    it('matches coding prompts to codex via capability rules', () => {
      const codex = createMockGate('codex');
      const haiku = createMockGate('haiku');
      router.registerGate(codex as any);
      router.registerGate(haiku as any);
      router.setRules(DEFAULT_ROUTING_RULES);

      expect(router.resolve('write a function to parse JSON')).toBe('codex');
      expect(router.resolve('fix the bug in the test file')).toBe('codex');
      expect(router.resolve('create a new component for the dashboard')).toBe('codex');
      expect(router.resolve('refactor the class to use generics')).toBe('codex');
    });

    it('matches shell prompts to haiku (workspace operator)', () => {
      const codex = createMockGate('codex');
      const haiku = createMockGate('haiku');
      router.registerGate(codex as any);
      router.registerGate(haiku as any);
      router.setRules(DEFAULT_ROUTING_RULES);

      expect(router.resolve('run npm install')).toBe('haiku');
      expect(router.resolve('execute the build script')).toBe('haiku');
      expect(router.resolve('run ls in the terminal')).toBe('haiku');
    });

    it('matches summary prompts to codex (primary operator)', () => {
      const codex = createMockGate('codex');
      const haiku = createMockGate('haiku');
      router.registerGate(codex as any);
      router.registerGate(haiku as any);
      router.setRules(DEFAULT_ROUTING_RULES);

      // Codex now handles summarization at priority 85
      expect(router.resolve('summarize what just happened')).toBe('codex');
      expect(router.resolve('explain this error message')).toBe('codex');
    });

    it('returns default (codex) for unmatched prompts', () => {
      const codex = createMockGate('codex');
      const haiku = createMockGate('haiku');
      router.registerGate(codex as any);
      router.registerGate(haiku as any);
      router.setRules(DEFAULT_ROUTING_RULES);

      // Default routing rule now assigns to codex
      expect(router.resolve('hello')).toBe('codex');
      expect(router.resolve('what time is it')).toBe('codex');
    });

    it('throws when no providers available', () => {
      const codex = createMockGate('codex', 'unavailable');
      const haiku = createMockGate('haiku', 'unavailable');
      router.registerGate(codex as any);
      router.registerGate(haiku as any);
      router.setRules(DEFAULT_ROUTING_RULES);

      expect(() => router.resolve('hello')).toThrow('No model providers available');
    });
  });

  describe('dispatch', () => {
    it('calls correct gate invoke', async () => {
      const codex = createMockGate('codex');
      const haiku = createMockGate('haiku');
      router.registerGate(codex as any);
      router.registerGate(haiku as any);

      const result = await router.dispatch('task_1', 'hello', 'haiku');

      expect(haiku.invoke).toHaveBeenCalled();
      expect(result.providerId).toBe('haiku');
    });

    it('throws for unavailable provider', async () => {
      const codex = createMockGate('codex', 'unavailable');
      router.registerGate(codex as any);

      await expect(router.dispatch('task_1', 'hello', 'codex'))
        .rejects.toThrow('Provider codex is unavailable');
    });

    it('throws for unregistered provider', async () => {
      await expect(router.dispatch('task_1', 'hello', 'codex'))
        .rejects.toThrow('Provider codex not registered');
    });
  });

  describe('handoff', () => {
    it('builds packet and returns it', () => {
      const codex = createMockGate('codex');
      const haiku = createMockGate('haiku');
      router.registerGate(codex as any);
      router.registerGate(haiku as any);

      const packet = router.handoff('task_1', 'codex', 'haiku');

      expect(packet.taskId).toBe('task_1');
      expect(packet.fromProvider).toBe('codex');
      expect(packet.toProvider).toBe('haiku');
    });
  });

  describe('cancel', () => {
    it('delegates to gate that owns the active task', () => {
      const codex = createMockGate('codex');
      codex.getStatus.mockReturnValue({ ...codex.getStatus(), activeTaskId: 'task_1' });
      router.registerGate(codex as any);

      expect(router.cancel('task_1')).toBe(true);
      expect(codex.cancel).toHaveBeenCalledWith('task_1');
    });

    it('returns false when no gate has the task', () => {
      const codex = createMockGate('codex');
      router.registerGate(codex as any);

      expect(router.cancel('task_unknown')).toBe(false);
    });
  });

  describe('getAvailableProviders', () => {
    it('returns only non-unavailable providers', () => {
      const codex = createMockGate('codex', 'unavailable');
      const haiku = createMockGate('haiku');
      router.registerGate(codex as any);
      router.registerGate(haiku as any);

      expect(router.getAvailableProviders()).toEqual(['haiku']);
    });
  });

  describe('rules sorting', () => {
    it('rules are sorted by priority (highest first)', () => {
      const codex = createMockGate('codex');
      const haiku = createMockGate('haiku');
      router.registerGate(codex as any);
      router.registerGate(haiku as any);
      router.setRules(DEFAULT_ROUTING_RULES);

      // code-generation (priority 100) should match before default (priority 0)
      expect(router.resolve('write a function to handle errors')).toBe('codex');
    });
  });

  describe('promptMatchesCapability', () => {
    it('matches repo analysis prompts', () => {
      expect(router.promptMatchesCapability('analyze the codebase for security issues', 'repo-analysis')).toBe(true);
      expect(router.promptMatchesCapability('review the code in this directory', 'repo-analysis')).toBe(true);
    });

    it('matches planning prompts', () => {
      expect(router.promptMatchesCapability('plan the architecture for this feature', 'planning')).toBe(true);
      expect(router.promptMatchesCapability('how should we approach this migration', 'planning')).toBe(true);
    });

    it('does not match chat capability (always false)', () => {
      expect(router.promptMatchesCapability('hello world', 'chat')).toBe(false);
    });
  });
});
