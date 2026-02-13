export type SessionId = string;

export type TranslationProvider = 'none' | 'openai-compatible';
export type AsrMode = 'online-gateway' | 'local-onnx';

export interface AsrOnlineConfig {
  mode: 'online-gateway';
  wsUrl: string;
  apiKey?: string;
  model: string;
  language: string;
  endpointHeaders?: Record<string, string>;
}

export interface AsrLocalConfig {
  mode: 'local-onnx';
  model: 'whisper-large-v3-turbo' | 'whisper-large-v3-onnx';
  precision: 'q4f16' | 'q4' | 'fp16';
  backend: 'webgpu' | 'wasm';
  language: string;
}

export type AsrConfig = AsrOnlineConfig | AsrLocalConfig;

export interface TranslationConfig {
  enabled: boolean;
  provider: TranslationProvider;
  targetLanguage: string;
  sourceLanguage: string;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  temperature: number;
}

export interface RuntimeConfig {
  maxSessions: number;
  engineIdleDisposeMs: number;
  partialTranslation: boolean;
  maxPendingAudioChunks: number;
}

export interface UiConfig {
  locale: string;
}

export interface ModelHubConfig {
  huggingFaceToken?: string;
}

export interface UserSettings {
  asr: AsrConfig;
  translation: TranslationConfig;
  runtime: RuntimeConfig;
  ui: UiConfig;
  modelHub: ModelHubConfig;
}

export interface StreamContext {
  url: string;
  title?: string;
  isLive: boolean;
  startedAt: number;
  playbackRate: number;
  videoId?: string;
}

export interface TranscriptSegment {
  text: string;
  translatedText?: string;
  isFinal: boolean;
  startMs?: number;
  endMs?: number;
  language?: string;
  revision: number;
  createdAt: number;
}

export type PlaybackState = 'playing' | 'paused' | 'stalled' | 'ended';

export type ContentToBackgroundMessage =
  | {
      type: 'SESSION_INIT';
      version: number;
      payload: StreamContext;
    }
  | {
      type: 'AUDIO_CHUNK';
      payload: {
        sessionTimestampMs: number;
        sampleRate: number;
        channels: 1;
        pcm16: ArrayBuffer;
      };
    }
  | {
      type: 'PLAYBACK_STATE';
      payload: {
        state: PlaybackState;
      };
    }
  | {
      type: 'HEARTBEAT';
      payload: {
        now: number;
      };
    }
  | {
      type: 'SESSION_STOP';
      payload: {
        reason: string;
      };
    };

export type BackgroundToContentMessage =
  | {
      type: 'SESSION_READY';
      payload: {
        sessionId: SessionId;
        engine: string;
      };
    }
  | {
      type: 'TRANSCRIPT_UPDATE';
      payload: TranscriptSegment;
    }
  | {
      type: 'SESSION_ERROR';
      payload: {
        code: string;
        message: string;
        fatal: boolean;
      };
    }
  | {
      type: 'SESSION_STOPPED';
      payload: {
        reason: string;
      };
    }
  | {
      type: 'SESSION_STATS';
      payload: {
        droppedAudioChunks: number;
        pendingAudioChunks: number;
        reconnectCount: number;
      };
    };

export interface SessionRuntimeStatus {
  sessionId: SessionId;
  tabId: number;
  frameId: number;
  state: 'idle' | 'running' | 'paused' | 'closed' | 'error';
  isLive: boolean;
  createdAt: number;
  updatedAt: number;
  asrEngine: string;
  droppedAudioChunks: number;
}

