// ═══════════════════════════════════════════════════════════════════════════
// Tool Definitions — Anthropic-compatible tool schemas for surface actions
// Maps 1:1 to the existing SurfaceActionKind system + observation queries
// ═══════════════════════════════════════════════════════════════════════════

import type { SurfaceActionKind } from '../../../shared/actions/surfaceActionTypes';

// ─── Tool Definition Type (Anthropic SDK compatible) ──────────────────────

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
};

export type ToolBundleName =
  | 'core'
  | 'browser-control'
  | 'browser-observation'
  | 'browser-research'
  | 'browser-strategy'
  | 'terminal-control'
  | 'terminal-observation';

// ─── Tool Name ↔ Action Kind Mapping ──────────────────────────────────────

const TOOL_TO_ACTION_KIND: Record<string, SurfaceActionKind> = {
  'browser_navigate': 'browser.navigate',
  'browser_back': 'browser.back',
  'browser_forward': 'browser.forward',
  'browser_reload': 'browser.reload',
  'browser_stop': 'browser.stop',
  'browser_create_tab': 'browser.create-tab',
  'browser_close_tab': 'browser.close-tab',
  'browser_activate_tab': 'browser.activate-tab',
  'click_element': 'browser.click',
  'type_in_element': 'browser.type',
  'dismiss_foreground_ui': 'browser.dismiss-foreground-ui',
  'return_to_primary_surface': 'browser.return-to-primary-surface',
  'click_ranked_action': 'browser.click-ranked-action',
  'wait_for_overlay_state': 'browser.wait-for-overlay-state',
  'open_search_results_tabs': 'browser.open-search-results-tabs',
  'terminal_execute': 'terminal.execute',
  'terminal_write': 'terminal.write',
  'terminal_restart': 'terminal.restart',
  'terminal_interrupt': 'terminal.interrupt',
};

// Observation tools (no side effects, not routed through SurfaceActionRouter)
const OBSERVATION_TOOLS = [
  'search_tools',
  'get_browser_state', 'get_terminal_session', 'reimport_chrome_cookies',
  'get_terminal_output', 'get_page_text', 'get_page_metadata', 'query_selector', 'execute_js',
  'capture_tab_snapshot', 'get_actionable_elements', 'get_form_model',
  'get_console_events', 'get_network_events', 'record_browser_finding', 'get_task_browser_memory',
  'get_task_memory', 'record_task_claim', 'record_task_evidence', 'record_task_critique', 'record_task_verification',
  'get_site_strategy', 'save_site_strategy', 'export_surface_eval_fixture',
  'extract_search_results', 'summarize_tab_working_set', 'extract_page_evidence',
  'compare_tabs', 'synthesize_research_brief',
] as const;
export type ObservationToolName = typeof OBSERVATION_TOOLS[number];

export function isObservationTool(name: string): name is ObservationToolName {
  return (OBSERVATION_TOOLS as readonly string[]).includes(name);
}

export function toolNameToActionKind(toolName: string): SurfaceActionKind | null {
  return TOOL_TO_ACTION_KIND[toolName] ?? null;
}

export function isActionTool(name: string): boolean {
  return name in TOOL_TO_ACTION_KIND;
}

export function categorizeTool(name: string): string {
  if (name === 'search_tools') return 'discovery';
  if (name.startsWith('browser_') || ['click_element', 'type_in_element', 'dismiss_foreground_ui', 'return_to_primary_surface', 'click_ranked_action', 'wait_for_overlay_state', 'open_search_results_tabs'].includes(name)) {
    return isActionTool(name) ? 'browser-action' : 'browser-observation';
  }
  if (name.startsWith('terminal_')) {
    return isActionTool(name) ? 'terminal-action' : 'terminal-observation';
  }
  if (name.startsWith('record_task_') || name === 'get_task_memory') return 'task-memory';
  if (name.startsWith('extract_') || name === 'compare_tabs' || name === 'synthesize_research_brief' || name === 'summarize_tab_working_set') return 'research';
  if (name.includes('site_strategy') || name.includes('surface_eval_fixture')) return 'browser-strategy';
  return isActionTool(name) ? 'action' : 'observation';
}

