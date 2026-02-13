import type {
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  PlaybackState,
  StreamContext,
} from '../../shared/contracts';
import {
  SESSION_HEARTBEAT_INTERVAL_MS,
  VT_CHANNEL_VERSION,
  VT_PORT_NAME,
} from '../../shared/constants';
import { log } from '../../shared/logger';
import { reportContentDebug } from '../debug-report';
import { AudioCapture } from '../youtube/audio-capture';
import { SubtitleOverlay } from '../youtube/subtitle-overlay';

const MEDIA_SELECTOR = 'video, audio';

export class GenericVideoController {
  private readonly overlay: SubtitleOverlay;
  private capture: AudioCapture | null = null;
  private port: chrome.runtime.Port | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private mutationObserver: MutationObserver | null = null;
  private media: HTMLMediaElement | null = null;
  private active = false;
  private startedAt = 0;

  constructor(siteId: string) {
    this.overlay = new SubtitleOverlay({
      siteId,
      title: `LinguaRelay ${location.hostname}`,
      autoSnapSupported: false,
      getAnchorRect: () => this.media?.getBoundingClientRect() ?? null,
    });
  }

  public start(): void {
    reportContentDebug({
      scope: 'generic-video-controller',
      message: 'controller started',
      level: 'info',
    });
    this.overlay.attach();
    this.overlay.setStatus('Scanning media elements on this site...');
    this.bindPageLifecycle();
    this.observeDom();
    this.evaluateAndSync('initial');
  }

  public async dispose(reason = 'generic_video_dispose'): Promise<void> {
    reportContentDebug({
      scope: 'generic-video-controller',
      message: 'controller disposed',
      level: 'info',
      details: reason,
    });
    this.active = false;
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    await this.stopCapture();

    if (this.port) {
      this.safePost({ type: 'SESSION_STOP', payload: { reason } });
      this.port.disconnect();
      this.port = null;
    }

    this.unbindMediaEvents();
    this.media = null;
    this.overlay.dispose();
  }

  private bindPageLifecycle(): void {
    window.addEventListener('beforeunload', () => {
      void this.dispose('beforeunload');
    });

    window.addEventListener('pagehide', () => {
      void this.dispose('pagehide');
    });
  }

