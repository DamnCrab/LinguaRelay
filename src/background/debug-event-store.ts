import type { DebugEventInput, DebugEventRecord, DebugState } from '../shared/debug-events';

const DEBUG_STORAGE_KEY = 'linguarelay:debug-enabled';
const MAX_DEBUG_EVENTS = 500;

export class DebugEventStore {
  private enabled = false;
  private readonly events: DebugEventRecord[] = [];

  private constructor() {}

  public static async create(): Promise<DebugEventStore> {
    const store = new DebugEventStore();
    await store.loadState();
    return store;
  }

  public getState(): DebugState {
    return {
      enabled: this.enabled,
    };
  }

  public async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    await chrome.storage.local.set({ [DEBUG_STORAGE_KEY]: enabled });
  }

  public list(limit = 200): DebugEventRecord[] {
    const safeLimit = Math.max(1, Math.min(limit, MAX_DEBUG_EVENTS));
    if (this.events.length <= safeLimit) {
      return [...this.events];
    }
    return this.events.slice(this.events.length - safeLimit);
  }

  public clear(): void {
    this.events.length = 0;
  }

  public push(input: DebugEventInput): void {
    if (!this.enabled) {
      return;
    }

    const event: DebugEventRecord = {
      ...input,
      id: createEventId(),
      timestamp: Date.now(),
    };

    this.events.push(event);
    if (this.events.length > MAX_DEBUG_EVENTS) {
      this.events.splice(0, this.events.length - MAX_DEBUG_EVENTS);
    }
  }

  public log(
    level: DebugEventInput['level'],
    scope: string,
    message: string,
    details?: string,
    extra?: Partial<Omit<DebugEventInput, 'source' | 'level' | 'scope' | 'message' | 'details'>>,
  ): void {
    this.push({
      source: 'background',
      level,
      scope,
      message,
      details,
      sessionId: extra?.sessionId,
      tabId: extra?.tabId,
      frameId: extra?.frameId,
      url: extra?.url,
    });
  }

  private async loadState(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(DEBUG_STORAGE_KEY);
      this.enabled = Boolean(result[DEBUG_STORAGE_KEY]);
    } catch {
      this.enabled = false;
    }
  }
}

function createEventId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
