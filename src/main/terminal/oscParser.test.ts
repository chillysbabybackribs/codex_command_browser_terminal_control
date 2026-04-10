import { describe, it, expect } from 'vitest';
import { parseOscSequences, stripAnsi, type OscEvent } from './oscParser';

describe('parseOscSequences', () => {
  it('extracts command-started marker (633;C)', () => {
    const input = 'some text\x1b]633;C\x07more text';
    const { cleaned, events } = parseOscSequences(input);
    expect(cleaned).toBe('some textmore text');
    expect(events).toEqual([{ type: 'command-started' }]);
  });

  it('extracts prompt-started marker (633;B)', () => {
    const input = '\x1b]633;B\x07$ ';
    const { cleaned, events } = parseOscSequences(input);
    expect(cleaned).toBe('$ ');
    expect(events).toEqual([{ type: 'prompt-started' }]);
  });

  it('extracts exit code (633;E;<code>)', () => {
    const input = '\x1b]633;E;0\x07';
    const { cleaned, events } = parseOscSequences(input);
    expect(cleaned).toBe('');
    expect(events).toEqual([{ type: 'exit-code', code: 0 }]);
  });

  it('extracts non-zero exit code', () => {
    const input = '\x1b]633;E;127\x07';
    const { cleaned, events } = parseOscSequences(input);
    expect(events).toEqual([{ type: 'exit-code', code: 127 }]);
  });

  it('extracts cwd (633;D;<path>)', () => {
    const input = '\x1b]633;D;/home/user/project\x07';
    const { cleaned, events } = parseOscSequences(input);
    expect(cleaned).toBe('');
    expect(events).toEqual([{ type: 'cwd', path: '/home/user/project' }]);
  });

  it('handles multiple sequences in one chunk', () => {
    const input = '\x1b]633;E;0\x07\x1b]633;D;/tmp\x07\x1b]633;B\x07$ ';
    const { cleaned, events } = parseOscSequences(input);
    expect(cleaned).toBe('$ ');
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: 'exit-code', code: 0 });
    expect(events[1]).toEqual({ type: 'cwd', path: '/tmp' });
    expect(events[2]).toEqual({ type: 'prompt-started' });
  });

  it('passes through non-633 OSC sequences unchanged', () => {
    const input = '\x1b]0;window title\x07hello';
    const { cleaned, events } = parseOscSequences(input);
    expect(cleaned).toBe('\x1b]0;window title\x07hello');
    expect(events).toEqual([]);
  });

  it('handles data with no OSC sequences', () => {
    const input = 'plain text output\n';
    const { cleaned, events } = parseOscSequences(input);
    expect(cleaned).toBe('plain text output\n');
    expect(events).toEqual([]);
  });

  it('handles empty input', () => {
    const { cleaned, events } = parseOscSequences('');
    expect(cleaned).toBe('');
    expect(events).toEqual([]);
  });

  it('handles cwd with spaces', () => {
    const input = '\x1b]633;D;/home/user/my project\x07';
    const { cleaned, events } = parseOscSequences(input);
    expect(events).toEqual([{ type: 'cwd', path: '/home/user/my project' }]);
  });
});

describe('stripAnsi', () => {
  it('strips SGR sequences', () => {
    expect(stripAnsi('\x1b[32mgreen\x1b[0m')).toBe('green');
  });

  it('strips cursor movement', () => {
    expect(stripAnsi('\x1b[2Ahello\x1b[K')).toBe('hello');
  });

  it('strips complex sequences', () => {
    expect(stripAnsi('\x1b[1;32;40mcolored\x1b[0m')).toBe('colored');
  });

  it('preserves plain text', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('handles empty input', () => {
    expect(stripAnsi('')).toBe('');
  });
});
