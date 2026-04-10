// ═══════════════════════════════════════════════════════════════════════════
// ProviderGate — shared base class for model provider gates
// ═══════════════════════════════════════════════════════════════════════════

import { eventBus } from '../events/eventBus';
import { AppEventType } from '../../shared/types/events';
import { appStateStore } from '../state/appStateStore';
import { ActionType } from '../state/actions';
import { generateId } from '../../shared/utils/ids';
import type {
  ProviderId, ProviderRuntime, ProviderStatus,
  InvocationProgress, CodexItem,
} from '../../shared/types/model';

export type ProgressListener = (progress: InvocationProgress) => void;

export abstract class ProviderGate {
  abstract readonly id: ProviderId;
  protected progressListeners = new Set<ProgressListener>();
  protected status: ProviderRuntime;

  constructor(initialId: ProviderId) {
    this.status = {
      id: initialId,
      status: 'unavailable',
      activeTaskId: null,
      lastActivityAt: null,
      errorDetail: null,
    };
  }

  protected setStatus(status: ProviderStatus, errorDetail?: string | null, activeTaskId?: string | null): void {
    this.status.status = status;
    if (errorDetail !== undefined) this.status.errorDetail = errorDetail;
    if (activeTaskId !== undefined) this.status.activeTaskId = activeTaskId;
    if (status === 'available' || status === 'busy') {
      this.status.lastActivityAt = Date.now();
      this.status.activeTaskId = activeTaskId ?? null;
    }
    appStateStore.dispatch({
      type: ActionType.SET_PROVIDER_RUNTIME,
      providerId: this.id,
      runtime: { ...this.status },
    });
    eventBus.emit(AppEventType.MODEL_PROVIDER_STATUS_CHANGED, { runtime: { ...this.status } });
  }

  protected emitLog(level: 'info' | 'warn' | 'error', message: string): void {
    const line = `[${new Date().toISOString()}] [model:${this.id}] [${level}] ${message}`;
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
    appStateStore.dispatch({
      type: ActionType.ADD_LOG,
      log: {
        id: generateId('log'),
        timestamp: Date.now(),
        level,
        source: this.id,
        message,
      },
    });
  }

  protected emitProgress(taskId: string, type: InvocationProgress['type'], data: string, codexItem?: CodexItem): void {
    console.log(
      `[${new Date().toISOString()}] [model:${this.id}] [progress:${type}] [task:${taskId}] ${data}`,
    );
    const progress: InvocationProgress = {
      taskId,
      providerId: this.id,
      type,
      data,
      codexItem,
      timestamp: Date.now(),
    };
    for (const listener of this.progressListeners) {
      listener(progress);
    }
    eventBus.emit(AppEventType.MODEL_INVOCATION_PROGRESS, { progress });
  }
}
