import type { AsrAudioChunk, AsrCallbacks, AsrEngine } from '../contracts';
import type { PlaybackState, StreamContext } from '../../../shared/contracts';

export class LocalOnnxAsrEngine implements AsrEngine {
  public readonly key: string;

  constructor(private readonly model: string, private readonly precision: string) {
    this.key = `asr:local:${model}:${precision}`;
  }

  public async initialize(_context: StreamContext, callbacks: AsrCallbacks): Promise<void> {
    callbacks.onError({
      code: 'LOCAL_ONNX_NOT_IMPLEMENTED',
      message:
        `Local ONNX runtime (${this.model}/${this.precision}) is not enabled in this build. ` +
        'Switch to online-gateway ASR or add local worker implementation.',
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

