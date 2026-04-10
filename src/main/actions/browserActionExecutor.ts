// ═══════════════════════════════════════════════════════════════════════════
// Browser Action Executor — Routes browser actions to BrowserService
// Returns structured { summary, data } for both display and model consumption
// ═══════════════════════════════════════════════════════════════════════════

import {
  SurfaceActionKind, BrowserNavigatePayload,
  BrowserCreateTabPayload, BrowserCloseTabPayload, BrowserActivateTabPayload,
  BrowserClickPayload, BrowserTypePayload,
} from '../../shared/actions/surfaceActionTypes';
import { browserService } from '../browser/BrowserService';

export type ActionResult = { summary: string; data: Record<string, unknown> };

/**
 * Debug-only: artificial delay (ms) applied after browser.navigate execution.
 * Set via env: V1_DEBUG_NAVIGATE_DELAY_MS=3000
 */
function getDebugNavigateDelayMs(): number {
  const raw = process.env.V1_DEBUG_NAVIGATE_DELAY_MS;
  if (!raw) return 0;
  const ms = parseInt(raw, 10);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

export async function executeBrowserAction(
  kind: SurfaceActionKind,
  payload: Record<string, unknown>,
): Promise<ActionResult> {
  if (!browserService.isCreated()) {
    throw new Error('Browser runtime not initialized');
  }

  switch (kind) {
    case 'browser.navigate': {
      const { url } = payload as BrowserNavigatePayload;
      browserService.navigate(url);

      const delayMs = getDebugNavigateDelayMs();
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      const state = browserService.getState();
      return {
        summary: `Navigating to ${state.navigation.url || url}`,
        data: {
          url: state.navigation.url || url,
          title: state.navigation.title,
          isLoading: state.navigation.isLoading,
          tabCount: state.tabs.length,
        },
      };
    }

    case 'browser.back': {
      const before = browserService.getState();
      if (!before.navigation.canGoBack) {
        throw new Error('Cannot go back: no history');
      }
      browserService.goBack();
      const after = browserService.getState();
      return {
        summary: 'Navigated back',
        data: {
          url: after.navigation.url,
          title: after.navigation.title,
          canGoBack: after.navigation.canGoBack,
          canGoForward: after.navigation.canGoForward,
        },
      };
    }

    case 'browser.forward': {
      const before = browserService.getState();
      if (!before.navigation.canGoForward) {
        throw new Error('Cannot go forward: no forward history');
      }
      browserService.goForward();
      const after = browserService.getState();
      return {
        summary: 'Navigated forward',
        data: {
          url: after.navigation.url,
          title: after.navigation.title,
          canGoBack: after.navigation.canGoBack,
          canGoForward: after.navigation.canGoForward,
        },
      };
    }

    case 'browser.reload': {
      browserService.reload();
      const state = browserService.getState();
      return {
        summary: 'Page reload initiated',
        data: { url: state.navigation.url, isLoading: state.navigation.isLoading },
      };
    }

    case 'browser.stop': {
      browserService.stop();
      const state = browserService.getState();
      return {
        summary: 'Page loading stopped',
        data: { url: state.navigation.url, isLoading: state.navigation.isLoading },
      };
    }

    case 'browser.create-tab': {
      const { url } = payload as BrowserCreateTabPayload;
      const tab = browserService.createTab(url);
      return {
        summary: url ? `Opened tab: ${url}` : `Opened new tab (${tab.id})`,
        data: { tabId: tab.id, url: url || '', totalTabs: browserService.getTabs().length },
      };
    }

    case 'browser.close-tab': {
      const { tabId } = payload as BrowserCloseTabPayload;
      browserService.closeTab(tabId);
      return {
        summary: `Closed tab ${tabId}`,
        data: { closedTabId: tabId, remainingTabs: browserService.getTabs().length },
      };
    }

    case 'browser.activate-tab': {
      const { tabId } = payload as BrowserActivateTabPayload;
      browserService.activateTab(tabId);
      const state = browserService.getState();
      return {
        summary: `Activated tab ${tabId}`,
        data: { tabId, url: state.navigation.url, title: state.navigation.title },
      };
    }

    case 'browser.click': {
      const { selector, tabId } = payload as BrowserClickPayload;
      const result = await browserService.clickElement(selector, tabId);
      if (!result.clicked) {
        throw new Error(result.error || `Click failed: ${selector}`);
      }
      return {
        summary: `Clicked: ${selector}`,
        data: { selector, clicked: true },
      };
    }

    case 'browser.type': {
      const { selector, text, tabId } = payload as BrowserTypePayload;
      const result = await browserService.typeInElement(selector, text, tabId);
      if (!result.typed) {
        throw new Error(result.error || `Type failed: ${selector}`);
      }
      return {
        summary: `Typed in: ${selector}`,
        data: { selector, typed: true, textLength: text.length },
      };
    }

    default:
      throw new Error(`Unknown browser action kind: ${kind}`);
  }
}
