import { screen } from 'electron';
import { LayoutPreset, WindowBounds } from '../../shared/types/appState';
import { WindowRole } from '../../shared/types/windowRoles';

type LayoutBounds = Record<WindowRole, WindowBounds & { displayId: number }>;

function classifyDisplays(): { topDisplay: Electron.Display; bottomDisplay: Electron.Display; isSingleMonitor: boolean } {
  const displays = screen.getAllDisplays();

  if (displays.length === 1) {
    return { topDisplay: displays[0], bottomDisplay: displays[0], isSingleMonitor: true };
  }

  const primary = screen.getPrimaryDisplay();
  const external = displays.find((d) => d.id !== primary.id) ?? primary;

  return {
    topDisplay: external,
    bottomDisplay: primary,
    isSingleMonitor: false,
  };
}

function computeDefaultLayout(): LayoutBounds {
  const { topDisplay, bottomDisplay, isSingleMonitor } = classifyDisplays();
  const top = topDisplay.workArea;
  const bottom = bottomDisplay.workArea;

  if (isSingleMonitor) {
    const totalH = top.height;
    const commandH = Math.floor(totalH * 0.33);
    const surfaceH = totalH - commandH;
    const halfW = Math.floor(top.width / 2);

    return {
      browser: { x: top.x, y: top.y, width: halfW, height: surfaceH, displayId: topDisplay.id },
      terminal: { x: top.x + halfW, y: top.y, width: top.width - halfW, height: surfaceH, displayId: topDisplay.id },
      command: { x: bottom.x, y: top.y + surfaceH, width: top.width, height: commandH, displayId: bottomDisplay.id },
    };
  }

  const halfW = Math.floor(top.width / 2);
  return {
    browser: { x: top.x, y: top.y, width: halfW, height: top.height, displayId: topDisplay.id },
    terminal: { x: top.x + halfW, y: top.y, width: top.width - halfW, height: top.height, displayId: topDisplay.id },
    command: { x: bottom.x, y: bottom.y, width: bottom.width, height: bottom.height, displayId: bottomDisplay.id },
  };
}

function computeFocusBrowserLayout(): LayoutBounds {
  const { topDisplay, bottomDisplay, isSingleMonitor } = classifyDisplays();
  const top = topDisplay.workArea;
  const bottom = bottomDisplay.workArea;

  if (isSingleMonitor) {
    const totalH = top.height;
    const commandH = Math.floor(totalH * 0.2);
    const terminalW = Math.floor(top.width * 0.3);
    const browserH = totalH - commandH;

    return {
      browser: { x: top.x, y: top.y, width: top.width - terminalW, height: browserH, displayId: topDisplay.id },
      terminal: { x: top.x + top.width - terminalW, y: top.y, width: terminalW, height: browserH, displayId: topDisplay.id },
      command: { x: bottom.x, y: top.y + browserH, width: top.width, height: commandH, displayId: bottomDisplay.id },
    };
  }

  const browserW = Math.floor(top.width * 0.7);
  return {
    browser: { x: top.x, y: top.y, width: browserW, height: top.height, displayId: topDisplay.id },
    terminal: { x: top.x + browserW, y: top.y, width: top.width - browserW, height: top.height, displayId: topDisplay.id },
    command: { x: bottom.x, y: bottom.y, width: bottom.width, height: bottom.height, displayId: bottomDisplay.id },
  };
}

function computeFocusTerminalLayout(): LayoutBounds {
  const { topDisplay, bottomDisplay, isSingleMonitor } = classifyDisplays();
  const top = topDisplay.workArea;
  const bottom = bottomDisplay.workArea;

  if (isSingleMonitor) {
    const totalH = top.height;
    const commandH = Math.floor(totalH * 0.2);
    const browserW = Math.floor(top.width * 0.3);
    const surfaceH = totalH - commandH;

    return {
      browser: { x: top.x, y: top.y, width: browserW, height: surfaceH, displayId: topDisplay.id },
      terminal: { x: top.x + browserW, y: top.y, width: top.width - browserW, height: surfaceH, displayId: topDisplay.id },
      command: { x: bottom.x, y: top.y + surfaceH, width: top.width, height: commandH, displayId: bottomDisplay.id },
    };
  }

  const terminalW = Math.floor(top.width * 0.7);
  const browserW = top.width - terminalW;
  return {
    browser: { x: top.x, y: top.y, width: browserW, height: top.height, displayId: topDisplay.id },
    terminal: { x: top.x + browserW, y: top.y, width: terminalW, height: top.height, displayId: topDisplay.id },
    command: { x: bottom.x, y: bottom.y, width: bottom.width, height: bottom.height, displayId: bottomDisplay.id },
  };
}

function computeFocusCommandLayout(): LayoutBounds {
  const { topDisplay, bottomDisplay, isSingleMonitor } = classifyDisplays();
  const top = topDisplay.workArea;
  const bottom = bottomDisplay.workArea;

  if (isSingleMonitor) {
    const totalH = top.height;
    const commandH = Math.floor(totalH * 0.5);
    const surfaceH = totalH - commandH;
    const halfW = Math.floor(top.width / 2);

    return {
      browser: { x: top.x, y: top.y, width: halfW, height: surfaceH, displayId: topDisplay.id },
      terminal: { x: top.x + halfW, y: top.y, width: top.width - halfW, height: surfaceH, displayId: topDisplay.id },
      command: { x: bottom.x, y: top.y + surfaceH, width: top.width, height: commandH, displayId: bottomDisplay.id },
    };
  }

  const halfW = Math.floor(top.width / 2);
  const surfaceH = Math.floor(top.height * 0.6);
  return {
    browser: { x: top.x, y: top.y, width: halfW, height: surfaceH, displayId: topDisplay.id },
    terminal: { x: top.x + halfW, y: top.y, width: top.width - halfW, height: surfaceH, displayId: topDisplay.id },
    command: { x: bottom.x, y: bottom.y, width: bottom.width, height: bottom.height, displayId: bottomDisplay.id },
  };
}

export function getLayoutBounds(preset: LayoutPreset): LayoutBounds {
  switch (preset) {
    case 'default': return computeDefaultLayout();
    case 'focus-browser': return computeFocusBrowserLayout();
    case 'focus-terminal': return computeFocusTerminalLayout();
    case 'focus-command': return computeFocusCommandLayout();
  }
}
