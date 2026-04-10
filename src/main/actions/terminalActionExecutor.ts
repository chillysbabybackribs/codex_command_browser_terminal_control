// ═══════════════════════════════════════════════════════════════════════════
// Terminal Action Executor — Routes terminal actions to TerminalService
// ═══════════════════════════════════════════════════════════════════════════

import { SurfaceActionKind, TerminalExecutePayload, TerminalWritePayload } from '../../shared/actions/surfaceActionTypes';
import { terminalService } from '../terminal/TerminalService';

export async function executeTerminalAction(
  kind: SurfaceActionKind,
  payload: Record<string, unknown>,
): Promise<string> {
  switch (kind) {
    case 'terminal.execute': {
      const { command } = payload as TerminalExecutePayload;
      const session = terminalService.getSession();
      if (!session || session.status !== 'running') {
        throw new Error('Terminal session not running');
      }
      // Write command + newline to execute it
      terminalService.write(command + '\n');
      return `Command sent: ${command} (session ${session.id})`;
    }

    case 'terminal.write': {
      const { input } = payload as TerminalWritePayload;
      const session = terminalService.getSession();
      if (!session || session.status !== 'running') {
        throw new Error('Terminal session not running');
      }
      terminalService.write(input);
      return `Input written to terminal (session ${session.id})`;
    }

    case 'terminal.restart': {
      const newSession = terminalService.restart();
      return `Terminal restarted (new session ${newSession.id})`;
    }

    case 'terminal.interrupt': {
      const session = terminalService.getSession();
      if (!session || session.status !== 'running') {
        throw new Error('Terminal session not running');
      }
      // Send Ctrl+C (ETX character)
      terminalService.write('\x03');
      return `Interrupt signal sent (session ${session.id})`;
    }

    default:
      throw new Error(`Unknown terminal action kind: ${kind}`);
  }
}
