// ═══════════════════════════════════════════════════════════════════════════
// Browser Action Executor — Routes browser actions to BrowserService
// ═══════════════════════════════════════════════════════════════════════════

import {
  SurfaceActionKind, BrowserNavigatePayload,
  BrowserCreateTabPayload, BrowserCloseTabPayload, BrowserActivateTabPayload,
} from '../../shared/actions/surfaceActionTypes';
import { browserService } from '../browser/BrowserService';

export async function executeBrowserAction(
  kind: SurfaceActionKind,
  payload: Record<string, unknown>,
): Promise<string> {
  if (!browserService.isCreated()) {
    throw new Error('Browser runtime not initialized');
  }

  switch (kind) {
    case 'browser.navigate': {
      const { url } = payload as BrowserNavigatePayload;
      browserService.navigate(url);
      // Get state after navigation starts
      const state = browserService.getState();
      return `Navigating to ${state.navigation.url || url}`;
    }

    case 'browser.back': {
      const stateBefore = browserService.getState();
      if (!stateBefore.navigation.canGoBack) {
        throw new Error('Cannot go back: no history');
      }
      browserService.goBack();
      return 'Navigated back';
    }

    case 'browser.forward': {
      const stateBefore = browserService.getState();
      if (!stateBefore.navigation.canGoForward) {
        throw new Error('Cannot go forward: no forward history');
      }
      browserService.goForward();
      return 'Navigated forward';
    }

    case 'browser.reload': {
      browserService.reload();
      return 'Page reload initiated';
    }

    case 'browser.stop': {
      browserService.stop();
      return 'Page loading stopped';
    }

    case 'browser.create-tab': {
      const { url } = payload as BrowserCreateTabPayload;
      const tab = browserService.createTab(url);
      return url ? `Opened tab: ${url}` : `Opened new tab (${tab.id})`;
    }

    case 'browser.close-tab': {
      const { tabId } = payload as BrowserCloseTabPayload;
      browserService.closeTab(tabId);
      return `Closed tab ${tabId}`;
    }

    case 'browser.activate-tab': {
      const { tabId } = payload as BrowserActivateTabPayload;
      browserService.activateTab(tabId);
      return `Activated tab ${tabId}`;
    }

    default:
      throw new Error(`Unknown browser action kind: ${kind}`);
  }
}
