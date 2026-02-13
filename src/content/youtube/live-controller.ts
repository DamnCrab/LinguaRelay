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
  YOUTUBE_HOST_PATTERN,
} from '../../shared/constants';
import { log } from '../../shared/logger';
import { AudioCapture } from './audio-capture';
import { SubtitleOverlay } from './subtitle-overlay';

const LIVE_SELECTORS = [
  '.ytp-live-badge',
  '.badge-style-type-live-now-alternate',
  'ytd-badge-supported-renderer[aria-label*="LIVE"]',
  '[overlay-style="LIVE"]',
];

export class YouTubeLiveController {
  private readonly overlay = new SubtitleOverlay();
  private capture: AudioCapture | null = null;
  private port: chrome.runtime.Port | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private mutationObserver: MutationObserver | null = null;
  private video: HTMLVideoElement | null = null;
  private active = false;
  private startedAt = 0;
  private evaluateTimer: ReturnType<typeof setTimeout> | null = null;

  public start(): void {
    if (!YOUTUBE_HOST_PATTERN.test(location.hostname)) {
      return;
    }

    this.overlay.attach();
    this.overlay.setStatus('等待直播检测...');

    this.observeDom();
    this.bindNavigationSignals();
    this.bindPageLifecycle();

    this.evaluateAndSync('initial');
  }

  public async dispose(reason = 'controller_dispose'): Promise<void> {
    this.active = false;
    this.clearEvaluateTimer();

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

    this.unbindVideoEvents();
    this.video = null;
    this.overlay.dispose();
  }

