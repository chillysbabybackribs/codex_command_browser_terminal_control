import { describe, it, expect } from 'vitest';
import { generateId } from './ids';

describe('generateId', () => {
  it('produces unique IDs on successive calls', () => {
    const a = generateId('test');
    const b = generateId('test');
    expect(a).not.toBe(b);
  });

  it('uses the given prefix', () => {
    expect(generateId('foo')).toMatch(/^foo_/);
    expect(generateId('bar')).toMatch(/^bar_/);
  });

  it('defaults to "id" prefix', () => {
    expect(generateId()).toMatch(/^id_/);
  });

  it('contains a timestamp component', () => {
    const before = Date.now();
    const id = generateId('t');
    const after = Date.now();
    const parts = id.split('_');
    const ts = parseInt(parts[1], 10);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
