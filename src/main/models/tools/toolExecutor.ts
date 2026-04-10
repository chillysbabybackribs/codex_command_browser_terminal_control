// ═══════════════════════════════════════════════════════════════════════════
// Tool Executor — Bridges model tool calls to SurfaceActionRouter + queries
// ═══════════════════════════════════════════════════════════════════════════

import { surfaceActionRouter } from '../../actions/SurfaceActionRouter';
import { targetForKind } from '../../../shared/actions/surfaceActionTypes';
import { browserService } from '../../browser/BrowserService';
import { terminalService } from '../../terminal/TerminalService';
import { appStateStore } from '../../state/appStateStore';
import {
  toolNameToActionKind,
  isObservationTool,
  isActionTool,
  searchToolDefinitions,
  categorizeTool,
  summarizeToolInput,
} from './toolDefinitions';
import { taskMemoryStore } from '../taskMemoryStore';

export type ToolExecResult = {
  result: Record<string, unknown>;
  isError: boolean;
};

type ToolExecOptions = {
  allowedToolNames?: string[];
};

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  taskId: string,
  options?: ToolExecOptions,
): Promise<ToolExecResult> {
  try {
    const allowedToolNames = options?.allowedToolNames;
    if (allowedToolNames && !allowedToolNames.includes(toolName)) {
      return {
        result: {
          error: `Tool not allowed in this invocation scope: ${toolName}`,
          allowedToolNames,
        },
        isError: true,
      };
    }

    // ── Observation tools (no side effects, except cookie reimport) ───
    if (isObservationTool(toolName)) {
      return await executeObservationTool(toolName, input, taskId, allowedToolNames);
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

function parseStringArrayField(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(item => String(item)) : undefined;
  } catch {
    return undefined;
  }
}

function parseNumberArrayField(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map(item => Number(item)).filter(item => Number.isFinite(item)).map(item => Math.floor(item))
      : undefined;
  } catch {
    return undefined;
  }
}

// ─── Observation Tools ──────────────────────────────────────────────────

async function executeObservationTool(
  toolName: string,
  input: Record<string, unknown>,
  taskId: string,
  allowedToolNames?: string[],
): Promise<ToolExecResult> {
  switch (toolName) {
    case 'search_tools': {
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      if (!query) return { result: { error: 'query is required' }, isError: true };
      const limit = typeof input.limit === 'number' ? Math.max(1, Math.floor(input.limit)) : 8;
      const category = typeof input.category === 'string' ? input.category : undefined;
      const matches = searchToolDefinitions(query, { limit, category, allowedToolNames }).map((tool) => ({
        name: tool.name,
        description: tool.description,
        category: categorizeTool(tool.name),
        inputSummary: summarizeToolInput(tool),
      }));
      return { result: { query, category: category || null, matches }, isError: false };
    }

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
        ? Math.max(1, Math.floor(input.lines))
        : 200;
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
        ? Math.max(100, Math.floor(input.maxLength))
        : 50000;
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
      const limit = typeof input.limit === 'number' ? Math.max(1, Math.floor(input.limit)) : 200;
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

    case 'capture_tab_snapshot': {
      if (!browserService.isCreated()) {
        return { result: { error: 'Browser not initialized' }, isError: false };
      }
      const snapshot = await browserService.captureTabSnapshot(input.tabId as string | undefined);
      return { result: snapshot as unknown as Record<string, unknown>, isError: false };
    }

    case 'get_actionable_elements': {
      if (!browserService.isCreated()) {
        return { result: { elements: [] }, isError: false };
      }
      const elements = await browserService.getActionableElements(input.tabId as string | undefined);
      return { result: { elements }, isError: false };
    }

    case 'get_form_model': {
      if (!browserService.isCreated()) {
        return { result: { forms: [] }, isError: false };
      }
      const forms = await browserService.getFormModel(input.tabId as string | undefined);
      return { result: { forms }, isError: false };
    }

    case 'get_console_events': {
      const tabId = typeof input.tabId === 'string' ? input.tabId : undefined;
      const since = typeof input.since === 'number' ? input.since : undefined;
      const events = browserService.getConsoleEvents(tabId, since);
      return { result: { events }, isError: false };
    }

    case 'get_network_events': {
      const tabId = typeof input.tabId === 'string' ? input.tabId : undefined;
      const since = typeof input.since === 'number' ? input.since : undefined;
      const events = browserService.getNetworkEvents(tabId, since);
      return { result: { events }, isError: false };
    }

    case 'record_browser_finding': {
      if (!browserService.isCreated()) {
        return { result: { error: 'Browser not initialized' }, isError: true };
      }
      const title = input.title as string;
      const summary = input.summary as string;
      if (!title || !summary) {
        return { result: { error: 'title and summary are required' }, isError: true };
      }
      const finding = await browserService.recordTabFinding({
        taskId,
        tabId: input.tabId as string | undefined,
        title,
        summary,
        severity: input.severity as 'info' | 'warning' | 'critical' | undefined,
        snapshotId: input.snapshotId as string | undefined,
      });
      return { result: finding as unknown as Record<string, unknown>, isError: false };
    }

    case 'get_task_browser_memory': {
      const memory = browserService.getTaskBrowserMemory(taskId);
      return { result: memory as unknown as Record<string, unknown>, isError: false };
    }

    case 'get_task_memory': {
      const memory = taskMemoryStore.get(taskId);
      return { result: memory as unknown as Record<string, unknown>, isError: false };
    }

    case 'record_task_claim': {
      const text = typeof input.text === 'string' ? input.text.trim() : '';
      if (!text) return { result: { error: 'text is required' }, isError: true };
      const memory = taskMemoryStore.recordClaim(taskId, text, {
        confidence: typeof input.confidence === 'number' ? input.confidence : undefined,
        status: typeof input.status === 'string' ? input.status : 'candidate',
      });
      return { result: memory as unknown as Record<string, unknown>, isError: false };
    }

    case 'record_task_evidence': {
      const text = typeof input.text === 'string' ? input.text.trim() : '';
      if (!text) return { result: { error: 'text is required' }, isError: true };
      const memory = taskMemoryStore.recordEvidence(taskId, text, {
        source: typeof input.source === 'string' ? input.source : undefined,
        supports: typeof input.supports === 'string' ? input.supports : undefined,
      });
      return { result: memory as unknown as Record<string, unknown>, isError: false };
    }

    case 'record_task_critique': {
      const text = typeof input.text === 'string' ? input.text.trim() : '';
      if (!text) return { result: { error: 'text is required' }, isError: true };
      const memory = taskMemoryStore.recordCritique(taskId, text, {
        isCorrectLikely: typeof input.isCorrectLikely === 'string' ? input.isCorrectLikely : undefined,
        overconfidenceRisk: typeof input.overconfidenceRisk === 'string' ? input.overconfidenceRisk : undefined,
        breakageRisk: typeof input.breakageRisk === 'string' ? input.breakageRisk : undefined,
        nextCheck: typeof input.nextCheck === 'string' ? input.nextCheck : undefined,
      });
      return { result: memory as unknown as Record<string, unknown>, isError: false };
    }

    case 'record_task_verification': {
      const verdict = typeof input.verdict === 'string' ? input.verdict : '';
      const text = typeof input.text === 'string' ? input.text.trim() : '';
      if (!verdict || !text) return { result: { error: 'verdict and text are required' }, isError: true };
      const memory = taskMemoryStore.recordVerification(taskId, text, {
        verdict,
        nextStep: typeof input.nextStep === 'string' ? input.nextStep : undefined,
        invalidationConditions: typeof input.invalidationConditions === 'string' ? input.invalidationConditions : undefined,
      });
      return { result: memory as unknown as Record<string, unknown>, isError: false };
    }

    case 'get_site_strategy': {
      let origin = typeof input.origin === 'string' ? input.origin : '';
      if (!origin) {
        const state = browserService.getState();
        const fallbackUrl = typeof input.tabId === 'string'
          ? state.tabs.find(tab => tab.id === input.tabId)?.navigation.url
          : state.navigation.url;
        if (fallbackUrl) {
          try {
            origin = new URL(fallbackUrl).origin;
          } catch {
            origin = '';
          }
        }
      }
      if (!origin) {
        return { result: { strategy: null, error: 'No origin available' }, isError: true };
      }
      return { result: { strategy: browserService.getSiteStrategy(origin) }, isError: false };
    }

    case 'save_site_strategy': {
      const origin = typeof input.origin === 'string' ? input.origin : '';
      if (!origin) {
        return { result: { error: 'origin is required' }, isError: true };
      }
      const strategy = browserService.saveSiteStrategy({
        origin,
        primaryRoutes: parseStringArrayField(input.primaryRoutes),
        primaryLabels: parseStringArrayField(input.primaryLabels),
        panelKeywords: parseStringArrayField(input.panelKeywords),
        notes: parseStringArrayField(input.notes),
      });
      return { result: { strategy }, isError: false };
    }

    case 'export_surface_eval_fixture': {
      if (!browserService.isCreated()) {
        return { result: { error: 'Browser not initialized' }, isError: true };
      }
      const name = typeof input.name === 'string' ? input.name : '';
      if (!name) {
        return { result: { error: 'name is required' }, isError: true };
      }
      const fixture = await browserService.exportSurfaceEvalFixture({
        name,
        tabId: input.tabId as string | undefined,
      });
      return { result: fixture as unknown as Record<string, unknown>, isError: false };
    }

    case 'extract_search_results': {
      if (!browserService.isCreated()) {
        return { result: { results: [], error: 'Browser not initialized' }, isError: true };
      }
      const limit = typeof input.limit === 'number' ? Math.max(1, Math.floor(input.limit)) : 10;
      const results = await browserService.extractSearchResults(input.tabId as string | undefined, limit);
      return { result: { results }, isError: false };
    }

    case 'summarize_tab_working_set': {
      if (!browserService.isCreated()) {
        return { result: { tabs: [], error: 'Browser not initialized' }, isError: true };
      }
      const tabIds = parseStringArrayField(input.tabIds);
      const tabs = await browserService.summarizeTabWorkingSet(tabIds);
      return { result: { tabs }, isError: false };
    }

    case 'extract_page_evidence': {
      if (!browserService.isCreated()) {
        return { result: { error: 'Browser not initialized' }, isError: true };
      }
      const evidence = await browserService.extractPageEvidence(input.tabId as string | undefined);
      return evidence
        ? { result: evidence as unknown as Record<string, unknown>, isError: false }
        : { result: { error: 'No tab available' }, isError: true };
    }

    case 'compare_tabs': {
      if (!browserService.isCreated()) {
        return { result: { error: 'Browser not initialized' }, isError: true };
      }
      const tabIds = parseStringArrayField(input.tabIds);
      const comparison = await browserService.compareTabs(tabIds);
      return { result: comparison, isError: false };
    }

    case 'synthesize_research_brief': {
      if (!browserService.isCreated()) {
        return { result: { error: 'Browser not initialized' }, isError: true };
      }
      const tabIds = parseStringArrayField(input.tabIds);
      const brief = await browserService.synthesizeResearchBrief({
        tabIds,
        question: typeof input.question === 'string' ? input.question : undefined,
      });
      return { result: brief, isError: false };
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

  const normalizedInput = toolName === 'open_search_results_tabs'
    ? {
        ...input,
        indices: parseNumberArrayField(input.indices) ?? input.indices,
      }
    : input;

  const record = await surfaceActionRouter.submit({
    target,
    kind: actionKind,
    payload: normalizedInput,
    taskId,
    origin: 'model',
  });

  // Wait for the action to complete (it may be queued)
  const completed = await waitForActionCompletion(record.id, 120_000);

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
