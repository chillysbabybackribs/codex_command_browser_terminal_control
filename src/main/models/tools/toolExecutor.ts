// ═══════════════════════════════════════════════════════════════════════════
// Tool Executor — Bridges model tool calls to SurfaceActionRouter + queries
// ═══════════════════════════════════════════════════════════════════════════

import { surfaceActionRouter } from '../../actions/SurfaceActionRouter';
import { targetForKind } from '../../../shared/actions/surfaceActionTypes';
import { browserService } from '../../browser/BrowserService';
import { terminalService } from '../../terminal/TerminalService';
import { appStateStore } from '../../state/appStateStore';
import { toolNameToActionKind, isObservationTool, isActionTool } from './toolDefinitions';

export type ToolExecResult = {
  result: Record<string, unknown>;
  isError: boolean;
};

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  taskId: string,
): Promise<ToolExecResult> {
  try {
    // ── Observation tools (no side effects, except cookie reimport) ───
    if (isObservationTool(toolName)) {
      return await executeObservationTool(toolName, input);
    }

    // ── Action tools (route through SurfaceActionRouter) ──────────────
    if (isActionTool(toolName)) {
      return await executeActionTool(toolName, input, taskId);
    }

    return { result: { error: `Unknown tool: ${toolName}` }, isError: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { result: { error: message }, isError: true };
  }
}

// ─── Observation Tools ──────────────────────────────────────────────────

async function executeObservationTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<ToolExecResult> {
  switch (toolName) {
    case 'get_browser_state': {
      if (!browserService.isCreated()) {
        return { result: { status: 'not_initialized', tabs: [], url: '', title: '' }, isError: false };
      }
      const state = browserService.getState();
      return {
        result: {
          url: state.navigation.url,
          title: state.navigation.title,
          isLoading: state.navigation.isLoading,
          canGoBack: state.navigation.canGoBack,
          canGoForward: state.navigation.canGoForward,
          activeTabId: state.activeTabId,
          tabs: state.tabs.map(t => ({
            id: t.id,
            url: t.navigation.url,
            title: t.navigation.title,
            status: t.status,
          })),
          tabCount: state.tabs.length,
        },
        isError: false,
      };
    }

    case 'get_terminal_session': {
      const session = terminalService.getSession();
      if (!session) {
        return { result: { status: 'no_session', message: 'No terminal session is running' }, isError: false };
      }
      const cmdState = terminalService.getCommandState();
      const appCmdState = appStateStore.getState().terminalCommand;
      return {
        result: {
          id: session.id,
          pid: session.pid,
          shell: session.shell,
          cwd: cmdState.cwd || session.cwd,
          status: session.status,
          cols: session.cols,
          rows: session.rows,
          commandPhase: cmdState.phase,
          lastExitCode: cmdState.lastExitCode,
          lastCommand: appCmdState.lastDispatchedCommand,
          dispatching: appCmdState.dispatched,
          shellIntegrationActive: cmdState.cwd !== '',
        },
        isError: false,
      };
    }

    case 'reimport_chrome_cookies': {
      try {
        const result = await browserService.reimportChromeCookies();
        return {
          result: {
            imported: result.imported,
            failed: result.failed,
            domains: result.domains,
            message: `Re-imported ${result.imported} cookies from ${result.domains.length} domains`,
          },
          isError: false,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: { error: msg }, isError: true };
      }
    }

    case 'get_terminal_output': {
      const lines = typeof input.lines === 'number'
        ? Math.min(Math.max(1, Math.floor(input.lines)), 200)
        : 50;
      const output = terminalService.getRecentOutput(lines);
      return {
        result: {
          lines: output ? output.split('\n').length : 0,
          output: output || '(no recent output)',
        },
        isError: false,
      };
    }

    case 'get_page_text': {
      if (!browserService.isCreated()) {
        return { result: { text: '', error: 'Browser not initialized' }, isError: false };
      }
      const maxLen = typeof input.maxLength === 'number'
        ? Math.min(Math.max(100, Math.floor(input.maxLength)), 16000)
        : 8000;
      const text = await browserService.getPageText(maxLen);
      const state = browserService.getState();
      return {
        result: {
          url: state.navigation.url,
          title: state.navigation.title,
          text,
          truncated: text.length >= maxLen,
          charCount: text.length,
        },
        isError: false,
      };
    }

    case 'get_page_metadata': {
      if (!browserService.isCreated()) {
        return { result: { error: 'Browser not initialized' }, isError: false };
      }
      const metadata = await browserService.getPageMetadata(input.tabId as string | undefined);
      return { result: metadata, isError: false };
    }

    case 'query_selector': {
      if (!browserService.isCreated()) {
        return { result: { elements: [] }, isError: false };
      }
      const selector = input.selector as string;
      if (!selector) return { result: { error: 'selector is required' }, isError: true };
      const limit = typeof input.limit === 'number' ? Math.min(Math.max(1, input.limit), 50) : 20;
      const elements = await browserService.querySelectorAll(
        selector,
        input.tabId as string | undefined,
        limit,
      );
      return {
        result: { selector, matchCount: elements.length, elements },
        isError: false,
      };
    }

    case 'execute_js': {
      if (!browserService.isCreated()) {
        return { result: { error: 'Browser not initialized' }, isError: true };
      }
      const expression = input.expression as string;
      if (!expression) return { result: { error: 'expression is required' }, isError: true };
      const { result, error } = await browserService.executeInPage(
        expression,
        input.tabId as string | undefined,
      );
      if (error) return { result: { error }, isError: true };
      return { result: { value: result }, isError: false };
    }

    default:
      return { result: { error: `Unknown observation tool: ${toolName}` }, isError: true };
  }
}

// ─── Action Tools ───────────────────────────────────────────────────────

async function executeActionTool(
  toolName: string,
  input: Record<string, unknown>,
  taskId: string,
): Promise<ToolExecResult> {
  const actionKind = toolNameToActionKind(toolName);
  if (!actionKind) {
    return { result: { error: `No action kind for tool: ${toolName}` }, isError: true };
  }

  const target = targetForKind(actionKind);

  const record = await surfaceActionRouter.submit({
    target,
    kind: actionKind,
    payload: input,
    taskId,
    origin: 'model',
  });

  // Wait for the action to complete (it may be queued)
  const completed = await waitForActionCompletion(record.id, 30_000);

  if (completed.status === 'failed') {
    return {
      result: { error: completed.error || 'Action failed', actionId: completed.id },
      isError: true,
    };
  }

  return {
    result: completed.resultData || { summary: completed.resultSummary },
    isError: false,
  };
}

// ─── Wait for action completion ─────────────────────────────────────────

function waitForActionCompletion(
  actionId: string,
  timeoutMs: number,
): Promise<{ status: string; resultSummary: string | null; resultData: Record<string, unknown> | null; error: string | null; id: string }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    function check(): void {
      const state = appStateStore.getState();
      const record = state.surfaceActions.find(a => a.id === actionId);

      if (!record) {
        reject(new Error(`Action ${actionId} not found in state`));
        return;
      }

      if (record.status === 'completed' || record.status === 'failed') {
        resolve(record);
        return;
      }

      if (Date.now() - start > timeoutMs) {
        resolve({ ...record, status: 'failed', error: 'Action timed out' });
        return;
      }

      setTimeout(check, 50);
    }

    check();
  });
}