export function summarizeToolInput(tool: ToolDefinition): string {
  const required = new Set(tool.input_schema.required || []);
  return Object.entries(tool.input_schema.properties)
    .map(([name, spec]) => `${name}${required.has(name) ? '*' : ''}: ${spec.description}`)
    .join('; ');
}

export function searchToolDefinitions(
  query: string,
  options?: { limit?: number; category?: string; allowedToolNames?: string[] },
): ToolDefinition[] {
  const normalized = query.trim().toLowerCase();
  const limit = options?.limit ?? 8;
  const category = options?.category?.trim().toLowerCase();
  const allowedToolNames = options?.allowedToolNames ? new Set(options.allowedToolNames) : null;

  const scored = ALL_TOOL_DEFINITIONS
    .filter((tool) => !allowedToolNames || allowedToolNames.has(tool.name))
    .filter((tool) => !category || categorizeTool(tool.name) === category)
    .map((tool) => {
      const haystack = [
        tool.name,
        tool.description,
        summarizeToolInput(tool),
        categorizeTool(tool.name),
      ].join(' ').toLowerCase();

      let score = 0;
      if (!normalized) score = 1;
      if (tool.name.toLowerCase() === normalized) score += 20;
      if (tool.name.toLowerCase().includes(normalized)) score += 12;
      if (haystack.includes(normalized)) score += 8;

      const terms = normalized.split(/\s+/).filter(Boolean);
      for (const term of terms) {
        if (tool.name.toLowerCase().includes(term)) score += 6;
        if (haystack.includes(term)) score += 2;
      }

      // Bias toward sufficient page inspection for active-page investigation tasks.
      const isPageInvestigationTask =
        /\b(active page|investigate|inspect|analyze|understand|question in front of you|current page|page contents?)\b/.test(normalized);
      if (isPageInvestigationTask) {
        if (tool.name === 'capture_tab_snapshot') score += 18;
        if (tool.name === 'get_page_text') score += 16;
        if (tool.name === 'get_page_metadata') score += 12;
        if (tool.name === 'extract_page_evidence') score += 18;
        if (tool.name === 'get_browser_state') score += 4;
      }

      const isSearchResearchTask =
        /\b(search|results|sources|research|compare|brief|evidence)\b/.test(normalized);
      if (isSearchResearchTask) {
        if (tool.name === 'extract_search_results') score += 16;
        if (tool.name === 'open_search_results_tabs') score += 14;
        if (tool.name === 'extract_page_evidence') score += 16;
        if (tool.name === 'compare_tabs') score += 12;
        if (tool.name === 'synthesize_research_brief') score += 10;
      }

      const isVerificationTask =
        /\b(claim|evidence|critique|verification|verify|self-check)\b/.test(normalized);
      if (isVerificationTask) {
        if (tool.name === 'record_task_claim') score += 12;
        if (tool.name === 'record_task_evidence') score += 12;
        if (tool.name === 'record_task_critique') score += 12;
        if (tool.name === 'record_task_verification') score += 12;
      }

      return { tool, score };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));

  return scored.slice(0, limit).map(entry => entry.tool);
}

export function getCoreToolDefinitions(): ToolDefinition[] {
  const names = new Set([
    'search_tools',
    'get_task_memory',
    'record_task_claim',
    'record_task_evidence',
    'record_task_critique',
    'record_task_verification',
    'get_browser_state',
    'get_terminal_session',
  ]);
  return ALL_TOOL_DEFINITIONS.filter(tool => names.has(tool.name));
}

