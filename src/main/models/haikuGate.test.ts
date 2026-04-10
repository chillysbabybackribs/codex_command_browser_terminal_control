import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HaikuGate } from './haikuGate';
import { HAIKU_DEFINITION } from './providerRegistry';
import type { InvocationRequest, HandoffPacket } from '../../shared/types/model';

// Mock electron app for appStateStore → persistence
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-v1' },
}));

// Mock fs so resolveApiKey doesn't find the real .env file
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(),
}));

// Mock toolExecutor to avoid real surface action execution in tests
vi.mock('./tools/toolExecutor', () => ({
  executeTool: vi.fn().mockResolvedValue({ result: { success: true }, isError: false }),
}));

// Mock the Anthropic SDK
const mockCreate = vi.fn();
const mockStream = {
  on: vi.fn().mockReturnThis(),
  finalMessage: vi.fn(),
};

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mockCreate, stream: vi.fn().mockReturnValue(mockStream) };
    constructor(_opts: any) {}
  }
  return { default: MockAnthropic };
});

function makeRequest(overrides: Partial<InvocationRequest> = {}): InvocationRequest {
  return {
    taskId: 'task_1',
    prompt: 'test prompt',
    context: null,
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

describe('HaikuGate', () => {
  let gate: HaikuGate;
  const originalEnv = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-123';
    gate = new HaikuGate(HAIKU_DEFINITION);
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  describe('detect', () => {
    it('returns false when ANTHROPIC_API_KEY not set', () => {
      delete process.env.ANTHROPIC_API_KEY;
      const g = new HaikuGate(HAIKU_DEFINITION);
      expect(g.detect()).toBe(false);
      expect(g.getStatus().status).toBe('unavailable');
      expect(g.getStatus().errorDetail).toContain('ANTHROPIC_API_KEY not set');
    });

    it('returns true when key is set', () => {
      expect(gate.detect()).toBe(true);
      expect(gate.getStatus().status).toBe('available');
    });
  });

  describe('buildMessages', () => {
    it('produces single user message when no context', () => {
      gate.detect();
      const messages = gate.buildMessages(makeRequest({ prompt: 'hello' }));
      expect(messages).toHaveLength(1);
      expect(messages[0]!.role).toBe('user');
      expect(messages[0]!.content).toBe('hello');
    });

    it('produces context + ack + user message with handoff', () => {
      gate.detect();
      const context: HandoffPacket = {
        id: 'hp_1', taskId: 'task_1', fromProvider: 'codex', toProvider: 'haiku',
        summary: 'Created hello.txt',
        artifacts: [{ type: 'file_change', label: 'add: /tmp/hello.txt', content: 'add /tmp/hello.txt', path: '/tmp/hello.txt' }],
        recentDecisions: [], tokenEstimate: 20, createdAt: Date.now(),
      };
      const messages = gate.buildMessages(makeRequest({ context, prompt: 'summarize' }));
      expect(messages).toHaveLength(3);
      expect(messages[0]!.role).toBe('user');
      expect((messages[0]!.content as string)).toContain('Context from codex');
      expect(messages[1]!.role).toBe('assistant');
      expect(messages[2]!.content).toBe('summarize');
    });
  });

  describe('invoke', () => {
    it('throws when client not initialized', async () => {
      const g = new HaikuGate(HAIKU_DEFINITION);
      await expect(g.invoke(makeRequest())).rejects.toThrow('Haiku client not initialized');
    });

    it('returns text response when model responds with text only', async () => {
      gate.detect();
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Hello from Haiku' }],
        usage: { input_tokens: 50, output_tokens: 10 },
        stop_reason: 'end_turn',
      });

      const result = await gate.invoke(makeRequest());
      expect(result.success).toBe(true);
      expect(result.output).toBe('Hello from Haiku');
      expect(result.usage.inputTokens).toBe(50);
      expect(result.usage.outputTokens).toBe(10);

      // Verify tools were sent to the API
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-4-5-20251001',
          tools: expect.arrayContaining([
            expect.objectContaining({ name: 'browser_navigate' }),
            expect.objectContaining({ name: 'terminal_execute' }),
            expect.objectContaining({ name: 'get_browser_state' }),
          ]),
        }),
        expect.any(Object),
      );
    });

    it('executes tool calls and loops until text response', async () => {
      gate.detect();

      // First call: model requests a tool
      mockCreate.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Let me navigate there.' },
          { type: 'tool_use', id: 'tu_1', name: 'browser_navigate', input: { url: 'https://google.com' } },
        ],
        usage: { input_tokens: 100, output_tokens: 30 },
        stop_reason: 'tool_use',
      });

      // Second call: model responds with text
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Done! I navigated to Google.' }],
        usage: { input_tokens: 150, output_tokens: 15 },
        stop_reason: 'end_turn',
      });

      const result = await gate.invoke(makeRequest({ prompt: 'go to google' }));

      expect(result.success).toBe(true);
      expect(result.output).toBe('Done! I navigated to Google.');
      expect(result.usage.inputTokens).toBe(250); // 100 + 150
      expect(result.usage.outputTokens).toBe(45); // 30 + 15
      expect(mockCreate).toHaveBeenCalledTimes(2);

      // Verify tool executor was called
      const { executeTool: mockExec } = await import('./tools/toolExecutor');
      expect(mockExec).toHaveBeenCalledWith('browser_navigate', { url: 'https://google.com' }, 'task_1');
    });

    it('returns failure result on API error', async () => {
      gate.detect();
      mockCreate.mockRejectedValue(new Error('API rate limit'));

      const result = await gate.invoke(makeRequest());
      expect(result.success).toBe(false);
      expect(result.error).toBe('API rate limit');
    });
  });

  describe('cancel', () => {
    it('returns false when no active request', () => {
      expect(gate.cancel('task_1')).toBe(false);
    });
  });

  describe('dispose', () => {
    it('runs without error', () => {
      gate.detect();
      gate.onProgress(vi.fn());
      gate.dispose();
    });
  });
});
