import { defineContentScript } from 'wxt/utils/define-content-script';

import {
  CONTENT_CONTROL_MESSAGE_TYPE,
  type ContentControlRequestMessage,
  type ContentControlResponseMessage,
} from '../shared/content-control';
import type { SiteAdapter, SiteController } from '../content/sites/contracts';
import { resolveSiteAdapter } from '../content/sites';
import { reportContentDebug } from '../content/debug-report';

const CONTENT_INSTANCE_ATTR = 'data-linguarelay-content-instance';
const CONTENT_RUNNING_OWNER_ATTR = 'data-linguarelay-running-owner';

interface ContentRuntimeState {
  instanceId: string;
  adapterId: string;
  dispose: () => Promise<void>;
}

declare global {
  interface Window {
    __linguarelayContentRuntime?: ContentRuntimeState;
  }
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    if (window.top !== window) {
      return;
    }

    const adapter = resolveSiteAdapter(location.href);
    if (!adapter) {
      return;
    }

    const root = document.documentElement;
    const instanceId = createInstanceId();

    // Cross-world singleton lock. If this attribute exists, another injected
    // content runtime already owns this page.
    if (root.hasAttribute(CONTENT_INSTANCE_ATTR)) {
      reportContentDebug({
        scope: 'content-runtime',
        message: 'skip boot: instance lock exists',
        level: 'warn',
      });
      return;
    }
    root.setAttribute(CONTENT_INSTANCE_ATTR, instanceId);

    const runtime = createRuntime(adapter, instanceId);
    (window as Window).__linguarelayContentRuntime = runtime;
  },
});

function createRuntime(adapter: SiteAdapter, instanceId: string): ContentRuntimeState {
  let running = false;
  let controller: SiteController | null = null;
  let disposed = false;

  const root = document.documentElement;
  const createController = (): SiteController => adapter.create();

  const isRunningOwner = (): boolean =>
    root.getAttribute(CONTENT_RUNNING_OWNER_ATTR) === instanceId;

  const acquireRunningOwner = (): boolean => {
    const current = root.getAttribute(CONTENT_RUNNING_OWNER_ATTR);
    if (current && current !== instanceId) {
      return false;
    }
    root.setAttribute(CONTENT_RUNNING_OWNER_ATTR, instanceId);
    return true;
  };

  const releaseRunningOwner = (): void => {
    if (isRunningOwner()) {
      root.removeAttribute(CONTENT_RUNNING_OWNER_ATTR);
    }
  };

  const start = (): ContentControlResponseMessage => {
    if (disposed) {
      return { ok: false, running: false, adapterId: adapter.id, message: 'runtime disposed' };
    }

    if (running && isRunningOwner()) {
      reportContentDebug({
        scope: 'content-runtime',
        message: 'start ignored: already running',
      });
      return { ok: true, running: true, adapterId: adapter.id };
    }

    if (!acquireRunningOwner()) {
      reportContentDebug({
        scope: 'content-runtime',
        message: 'start blocked by running lock',
        level: 'warn',
      });
      return {
        ok: true,
        running: false,
        adapterId: adapter.id,
        message: 'another content runtime owns running lock',
      };
    }

    if (!controller) {
      controller = createController();
    }

    controller.start();
    reportContentDebug({
      scope: 'content-runtime',
      message: 'controller started',
      level: 'info',
      details: adapter.id,
    });
    running = true;
    return { ok: true, running: true, adapterId: adapter.id };
  };

  const stop = async (reason = 'manual_stop'): Promise<ContentControlResponseMessage> => {
    if (disposed) {
      return { ok: false, running: false, adapterId: adapter.id, message: 'runtime disposed' };
    }

    if (running && controller) {
      await controller.dispose(reason);
      reportContentDebug({
        scope: 'content-runtime',
        message: 'controller stopped',
        level: 'info',
        details: reason,
      });
    }

    controller = null;
    running = false;
    releaseRunningOwner();

    return { ok: true, running: false, adapterId: adapter.id };
  };

  const onMessage = (
    raw: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ContentControlResponseMessage) => void,
  ): boolean | void => {
    const message = raw as Partial<ContentControlRequestMessage> | undefined;
    if (!message || message.type !== CONTENT_CONTROL_MESSAGE_TYPE) {
      return;
    }

    if (message.action === 'status') {
      reportContentDebug({
        scope: 'content-runtime',
        message: 'status queried',
        details: `running=${running && isRunningOwner()}`,
      });
      sendResponse({
        ok: true,
        running: running && isRunningOwner(),
        adapterId: adapter.id,
      });
      return;
    }

    void (async () => {
      try {
        if (message.action === 'start') {
          sendResponse(start());
          return;
        }
        if (message.action === 'stop') {
          sendResponse(await stop());
          return;
        }
        sendResponse({
          ok: false,
          running: running && isRunningOwner(),
          adapterId: adapter.id,
          message: 'unsupported action',
        });
      } catch (error) {
        sendResponse({
          ok: false,
          running: running && isRunningOwner(),
          adapterId: adapter.id,
          message: error instanceof Error ? error.message : 'content control failed',
        });
      }
    })();

    return true;
  };

  const cleanupPage = (): void => {
    void stop('content_cleanup');
  };

  const dispose = async (): Promise<void> => {
    if (disposed) {
      return;
    }
    disposed = true;

    chrome.runtime.onMessage.removeListener(onMessage);
    window.removeEventListener('beforeunload', cleanupPage);
    window.removeEventListener('pagehide', cleanupPage);

    await stop('runtime_dispose');
    releaseRunningOwner();

    if (root.getAttribute(CONTENT_INSTANCE_ATTR) === instanceId) {
      root.removeAttribute(CONTENT_INSTANCE_ATTR);
    }

    const host = window as Window;
    if (host.__linguarelayContentRuntime?.instanceId === instanceId) {
      host.__linguarelayContentRuntime = undefined;
    }
  };

  chrome.runtime.onMessage.addListener(onMessage);
  window.addEventListener('beforeunload', cleanupPage, { once: true });
  window.addEventListener('pagehide', cleanupPage, { once: true });

  return {
    instanceId,
    adapterId: adapter.id,
    dispose,
  };
}

function createInstanceId(): string {
  return `lr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
