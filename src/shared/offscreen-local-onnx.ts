export const LOCAL_ONNX_OFFSCREEN_MESSAGE_TYPE = 'LOCAL_ONNX_OFFSCREEN_REQUEST';

export interface LocalOnnxInitPayload {
  modelId: string;
  sourceRepo: string;
  precision: string;
  backend: 'webgpu' | 'wasm';
}

export interface LocalOnnxTranscribePayload {
  audioBuffer: ArrayBuffer;
  language: string;
}

export interface LocalOnnxWhisperTimestampChunk {
  timestamp?: [number, number];
}

export interface LocalOnnxWhisperOutput {
  text?: string;
  chunks?: LocalOnnxWhisperTimestampChunk[];
}

export type LocalOnnxOffscreenRequest =
  | {
      id: number;
      type: 'INIT';
      payload: LocalOnnxInitPayload;
    }
  | {
      id: number;
      type: 'TRANSCRIBE';
      payload: LocalOnnxTranscribePayload;
    }
  | {
      id: number;
      type: 'DISPOSE';
      payload: Record<string, never>;
    };

export type LocalOnnxOffscreenResponse =
  | {
      id: number;
      ok: true;
      payload: { ok: true } | LocalOnnxWhisperOutput;
    }
  | {
      id: number;
      ok: false;
      error: string;
    };

export interface LocalOnnxOffscreenRequestMessage {
  type: typeof LOCAL_ONNX_OFFSCREEN_MESSAGE_TYPE;
  payload: LocalOnnxOffscreenRequest;
}
