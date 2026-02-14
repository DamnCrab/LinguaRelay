import { defineBackground } from 'wxt/utils/define-background';
import { DebugEventStore } from '../background/debug-event-store';
import { ModelCacheService } from '../background/model-cache-service';
import { SessionManager } from '../background/session-manager';
import {
  getLocalOnnxEngineDisabledReason,
  isLocalOnnxEngineImplemented,
} from '../background/engines/asr/local-onnx-asr-engine';
import { VT_PORT_NAME } from '../shared/constants';
import { getModelAdapter, getModelAdapterByModelKey } from '../shared/model-adapters';
import type { PopupRequestMessage, PopupResponseMessage } from '../shared/popup-api';
import type { StartupCheckIssue, StartupCheckResult } from '../shared/startup-checks';
import { getSettings, setSettings } from '../shared/settings';
import { LOCAL_ONNX_OFFSCREEN_MESSAGE_TYPE } from '../shared/offscreen-local-onnx';

export default defineBackground(async () => {
  const debugStore = await DebugEventStore.create();
  const manager = await SessionManager.create((level, scope, message, details, extra) => {
    debugStore.push({
      source: 'session',
      level,
      scope,
      message,
      details,
      sessionId: extra?.sessionId,
      tabId: extra?.tabId,
      frameId: extra?.frameId,
      url: extra?.url,
    });
  });
  const modelCache = new ModelCacheService();

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== VT_PORT_NAME) {
      return;
    }

    debugStore.log(
      'info',
      'background.port',
      'port connected',
      port.sender?.url,
      {
        tabId: port.sender?.tab?.id,
        frameId: port.sender?.frameId,
      },
    );
    manager.attachPort(port);
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void manager.detachTab(tabId);
  });

  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    const offscreenType = (raw as { type?: unknown })?.type;
    if (offscreenType === LOCAL_ONNX_OFFSCREEN_MESSAGE_TYPE) {
      return;
    }

    const message = raw as PopupRequestMessage;
    if (!message || typeof message !== 'object' || !('type' in message)) {
      return;
    }

    void handlePopupRequest(manager, modelCache, debugStore, message, sender)
      .then((response) => {
        sendResponse(response);
      })
      .catch((error: unknown) => {
        debugStore.log(
          'error',
          'background.message',
          'popup request failed',
          error instanceof Error ? error.stack ?? error.message : String(error),
        );
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
  modelCache: ModelCacheService,
  debugStore: DebugEventStore,
  message: PopupRequestMessage,
  sender: chrome.runtime.MessageSender,
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
      const support = await detectRuntimeSupport();
      return {
        type: 'RUNTIME_INFO',
        payload: {
          browser: detectBrowser(),
          support,
        },
      };
    }
    case 'LIST_MODEL_CACHE': {
      return {
        type: 'MODEL_CACHE',
        payload: await modelCache.listModels(),
      };
    }
    case 'GET_MODEL_FILES': {
      return {
        type: 'MODEL_FILES',
        payload: await modelCache.listFiles(message.payload.modelId),
      };
    }
    case 'DOWNLOAD_MODEL_VARIANT': {
      const adapter = getModelAdapter(message.payload.adapterId);
      const request = adapter.getDownloadRequest(message.payload.precisionId);
      await modelCache.startDownload(request);
      return {
        type: 'MODEL_DOWNLOAD_ACCEPTED',
        payload: { modelId: request.modelId },
      };
    }
    case 'DELETE_MODEL': {
      await modelCache.deleteModel(message.payload.modelId);
      return { type: 'OK' };
    }
    case 'CANCEL_MODEL_DOWNLOAD': {
      await modelCache.cancelDownload(message.payload.modelId);
      return { type: 'OK' };
    }
    case 'RUN_STARTUP_CHECKS': {
      return {
        type: 'STARTUP_CHECKS',
        payload: await runStartupChecks(modelCache),
      };
    }
    case 'GET_DEBUG_STATE': {
      return {
        type: 'DEBUG_STATE',
        payload: debugStore.getState(),
      };
    }
    case 'SET_DEBUG_STATE': {
      await debugStore.setEnabled(message.payload.enabled);
      return {
        type: 'DEBUG_STATE',
        payload: debugStore.getState(),
      };
    }
    case 'LIST_DEBUG_EVENTS': {
      return {
        type: 'DEBUG_EVENTS',
        payload: debugStore.list(message.payload?.limit ?? 200),
      };
    }
    case 'CLEAR_DEBUG_EVENTS': {
      debugStore.clear();
      return { type: 'OK' };
    }
    case 'REPORT_DEBUG_EVENT': {
      debugStore.push({
        ...message.payload,
        tabId: message.payload.tabId ?? sender.tab?.id,
        frameId: message.payload.frameId ?? sender.frameId,
        url: message.payload.url ?? sender.url,
      });
      return { type: 'OK' };
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

async function detectRuntimeSupport(): Promise<{
  webgpu: boolean;
  wasm: boolean;
  sharedWorker: boolean;
  audioWorklet: boolean;
}> {
  const [webgpu, wasm] = await Promise.all([detectWebGpuSupport(), Promise.resolve(detectWasmSupport())]);

  return {
    webgpu,
    wasm,
    sharedWorker: typeof SharedWorker !== 'undefined',
    audioWorklet: typeof AudioWorkletNode !== 'undefined',
  };
}

async function detectWebGpuSupport(): Promise<boolean> {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const gpuNavigator = navigator as Navigator & {
    gpu?: {
      requestAdapter?: () => Promise<unknown>;
    };
  };

  const requestAdapter = gpuNavigator.gpu?.requestAdapter;
  if (typeof requestAdapter !== 'function') {
    return false;
  }

  try {
    const adapter = await requestAdapter.call(gpuNavigator.gpu);
    return Boolean(adapter);
  } catch {
    return false;
  }
}

function detectWasmSupport(): boolean {
  if (typeof WebAssembly === 'undefined') {
    return false;
  }

  if (typeof WebAssembly.validate !== 'function') {
    return true;
  }

  try {
    const wasmModuleHeader = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    return WebAssembly.validate(wasmModuleHeader);
  } catch {
    return false;
  }
}

async function runStartupChecks(modelCache: ModelCacheService): Promise<StartupCheckResult> {
  const issues: StartupCheckIssue[] = [];
  const settings = await getSettings();
  const support = await detectRuntimeSupport();
  const browser = detectBrowser();
  let modelId: string | undefined;

  if (settings.asr.mode === 'online-gateway') {
    if (!settings.asr.wsUrl.trim()) {
      issues.push({
        code: 'ASR_WS_URL_EMPTY',
        level: 'error',
        message: 'ASR WebSocket URL is empty.',
      });
    } else {
      try {
        const parsed = new URL(settings.asr.wsUrl);
        if (!['ws:', 'wss:'].includes(parsed.protocol)) {
          issues.push({
            code: 'ASR_WS_URL_PROTOCOL',
            level: 'error',
            message: 'ASR WebSocket URL must use ws:// or wss://.',
          });
        }
      } catch {
        issues.push({
          code: 'ASR_WS_URL_INVALID',
          level: 'error',
          message: 'ASR WebSocket URL is invalid.',
        });
      }
    }
  } else {
    if (!isLocalOnnxEngineImplemented()) {
      issues.push({
        code: 'ASR_LOCAL_ENGINE_DISABLED',
        level: 'error',
        message: getLocalOnnxEngineDisabledReason(),
      });
    }

    const adapter = getModelAdapterByModelKey(settings.asr.model);
    if (!adapter) {
      issues.push({
        code: 'ASR_MODEL_ADAPTER_NOT_FOUND',
        level: 'error',
        message: `No adapter found for model key: ${settings.asr.model}`,
      });
    } else {
      modelId = adapter.getModelId(settings.asr.precision);
      const envCheck = adapter.checkEnvironment(
        {
          browser,
          support,
        },
        {
          precisionId: settings.asr.precision,
          backendId: settings.asr.backend,
        },
      );
      for (const error of envCheck.errors) {
        issues.push({
          code: 'ASR_RUNTIME_ENV_ERROR',
          level: 'error',
          message: error,
        });
      }
      for (const warning of envCheck.warnings) {
        issues.push({
          code: 'ASR_RUNTIME_ENV_WARNING',
          level: 'warning',
          message: warning,
        });
      }

      const allModels = await modelCache.listModels();
      const summary = allModels.find((item) => item.modelId === modelId);
      const status = adapter.getDownloadStatus({
        precisionId: settings.asr.precision,
        summary,
      });
      if (status.state !== 'ready') {
        issues.push({
          code: 'ASR_MODEL_NOT_READY',
          level: 'error',
          message: `Local ASR model is not ready: ${modelId} (${status.state})`,
        });
      }
    }
  }

  if (settings.translation.enabled) {
    if (settings.translation.provider !== 'openai-compatible') {
      issues.push({
        code: 'TRANSLATION_PROVIDER_INVALID',
        level: 'error',
        message: 'Translation is enabled but provider is not configured.',
      });
    }
    if (!settings.translation.endpoint?.trim()) {
      issues.push({
        code: 'TRANSLATION_ENDPOINT_EMPTY',
        level: 'error',
        message: 'Translation endpoint is empty.',
      });
    }
    if (!settings.translation.model?.trim()) {
      issues.push({
        code: 'TRANSLATION_MODEL_EMPTY',
        level: 'error',
        message: 'Translation model is empty.',
      });
    }
  }

  return {
    ok: issues.every((issue) => issue.level !== 'error'),
    checkedAt: Date.now(),
    asrMode: settings.asr.mode,
    modelId,
    issues,
  };
}

