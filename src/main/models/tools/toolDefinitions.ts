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
  'terminal_execute': 'terminal.execute',
  'terminal_write': 'terminal.write',
  'terminal_restart': 'terminal.restart',
  'terminal_interrupt': 'terminal.interrupt',
};

// Observation tools (no side effects, not routed through SurfaceActionRouter)
const OBSERVATION_TOOLS = [
  'get_browser_state', 'get_terminal_session', 'reimport_chrome_cookies',
  'get_terminal_output', 'get_page_text', 'get_page_metadata', 'query_selector', 'execute_js',
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

// ─── Browser Action Tools ─────────────────────────────────────────────────

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

// ─── Exports ──────────────────────────────────────────────────────────────

export const ALL_TOOL_DEFINITIONS: ToolDefinition[] = [
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
  // Session management
  REIMPORT_CHROME_COOKIES,
];

export const ACTION_TOOL_DEFINITIONS: ToolDefinition[] = ALL_TOOL_DEFINITIONS.filter(
  t => isActionTool(t.name),
);

export const OBSERVATION_TOOL_DEFINITIONS: ToolDefinition[] = ALL_TOOL_DEFINITIONS.filter(
  t => isObservationTool(t.name),
);
