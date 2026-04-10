// ═══════════════════════════════════════════════════════════════════════════
// Context Manager — Handoff packet assembly, artifact tracking
// ═══════════════════════════════════════════════════════════════════════════

import { generateId } from '../../shared/utils/ids';
import type {
  ProviderId, HandoffPacket, HandoffArtifact,
  CodexItem, InvocationResult,
} from '../../shared/types/model';

export class ContextManager {
  private lastResults = new Map<string, InvocationResult>();
  private packets = new Map<string, HandoffPacket[]>();

  recordResult(result: InvocationResult): void {
    this.lastResults.set(result.taskId, result);
  }

  buildHandoffPacket(
    taskId: string,
    from: ProviderId,
    to: ProviderId,
  ): HandoffPacket {
    const result = this.lastResults.get(taskId);
    const artifacts: HandoffArtifact[] = [];
    let summary = '';

    if (result) {
      summary = result.output;

      if (result.codexItems) {
        for (const item of result.codexItems) {
          const artifact = this.codexItemToArtifact(item);
          if (artifact) artifacts.push(artifact);
        }
      }
    }

    const packet: HandoffPacket = {
      id: generateId('hp'),
      taskId,
      fromProvider: from,
      toProvider: to,
      summary,
      artifacts,
      recentDecisions: [],
      tokenEstimate: Math.ceil(summary.length / 4),
      createdAt: Date.now(),
    };

    if (!this.packets.has(taskId)) this.packets.set(taskId, []);
    this.packets.get(taskId)!.push(packet);

    return packet;
  }

  getHistory(taskId: string): HandoffPacket[] {
    return this.packets.get(taskId) || [];
  }

  clear(taskId: string): void {
    this.lastResults.delete(taskId);
    this.packets.delete(taskId);
  }

  private codexItemToArtifact(item: CodexItem): HandoffArtifact | null {
    switch (item.type) {
      case 'agent_message':
        return null;
      case 'command_execution': {
        if (item.status !== 'completed') return null;
        return {
          type: 'command_output',
          label: `$ ${item.command}`,
          content: item.aggregated_output,
        };
      }
      case 'file_change': {
        if (item.status !== 'completed' || item.changes.length === 0) return null;
        return {
          type: 'file_change',
          label: item.changes.map(c => `${c.kind}: ${c.path}`).join(', '),
          content: item.changes.map(c => `${c.kind} ${c.path}`).join('\n'),
          path: item.changes[0]?.path,
        };
      }
      case 'mcp_tool_call': {
        if (item.error) {
          return {
            type: 'error',
            label: `MCP ${item.tool} failed`,
            content: item.error.message,
          };
        }
        return null;
      }
      default:
        return null;
    }
  }
}

export const contextManager = new ContextManager();