const TOOL_BUNDLES: Record<ToolBundleName, string[]> = {
  core: [
    'search_tools',
    'get_task_memory',
    'record_task_claim',
    'record_task_evidence',
    'record_task_critique',
    'record_task_verification',
  ],
  'browser-control': [
    'get_browser_state',
    'browser_navigate',
    'browser_back',
    'browser_forward',
    'browser_reload',
    'browser_stop',
    'browser_create_tab',
    'browser_close_tab',
    'browser_activate_tab',
    'click_element',
    'type_in_element',
    'dismiss_foreground_ui',
    'return_to_primary_surface',
    'click_ranked_action',
    'wait_for_overlay_state',
  ],
  'browser-observation': [
    'get_browser_state',
    'get_page_text',
    'get_page_metadata',
    'query_selector',
    'execute_js',
    'capture_tab_snapshot',
    'get_actionable_elements',
    'get_form_model',
    'get_console_events',
    'get_network_events',
    'record_browser_finding',
    'get_task_browser_memory',
    'reimport_chrome_cookies',
  ],
  'browser-research': [
    'capture_tab_snapshot',
    'extract_search_results',
    'open_search_results_tabs',
    'summarize_tab_working_set',
    'extract_page_evidence',
    'compare_tabs',
    'synthesize_research_brief',
  ],
  'browser-strategy': [
    'get_site_strategy',
    'save_site_strategy',
    'export_surface_eval_fixture',
  ],
  'terminal-control': [
    'terminal_execute',
    'terminal_write',
    'terminal_restart',
    'terminal_interrupt',
  ],
  'terminal-observation': [
    'get_terminal_session',
    'get_terminal_output',
  ],
};

export function getToolDefinitionsForBundles(bundleNames: ToolBundleName[]): ToolDefinition[] {
  const names = new Set<string>();
  for (const bundleName of bundleNames) {
    for (const toolName of TOOL_BUNDLES[bundleName] || []) {
      names.add(toolName);
    }
  }
  return ALL_TOOL_DEFINITIONS.filter(tool => names.has(tool.name));
}

export function inferToolBundlesForPrompt(prompt: string): ToolBundleName[] {
  const p = prompt.toLowerCase();
  const bundles = new Set<ToolBundleName>(['core']);

  if (/\b(browser|tab|page|navigate|click|form|overlay|site|snapshot)\b/.test(p)) {
    bundles.add('browser-control');
    bundles.add('browser-observation');
  }
  if (/\b(search|results|research|source|evidence|compare|brief)\b/.test(p)) {
    bundles.add('browser-observation');
    bundles.add('browser-research');
  }
  if (/\b(strategy|fixture|surface eval|surface evaluation|primary surface|panel keywords)\b/.test(p)) {
    bundles.add('browser-strategy');
  }
  if (/\b(terminal|shell|command|npm|pnpm|yarn|build|test|lint|git)\b/.test(p)) {
    bundles.add('terminal-control');
    bundles.add('terminal-observation');
  }

  return Array.from(bundles);
}

// ─── Browser Action Tools ─────────────────────────────────────────────────

const SEARCH_TOOLS: ToolDefinition = {
  name: 'search_tools',
  description: 'Search the host tool registry for the most relevant tools for the current task. Use this first when you are unsure which tool names to call.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What you want to do, e.g. "capture current tab snapshot", "compare tabs", or "record critique"' },
      category: { type: 'string', description: 'Optional tool category filter', enum: ['discovery', 'browser-action', 'browser-observation', 'terminal-action', 'terminal-observation', 'task-memory', 'research', 'browser-strategy', 'action', 'observation'] },
      limit: { type: 'number', description: 'Maximum number of matches to return (default: 8)' },
    },
    required: ['query'],
  },
};

const BROWSER_NAVIGATE: ToolDefinition = {
  name: 'browser_navigate',
  description: 'Navigate the browser to a URL. Use this to open websites, search engines, or any web address. The URL will load in the active tab.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to navigate to (e.g., "https://google.com" or "google.com")' },
    },
    required: ['url'],
  },
};

const BROWSER_BACK: ToolDefinition = {
  name: 'browser_back',
  description: 'Navigate the browser back to the previous page in history.',
  input_schema: { type: 'object', properties: {} },
};

const BROWSER_FORWARD: ToolDefinition = {
  name: 'browser_forward',
  description: 'Navigate the browser forward in history.',
  input_schema: { type: 'object', properties: {} },
};

