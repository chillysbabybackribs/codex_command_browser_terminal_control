import { describe, it, expect } from 'vitest';
import { ACTION_CONCURRENCY_POLICY } from './surfaceActionPolicy';
import { ALL_ACTION_KINDS } from '../../shared/actions/surfaceActionTypes';

describe('ACTION_CONCURRENCY_POLICY', () => {
  it('has a policy for every action kind', () => {
    for (const kind of ALL_ACTION_KINDS) {
      expect(ACTION_CONCURRENCY_POLICY[kind], `missing policy for ${kind}`).toBeDefined();
    }
  });

  it('has no extra keys beyond known action kinds', () => {
    const policyKinds = Object.keys(ACTION_CONCURRENCY_POLICY);
    expect(policyKinds.sort()).toEqual([...ALL_ACTION_KINDS].sort());
  });

  it('browser navigation actions serialize with replacesSameKind', () => {
    for (const kind of ['browser.navigate', 'browser.back', 'browser.forward', 'browser.reload'] as const) {
      const p = ACTION_CONCURRENCY_POLICY[kind];
      expect(p.mode, `${kind} mode`).toBe('serialize');
      expect(p.replacesSameKind, `${kind} replacesSameKind`).toBe(true);
    }
  });

  it('browser tab actions serialize without replacesSameKind', () => {
    for (const kind of ['browser.create-tab', 'browser.close-tab', 'browser.activate-tab'] as const) {
      const p = ACTION_CONCURRENCY_POLICY[kind];
      expect(p.mode, `${kind} mode`).toBe('serialize');
      expect(p.replacesSameKind).toBeFalsy();
    }
  });

  it('browser.stop bypasses and clears queue', () => {
    const p = ACTION_CONCURRENCY_POLICY['browser.stop'];
    expect(p.mode).toBe('bypass');
    expect(p.clearsQueue).toBe(true);
  });

  it('terminal.execute serializes with replacesSameKind', () => {
    const p = ACTION_CONCURRENCY_POLICY['terminal.execute'];
    expect(p.mode).toBe('serialize');
    expect(p.replacesSameKind).toBe(true);
  });

  it('terminal.write bypasses with requiresActiveAction', () => {
    const p = ACTION_CONCURRENCY_POLICY['terminal.write'];
    expect(p.mode).toBe('bypass');
    expect(p.requiresActiveAction).toBe(true);
  });

  it('terminal.interrupt bypasses and clears queue', () => {
    const p = ACTION_CONCURRENCY_POLICY['terminal.interrupt'];
    expect(p.mode).toBe('bypass');
    expect(p.clearsQueue).toBe(true);
  });

  it('terminal.restart bypasses and clears queue', () => {
    const p = ACTION_CONCURRENCY_POLICY['terminal.restart'];
    expect(p.mode).toBe('bypass');
    expect(p.clearsQueue).toBe(true);
  });
});
