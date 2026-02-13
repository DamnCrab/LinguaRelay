import type { AsrEngine, TranslatorEngine } from './contracts';

type DisposableEngine = AsrEngine | TranslatorEngine;

interface PoolEntry<T extends DisposableEngine> {
  engine: T;
  refCount: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  key: string;
}

export class EnginePool<T extends DisposableEngine> {
  private readonly entries = new Map<string, PoolEntry<T>>();

  constructor(private readonly idleDisposeMs: () => number) {}

  public acquire(key: string, create: () => T): T {
    const existing = this.entries.get(key);
    if (existing) {
      existing.refCount += 1;
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = null;
      }
      return existing.engine;
    }

    const engine = create();
    this.entries.set(key, {
      engine,
      refCount: 1,
      idleTimer: null,
      key,
    });
    return engine;
  }

  public release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }

    entry.refCount -= 1;
    if (entry.refCount > 0) {
      return;
    }

    const idleMs = this.idleDisposeMs();
    entry.idleTimer = setTimeout(() => {
      const target = this.entries.get(key);
      if (!target || target.refCount > 0) {
        return;
      }

      target.engine.dispose().catch(() => undefined);
      this.entries.delete(key);
    }, idleMs);
  }

  public async disposeAll(): Promise<void> {
    const tasks: Array<Promise<void>> = [];
    for (const [key, entry] of this.entries) {
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
      }
      tasks.push(entry.engine.dispose());
      this.entries.delete(key);
    }

    await Promise.allSettled(tasks);
  }

  public size(): number {
    return this.entries.size;
  }
}

