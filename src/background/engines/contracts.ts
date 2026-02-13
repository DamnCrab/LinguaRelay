import type {
  AsrConfig,
  PlaybackState,
  StreamContext,
  TranscriptSegment,
  TranslationConfig,
} from '../../shared/contracts';

export interface AsrAudioChunk {
  sampleRate: number;
  channels: 1;
  pcm16: ArrayBuffer;
  sessionTimestampMs: number;
}

export interface AsrCallbacks {
  onSegment: (segment: TranscriptSegment) => void;
  onError: (error: { code: string; message: string; fatal: boolean }) => void;
  onStats?: (stats: Record<string, number>) => void;
}

export interface AsrEngine {
  readonly key: string;
  initialize(context: StreamContext, callbacks: AsrCallbacks): Promise<void>;
  pushAudio(chunk: AsrAudioChunk): Promise<void>;
  setPlaybackState(state: PlaybackState): Promise<void>;
  dispose(): Promise<void>;
}

export interface TranslatorEngine {
  readonly key: string;
  translate(input: {
    text: string;
    sourceLanguage: string;
    targetLanguage: string;
    isFinal: boolean;
  }): Promise<string>;
  dispose(): Promise<void>;
}

export interface EngineFactoryContext {
  asr: AsrConfig;
  translation: TranslationConfig;
}

