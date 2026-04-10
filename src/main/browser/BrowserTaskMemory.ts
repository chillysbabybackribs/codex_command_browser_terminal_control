import {
  BrowserFinding,
  BrowserTaskMemory,
  createEmptyBrowserTaskMemory,
} from '../../shared/types/browserIntelligence';

export class BrowserTaskMemoryStore {
  private memoryByTask = new Map<string, BrowserTaskMemory>();

  recordFinding(finding: BrowserFinding): BrowserTaskMemory {
    const current = this.memoryByTask.get(finding.taskId) || createEmptyBrowserTaskMemory(finding.taskId);
    const next: BrowserTaskMemory = {
      ...current,
      lastUpdatedAt: finding.createdAt,
      findings: [...current.findings, finding],
      tabsTouched: current.tabsTouched.includes(finding.tabId)
        ? current.tabsTouched
        : [...current.tabsTouched, finding.tabId],
      snapshotIds: finding.snapshotId && !current.snapshotIds.includes(finding.snapshotId)
        ? [...current.snapshotIds, finding.snapshotId]
        : current.snapshotIds,
    };
    this.memoryByTask.set(finding.taskId, next);
    return next;
  }

  getTaskMemory(taskId: string): BrowserTaskMemory {
    return this.memoryByTask.get(taskId) || createEmptyBrowserTaskMemory(taskId);
  }

  clearTask(taskId: string): void {
    this.memoryByTask.delete(taskId);
  }
}
