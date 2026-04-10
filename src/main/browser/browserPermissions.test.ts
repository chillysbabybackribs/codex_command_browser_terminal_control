import { describe, it, expect } from 'vitest';
import { resolvePermission, classifyPermission } from './browserPermissions';

describe('classifyPermission', () => {
  it('maps known Electron permission strings', () => {
    expect(classifyPermission('media')).toBe('media');
    expect(classifyPermission('geolocation')).toBe('geolocation');
    expect(classifyPermission('notifications')).toBe('notifications');
    expect(classifyPermission('midi')).toBe('midi');
    expect(classifyPermission('pointerLock')).toBe('pointerLock');
    expect(classifyPermission('fullscreen')).toBe('fullscreen');
    expect(classifyPermission('openExternal')).toBe('openExternal');
    expect(classifyPermission('clipboard-read')).toBe('clipboard-read');
    expect(classifyPermission('clipboard-sanitized-write')).toBe('clipboard-sanitized-write');
    expect(classifyPermission('window-management')).toBe('window-management');
  });

  it('returns "unknown" for unmapped permissions', () => {
    expect(classifyPermission('something-new')).toBe('unknown');
    expect(classifyPermission('')).toBe('unknown');
  });
});

describe('resolvePermission', () => {
  it('grants safe permissions', () => {
    expect(resolvePermission('clipboard-sanitized-write')).toBe('granted');
    expect(resolvePermission('fullscreen')).toBe('granted');
    expect(resolvePermission('pointerLock')).toBe('granted');
    expect(resolvePermission('window-management')).toBe('granted');
  });

  it('denies sensitive permissions', () => {
    expect(resolvePermission('geolocation')).toBe('denied');
    expect(resolvePermission('notifications')).toBe('denied');
    expect(resolvePermission('midi')).toBe('denied');
    expect(resolvePermission('openExternal')).toBe('denied');
  });

  it('denies unknown permissions by default', () => {
    expect(resolvePermission('unknown')).toBe('denied');
    expect(resolvePermission('media')).toBe('denied');
    expect(resolvePermission('clipboard-read')).toBe('denied');
  });
});
