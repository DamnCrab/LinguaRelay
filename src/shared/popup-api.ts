import type { SessionRuntimeStatus, UserSettings } from './contracts';
import type {
  CachedModelFileSummary,
  CachedModelSummary,
} from './model-cache';
import type { ModelVariantSelection } from './model-adapters/contracts';
import type { StartupCheckResult } from './startup-checks';
import type { DebugEventInput, DebugEventRecord, DebugState } from './debug-events';

export type PopupRequestMessage =
  | { type: 'GET_SETTINGS' }
  | { type: 'SET_SETTINGS'; payload: UserSettings }
  | { type: 'LIST_SESSIONS' }
  | { type: 'GET_RUNTIME_INFO' }
  | { type: 'LIST_MODEL_CACHE' }
  | { type: 'GET_MODEL_FILES'; payload: { modelId: string } }
  | { type: 'DOWNLOAD_MODEL_VARIANT'; payload: ModelVariantSelection }
  | { type: 'DELETE_MODEL'; payload: { modelId: string } }
  | { type: 'CANCEL_MODEL_DOWNLOAD'; payload: { modelId: string } }
  | { type: 'RUN_STARTUP_CHECKS' }
  | { type: 'GET_DEBUG_STATE' }
  | { type: 'SET_DEBUG_STATE'; payload: { enabled: boolean } }
  | { type: 'LIST_DEBUG_EVENTS'; payload?: { limit?: number } }
  | { type: 'CLEAR_DEBUG_EVENTS' }
  | { type: 'REPORT_DEBUG_EVENT'; payload: DebugEventInput };

export type PopupResponseMessage =
  | { type: 'SETTINGS'; payload: UserSettings }
  | { type: 'SESSIONS'; payload: SessionRuntimeStatus[] }
  | { type: 'MODEL_CACHE'; payload: CachedModelSummary[] }
  | { type: 'MODEL_FILES'; payload: CachedModelFileSummary[] }
  | { type: 'MODEL_DOWNLOAD_ACCEPTED'; payload: { modelId: string } }
  | { type: 'STARTUP_CHECKS'; payload: StartupCheckResult }
  | {
      type: 'RUNTIME_INFO';
      payload: {
        browser: string;
        support: {
          webgpu: boolean;
          wasm: boolean;
          sharedWorker: boolean;
          audioWorklet: boolean;
        };
      };
    }
  | { type: 'DEBUG_STATE'; payload: DebugState }
  | { type: 'DEBUG_EVENTS'; payload: DebugEventRecord[] }
  | { type: 'OK' }
  | {
      type: 'ERROR';
      payload: {
        message: string;
      };
    };

