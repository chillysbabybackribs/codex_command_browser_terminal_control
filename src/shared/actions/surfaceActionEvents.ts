// ═══════════════════════════════════════════════════════════════════════════
// Surface Action Events — Typed lifecycle events for the orchestration layer
// ═══════════════════════════════════════════════════════════════════════════

import { SurfaceActionRecord } from './surfaceActionTypes';

export enum SurfaceActionEventType {
  SURFACE_ACTION_SUBMITTED = 'SURFACE_ACTION_SUBMITTED',
  SURFACE_ACTION_STARTED = 'SURFACE_ACTION_STARTED',
  SURFACE_ACTION_COMPLETED = 'SURFACE_ACTION_COMPLETED',
  SURFACE_ACTION_FAILED = 'SURFACE_ACTION_FAILED',
  SURFACE_ACTION_RESULT_UPDATED = 'SURFACE_ACTION_RESULT_UPDATED',
}

export type SurfaceActionEventPayloads = {
  [SurfaceActionEventType.SURFACE_ACTION_SUBMITTED]: { record: SurfaceActionRecord };
  [SurfaceActionEventType.SURFACE_ACTION_STARTED]: { record: SurfaceActionRecord };
  [SurfaceActionEventType.SURFACE_ACTION_COMPLETED]: { record: SurfaceActionRecord };
  [SurfaceActionEventType.SURFACE_ACTION_FAILED]: { record: SurfaceActionRecord };
  [SurfaceActionEventType.SURFACE_ACTION_RESULT_UPDATED]: { record: SurfaceActionRecord };
};

export type SurfaceActionEvent<T extends SurfaceActionEventType = SurfaceActionEventType> = {
  type: T;
  payload: SurfaceActionEventPayloads[T];
  timestamp: number;
};
