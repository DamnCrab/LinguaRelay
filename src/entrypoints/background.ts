import { defineBackground } from 'wxt/utils/define-background';
import { SessionManager } from '../background/session-manager';
import { VT_PORT_NAME } from '../shared/constants';
import type { PopupRequestMessage, PopupResponseMessage } from '../shared/popup-api';
import { getSettings, setSettings } from '../shared/settings';

export default defineBackground(async () => {
  const manager = await SessionManager.create();

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== VT_PORT_NAME) {
      return;
    }

    manager.attachPort(port);
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void manager.detachTab(tabId);
  });

  chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
    const message = raw as PopupRequestMessage;
    if (!message || typeof message !== 'object' || !('type' in message)) {
      return;
    }

    void handlePopupRequest(manager, message)
      .then((response) => {
        sendResponse(response);
      })
      .catch((error: unknown) => {
        const fallback: PopupResponseMessage = {
          type: 'ERROR',
          payload: {
            message: error instanceof Error ? error.message : 'Unknown background error',
          },
        };
        sendResponse(fallback);
      });

    return true;
  });

  globalThis.addEventListener('unload', () => {
    void manager.shutdown();
  });
});

async function handlePopupRequest(
  manager: SessionManager,
  message: PopupRequestMessage,
): Promise<PopupResponseMessage> {
  switch (message.type) {
    case 'GET_SETTINGS': {
      const settings = await getSettings();
      return {
        type: 'SETTINGS',
        payload: settings,
      };
    }
    case 'SET_SETTINGS': {
      await setSettings(message.payload);
      await manager.refreshSettings();
      return { type: 'OK' };
    }
    case 'LIST_SESSIONS': {
      return {
        type: 'SESSIONS',
        payload: manager.listSessions(),
      };
    }
    case 'GET_RUNTIME_INFO': {
      return {
        type: 'RUNTIME_INFO',
        payload: {
          browser: detectBrowser(),
          support: {
            webgpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
            sharedWorker: typeof SharedWorker !== 'undefined',
            audioWorklet: typeof AudioWorkletNode !== 'undefined',
          },
        },
      };
    }
    default:
      return {
        type: 'ERROR',
        payload: { message: 'Unsupported message' },
      };
  }
}

function detectBrowser(): string {
  const ua = navigator.userAgent;
  if (/firefox/i.test(ua)) {
    return 'Firefox';
  }
  if (/edg/i.test(ua)) {
    return 'Edge';
  }
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) {
    return 'Safari';
  }
  if (/chrome/i.test(ua)) {
    return 'Chrome';
  }
  return 'Unknown';
}

