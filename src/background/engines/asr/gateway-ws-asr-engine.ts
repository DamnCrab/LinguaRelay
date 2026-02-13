import type { AsrCallbacks, AsrEngine, AsrAudioChunk } from '../contracts';
import type { PlaybackState, StreamContext } from '../../../shared/contracts';
import { log } from '../../../shared/logger';

interface GatewayEnvelope {
  type: string;
  text?: string;
  isFinal?: boolean;
  startMs?: number;
  endMs?: number;
  language?: string;
  revision?: number;
  code?: string;
  message?: string;
  stats?: Record<string, number>;
}

interface GatewayWsAsrEngineOptions {
  wsUrl: string;
  apiKey?: string;
  model: string;
  language: string;
  endpointHeaders?: Record<string, string>;
}

export class GatewayWsAsrEngine implements AsrEngine {
  public readonly key: string;

  private ws: WebSocket | null = null;
  private callbacks: AsrCallbacks | null = null;
  private reconnectCount = 0;
  private isDisposed = false;

  constructor(private readonly options: GatewayWsAsrEngineOptions) {
    this.key = `asr:gateway:${options.model}:${options.language}`;
  }

  public async initialize(context: StreamContext, callbacks: AsrCallbacks): Promise<void> {
    this.callbacks = callbacks;
    this.isDisposed = false;
    await this.connect(context);
  }

  public async pushAudio(chunk: AsrAudioChunk): Promise<void> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    ws.send(
      JSON.stringify({
        type: 'audio-meta',
        sampleRate: chunk.sampleRate,
        channels: chunk.channels,
        sessionTimestampMs: chunk.sessionTimestampMs,
      }),
    );
    ws.send(chunk.pcm16);
  }

  public async setPlaybackState(state: PlaybackState): Promise<void> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    ws.send(
      JSON.stringify({
        type: 'playback-state',
        state,
      }),
    );
  }

  public async dispose(): Promise<void> {
    this.isDisposed = true;
    this.callbacks = null;

    const ws = this.ws;
    this.ws = null;
    if (!ws) {
      return;
    }

    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.close(1000, 'disposed');
  }

  private async connect(context: StreamContext): Promise<void> {
    const url = new URL(this.options.wsUrl);
    url.searchParams.set('model', this.options.model);
    url.searchParams.set('language', this.options.language);
    url.searchParams.set('sourceUrl', context.url);
    if (this.options.apiKey) {
      url.searchParams.set('apiKey', this.options.apiKey);
    }

    const ws = new WebSocket(url.toString());
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'session-init',
          stream: {
            url: context.url,
            title: context.title,
            isLive: context.isLive,
            playbackRate: context.playbackRate,
            startedAt: context.startedAt,
          },
          endpointHeaders: this.options.endpointHeaders,
        }),
      );
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        return;
      }

      let envelope: GatewayEnvelope;
      try {
        envelope = JSON.parse(event.data) as GatewayEnvelope;
      } catch {
        return;
      }

      this.handleEnvelope(envelope);
    };

    ws.onerror = () => {
      this.callbacks?.onError({
        code: 'ASR_WS_ERROR',
        message: 'ASR websocket error.',
        fatal: false,
      });
    };

    ws.onclose = (event) => {
      if (this.isDisposed) {
        return;
      }

      if (event.code !== 1000) {
        this.reconnectCount += 1;
        this.callbacks?.onStats?.({ reconnectCount: this.reconnectCount });
        log('warn', 'asr-gateway', 'websocket closed unexpectedly', event.code);
      }
    };

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener(
        'open',
        () => {
          this.ws = ws;
          resolve();
        },
        { once: true },
      );
      ws.addEventListener(
        'error',
        () => {
          reject(new Error('ASR websocket connection failed'));
        },
        { once: true },
      );
    });
  }

  private handleEnvelope(envelope: GatewayEnvelope): void {
    const callbacks = this.callbacks;
    if (!callbacks) {
      return;
    }

    switch (envelope.type) {
      case 'partial':
      case 'final': {
        if (!envelope.text) {
          return;
        }

        callbacks.onSegment({
          text: envelope.text,
          isFinal: envelope.type === 'final' || Boolean(envelope.isFinal),
          startMs: envelope.startMs,
          endMs: envelope.endMs,
          language: envelope.language,
          revision: envelope.revision ?? Date.now(),
          createdAt: Date.now(),
        });
        return;
      }
      case 'stats': {
        callbacks.onStats?.(envelope.stats ?? {});
        return;
      }
      case 'error': {
        callbacks.onError({
          code: envelope.code ?? 'ASR_REMOTE_ERROR',
          message: envelope.message ?? 'Unknown ASR remote error',
          fatal: false,
        });
        return;
      }
      default:
        return;
    }
  }
}

