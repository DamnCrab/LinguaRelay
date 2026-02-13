import type { SessionRuntimeStatus, UserSettings } from './contracts';

export type PopupRequestMessage =
  | { type: 'GET_SETTINGS' }
  | { type: 'SET_SETTINGS'; payload: UserSettings }
  | { type: 'LIST_SESSIONS' }
  | { type: 'GET_RUNTIME_INFO' };

export type PopupResponseMessage =
  | { type: 'SETTINGS'; payload: UserSettings }
  | { type: 'SESSIONS'; payload: SessionRuntimeStatus[] }
  | {
      type: 'RUNTIME_INFO';
      payload: {
        browser: string;
        support: {
          webgpu: boolean;
          sharedWorker: boolean;
          audioWorklet: boolean;
        };
      };
    }
  | { type: 'OK' }
  | {
      type: 'ERROR';
      payload: {
        message: string;
      };
    };

