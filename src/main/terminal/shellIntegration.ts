// ═══════════════════════════════════════════════════════════════════════════
// Shell Integration — Injects OSC 633 hooks into bash/zsh at PTY spawn
// ═══════════════════════════════════════════════════════════════════════════

import * as path from 'path';

function detectShellType(shellPath: string): 'bash' | 'zsh' | null {
  const name = path.basename(shellPath);
  if (name === 'bash') return 'bash';
  if (name === 'zsh') return 'zsh';
  return null;
}

const BASH_INTEGRATION = `
__v1_preexec() { printf '\\x1b]633;C\\x07'; printf '\\x1b]633;D;%s\\x07' "$PWD"; }
__v1_precmd() { local ec=$?; printf '\\x1b]633;E;%d\\x07' "$ec"; printf '\\x1b]633;D;%s\\x07' "$PWD"; printf '\\x1b]633;B\\x07'; }
trap '__v1_preexec' DEBUG
PROMPT_COMMAND="__v1_precmd\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
`.trim();

const ZSH_INTEGRATION = `
__v1_precmd() { local ec=$?; printf '\\x1b]633;E;%d\\x07' "$ec"; printf '\\x1b]633;D;%s\\x07' "$PWD"; printf '\\x1b]633;B\\x07'; }
__v1_preexec() { printf '\\x1b]633;C\\x07'; printf '\\x1b]633;D;%s\\x07' "$PWD"; }
precmd_functions+=(__v1_precmd)
preexec_functions+=(__v1_preexec)
`.trim();

export function getShellIntegrationScript(shellPath: string): string | null {
  if (!shellPath) return null;
  const type = detectShellType(shellPath);
  switch (type) {
    case 'bash': return BASH_INTEGRATION;
    case 'zsh': return ZSH_INTEGRATION;
    default: return null;
  }
}
