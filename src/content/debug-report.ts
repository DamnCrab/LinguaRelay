import type { DebugEventInput, DebugEventLevel } from '../shared/debug-events';
import type { PopupRequestMessage } from '../shared/popup-api';

interface ContentDebugOptions {
  scope: string;
  message: string;
  level?: DebugEventLevel;
  details?: string;
}

export function reportContentDebug(options: ContentDebugOptions): void {
  const payload: DebugEventInput = {
    source: 'content',
    level: options.level ?? 'debug',
    scope: options.scope,
    message: options.message,
    details: options.details,
    url: location.href,
  };

  const request: PopupRequestMessage = {
    type: 'REPORT_DEBUG_EVENT',
    payload,
  };

  try {
    const result = chrome.runtime.sendMessage(request);
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      void (result as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // Ignore debug transport errors.
  }
}