const BROWSER_RELOAD: ToolDefinition = {
  name: 'browser_reload',
  description: 'Reload the current page in the browser.',
  input_schema: { type: 'object', properties: {} },
};

const BROWSER_STOP: ToolDefinition = {
  name: 'browser_stop',
  description: 'Stop the current page from loading.',
  input_schema: { type: 'object', properties: {} },
};

const BROWSER_CREATE_TAB: ToolDefinition = {
  name: 'browser_create_tab',
  description: 'Open a new browser tab. Optionally navigate to a URL immediately.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Optional URL to open in the new tab' },
    },
  },
};

const BROWSER_CLOSE_TAB: ToolDefinition = {
  name: 'browser_close_tab',
  description: 'Close a browser tab by its ID. Use get_browser_state first to see available tab IDs.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'The ID of the tab to close' },
    },
    required: ['tabId'],
  },
};

const BROWSER_ACTIVATE_TAB: ToolDefinition = {
  name: 'browser_activate_tab',
  description: 'Switch the browser to a different tab by its ID. Use get_browser_state first to see available tab IDs.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'The ID of the tab to activate' },
    },
    required: ['tabId'],
  },
};

const DISMISS_FOREGROUND_UI: ToolDefinition = {
  name: 'dismiss_foreground_ui',
  description: 'Dismiss the currently foregrounded overlay, dialog, dropdown, or drawer when possible. Use this when page interaction appears obstructed by transient UI.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
    },
  },
};

const RETURN_TO_PRIMARY_SURFACE: ToolDefinition = {
  name: 'return_to_primary_surface',
  description: 'Take the safest action to restore the main page surface when foreground UI is open. Prefer dismissing transient overlays instead of navigating away.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
    },
  },
};

const CLICK_RANKED_ACTION: ToolDefinition = {
  name: 'click_ranked_action',
  description: 'Click an actionable element chosen from the semantic snapshot ranking. Use actionId to target a specific ranked element, or index to choose by rank.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
      index: { type: 'number', description: '0-based ranked action index to click' },
      actionId: { type: 'string', description: 'Specific actionable element id from capture_tab_snapshot/get_actionable_elements' },
      preferDismiss: { type: 'boolean', description: 'Bias ranking toward dismiss/close actions when transient UI is open' },
    },
  },
};

const WAIT_FOR_OVERLAY_STATE: ToolDefinition = {
  name: 'wait_for_overlay_state',
  description: 'Wait for foreground overlay state to become open or closed using the semantic snapshot model.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
      state: { type: 'string', description: 'Desired overlay state', enum: ['open', 'closed'] },
      timeoutMs: { type: 'number', description: 'Optional timeout in milliseconds (default: 3000)' },
    },
    required: ['state'],
  },
};

const OPEN_SEARCH_RESULTS_TABS: ToolDefinition = {
  name: 'open_search_results_tabs',
  description: 'Open ranked search results from the active page into new tabs. Use this on search/result pages to build a research working set quickly.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'Optional tab ID containing the search results page' },
      indices: { type: 'string', description: 'Optional JSON array string of 0-based result indices to open, e.g. "[0,1,2]"' },
      limit: { type: 'number', description: 'Open the top N ranked results when indices are not provided (default: 3)' },
      activateFirst: { type: 'boolean', description: 'Whether to focus the first opened result tab instead of returning to the original tab' },
    },
  },
};

// ─── Terminal Action Tools ────────────────────────────────────────────────

const TERMINAL_EXECUTE: ToolDefinition = {
  name: 'terminal_execute',
  description: 'Execute a shell command in the terminal. The command is sent to the active terminal session with a newline appended. Use get_terminal_session to check if a session is running first.',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute (e.g., "ls -la", "npm test", "git status")' },
    },
    required: ['command'],
  },
};

const TERMINAL_WRITE: ToolDefinition = {
  name: 'terminal_write',
  description: 'Write raw input to the terminal without appending a newline. Use this for interactive prompts or sending partial input.',
  input_schema: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'The raw input to write to the terminal' },
    },
    required: ['input'],
  },
};

