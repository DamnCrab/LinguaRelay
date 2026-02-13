import type { AsrAudioChunk, AsrCallbacks, AsrEngine } from '../contracts';
import type { PlaybackState, StreamContext } from '../../../shared/contracts';

const LOCAL_ONNX_ENGINE_IMPLEMENTED = false;
const LOCAL_ONNX_ENGINE_DISABLED_REASON =
  'Local @huggingface/transformers runtime worker is not enabled in this build.';

export class LocalOnnxAsrEngine implements AsrEngine {
  public readonly key: string;

  constructor(
    private readonly model: string,
    private readonly precision: string,
    private readonly backend: 'webgpu' | 'wasm',
  ) {
    this.key = `asr:local:${model}:${precision}:${backend}`;
  }

  public async initialize(_context: StreamContext, callbacks: AsrCallbacks): Promise<void> {
    if (this.backend === 'webgpu' && !isWebGpuAvailable()) {
      callbacks.onError({
        code: 'LOCAL_BACKEND_UNSUPPORTED',
        message: 'Selected local backend "webgpu" is not supported in current browser environment.',
        fatal: true,
      });
      return;
    }

    if (this.backend === 'wasm' && !isWasmAvailable()) {
      callbacks.onError({
        code: 'LOCAL_BACKEND_UNSUPPORTED',
        message: 'Selected local backend "wasm" is not supported in current browser environment.',
        fatal: true,
      });
      return;
    }

    callbacks.onError({
      code: 'LOCAL_ONNX_NOT_IMPLEMENTED',
      message:
        `Local @huggingface/transformers runtime (${this.model}/${this.precision}/${this.backend}) ` +
        `is not enabled in this build. ${LOCAL_ONNX_ENGINE_DISABLED_REASON}`,
      fatal: true,
    });
  }

  public async pushAudio(_chunk: AsrAudioChunk): Promise<void> {
    return;
  }

  public async setPlaybackState(_state: PlaybackState): Promise<void> {
    return;
  }

  public async dispose(): Promise<void> {
    return;
  }
}

function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

function isWasmAvailable(): boolean {
  return typeof WebAssembly !== 'undefined';
}

export function isLocalOnnxEngineImplemented(): boolean {
  return LOCAL_ONNX_ENGINE_IMPLEMENTED;
}

export function getLocalOnnxEngineDisabledReason(): string {
  return LOCAL_ONNX_ENGINE_DISABLED_REASON;
}