  private observeDom(): void {
    const observer = new MutationObserver(() => {
      this.evaluateAndSync('dom_mutation');
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    this.mutationObserver = observer;
  }

  private evaluateAndSync(reason: string): void {
    const media = this.findMedia();
    if (!media) {
      this.active = false;
      this.overlay.setStatus('No media element found on this page.');
      void this.stopCapture();
      this.unbindMediaEvents();
      return;
    }

    if (this.media !== media) {
      this.unbindMediaEvents();
      this.media = media;
      this.bindMediaEvents(media);
    }

    if (!this.active) {
      this.active = true;
      this.startedAt = Date.now();
      this.ensurePort();
      reportContentDebug({
        scope: 'generic-video-controller',
        message: 'session init',
        level: 'info',
        details: reason,
      });
      this.overlay.setStatus(`Session initialized (${reason})`);
      this.sendSessionInit(media);
    }

    if (!media.paused && !media.ended) {
      void this.startCapture(media);
    }
  }

  private findMedia(): HTMLMediaElement | null {
    const mediaNodes = [...document.querySelectorAll<HTMLMediaElement>(MEDIA_SELECTOR)];
    if (mediaNodes.length === 0) {
      return null;
    }

    const playing = mediaNodes.find((node) => !node.paused && !node.ended);
    if (playing) {
      return playing;
    }

    const video = mediaNodes.find((node) => node.tagName.toLowerCase() === 'video');
    return video ?? mediaNodes[0] ?? null;
  }

  private ensurePort(): void {
    if (this.port) {
      return;
    }

    const port = chrome.runtime.connect({ name: VT_PORT_NAME });
    port.onMessage.addListener((raw: unknown) => this.handleBackgroundMessage(raw));
    port.onDisconnect.addListener(() => {
      this.port = null;
      if (!this.active) {
        return;
      }
      this.overlay.setStatus('Background disconnected, reconnecting...');
      reportContentDebug({
        scope: 'generic-video-controller',
        message: 'background disconnected',
        level: 'warn',
      });
      setTimeout(() => {
        if (!this.active) {
          return;
        }
        this.ensurePort();
        if (this.media) {
          this.sendSessionInit(this.media);
        }
      }, 1000);
    });

    this.port = port;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.heartbeatTimer = setInterval(() => {
      this.safePost({
        type: 'HEARTBEAT',
        payload: { now: Date.now() },
      });
    }, SESSION_HEARTBEAT_INTERVAL_MS);
  }

  private sendSessionInit(media: HTMLMediaElement): void {
    const context: StreamContext = {
      url: location.href,
      title: document.title || 'Generic media page',
      isLive: true,
      startedAt: this.startedAt,
      playbackRate: media.playbackRate,
    };

    this.safePost({
      type: 'SESSION_INIT',
      version: VT_CHANNEL_VERSION,
      payload: context,
    });
    reportContentDebug({
      scope: 'generic-video-controller',
      message: 'SESSION_INIT sent',
      details: context.url,
    });
  }

  private handleBackgroundMessage(raw: unknown): void {
    const message = raw as BackgroundToContentMessage;
    if (!message || typeof message !== 'object' || !('type' in message)) {
      return;
    }

    switch (message.type) {
      case 'SESSION_READY': {
        this.overlay.setStatus(`ASR engine: ${message.payload.engine}`);
        return;
      }
      case 'TRANSCRIPT_UPDATE': {
        this.overlay.update(message.payload);
        return;
      }
      case 'SESSION_ERROR': {
        this.overlay.setStatus(`Error(${message.payload.code}): ${message.payload.message}`);
        reportContentDebug({
          scope: 'generic-video-controller',
          message: `SESSION_ERROR ${message.payload.code}`,
          level: message.payload.fatal ? 'error' : 'warn',
          details: message.payload.message,
        });
        if (message.payload.fatal) {
          void this.stopCapture();
        }
        return;
      }
      case 'SESSION_STOPPED': {
        this.overlay.setStatus(`Stopped: ${message.payload.reason}`);
        return;
      }
      case 'SESSION_STATS': {
        this.overlay.setStatus(
          `Running | dropped:${message.payload.droppedAudioChunks} | queue:${message.payload.pendingAudioChunks} | reconnect:${message.payload.reconnectCount}`,
        );
        return;
      }
      default:
        return;
    }
  }

  private safePost(message: ContentToBackgroundMessage): void {
    try {
      this.port?.postMessage(message);
    } catch (error) {
      log('warn', 'generic-video-controller', 'failed to post message', error);
      reportContentDebug({
        scope: 'generic-video-controller',
        message: 'post message failed',
        level: 'warn',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async startCapture(media: HTMLMediaElement): Promise<void> {
    if (this.capture) {
      return;
    }

    const capture = new AudioCapture(media, (pcm16, sampleRate) => {
      this.safePost({
        type: 'AUDIO_CHUNK',
        payload: {
          sessionTimestampMs: Date.now(),
          sampleRate,
          channels: 1,
          pcm16,
        },
      });
    });

    try {
      await capture.start();
      this.capture = capture;
      reportContentDebug({
        scope: 'generic-video-controller',
        message: 'audio capture started',
        level: 'info',
      });
      this.safePost({
        type: 'PLAYBACK_STATE',
        payload: { state: 'playing' },
      });
    } catch (error) {
      log('error', 'generic-video-controller', 'audio capture start failed', error);
      reportContentDebug({
        scope: 'generic-video-controller',
        message: 'audio capture failed',
        level: 'error',
        details: error instanceof Error ? error.message : String(error),
      });
      this.overlay.setStatus('Audio capture failed. Check autoplay/audio permissions.');
    }
  }

  private async stopCapture(): Promise<void> {
    const capture = this.capture;
    this.capture = null;
    if (!capture) {
      return;
    }

    await capture.stop();
    reportContentDebug({
      scope: 'generic-video-controller',
      message: 'audio capture stopped',
      level: 'info',
    });
    this.safePost({
      type: 'PLAYBACK_STATE',
      payload: { state: 'paused' },
    });
  }

  private bindMediaEvents(media: HTMLMediaElement): void {
    media.addEventListener('play', this.onMediaPlay);
    media.addEventListener('pause', this.onMediaPause);
    media.addEventListener('ended', this.onMediaEnded);
    media.addEventListener('stalled', this.onMediaStalled);
    media.addEventListener('ratechange', this.onMediaRateChange);
  }

  private unbindMediaEvents(): void {
    if (!this.media) {
      return;
    }

    this.media.removeEventListener('play', this.onMediaPlay);
    this.media.removeEventListener('pause', this.onMediaPause);
    this.media.removeEventListener('ended', this.onMediaEnded);
    this.media.removeEventListener('stalled', this.onMediaStalled);
    this.media.removeEventListener('ratechange', this.onMediaRateChange);
  }

  private onMediaPlay = (): void => {
    if (!this.media) {
      return;
    }
    void this.startCapture(this.media);
  };

  private onMediaPause = (): void => {
    this.safePost({
      type: 'PLAYBACK_STATE',
      payload: { state: 'paused' as PlaybackState },
    });
    void this.stopCapture();
  };

  private onMediaEnded = (): void => {
    this.safePost({
      type: 'PLAYBACK_STATE',
      payload: { state: 'ended' },
    });
    void this.stopCapture();
  };

  private onMediaStalled = (): void => {
    this.safePost({
      type: 'PLAYBACK_STATE',
      payload: { state: 'stalled' },
    });
  };

  private onMediaRateChange = (): void => {
    this.safePost({
      type: 'PLAYBACK_STATE',
      payload: { state: this.media?.paused ? 'paused' : 'playing' },
    });
  };
}