const TERMINAL_RESTART: ToolDefinition = {
  name: 'terminal_restart',
  description: 'Restart the terminal session. Kills the current shell process and starts a new one.',
  input_schema: { type: 'object', properties: {} },
};

const TERMINAL_INTERRUPT: ToolDefinition = {
  name: 'terminal_interrupt',
  description: 'Send an interrupt signal (Ctrl+C) to the terminal. Use this to stop a running command.',
  input_schema: { type: 'object', properties: {} },
};

// ─── Observation Tools (no side effects) ──────────────────────────────────

const GET_BROWSER_STATE: ToolDefinition = {
  name: 'get_browser_state',
  description: 'Get the current state of the browser: active URL, page title, list of open tabs, loading status, and navigation history availability. Call this before taking browser actions to understand the current state.',
  input_schema: { type: 'object', properties: {} },
};

const GET_TERMINAL_SESSION: ToolDefinition = {
  name: 'get_terminal_session',
  description: 'Get information about the current terminal session: shell type, process ID, working directory, dimensions, status, and last dispatched command. Call this to check if the terminal is running before executing commands.',
  input_schema: { type: 'object', properties: {} },
};

const REIMPORT_CHROME_COOKIES: ToolDefinition = {
  name: 'reimport_chrome_cookies',
  description: 'Re-import cookies from the user\'s Chrome browser into the app. Use this when a website shows a login error, session expired, or cookie problem. The user must be logged into the website in their real Chrome browser first.',
  input_schema: { type: 'object', properties: {} },
};

// ─── Terminal Observation Tools ──────────────────────────────────────────

const GET_TERMINAL_OUTPUT: ToolDefinition = {
  name: 'get_terminal_output',
  description: 'Get recent terminal output lines. Use after executing a command to see more output, or to check on a long-running process. Returns ANSI-stripped text.',
  input_schema: {
    type: 'object',
    properties: {
      lines: { type: 'number', description: 'Number of recent lines to return (default: 50, max: 200)' },
    },
  },
};

// ─── Browser Observation Tools ──────────────────────────────────────────

const GET_PAGE_TEXT: ToolDefinition = {
  name: 'get_page_text',
  description: 'Get the visible text content of the current browser page (document.body.innerText). Use after navigating to verify what loaded. Large pages are truncated.',
  input_schema: {
    type: 'object',
    properties: {
      maxLength: { type: 'number', description: 'Maximum characters to return (default: 8000, max: 16000)' },
    },
  },
};

const GET_PAGE_METADATA: ToolDefinition = {
  name: 'get_page_metadata',
  description: 'Get a structural overview of the current page: title, URL, meta description, headings, and counts of links, inputs, forms, and images. Use to understand page structure before interacting.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
    },
  },
};

const QUERY_SELECTOR: ToolDefinition = {
  name: 'query_selector',
  description: 'Find elements on the page by CSS selector. Returns an array of matching elements with their tag name, visible text (truncated), href, id, and CSS classes. Use to find buttons, links, inputs, or any element before clicking or typing.',
  input_schema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector (e.g., "button.submit", "a[href*=login]", "input[type=email]")' },
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
      limit: { type: 'number', description: 'Maximum elements to return (default: 20)' },
    },
    required: ['selector'],
  },
};

const CLICK_ELEMENT: ToolDefinition = {
  name: 'click_element',
  description: 'Click an element on the page by CSS selector. Use query_selector first to find the right selector. The first matching element is clicked.',
  input_schema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector for the element to click' },
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
    },
    required: ['selector'],
  },
};

const TYPE_IN_ELEMENT: ToolDefinition = {
  name: 'type_in_element',
  description: 'Type text into an input field or textarea by CSS selector. Sets the value, focuses the element, and dispatches input+change events. Use query_selector first to find the right selector.',
  input_schema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector for the input element' },
      text: { type: 'string', description: 'The text to type into the element' },
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
    },
    required: ['selector', 'text'],
  },
};

