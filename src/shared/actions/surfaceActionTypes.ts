// ═══════════════════════════════════════════════════════════════════════════
// Surface Action Type System — Typed contracts for orchestrated control
// ═══════════════════════════════════════════════════════════════════════════

import { SurfaceRole } from '../types/windowRoles';

// ─── Targets ──────────────────────────────────────────────────────────────

export type SurfaceTarget = SurfaceRole; // 'browser' | 'terminal'

// ─── Lifecycle ────────────────────────────────────────────────────────────

export type SurfaceActionStatus = 'queued' | 'running' | 'completed' | 'failed';

// ─── Action Kinds ─────────────────────────────────────────────────────────

export type BrowserActionKind =
  | 'browser.navigate'
  | 'browser.back'
  | 'browser.forward'
  | 'browser.reload'
  | 'browser.stop'
  | 'browser.create-tab'
  | 'browser.close-tab'
  | 'browser.activate-tab';

export type TerminalActionKind =
  | 'terminal.execute'
  | 'terminal.write'
  | 'terminal.restart'
  | 'terminal.interrupt';

export type SurfaceActionKind = BrowserActionKind | TerminalActionKind;

// ─── Action Origin ────────────────────────────────────────────────────────

export type SurfaceActionOrigin = 'command-center' | 'system';

// ─── Typed Payloads ───────────────────────────────────────────────────────

export type BrowserNavigatePayload = { url: string };
export type BrowserCreateTabPayload = { url?: string };
export type BrowserCloseTabPayload = { tabId: string };
export type BrowserActivateTabPayload = { tabId: string };
export type BrowserEmptyPayload = Record<string, never>;

export type TerminalExecutePayload = { command: string };
export type TerminalWritePayload = { input: string };
export type TerminalEmptyPayload = Record<string, never>;

export type SurfaceActionPayloadMap = {
  'browser.navigate': BrowserNavigatePayload;
  'browser.back': BrowserEmptyPayload;
  'browser.forward': BrowserEmptyPayload;
  'browser.reload': BrowserEmptyPayload;
  'browser.stop': BrowserEmptyPayload;
  'browser.create-tab': BrowserCreateTabPayload;
  'browser.close-tab': BrowserCloseTabPayload;
  'browser.activate-tab': BrowserActivateTabPayload;
  'terminal.execute': TerminalExecutePayload;
  'terminal.write': TerminalWritePayload;
  'terminal.restart': TerminalEmptyPayload;
  'terminal.interrupt': TerminalEmptyPayload;
};

// ─── Typed Results ────────────────────────────────────────────────────────

export type BrowserNavigateResult = {
  url: string;
  title: string;
  success: boolean;
  error?: string;
};

export type BrowserEmptyResult = { success: boolean };

export type BrowserCreateTabResult = {
  tabId: string;
  url: string;
};

export type BrowserCloseTabResult = {
  tabId: string;
  closed: boolean;
};

export type BrowserActivateTabResult = {
  tabId: string;
  activated: boolean;
};

export type TerminalExecuteResult = {
  sessionId: string;
  commandAccepted: boolean;
  error?: string;
};

export type TerminalWriteResult = {
  sessionId: string;
  written: boolean;
  error?: string;
};

export type TerminalRestartResult = {
  sessionId: string;
  success: boolean;
  error?: string;
};

export type TerminalInterruptResult = {
  sessionId: string;
  sent: boolean;
  error?: string;
};

export type SurfaceActionResultMap = {
  'browser.navigate': BrowserNavigateResult;
  'browser.back': BrowserEmptyResult;
  'browser.forward': BrowserEmptyResult;
  'browser.reload': BrowserEmptyResult;
  'browser.stop': BrowserEmptyResult;
  'browser.create-tab': BrowserCreateTabResult;
  'browser.close-tab': BrowserCloseTabResult;
  'browser.activate-tab': BrowserActivateTabResult;
  'terminal.execute': TerminalExecuteResult;
  'terminal.write': TerminalWriteResult;
  'terminal.restart': TerminalRestartResult;
  'terminal.interrupt': TerminalInterruptResult;
};

// ─── Core Action Model ───────────────────────────────────────────────────

export type SurfaceAction<K extends SurfaceActionKind = SurfaceActionKind> = {
  id: string;
  target: SurfaceTarget;
  kind: K;
  status: SurfaceActionStatus;
  origin: SurfaceActionOrigin;
  payload: SurfaceActionPayloadMap[K];
  createdAt: number;
  updatedAt: number;
  taskId: string | null;
};

// ─── Action Record (for state/display — no raw output) ───────────────────

export type SurfaceActionRecord = {
  id: string;
  target: SurfaceTarget;
  kind: SurfaceActionKind;
  status: SurfaceActionStatus;
  origin: SurfaceActionOrigin;
  payloadSummary: string;
  resultSummary: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  taskId: string | null;
};

// ─── Action Input (renderer submits this) ─────────────────────────────────

export type SurfaceActionInput<K extends SurfaceActionKind = SurfaceActionKind> = {
  target: SurfaceTarget;
  kind: K;
  payload: SurfaceActionPayloadMap[K];
  taskId?: string | null;
  origin?: SurfaceActionOrigin;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

export function targetForKind(kind: SurfaceActionKind): SurfaceTarget {
  return kind.startsWith('browser.') ? 'browser' : 'terminal';
}

export function summarizePayload(kind: SurfaceActionKind, payload: Record<string, unknown>): string {
  switch (kind) {
    case 'browser.navigate': return `Navigate to ${(payload as BrowserNavigatePayload).url}`;
    case 'browser.back': return 'Go back';
    case 'browser.forward': return 'Go forward';
    case 'browser.reload': return 'Reload page';
    case 'browser.stop': return 'Stop loading';
    case 'browser.create-tab': {
      const url = (payload as BrowserCreateTabPayload).url;
      return url ? `Open tab: ${url}` : 'Open new tab';
    }
    case 'browser.close-tab': return `Close tab ${(payload as BrowserCloseTabPayload).tabId}`;
    case 'browser.activate-tab': return `Switch to tab ${(payload as BrowserActivateTabPayload).tabId}`;
    case 'terminal.execute': return `Execute: ${(payload as TerminalExecutePayload).command}`;
    case 'terminal.write': return `Write: ${(payload as TerminalWritePayload).input}`;
    case 'terminal.restart': return 'Restart terminal';
    case 'terminal.interrupt': return 'Send interrupt (Ctrl+C)';
    default: return kind;
  }
}

export const BROWSER_ACTION_KINDS: BrowserActionKind[] = [
  'browser.navigate', 'browser.back', 'browser.forward', 'browser.reload', 'browser.stop',
  'browser.create-tab', 'browser.close-tab', 'browser.activate-tab',
];

export const TERMINAL_ACTION_KINDS: TerminalActionKind[] = [
  'terminal.execute', 'terminal.write', 'terminal.restart', 'terminal.interrupt',
];

export const ALL_ACTION_KINDS: SurfaceActionKind[] = [
  ...BROWSER_ACTION_KINDS,
  ...TERMINAL_ACTION_KINDS,
];
