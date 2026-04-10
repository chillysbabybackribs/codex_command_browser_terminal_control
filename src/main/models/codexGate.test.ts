import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodexGate } from './codexGate';
import { CODEX_DEFINITION } from './providerRegistry';
import type { InvocationRequest, CodexInvocationConfig } from '../../shared/types/model';

// Mock electron app for appStateStore → persistence
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/test-v1' },
}));

// Minimal mock for child_process — individual tests override as needed
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

import { execFileSync, spawn } from 'child_process';
import { EventEmitter } from 'events';

function makeRequest(overrides: Partial<InvocationRequest> = {}): InvocationRequest {
  return {
    taskId: 'task_1',
    prompt: 'test prompt',
    context: null,
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

describe('CodexGate', () => {
  let gate: CodexGate;

  beforeEach(() => {
    vi.clearAllMocks();
    gate = new CodexGate(CODEX_DEFINITION);
  });

  describe('detect', () => {
    it('returns true when codex binary is found', () => {
      (execFileSync as any).mockReturnValue('/usr/bin/codex\n');

      expect(gate.detect()).toBe(true);
      expect(gate.getStatus().status).toBe('available');
    });

    it('returns false when codex binary is not found', () => {
      (execFileSync as any).mockImplementation(() => { throw new Error('not found'); });

      expect(gate.detect()).toBe(false);
      expect(gate.getStatus().status).toBe('unavailable');
      expect(gate.getStatus().errorDetail).toBe('codex CLI not found in PATH');
    });
  });

  describe('buildArgs', () => {
    it('produces correct flags for dangerously-bypass mode', () => {
      (execFileSync as any).mockReturnValue('/usr/bin/codex\n');
      gate.detect();

      const args = gate.buildArgs(makeRequest());
      expect(args).toContain('exec');
      expect(args).toContain('--json');
      // DEFAULT_CODEX_CONFIG has ephemeral: false, so --ephemeral is not included
      expect(args).not.toContain('--ephemeral');
      expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
      expect(args).not.toContain('--full-auto');
    });

    it('produces correct flags for full-auto mode with sandbox', () => {
      const config: CodexInvocationConfig = {
        approvalMode: 'full-auto',
        sandbox: 'workspace-write',
        timeoutMs: 60_000,
        ephemeral: true,
      };
      const autoGate = new CodexGate(CODEX_DEFINITION, config);
      (execFileSync as any).mockReturnValue('/usr/bin/codex\n');
      autoGate.detect();

      const args = autoGate.buildArgs(makeRequest());
      expect(args).toContain('--full-auto');
      expect(args).toContain('--sandbox');
      expect(args).toContain('workspace-write');
      expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    });

    it('includes -C when cwd is provided', () => {
      (execFileSync as any).mockReturnValue('/usr/bin/codex\n');
      gate.detect();

      const args = gate.buildArgs(makeRequest({ cwd: '/tmp/work' }));
      expect(args).toContain('-C');
      expect(args).toContain('/tmp/work');
    });
  });

  describe('invoke', () => {
    it('rejects when binary not available', async () => {
      await expect(gate.invoke(makeRequest())).rejects.toThrow('Codex CLI not available');
    });

    it('rejects when another task is already running', async () => {
      (execFileSync as any).mockReturnValue('/usr/bin/codex\n');
      gate.detect();

      // Create a mock process that never exits
      const mockProc = new EventEmitter() as any;
      mockProc.stdout = new EventEmitter();
      mockProc.stderr = new EventEmitter();
      mockProc.stdin = { write: vi.fn(), end: vi.fn() };
      mockProc.kill = vi.fn();
      mockProc.killed = false;
      (spawn as any).mockReturnValue(mockProc);

      // Start first invocation (won't resolve until process closes)
      const promise1 = gate.invoke(makeRequest({ taskId: 'task_1' }));

      // Second invocation should throw
      await expect(gate.invoke(makeRequest({ taskId: 'task_2' }))).rejects.toThrow('Codex is already running a task');

      // Clean up: emit a final response and close with 0
      mockProc.stdout.emit('data', Buffer.from(
        '{"type":"item.completed","item":{"id":"i0","type":"agent_message","text":"{\\"type\\":\\"final\\",\\"message\\":\\"done\\"}"}}\n' +
        '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}\n'
      ));
      mockProc.emit('close', 0);
      await promise1;
    });

    it('parses JSONL events and collects agent messages', async () => {
      (execFileSync as any).mockReturnValue('/usr/bin/codex\n');
      gate.detect();

      const mockProc = new EventEmitter() as any;
      mockProc.stdout = new EventEmitter();
      mockProc.stderr = new EventEmitter();
      mockProc.stdin = { write: vi.fn(), end: vi.fn() };
      mockProc.kill = vi.fn();
      mockProc.killed = false;
      (spawn as any).mockReturnValue(mockProc);

      const resultPromise = gate.invoke(makeRequest());

      // The agent_message text must be valid JSON for parseProtocolResponse
      // since invoke's tool loop calls parseProtocolResponse(turn.output)
      // where turn.output = agentOutput (accumulated agent_message text)
      mockProc.stdout.emit('data', Buffer.from(
        '{"type":"thread.started","thread_id":"abc"}\n' +
        '{"type":"turn.started"}\n' +
        '{"type":"item.completed","item":{"id":"i0","type":"agent_message","text":"{\\"type\\":\\"final\\",\\"message\\":\\"Hello world\\"}"}}\n' +
        '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":50,"output_tokens":10}}\n'
      ));
      mockProc.emit('close', 0);

      const result = await resultPromise;
      expect(result.success).toBe(true);
      expect(result.output).toBe('Hello world');
      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(10);
      expect(result.codexItems).toHaveLength(1);
      expect(result.codexItems![0]!.type).toBe('agent_message');
    });

    it('collects command_execution and file_change items', async () => {
      (execFileSync as any).mockReturnValue('/usr/bin/codex\n');
      gate.detect();

      const mockProc = new EventEmitter() as any;
      mockProc.stdout = new EventEmitter();
      mockProc.stderr = new EventEmitter();
      mockProc.stdin = { write: vi.fn(), end: vi.fn() };
      mockProc.kill = vi.fn();
      mockProc.killed = false;
      (spawn as any).mockReturnValue(mockProc);

      const resultPromise = gate.invoke(makeRequest());

      // Emit JSONL events including items and a final agent_message with protocol response
      mockProc.stdout.emit('data', Buffer.from(
        '{"type":"item.completed","item":{"id":"i1","type":"command_execution","command":"ls","aggregated_output":"hello.txt\\n","exit_code":0,"status":"completed"}}\n' +
        '{"type":"item.completed","item":{"id":"i2","type":"file_change","changes":[{"path":"/tmp/hello.txt","kind":"add"}],"status":"completed"}}\n' +
        '{"type":"item.completed","item":{"id":"i3","type":"agent_message","text":"{\\"type\\":\\"final\\",\\"message\\":\\"Done\\"}"}}\n' +
        '{"type":"turn.completed","usage":{"input_tokens":50,"cached_input_tokens":0,"output_tokens":5}}\n'
      ));
      mockProc.emit('close', 0);

      const result = await resultPromise;
      // 3 items: command_execution, file_change, agent_message
      expect(result.codexItems).toHaveLength(3);
      expect(result.codexItems![0]!.type).toBe('command_execution');
      expect(result.codexItems![1]!.type).toBe('file_change');
    });

    it('reports failure on non-zero exit code', async () => {
      (execFileSync as any).mockReturnValue('/usr/bin/codex\n');
      gate.detect();

      const mockProc = new EventEmitter() as any;
      mockProc.stdout = new EventEmitter();
      mockProc.stderr = new EventEmitter();
      mockProc.stdin = { write: vi.fn(), end: vi.fn() };
      mockProc.kill = vi.fn();
      mockProc.killed = false;
      (spawn as any).mockReturnValue(mockProc);

      const resultPromise = gate.invoke(makeRequest());

      mockProc.stderr.emit('data', Buffer.from('something went wrong'));
      mockProc.emit('close', 1);

      // Non-zero exit rejects from runCodexTurn, caught by invoke's catch block
      await expect(resultPromise).rejects.toThrow('Exit code 1');
    });
  });

  describe('cancel', () => {
    it('returns false when no active process', () => {
      expect(gate.cancel('task_1')).toBe(false);
    });

    it('sends SIGTERM to active process', async () => {
      (execFileSync as any).mockReturnValue('/usr/bin/codex\n');
      gate.detect();

      const mockProc = new EventEmitter() as any;
      mockProc.stdout = new EventEmitter();
      mockProc.stderr = new EventEmitter();
      mockProc.stdin = { write: vi.fn(), end: vi.fn() };
      mockProc.kill = vi.fn();
      mockProc.killed = false;
      (spawn as any).mockReturnValue(mockProc);

      const resultPromise = gate.invoke(makeRequest({ taskId: 'task_1' }));

      expect(gate.cancel('task_1')).toBe(true);
      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');

      // Non-zero exit code from kill rejects the promise
      mockProc.emit('close', 137);
      await expect(resultPromise).rejects.toThrow('Exit code 137');
    });

    it('returns false for wrong task id', async () => {
      (execFileSync as any).mockReturnValue('/usr/bin/codex\n');
      gate.detect();

      const mockProc = new EventEmitter() as any;
      mockProc.stdout = new EventEmitter();
      mockProc.stderr = new EventEmitter();
      mockProc.stdin = { write: vi.fn(), end: vi.fn() };
      mockProc.kill = vi.fn();
      mockProc.killed = false;
      (spawn as any).mockReturnValue(mockProc);

      const resultPromise = gate.invoke(makeRequest({ taskId: 'task_1' }));

      expect(gate.cancel('task_other')).toBe(false);

      // Clean up with a valid final response
      mockProc.stdout.emit('data', Buffer.from(
        '{"type":"item.completed","item":{"id":"i0","type":"agent_message","text":"{\\"type\\":\\"final\\",\\"message\\":\\"done\\"}"}}\n' +
        '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}\n'
      ));
      mockProc.emit('close', 0);
      await resultPromise;
    });
  });

  describe('progress listeners', () => {
    it('calls listeners on progress events', async () => {
      (execFileSync as any).mockReturnValue('/usr/bin/codex\n');
      gate.detect();

      const listener = vi.fn();
      gate.onProgress(listener);

      const mockProc = new EventEmitter() as any;
      mockProc.stdout = new EventEmitter();
      mockProc.stderr = new EventEmitter();
      mockProc.stdin = { write: vi.fn(), end: vi.fn() };
      mockProc.kill = vi.fn();
      mockProc.killed = false;
      (spawn as any).mockReturnValue(mockProc);

      const resultPromise = gate.invoke(makeRequest());

      // Emit an item event and a valid final response so the tool loop terminates
      mockProc.stdout.emit('data', Buffer.from(
        '{"type":"item.completed","item":{"id":"i0","type":"agent_message","text":"{\\"type\\":\\"final\\",\\"message\\":\\"hi\\"}"}}\n' +
        '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}\n'
      ));
      mockProc.emit('close', 0);
      await resultPromise;

      expect(listener).toHaveBeenCalled();
      const call = listener.mock.calls.find((c: any) => c[0].type === 'item');
      expect(call).toBeDefined();
    });
  });
});
