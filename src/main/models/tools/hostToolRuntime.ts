import type Anthropic from '@anthropic-ai/sdk';
import { executeTool } from './toolExecutor';

export type HostToolCall = {
  name: string;
  input: Record<string, unknown>;
};

export type HostToolResult = {
  name: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  isError: boolean;
};

export async function executeHostToolCalls(
  calls: HostToolCall[],
  taskId: string,
  options?: { allowedToolNames?: string[] },
): Promise<HostToolResult[]> {
  const results: HostToolResult[] = [];

  for (const call of calls) {
    const exec = await executeTool(call.name, call.input || {}, taskId, {
      allowedToolNames: options?.allowedToolNames,
    });
    results.push({
      name: call.name,
      input: call.input || {},
      result: exec.result,
      isError: exec.isError,
    });
  }

  return results;
}

export function anthropicToolBlockToHostCall(
  toolBlock: Anthropic.ToolUseBlock,
): HostToolCall {
  return {
    name: toolBlock.name,
    input: toolBlock.input as Record<string, unknown>,
  };
}

export function serializeHostToolResults(results: HostToolResult[]): string[] {
  return results.map((entry) => JSON.stringify({
    tool: entry.name,
    input: entry.input,
    result: entry.result,
    isError: entry.isError,
  }));
}

function truncate(value: string, max = 220): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

export function summarizeHostToolResultForLog(entry: HostToolResult): string {
  const { name, result, isError } = entry;

  if (isError) {
    return JSON.stringify(result);
  }

  if (name === 'capture_tab_snapshot') {
    const viewport = (result.viewport as Record<string, unknown> | undefined) || {};
    const actionable = Array.isArray(result.actionableElements) ? result.actionableElements.length : 0;
    const forms = Array.isArray(result.forms) ? result.forms.length : 0;
    return JSON.stringify({
      id: result.id,
      url: result.url,
      title: result.title,
      mainHeading: result.mainHeading,
      excerpt: truncate(String(result.visibleTextExcerpt || '')),
      actionableCount: actionable,
      formCount: forms,
      viewport: {
        foregroundUiType: viewport.foregroundUiType,
        activeSurfaceType: viewport.activeSurfaceType,
        activeSurfaceLabel: viewport.activeSurfaceLabel,
        activeSurfaceConfidence: viewport.activeSurfaceConfidence,
        isPrimarySurface: viewport.isPrimarySurface,
      },
    });
  }

  if (name === 'get_page_text') {
    return JSON.stringify({
      url: result.url,
      title: result.title,
      charCount: result.charCount,
      truncated: result.truncated,
      excerpt: truncate(String(result.text || '')),
    });
  }

  if (name === 'search_tools') {
    const matches = Array.isArray(result.matches) ? result.matches : [];
    return JSON.stringify({
      query: result.query,
      category: result.category,
      matches: matches.map((match: any) => ({
        name: match.name,
        category: match.category,
      })),
    });
  }

  if (name === 'get_browser_state') {
    const tabs = Array.isArray(result.tabs) ? result.tabs : [];
    return JSON.stringify({
      url: result.url,
      title: result.title,
      isLoading: result.isLoading,
      activeTabId: result.activeTabId,
      tabCount: result.tabCount,
      tabs: tabs.slice(0, 5).map((tab: any) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        status: tab.status,
      })),
    });
  }

  if (name.startsWith('record_task_')) {
    const entries = Array.isArray(result.entries) ? result.entries : [];
    const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;
    return JSON.stringify({
      taskId: result.taskId,
      lastUpdatedAt: result.lastUpdatedAt,
      entryCount: entries.length,
      lastEntry: lastEntry ? {
        kind: lastEntry.kind,
        text: truncate(String(lastEntry.text || ''), 180),
        category: lastEntry.metadata?.category,
      } : null,
    });
  }

  return truncate(JSON.stringify(result), 500);
}
