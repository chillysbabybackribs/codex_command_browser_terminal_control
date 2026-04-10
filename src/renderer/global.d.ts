interface WorkspaceAPI {
  getState(): Promise<any>;
  getRole(): Promise<string>;
  createTask(title: string): Promise<void>;
  updateTaskStatus(taskId: string, status: string): Promise<void>;
  addLog(level: string, source: string, message: string, taskId?: string): Promise<void>;
  applyLayout(preset: string): Promise<void>;
  resetLayout(): Promise<void>;
  requestBrowserAction(action: string, taskId?: string): Promise<void>;
  requestTerminalAction(action: string, taskId?: string): Promise<void>;
  updateSurfaceStatus(surface: string, status: any): Promise<void>;
  onStateUpdate(callback: (state: any) => void): void;
  onEvent(callback: (type: string, payload: any) => void): void;
  removeAllListeners(): void;
}

interface Window {
  workspaceAPI: WorkspaceAPI;
}

declare const workspaceAPI: WorkspaceAPI;