  private observeDom(): void {
    const observer = new MutationObserver(() => {
      this.scheduleEvaluate('dom_mutation', 200);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    this.mutationObserver = observer;
  }

  private bindNavigationSignals(): void {
    window.addEventListener('yt-navigate-start', () => {
      this.active = false;
      this.overlay.setStatus('页面跳转中，暂停转写...');
      void this.stopCapture();
    });

    window.addEventListener('yt-navigate-finish', () => {
      this.scheduleEvaluate('yt_navigate_finish', 300);
    });

    window.addEventListener('popstate', () => {
      this.scheduleEvaluate('popstate', 300);
    });
  }

  private bindPageLifecycle(): void {
    window.addEventListener('beforeunload', () => {
      void this.dispose('beforeunload');
    });

    window.addEventListener('pagehide', () => {
      void this.dispose('pagehide');
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.safePost({
          type: 'PLAYBACK_STATE',
          payload: { state: 'paused' },
        });
      } else {
        this.safePost({
          type: 'PLAYBACK_STATE',
          payload: { state: 'playing' },
        });
      }
    });
  }

  private scheduleEvaluate(reason: string, delayMs: number): void {
    this.clearEvaluateTimer();
    this.evaluateTimer = setTimeout(() => {
      this.evaluateAndSync(reason);
    }, delayMs);
  }

  private clearEvaluateTimer(): void {
    if (!this.evaluateTimer) {
      return;
    }

    clearTimeout(this.evaluateTimer);
    this.evaluateTimer = null;
  }

  private evaluateAndSync(reason: string): void {
    const video = this.findVideo();
    const isLive = this.detectLive(video);
    const isWatchPage = this.isWatchPage(location.href);

    if (!video || !isWatchPage || !isLive) {
      this.active = false;
      this.overlay.setStatus('当前页面不是直播，等待中...');
      void this.stopCapture();
      this.unbindVideoEvents();
      return;
    }

    if (this.video !== video) {
      this.unbindVideoEvents();
      this.video = video;
      this.bindVideoEvents(video);
    }

    if (!this.active) {
      this.active = true;
      this.startedAt = Date.now();
      this.ensurePort();
      this.overlay.setStatus(`已连接直播 (${reason})`);
      this.sendSessionInit(video);
    }

    if (!video.paused) {
      void this.startCapture(video);
    }
  }

  private ensurePort(): void {
    if (this.port) {
      return;
    }

    const port = chrome.runtime.connect({ name: VT_PORT_NAME });
    port.onMessage.addListener((raw: unknown) => this.handleBackgroundMessage(raw));
    port.onDisconnect.addListener(() => {
      this.port = null;
      if (this.active) {
        this.overlay.setStatus('后台连接断开，尝试重连...');
        setTimeout(() => {
          if (!this.active) {
            return;
          }
          this.ensurePort();
          if (this.video) {
            this.sendSessionInit(this.video);
          }
        }, 1200);
      }
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

  private sendSessionInit(video: HTMLVideoElement): void {
    const streamContext: StreamContext = {
      url: location.href,
      title: document.title,
      isLive: true,
      startedAt: this.startedAt,
      playbackRate: video.playbackRate,
      videoId: this.extractVideoId(location.href),
    };

    this.safePost({
      type: 'SESSION_INIT',
      version: VT_CHANNEL_VERSION,
      payload: streamContext,
    });
  }

  private handleBackgroundMessage(raw: unknown): void {
    const message = raw as BackgroundToContentMessage;
    if (!message || typeof message !== 'object' || !('type' in message)) {
      return;
    }

    switch (message.type) {
      case 'SESSION_READY': {
        this.overlay.setStatus(`ASR 引擎: ${message.payload.engine}`);
        return;
      }
      case 'TRANSCRIPT_UPDATE': {
        this.overlay.update(message.payload);
        return;
      }
      case 'SESSION_ERROR': {
        this.overlay.setStatus(`错误(${message.payload.code}): ${message.payload.message}`);
        if (message.payload.fatal) {
          void this.stopCapture();
        }
        return;
      }
      case 'SESSION_STOPPED': {
        this.overlay.setStatus(`已停止: ${message.payload.reason}`);
        return;
      }
      case 'SESSION_STATS': {
        this.overlay.setStatus(
          `运行中 | 丢弃:${message.payload.droppedAudioChunks} | 队列:${message.payload.pendingAudioChunks} | 重连:${message.payload.reconnectCount}`,
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
      log('warn', 'yt-controller', 'failed to post message', error);
    }
  }

  private async startCapture(video: HTMLVideoElement): Promise<void> {
    if (this.capture) {
      return;
    }

    const capture = new AudioCapture(video, (pcm16, sampleRate) => {
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
      this.safePost({
        type: 'PLAYBACK_STATE',
        payload: { state: 'playing' },
      });
    } catch (error) {
      log('error', 'yt-controller', 'audio capture start failed', error);
      this.overlay.setStatus('音频采集启动失败，检查浏览器自动播放/音频权限');
    }
  }

  private async stopCapture(): Promise<void> {
    const capture = this.capture;
    this.capture = null;
    if (!capture) {
      return;
    }

    await capture.stop();
    this.safePost({
      type: 'PLAYBACK_STATE',
      payload: { state: 'paused' },
    });
  }

  private bindVideoEvents(video: HTMLVideoElement): void {
    video.addEventListener('play', this.onVideoPlay);
    video.addEventListener('pause', this.onVideoPause);
    video.addEventListener('stalled', this.onVideoStalled);
    video.addEventListener('ended', this.onVideoEnded);
    video.addEventListener('ratechange', this.onVideoRateChange);
  }

  private unbindVideoEvents(): void {
    if (!this.video) {
      return;
    }

    this.video.removeEventListener('play', this.onVideoPlay);
    this.video.removeEventListener('pause', this.onVideoPause);
    this.video.removeEventListener('stalled', this.onVideoStalled);
    this.video.removeEventListener('ended', this.onVideoEnded);
    this.video.removeEventListener('ratechange', this.onVideoRateChange);
  }

  private onVideoPlay = (): void => {
    if (!this.video) {
      return;
    }

    void this.startCapture(this.video);
  };

  private onVideoPause = (): void => {
    this.safePost({
      type: 'PLAYBACK_STATE',
      payload: { state: 'paused' as PlaybackState },
    });
    void this.stopCapture();
  };

  private onVideoStalled = (): void => {
    this.safePost({
      type: 'PLAYBACK_STATE',
      payload: { state: 'stalled' },
    });
  };

  private onVideoEnded = (): void => {
    this.safePost({
      type: 'PLAYBACK_STATE',
      payload: { state: 'ended' },
    });
    void this.stopCapture();
  };

  private onVideoRateChange = (): void => {
    this.safePost({
      type: 'PLAYBACK_STATE',
      payload: {
        state: this.video?.paused ? 'paused' : 'playing',
      },
    });
  };

  private findVideo(): HTMLVideoElement | null {
    return document.querySelector('video.html5-main-video, video.video-stream.html5-main-video');
  }

  private detectLive(video: HTMLVideoElement | null): boolean {
    if (!video) {
      return false;
    }

    if (Number.isFinite(video.duration) && video.duration > 0) {
      for (const selector of LIVE_SELECTORS) {
        if (document.querySelector(selector)) {
          return true;
        }
      }

      const badges = [...document.querySelectorAll('[aria-label], [title], .ytp-time-display')]
        .map((node) => (node.textContent ?? '').trim().toUpperCase())
        .filter(Boolean);
      return badges.some((value) => value.includes('LIVE'));
    }

    return true;
  }

  private isWatchPage(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.pathname === '/watch';
    } catch {
      return false;
    }
  }

  private extractVideoId(url: string): string | undefined {
    try {
      const parsed = new URL(url);
      const value = parsed.searchParams.get('v');
      return value ?? undefined;
    } catch {
      return undefined;
    }
  }
}



