import { describe, it, expect } from 'vitest';
import { getShellIntegrationScript } from './shellIntegration';

describe('getShellIntegrationScript', () => {
  it('returns a script for bash', () => {
    const script = getShellIntegrationScript('/bin/bash');
    expect(script).not.toBeNull();
    expect(script).toContain('__v1_precmd');
    expect(script).toContain('__v1_preexec');
    expect(script).toContain('633;C');
    expect(script).toContain('633;B');
    expect(script).toContain('633;E');
    expect(script).toContain('633;D');
  });

  it('returns a script for zsh', () => {
    const script = getShellIntegrationScript('/bin/zsh');
    expect(script).not.toBeNull();
    expect(script).toContain('precmd_functions');
    expect(script).toContain('preexec_functions');
    expect(script).toContain('633;C');
    expect(script).toContain('633;B');
    expect(script).toContain('633;E');
    expect(script).toContain('633;D');
  });

  it('returns a script for bash at non-standard path', () => {
    const script = getShellIntegrationScript('/usr/local/bin/bash');
    expect(script).not.toBeNull();
    expect(script).toContain('__v1_precmd');
  });

  it('returns null for unsupported shells', () => {
    expect(getShellIntegrationScript('/bin/sh')).toBeNull();
    expect(getShellIntegrationScript('/usr/bin/dash')).toBeNull();
    expect(getShellIntegrationScript('/bin/fish')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getShellIntegrationScript('')).toBeNull();
  });

  it('script does not contain bare newlines that would execute prematurely', () => {
    const script = getShellIntegrationScript('/bin/bash');
    expect(script).not.toBeNull();
    expect(script!.trim().length).toBeGreaterThan(0);
  });
});
