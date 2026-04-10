import { describe, it, expect } from 'vitest';
import { appReducer } from './reducer';
import { ActionType } from './actions';
import { createDefaultAppState } from '../../shared/types/appState';

function baseState() {
  return createDefaultAppState();
}

describe('appReducer', () => {
  describe('SET_WINDOW_BOUNDS', () => {
    it('updates bounds for the given role', () => {
      const bounds = { x: 100, y: 200, width: 1024, height: 768 };
      const next = appReducer(baseState(), {
        type: ActionType.SET_WINDOW_BOUNDS,
        role: 'execution',
        bounds,
        displayId: 42,
      });
      expect(next.windows.execution.bounds).toEqual(bounds);
      expect(next.windows.execution.displayId).toBe(42);
    });

    it('does not mutate other roles', () => {
      const state = baseState();
      const next = appReducer(state, {
        type: ActionType.SET_WINDOW_BOUNDS,
        role: 'execution',
        bounds: { x: 1, y: 2, width: 3, height: 4 },
        displayId: 1,
      });
      expect(next.windows.command).toEqual(state.windows.command);
    });
  });

  describe('SET_WINDOW_FOCUSED', () => {
    it('focuses the target role and unfocuses others', () => {
      const next = appReducer(baseState(), {
        type: ActionType.SET_WINDOW_FOCUSED,
        role: 'command',
        isFocused: true,
      });
      expect(next.windows.command.isFocused).toBe(true);
      expect(next.windows.execution.isFocused).toBe(false);
    });

    it('can unfocus all', () => {
      let state = appReducer(baseState(), {
        type: ActionType.SET_WINDOW_FOCUSED,
        role: 'command',
        isFocused: true,
      });
      state = appReducer(state, {
        type: ActionType.SET_WINDOW_FOCUSED,
        role: 'command',
        isFocused: false,
      });
      expect(state.windows.command.isFocused).toBe(false);
      expect(state.windows.execution.isFocused).toBe(false);
    });
  });

  describe('SET_WINDOW_VISIBLE', () => {
    it('sets visibility for the given role', () => {
      const next = appReducer(baseState(), {
        type: ActionType.SET_WINDOW_VISIBLE,
        role: 'execution',
        isVisible: true,
      });
      expect(next.windows.execution.isVisible).toBe(true);
      expect(next.windows.command.isVisible).toBe(false);
    });
  });

  describe('SET_EXECUTION_SPLIT', () => {
    it('updates split state', () => {
      const split = { preset: 'focus-terminal' as const, ratio: 0.3 };
      const next = appReducer(baseState(), {
        type: ActionType.SET_EXECUTION_SPLIT,
        split,
      });
      expect(next.executionSplit).toEqual(split);
    });
  });

  describe('ADD_TASK / UPDATE_TASK / SET_ACTIVE_TASK', () => {
    const task = {
      id: 'task_1', title: 'Test task', status: 'queued' as const,
      owner: 'user' as const,
      createdAt: 1000, updatedAt: 1000,
    };

    it('adds a task and sets it active', () => {
      const next = appReducer(baseState(), { type: ActionType.ADD_TASK, task });
      expect(next.tasks).toHaveLength(1);
      expect(next.tasks[0]).toEqual(task);
      expect(next.activeTaskId).toBe('task_1');
    });

    it('updates a task by id', () => {
      let state = appReducer(baseState(), { type: ActionType.ADD_TASK, task });
      state = appReducer(state, {
        type: ActionType.UPDATE_TASK,
        taskId: 'task_1',
        updates: { status: 'running', updatedAt: 2000 },
      });
      expect(state.tasks[0].status).toBe('running');
      expect(state.tasks[0].updatedAt).toBe(2000);
    });

    it('sets active task', () => {
      const next = appReducer(baseState(), {
        type: ActionType.SET_ACTIVE_TASK,
        taskId: 'task_99',
      });
      expect(next.activeTaskId).toBe('task_99');
    });
  });

  describe('ADD_LOG', () => {
    it('appends a log entry', () => {
      const log = { id: 'log_1', timestamp: 1000, level: 'info' as const, source: 'browser' as const, message: 'test' };
      const next = appReducer(baseState(), { type: ActionType.ADD_LOG, log });
      expect(next.logs).toHaveLength(1);
      expect(next.logs[0]).toEqual(log);
    });

    it('caps logs at 500', () => {
      let state = baseState();
      for (let i = 0; i < 510; i++) {
        state = appReducer(state, {
          type: ActionType.ADD_LOG,
          log: { id: `log_${i}`, timestamp: i, level: 'info', source: 'browser', message: `msg ${i}` },
        });
      }
      expect(state.logs).toHaveLength(500);
      expect(state.logs[0].id).toBe('log_10');
      expect(state.logs[499].id).toBe('log_509');
    });
  });

  describe('SET_SURFACE_STATUS', () => {
    it('sets browser status', () => {
      const status = { status: 'running' as const, lastUpdatedAt: 5000, detail: 'loading page' };
      const next = appReducer(baseState(), {
        type: ActionType.SET_SURFACE_STATUS,
        surface: 'browser',
        status,
      });
      expect(next.browser).toEqual(status);
    });

    it('sets terminal status', () => {
      const status = { status: 'done' as const, lastUpdatedAt: 6000, detail: 'command finished' };
      const next = appReducer(baseState(), {
        type: ActionType.SET_SURFACE_STATUS,
        surface: 'terminal',
        status,
      });
      expect(next.terminal).toEqual(status);
    });
  });

  describe('ADD_SURFACE_ACTION / UPDATE_SURFACE_ACTION', () => {
    const record = {
      id: 'sa_1', target: 'browser' as const, kind: 'browser.navigate' as const,
      status: 'queued' as const, origin: 'command-center' as const,
      payloadSummary: 'Navigate to x', resultSummary: null, resultData: null, error: null,
      createdAt: 1000, updatedAt: 1000, taskId: null,
    };

    it('adds a surface action', () => {
      const next = appReducer(baseState(), { type: ActionType.ADD_SURFACE_ACTION, record });
      expect(next.surfaceActions).toHaveLength(1);
    });

    it('caps surface actions at 200', () => {
      let state = baseState();
      for (let i = 0; i < 210; i++) {
        state = appReducer(state, {
          type: ActionType.ADD_SURFACE_ACTION,
          record: { ...record, id: `sa_${i}` },
        });
      }
      expect(state.surfaceActions).toHaveLength(200);
    });

    it('updates a surface action', () => {
      let state = appReducer(baseState(), { type: ActionType.ADD_SURFACE_ACTION, record });
      state = appReducer(state, {
        type: ActionType.UPDATE_SURFACE_ACTION,
        id: 'sa_1',
        updates: { status: 'completed', resultSummary: 'Done' },
      });
      expect(state.surfaceActions[0].status).toBe('completed');
      expect(state.surfaceActions[0].resultSummary).toBe('Done');
    });
  });

  describe('REPLACE_STATE', () => {
    it('replaces entire state', () => {
      const replacement = { ...baseState(), activeTaskId: 'replaced' };
      const next = appReducer(baseState(), { type: ActionType.REPLACE_STATE, state: replacement });
      expect(next).toEqual(replacement);
    });
  });

  it('returns state unchanged for unknown action types', () => {
    const state = baseState();
    const next = appReducer(state, { type: 'UNKNOWN' as any } as any);
    expect(next).toBe(state);
  });
});