const EXECUTE_JS: ToolDefinition = {
  name: 'execute_js',
  description: 'Execute arbitrary JavaScript in the browser page context. Returns the expression result. Use for advanced page inspection or interaction not covered by other tools.',
  input_schema: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'JavaScript expression to evaluate in the page (e.g., "document.title", "document.querySelectorAll(\'li\').length")' },
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
    },
    required: ['expression'],
  },
};

const CAPTURE_TAB_SNAPSHOT: ToolDefinition = {
  name: 'capture_tab_snapshot',
  description: 'Capture a semantic snapshot of a browser tab. Returns the page URL, title, main heading, visible text excerpt, actionable elements, and forms. Use this as the primary browser perception tool.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
    },
  },
};

const GET_ACTIONABLE_ELEMENTS: ToolDefinition = {
  name: 'get_actionable_elements',
  description: 'Get a normalized list of actionable elements in the current tab: links, buttons, inputs, and other interactive affordances with selectors and visibility metadata.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
    },
  },
};

const GET_FORM_MODEL: ToolDefinition = {
  name: 'get_form_model',
  description: 'Get normalized form models for the current page, including fields, inferred purpose, submit labels, and input metadata.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
    },
  },
};

const GET_CONSOLE_EVENTS: ToolDefinition = {
  name: 'get_console_events',
  description: 'Get recent browser console events captured from a tab, including log level, message, and source location.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'Optional tab ID (defaults to all tracked tabs)' },
      since: { type: 'number', description: 'Optional unix timestamp in milliseconds to filter recent events' },
    },
  },
};

const GET_NETWORK_EVENTS: ToolDefinition = {
  name: 'get_network_events',
  description: 'Get recent browser network events captured from a tab, including method, URL, resource type, and status.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'Optional tab ID (defaults to all tracked tabs)' },
      since: { type: 'number', description: 'Optional unix timestamp in milliseconds to filter recent events' },
    },
  },
};

const RECORD_BROWSER_FINDING: ToolDefinition = {
  name: 'record_browser_finding',
  description: 'Persist a browser finding into task-bound browser memory. Use this when the agent discovers an important fact, blocker, or hypothesis while browsing.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
      title: { type: 'string', description: 'Short finding title' },
      summary: { type: 'string', description: 'Short factual summary of the finding' },
      severity: { type: 'string', description: 'Finding severity', enum: ['info', 'warning', 'critical'] },
      snapshotId: { type: 'string', description: 'Optional existing snapshot ID to associate with the finding' },
    },
    required: ['title', 'summary'],
  },
};

const GET_TASK_MEMORY: ToolDefinition = {
  name: 'get_task_memory',
  description: 'Get the unified task memory for the current task, including prior prompts, model outputs, browser findings, claims, evidence, and verification notes.',
  input_schema: { type: 'object', properties: {} },
};

const RECORD_TASK_CLAIM: ToolDefinition = {
  name: 'record_task_claim',
  description: 'Record a candidate claim into task memory. Use this before making substantive conclusions so later evidence and verification can reference it.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Concise candidate claim' },
      confidence: { type: 'number', description: 'Optional confidence from 0 to 1' },
      status: { type: 'string', description: 'Optional claim status', enum: ['candidate', 'supported', 'disputed', 'rejected'] },
    },
    required: ['text'],
  },
};

const RECORD_TASK_EVIDENCE: ToolDefinition = {
  name: 'record_task_evidence',
  description: 'Record compact evidence into task memory. Use for source-backed facts, observations, or counterevidence.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Short evidence statement' },
      source: { type: 'string', description: 'Optional source label or URL' },
      supports: { type: 'string', description: 'Optional note about what claim this supports or challenges' },
    },
    required: ['text'],
  },
};

const RECORD_TASK_CRITIQUE: ToolDefinition = {
  name: 'record_task_critique',
  description: 'Record a critique of the current draft answer. Use this to challenge correctness, identify what could break the answer, and assess overconfidence before finalizing.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Compact critique summary' },
      isCorrectLikely: { type: 'string', description: 'Whether the draft still looks likely correct after critique', enum: ['yes', 'no', 'unclear'] },
      overconfidenceRisk: { type: 'string', description: 'How overconfident the draft appears', enum: ['low', 'medium', 'high'] },
      breakageRisk: { type: 'string', description: 'What would most likely break or invalidate the draft answer' },
      nextCheck: { type: 'string', description: 'Optional next check the agent should perform before trusting the answer' },
    },
    required: ['text'],
  },
};

