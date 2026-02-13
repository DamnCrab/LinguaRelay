import type { PopupRequestMessage, PopupResponseMessage } from './popup-api';
import type { SessionRuntimeStatus, UserSettings } from './contracts';

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

