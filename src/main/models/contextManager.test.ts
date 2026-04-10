import { describe, it, expect, beforeEach } from 'vitest';
import { ContextManager } from './contextManager';
import type { InvocationResult, CodexItem } from '../../shared/types/model';

function makeResult(overrides: Partial<InvocationResult> = {}): InvocationResult {
  return {
    taskId: 'task_1',
    providerId: 'codex',
    success: true,
    output: 'Some output text',
    artifacts: [],
    usage: { inputTokens: 100, outputTokens: 20, durationMs: 500 },
    ...overrides,
  };
}

describe('ContextManager', () => {
  let cm: ContextManager;

  beforeEach(() => {
    cm = new ContextManager();
  });

  it('builds a handoff packet from a recorded result', () => {
    cm.recordResult(makeResult());
    const packet = cm.buildHandoffPacket('task_1', 'codex', 'haiku');

    expect(packet.taskId).toBe('task_1');
    expect(packet.fromProvider).toBe('codex');
    expect(packet.toProvider).toBe('haiku');
    expect(packet.summary).toBe('Some output text');
    expect(packet.id).toMatch(/^hp_/);
    expect(packet.createdAt).toBeGreaterThan(0);
  });

  it('preserves full summary output', () => {
    const longOutput = 'x'.repeat(3000);
    cm.recordResult(makeResult({ output: longOutput }));
    const packet = cm.buildHandoffPacket('task_1', 'codex', 'haiku');

    expect(packet.summary).toBe(longOutput);
  });

  it('extracts command_execution items as command_output artifacts', () => {
    const items: CodexItem[] = [
      { id: 'i1', type: 'command_execution', command: 'ls -la', aggregated_output: 'file1\nfile2\n', exit_code: 0, status: 'completed' },
    ];
    cm.recordResult(makeResult({ codexItems: items }));
    const packet = cm.buildHandoffPacket('task_1', 'codex', 'haiku');

    expect(packet.artifacts).toHaveLength(1);
    expect(packet.artifacts[0]!.type).toBe('command_output');
    expect(packet.artifacts[0]!.label).toBe('$ ls -la');
    expect(packet.artifacts[0]!.content).toBe('file1\nfile2\n');
  });

  it('extracts file_change items as file_change artifacts', () => {
    const items: CodexItem[] = [
      { id: 'i1', type: 'file_change', changes: [{ path: '/tmp/hello.txt', kind: 'add' }], status: 'completed' },
    ];
    cm.recordResult(makeResult({ codexItems: items }));
    const packet = cm.buildHandoffPacket('task_1', 'codex', 'haiku');

    expect(packet.artifacts).toHaveLength(1);
    expect(packet.artifacts[0]!.type).toBe('file_change');
    expect(packet.artifacts[0]!.path).toBe('/tmp/hello.txt');
  });

  it('does NOT extract agent_message items as artifacts', () => {
    const items: CodexItem[] = [
      { id: 'i1', type: 'agent_message', text: 'I created the file' },
    ];
    cm.recordResult(makeResult({ codexItems: items }));
    const packet = cm.buildHandoffPacket('task_1', 'codex', 'haiku');

    expect(packet.artifacts).toHaveLength(0);
  });

  it('extracts mcp_tool_call errors as error artifacts', () => {
    const items: CodexItem[] = [
      { id: 'i1', type: 'mcp_tool_call', server: 'local-agent', tool: 'os_shell_exec', arguments: {}, result: null, error: { message: 'sandbox blocked' }, status: 'failed' },
    ];
    cm.recordResult(makeResult({ codexItems: items }));
    const packet = cm.buildHandoffPacket('task_1', 'codex', 'haiku');

    expect(packet.artifacts).toHaveLength(1);
    expect(packet.artifacts[0]!.type).toBe('error');
    expect(packet.artifacts[0]!.content).toBe('sandbox blocked');
  });

  it('includes all completed artifacts without a cap', () => {
    const items: CodexItem[] = Array.from({ length: 15 }, (_, i) => ({
      id: `i${i}`,
      type: 'command_execution' as const,
      command: `cmd_${i}`,
      aggregated_output: `out_${i}`,
      exit_code: 0,
      status: 'completed' as const,
    }));
    cm.recordResult(makeResult({ codexItems: items }));
    const packet = cm.buildHandoffPacket('task_1', 'codex', 'haiku');

    expect(packet.artifacts).toHaveLength(15);
  });

  it('skips incomplete command_execution items', () => {
    const items: CodexItem[] = [
      { id: 'i1', type: 'command_execution', command: 'ls', aggregated_output: '', exit_code: null, status: 'in_progress' },
    ];
    cm.recordResult(makeResult({ codexItems: items }));
    const packet = cm.buildHandoffPacket('task_1', 'codex', 'haiku');

    expect(packet.artifacts).toHaveLength(0);
  });

  it('returns empty history for unknown task', () => {
    expect(cm.getHistory('unknown')).toEqual([]);
  });

  it('accumulates handoff history for a task', () => {
    cm.recordResult(makeResult());
    cm.buildHandoffPacket('task_1', 'codex', 'haiku');
    cm.buildHandoffPacket('task_1', 'haiku', 'codex');

    expect(cm.getHistory('task_1')).toHaveLength(2);
  });

  it('clear removes all state for a task', () => {
    cm.recordResult(makeResult());
    cm.buildHandoffPacket('task_1', 'codex', 'haiku');
    cm.clear('task_1');

    expect(cm.getHistory('task_1')).toEqual([]);
    // Building a packet after clear should produce empty summary
    const packet = cm.buildHandoffPacket('task_1', 'codex', 'haiku');
    expect(packet.summary).toBe('');
  });

  it('builds empty packet when no result recorded', () => {
    const packet = cm.buildHandoffPacket('task_1', 'codex', 'haiku');

    expect(packet.summary).toBe('');
    expect(packet.artifacts).toHaveLength(0);
    expect(packet.tokenEstimate).toBe(0);
  });

  it('preserves full command output in artifacts', () => {
    const longOutput = 'x'.repeat(5000);
    const items: CodexItem[] = [
      { id: 'i1', type: 'command_execution', command: 'cat bigfile', aggregated_output: longOutput, exit_code: 0, status: 'completed' },
    ];
    cm.recordResult(makeResult({ codexItems: items }));
    const packet = cm.buildHandoffPacket('task_1', 'codex', 'haiku');

    expect(packet.artifacts[0]!.content).toBe(longOutput);
  });
});