const RECORD_TASK_VERIFICATION: ToolDefinition = {
  name: 'record_task_verification',
  description: 'Record the verifier pass into task memory. Use this after challenging claims, sources, or process quality before finalizing an answer.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', description: 'Short verifier verdict', enum: ['pass', 'needs_more_evidence', 'contradicted', 'uncertain'] },
      text: { type: 'string', description: 'Compact verification summary' },
      nextStep: { type: 'string', description: 'Optional next step if verification failed or remains uncertain' },
      invalidationConditions: { type: 'string', description: 'What would invalidate this answer — specific conditions, evidence, or scenarios that would make the conclusion wrong' },
    },
    required: ['verdict', 'text'],
  },
};

const GET_TASK_BROWSER_MEMORY: ToolDefinition = {
  name: 'get_task_browser_memory',
  description: 'Get the accumulated browser findings and touched tabs recorded for the current task.',
  input_schema: { type: 'object', properties: {} },
};

const GET_SITE_STRATEGY: ToolDefinition = {
  name: 'get_site_strategy',
  description: 'Get the origin-scoped browser site strategy used to bias primary-surface and panel detection. Use this to inspect current site-specific hints before tuning perception.',
  input_schema: {
    type: 'object',
    properties: {
      origin: { type: 'string', description: 'Site origin such as "https://www.tiktok.com". If omitted, uses the active tab origin.' },
      tabId: { type: 'string', description: 'Optional tab ID used to infer the origin when origin is omitted.' },
    },
  },
};

const SAVE_SITE_STRATEGY: ToolDefinition = {
  name: 'save_site_strategy',
  description: 'Create or update the site strategy for an origin. Use this to add primary routes, labels, and panel keywords after repeated perception failures on a site.',
  input_schema: {
    type: 'object',
    properties: {
      origin: { type: 'string', description: 'Site origin such as "https://www.tiktok.com"' },
      primaryRoutes: { type: 'string', description: 'Optional JSON array string of primary route prefixes for this site' },
      primaryLabels: { type: 'string', description: 'Optional JSON array string of labels that strongly indicate the primary surface' },
      panelKeywords: { type: 'string', description: 'Optional JSON array string of keywords that indicate embedded panels or activity surfaces' },
      notes: { type: 'string', description: 'Optional JSON array string of short operator notes about the site strategy' },
    },
    required: ['origin'],
  },
};

const EXPORT_SURFACE_EVAL_FIXTURE: ToolDefinition = {
  name: 'export_surface_eval_fixture',
  description: 'Export the current tab perception evidence and resolved surface classification as a reusable evaluation fixture. Use this after a failed or interesting browser state to add it to the calibration corpus.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Fixture name, e.g. "tiktok-activity-open"' },
      tabId: { type: 'string', description: 'Optional tab ID (defaults to active tab)' },
    },
    required: ['name'],
  },
};

const EXTRACT_SEARCH_RESULTS: ToolDefinition = {
  name: 'extract_search_results',
  description: 'Extract and rank likely search results from the active page. Returns titles, URLs, snippets, selectors, and ranking indexes for use in cross-tab research.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'Optional tab ID containing the search/results page' },
      limit: { type: 'number', description: 'Maximum number of ranked results to return (default: 10)' },
    },
  },
};

const SUMMARIZE_TAB_WORKING_SET: ToolDefinition = {
  name: 'summarize_tab_working_set',
  description: 'Summarize a set of browser tabs as a research working set using semantic snapshots. Returns each tab URL, title, heading, active surface, and a short excerpt.',
  input_schema: {
    type: 'object',
    properties: {
      tabIds: { type: 'string', description: 'Optional JSON array string of tab IDs. If omitted, summarizes all open tabs.' },
    },
  },
};

