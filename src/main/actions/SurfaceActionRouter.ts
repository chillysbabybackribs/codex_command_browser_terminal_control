// ═══════════════════════════════════════════════════════════════════════════
// Surface Action Router — Main-process orchestration layer
// ═══════════════════════════════════════════════════════════════════════════
//
// Receives action inputs, validates, persists to state, routes to the
// correct runtime service, captures results, and emits lifecycle events.

import {
  SurfaceAction, SurfaceActionInput, SurfaceActionRecord,
  SurfaceActionKind, SurfaceActionStatus,
  SurfaceActionPayloadMap, SurfaceActionResultMap,
  targetForKind, summarizePayload,
  BrowserNavigatePayload, BrowserCloseTabPayload,
  BrowserActivateTabPayload,
  TerminalExecutePayload, TerminalWritePayload,
} from '../../shared/actions/surfaceActionTypes';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { generateId } from '../../shared/utils/ids';
import { executeBrowserAction } from './browserActionExecutor';
import { executeTerminalAction } from './terminalActionExecutor';

const MAX_ACTIONS = 200;

class SurfaceActionRouter {
  private activeActions: Map<string, SurfaceAction> = new Map();

  async submit<K extends SurfaceActionKind>(input: SurfaceActionInput<K>): Promise<SurfaceActionRecord> {
    // Validate target matches kind
    const expectedTarget = targetForKind(input.kind);
    if (input.target !== expectedTarget) {
      throw new Error(`Action kind "${input.kind}" requires target "${expectedTarget}", got "${input.target}"`);
    }

    // Validate payload
    this.validatePayload(input.kind, input.payload);

    // Create the action
    const now = Date.now();
    const action: SurfaceAction<K> = {
      id: generateId('sa'),
      target: input.target,
      kind: input.kind,
      status: 'queued',
      origin: input.origin || 'command-center',
      payload: input.payload,
      createdAt: now,
      updatedAt: now,
      taskId: input.taskId ?? null,
    };

    // Create the record for state
    const record = this.toRecord(action);

    // Persist to state
    appStateStore.dispatch({ type: ActionType.ADD_SURFACE_ACTION, record });

    // Emit submitted event
    eventBus.emit(AppEventType.SURFACE_ACTION_SUBMITTED, { record: { ...record } });

    // Log the action
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: now,
        level: 'info',
        source: action.target,
        message: `Action submitted: ${record.payloadSummary}`,
        taskId: action.taskId ?? undefined,
      },
    });

    // Track and execute
    this.activeActions.set(action.id, action as SurfaceAction);
    this.executeAction(action as SurfaceAction);

    return { ...record };
  }

  getRecentActions(limit: number = 50): SurfaceActionRecord[] {
    const state = appStateStore.getState();
    return state.surfaceActions.slice(-limit);
  }

  getActionsByTarget(target: 'browser' | 'terminal', limit: number = 50): SurfaceActionRecord[] {
    const state = appStateStore.getState();
    return state.surfaceActions.filter(a => a.target === target).slice(-limit);
  }

  getActionsByTask(taskId: string): SurfaceActionRecord[] {
    const state = appStateStore.getState();
    return state.surfaceActions.filter(a => a.taskId === taskId);
  }

  private async executeAction(action: SurfaceAction): Promise<void> {
    const id = action.id;

    // Transition to running
    this.updateStatus(id, 'running');
    eventBus.emit(AppEventType.SURFACE_ACTION_STARTED, { record: this.getCurrentRecord(id) });

    try {
      let resultSummary: string;

      if (action.target === 'browser') {
        resultSummary = await executeBrowserAction(action.kind, action.payload);
      } else {
        resultSummary = await executeTerminalAction(action.kind, action.payload);
      }

      // Transition to completed
      this.updateRecord(id, { status: 'completed', resultSummary, updatedAt: Date.now() });
      eventBus.emit(AppEventType.SURFACE_ACTION_COMPLETED, { record: this.getCurrentRecord(id) });

      appStateStore.dispatch({
        type: ActionType.ADD_LOG,
        log: {
          id: generateId('log'),
          timestamp: Date.now(),
          level: 'info',
          source: action.target,
          message: `Action completed: ${resultSummary}`,
          taskId: action.taskId ?? undefined,
        },
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Transition to failed
      this.updateRecord(id, { status: 'failed', error: errorMsg, updatedAt: Date.now() });
      eventBus.emit(AppEventType.SURFACE_ACTION_FAILED, { record: this.getCurrentRecord(id) });

      appStateStore.dispatch({
        type: ActionType.ADD_LOG,
        log: {
          id: generateId('log'),
          timestamp: Date.now(),
          level: 'error',
          source: action.target,
          message: `Action failed: ${errorMsg}`,
          taskId: action.taskId ?? undefined,
        },
      });
    } finally {
      this.activeActions.delete(id);
    }
  }

  private validatePayload(kind: SurfaceActionKind, payload: Record<string, unknown>): void {
    switch (kind) {
      case 'browser.navigate': {
        const p = payload as BrowserNavigatePayload;
        if (!p.url || typeof p.url !== 'string' || p.url.trim().length === 0) {
          throw new Error('browser.navigate requires a non-empty "url" string');
        }
        break;
      }
      case 'terminal.execute': {
        const p = payload as TerminalExecutePayload;
        if (!p.command || typeof p.command !== 'string' || p.command.trim().length === 0) {
          throw new Error('terminal.execute requires a non-empty "command" string');
        }
        break;
      }
      case 'terminal.write': {
        const p = payload as TerminalWritePayload;
        if (typeof p.input !== 'string') {
          throw new Error('terminal.write requires an "input" string');
        }
        break;
      }
      case 'browser.close-tab': {
        const p = payload as BrowserCloseTabPayload;
        if (!p.tabId || typeof p.tabId !== 'string') {
          throw new Error('browser.close-tab requires a non-empty "tabId" string');
        }
        break;
      }
      case 'browser.activate-tab': {
        const p = payload as BrowserActivateTabPayload;
        if (!p.tabId || typeof p.tabId !== 'string') {
          throw new Error('browser.activate-tab requires a non-empty "tabId" string');
        }
        break;
      }
      // Empty/optional payloads: browser.back, browser.forward, browser.reload, browser.stop, browser.create-tab, terminal.restart, terminal.interrupt
      default:
        break;
    }
  }

  private updateStatus(id: string, status: SurfaceActionStatus): void {
    appStateStore.dispatch({
      type: ActionType.UPDATE_SURFACE_ACTION,
      id,
      updates: { status, updatedAt: Date.now() },
    });
  }

  private updateRecord(id: string, updates: Partial<Pick<SurfaceActionRecord, 'status' | 'resultSummary' | 'error' | 'updatedAt'>>): void {
    appStateStore.dispatch({
      type: ActionType.UPDATE_SURFACE_ACTION,
      id,
      updates,
    });
  }

  private getCurrentRecord(id: string): SurfaceActionRecord {
    const state = appStateStore.getState();
    const record = state.surfaceActions.find(a => a.id === id);
    if (!record) throw new Error(`Action record ${id} not found`);
    return { ...record };
  }

  private toRecord(action: SurfaceAction): SurfaceActionRecord {
    return {
      id: action.id,
      target: action.target,
      kind: action.kind,
      status: action.status,
      origin: action.origin,
      payloadSummary: summarizePayload(action.kind, action.payload as Record<string, unknown>),
      resultSummary: null,
      error: null,
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
      taskId: action.taskId,
    };
  }
}

export const surfaceActionRouter = new SurfaceActionRouter();
