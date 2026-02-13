import type { PopupRequestMessage, PopupResponseMessage } from './popup-api';
import type { SessionRuntimeStatus, UserSettings } from './contracts';
import type {
  CachedModelFileSummary,
  CachedModelSummary,
} from './model-cache';
import type { ModelVariantSelection } from './model-adapters/contracts';
import type { StartupCheckResult } from './startup-checks';
import type { DebugEventInput, DebugEventRecord, DebugState } from './debug-events';

export async function runtimeRequest(message: PopupRequestMessage): Promise<PopupResponseMessage> {
  return (await chrome.runtime.sendMessage(message)) as PopupResponseMessage;
}

export async function loadSettings(): Promise<UserSettings> {
  const response = await runtimeRequest({ type: 'GET_SETTINGS' });
  if (response.type !== 'SETTINGS') {
    throw new Error('Failed to load settings');
  }
  return response.payload;
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  const response = await runtimeRequest({ type: 'SET_SETTINGS', payload: settings });
  if (response.type === 'ERROR') {
    throw new Error(response.payload.message);
  }
}

export async function listSessions(): Promise<SessionRuntimeStatus[]> {
  const response = await runtimeRequest({ type: 'LIST_SESSIONS' });
  if (response.type !== 'SESSIONS') {
    return [];
  }
  return response.payload;
}

export async function getRuntimeInfo(): Promise<
  Extract<PopupResponseMessage, { type: 'RUNTIME_INFO' }>['payload']
> {
  const response = await runtimeRequest({ type: 'GET_RUNTIME_INFO' });
  if (response.type !== 'RUNTIME_INFO') {
    throw new Error('Failed to get runtime info');
  }
  return response.payload;
}

export async function listModelCache(): Promise<CachedModelSummary[]> {
  const response = await runtimeRequest({ type: 'LIST_MODEL_CACHE' });
  if (response.type !== 'MODEL_CACHE') {
    return [];
  }
  return response.payload;
}

export async function listModelFiles(modelId: string): Promise<CachedModelFileSummary[]> {
  const response = await runtimeRequest({ type: 'GET_MODEL_FILES', payload: { modelId } });
  if (response.type !== 'MODEL_FILES') {
    return [];
  }
  return response.payload;
}

export async function downloadModelVariant(payload: ModelVariantSelection): Promise<void> {
  const response = await runtimeRequest({
    type: 'DOWNLOAD_MODEL_VARIANT',
    payload,
  });
  if (response.type === 'ERROR') {
    throw new Error(response.payload.message);
  }
}

export async function deleteModel(modelId: string): Promise<void> {
  const response = await runtimeRequest({ type: 'DELETE_MODEL', payload: { modelId } });
  if (response.type === 'ERROR') {
    throw new Error(response.payload.message);
  }
}

export async function cancelModelDownload(modelId: string): Promise<void> {
  const response = await runtimeRequest({
    type: 'CANCEL_MODEL_DOWNLOAD',
    payload: { modelId },
  });
  if (response.type === 'ERROR') {
    throw new Error(response.payload.message);
  }
}

export async function runStartupChecks(): Promise<StartupCheckResult> {
  const response = await runtimeRequest({ type: 'RUN_STARTUP_CHECKS' });
  if (response.type !== 'STARTUP_CHECKS') {
    throw new Error('Failed to run startup checks');
  }
  return response.payload;
}

export async function getDebugState(): Promise<DebugState> {
  const response = await runtimeRequest({ type: 'GET_DEBUG_STATE' });
  if (response.type !== 'DEBUG_STATE') {
    throw new Error('Failed to get debug state');
  }
  return response.payload;
}

export async function setDebugState(enabled: boolean): Promise<DebugState> {
  const response = await runtimeRequest({ type: 'SET_DEBUG_STATE', payload: { enabled } });
  if (response.type !== 'DEBUG_STATE') {
    throw new Error('Failed to set debug state');
  }
  return response.payload;
}

export async function listDebugEvents(limit = 200): Promise<DebugEventRecord[]> {
  const response = await runtimeRequest({ type: 'LIST_DEBUG_EVENTS', payload: { limit } });
  if (response.type !== 'DEBUG_EVENTS') {
    throw new Error('Failed to list debug events');
  }
  return response.payload;
}

export async function clearDebugEvents(): Promise<void> {
  const response = await runtimeRequest({ type: 'CLEAR_DEBUG_EVENTS' });
  if (response.type === 'ERROR') {
    throw new Error(response.payload.message);
  }
}

export async function reportDebugEvent(payload: DebugEventInput): Promise<void> {
  const response = await runtimeRequest({ type: 'REPORT_DEBUG_EVENT', payload });
  if (response.type === 'ERROR') {
    throw new Error(response.payload.message);
  }
}