const EXTRACT_PAGE_EVIDENCE: ToolDefinition = {
  name: 'extract_page_evidence',
  description: 'Extract research-oriented evidence from a tab: summary, key factual sentences, quotes, dates, and source links. Use this after opening result tabs.',
  input_schema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'Optional tab ID to analyze (defaults to active tab)' },
    },
  },
};

const COMPARE_TABS: ToolDefinition = {
  name: 'compare_tabs',
  description: 'Compare a set of tabs using extracted evidence. Returns per-tab evidence plus shared terms, mentioned dates, and headings.',
  input_schema: {
    type: 'object',
    properties: {
      tabIds: { type: 'string', description: 'Optional JSON array string of tab IDs. If omitted, compares all open tabs.' },
    },
  },
};

const SYNTHESIZE_RESEARCH_BRIEF: ToolDefinition = {
  name: 'synthesize_research_brief',
  description: 'Synthesize a compact cross-tab research brief from the current working set. Returns narrative summary, key findings, shared themes, dates, and sources.',
  input_schema: {
    type: 'object',
    properties: {
      tabIds: { type: 'string', description: 'Optional JSON array string of tab IDs. If omitted, uses all open tabs.' },
      question: { type: 'string', description: 'Optional research question to anchor the brief' },
    },
  },
};

// ─── Exports ──────────────────────────────────────────────────────────────

export const ALL_TOOL_DEFINITIONS: ToolDefinition[] = [
  SEARCH_TOOLS,
  // Browser actions
  BROWSER_NAVIGATE,
  BROWSER_BACK,
  BROWSER_FORWARD,
  BROWSER_RELOAD,
  BROWSER_STOP,
  BROWSER_CREATE_TAB,
  BROWSER_CLOSE_TAB,
  BROWSER_ACTIVATE_TAB,
  CLICK_ELEMENT,
  TYPE_IN_ELEMENT,
  DISMISS_FOREGROUND_UI,
  RETURN_TO_PRIMARY_SURFACE,
  CLICK_RANKED_ACTION,
  WAIT_FOR_OVERLAY_STATE,
  OPEN_SEARCH_RESULTS_TABS,
  // Terminal actions
  TERMINAL_EXECUTE,
  TERMINAL_WRITE,
  TERMINAL_RESTART,
  TERMINAL_INTERRUPT,
  // Observation
  GET_BROWSER_STATE,
  GET_TERMINAL_SESSION,
  GET_TERMINAL_OUTPUT,
  GET_PAGE_TEXT,
  GET_PAGE_METADATA,
  QUERY_SELECTOR,
  EXECUTE_JS,
  CAPTURE_TAB_SNAPSHOT,
  GET_ACTIONABLE_ELEMENTS,
  GET_FORM_MODEL,
  GET_CONSOLE_EVENTS,
  GET_NETWORK_EVENTS,
  RECORD_BROWSER_FINDING,
  GET_TASK_BROWSER_MEMORY,
  GET_TASK_MEMORY,
  RECORD_TASK_CLAIM,
  RECORD_TASK_EVIDENCE,
  RECORD_TASK_CRITIQUE,
  RECORD_TASK_VERIFICATION,
  GET_SITE_STRATEGY,
  SAVE_SITE_STRATEGY,
  EXPORT_SURFACE_EVAL_FIXTURE,
  EXTRACT_SEARCH_RESULTS,
  SUMMARIZE_TAB_WORKING_SET,
  EXTRACT_PAGE_EVIDENCE,
  COMPARE_TABS,
  SYNTHESIZE_RESEARCH_BRIEF,
  // Session management
  REIMPORT_CHROME_COOKIES,
];

export const ACTION_TOOL_DEFINITIONS: ToolDefinition[] = ALL_TOOL_DEFINITIONS.filter(
  t => isActionTool(t.name),
);

export const OBSERVATION_TOOL_DEFINITIONS: ToolDefinition[] = ALL_TOOL_DEFINITIONS.filter(
  t => isObservationTool(t.name),
);
