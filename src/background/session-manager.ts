import type {
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  SessionRuntimeStatus,
  StreamContext,
  UserSettings,
} from '../shared/contracts';
import {
  SESSION_HEARTBEAT_TIMEOUT_MS,
  VT_CHANNEL_VERSION,
} from '../shared/constants';
import { log } from '../shared/logger';
import { getSettings } from '../shared/settings';
import type { AsrAudioChunk, AsrEngine, TranslatorEngine } from './engines/contracts';
import { EnginePool } from './engines/engine-pool';
import {
  createAsrEngine,
  createTranslator,
  getAsrEngineKey,
  getTranslatorKey,
} from './engines/engine-registry';

type SessionDebugLevel = 'debug' | 'info' | 'warn' | 'error';

interface SessionEngines {
  asrKey: string;
  translatorKey: string;
  asr: AsrEngine;
  translator: TranslatorEngine;
}

class TabSession {
  private state: SessionRuntimeStatus['state'] = 'idle';
  private context: StreamContext | null = null;
  private settings: UserSettings | null = null;
  private engines: SessionEngines | null = null;
  private messageUnsubscribe: (() => void) | null = null;
  private disconnectUnsubscribe: (() => void) | null = null;
  private lastHeartbeatAt = Date.now();
  private droppedAudioChunks = 0;
  private pendingAudioChunks: AsrAudioChunk[] = [];
  private flushingAudio = false;
  private revision = 0;
  private reconnectCount = 0;
  private isDisposed = false;
  private receivedAudioChunks = 0;
  private pushedAudioChunks = 0;
  private lastAudioDebugAt = 0;
  private initInProgress = false;

  constructor(
    private readonly sessionId: string,
    private readonly tabId: number,
    private readonly frameId: number,
    private port: chrome.runtime.Port,
    private readonly deps: {
      loadSettings: () => Promise<UserSettings>;
      acquireAsr: (key: string, create: () => AsrEngine) => AsrEngine;
      releaseAsr: (key: string) => void;
      acquireTranslator: (key: string, create: () => TranslatorEngine) => TranslatorEngine;
      releaseTranslator: (key: string) => void;
      onClosed: (sessionId: string) => void;
      debug: (
        level: SessionDebugLevel,
        scope: string,
        message: string,
        details?: string,
        extra?: {
          sessionId?: string;
          tabId?: number;
          frameId?: number;
          url?: string;
        },
      ) => void;
    },
  ) {
    this.bindPort(port);
    this.debug('info', 'session.lifecycle', 'session attached');
  }

  public getRuntimeStatus(): SessionRuntimeStatus {
    return {
      sessionId: this.sessionId,
      tabId: this.tabId,
      frameId: this.frameId,
      state: this.state,
      isLive: this.context?.isLive ?? false,
      createdAt: this.context?.startedAt ?? Date.now(),
      updatedAt: this.lastHeartbeatAt,
      asrEngine: this.engines?.asr.key ?? 'n/a',
      droppedAudioChunks: this.droppedAudioChunks,
    };
  }

  public refreshHeartbeat(now = Date.now()): void {
    this.lastHeartbeatAt = now;
  }

  public isHeartbeatExpired(now = Date.now()): boolean {
    return now - this.lastHeartbeatAt > SESSION_HEARTBEAT_TIMEOUT_MS;
  }

  public replacePort(nextPort: chrome.runtime.Port): void {
    this.unbindPort();
    this.port = nextPort;
    this.bindPort(nextPort);
  }

  public async dispose(reason: string): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;
    this.state = 'closed';

    this.unbindPort();
    this.pendingAudioChunks.length = 0;

    const engines = this.engines;
    this.engines = null;

    if (engines) {
      this.deps.releaseAsr(engines.asrKey);
      this.deps.releaseTranslator(engines.translatorKey);
    }

    this.safePost({
      type: 'SESSION_STOPPED',
      payload: { reason },
    });

    this.debug('info', 'session.lifecycle', 'session disposed', reason);
    this.deps.onClosed(this.sessionId);
  }

  private bindPort(port: chrome.runtime.Port): void {
    const onMessage = (raw: unknown): void => {
      void this.handleIncoming(raw);
    };

    const onDisconnect = (): void => {
      void this.dispose('port_disconnected');
    };

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);

    this.messageUnsubscribe = () => port.onMessage.removeListener(onMessage);
    this.disconnectUnsubscribe = () => port.onDisconnect.removeListener(onDisconnect);
  }

  private unbindPort(): void {
    this.messageUnsubscribe?.();
    this.disconnectUnsubscribe?.();
    this.messageUnsubscribe = null;
    this.disconnectUnsubscribe = null;
  }

  private async handleIncoming(raw: unknown): Promise<void> {
    const message = raw as ContentToBackgroundMessage;
    if (!message || typeof message !== 'object' || !('type' in message)) {
      return;
    }

    switch (message.type) {
      case 'SESSION_INIT': {
        await this.handleSessionInit(message);
        return;
      }
      case 'AUDIO_CHUNK': {
        await this.handleAudioChunk(message.payload);
        return;
      }
      case 'PLAYBACK_STATE': {
        this.refreshHeartbeat();
        if (this.engines) {
          await this.engines.asr.setPlaybackState(message.payload.state);
          this.state = message.payload.state === 'paused' ? 'paused' : this.state;
        }
        return;
      }
      case 'HEARTBEAT': {
        this.refreshHeartbeat(message.payload.now);
        return;
      }
      case 'SESSION_STOP': {
        await this.dispose(message.payload.reason);
        return;
      }
      default:
        return;
    }
  }

  private async handleSessionInit(message: Extract<ContentToBackgroundMessage, { type: 'SESSION_INIT' }>): Promise<void> {
    if (this.initInProgress) {
      this.debug('warn', 'session.init', 'duplicate SESSION_INIT ignored');
      return;
    }
    this.initInProgress = true;
    this.refreshHeartbeat();

    if (message.version !== VT_CHANNEL_VERSION) {
      this.debug(
        'error',
        'session.init',
        'version mismatch',
        `expected=${VT_CHANNEL_VERSION}, got=${message.version}`,
      );
      this.safePost({
        type: 'SESSION_ERROR',
        payload: {
          code: 'VERSION_MISMATCH',
          message: `Version mismatch. expected=${VT_CHANNEL_VERSION}, got=${message.version}`,
          fatal: true,
        },
      });
      await this.dispose('version_mismatch');
      this.initInProgress = false;
      return;
    }

    if (!message.payload.isLive) {
      this.debug('error', 'session.init', 'stream is not live');
      this.safePost({
        type: 'SESSION_ERROR',
        payload: {
          code: 'NOT_LIVE_STREAM',
          message: 'Current YouTube video is not live.',
          fatal: true,
        },
      });
      await this.dispose('non_live');
      this.initInProgress = false;
      return;
    }

    this.context = message.payload;
    this.settings = await this.deps.loadSettings();
    this.debug(
      'info',
      'session.init',
      'settings loaded',
      `asr=${this.settings.asr.mode} translation=${this.settings.translation.enabled}`,
      { url: this.context.url },
    );

    const asrKey = getAsrEngineKey(this.settings.asr);
    const translatorKey = getTranslatorKey(this.settings.translation);

    const asr = this.deps.acquireAsr(asrKey, () => createAsrEngine(this.settings!.asr));
    const translator = this.deps.acquireTranslator(translatorKey, () =>
      createTranslator(this.settings!.translation),
    );

    this.engines = {
      asrKey,
      translatorKey,
      asr,
      translator,
    };

    let fatalInitError = false;
    try {
      await asr.initialize(this.context, {
        onSegment: (segment) => {
          void this.handleAsrSegment(
            segment.text,
            segment.isFinal,
            segment.language,
            segment.startMs,
            segment.endMs,
          );
        },
        onError: (error) => {
          this.safePost({ type: 'SESSION_ERROR', payload: error });
          this.debug(
            error.fatal ? 'error' : 'warn',
            'session.asr',
            `ASR error: ${error.code}`,
            error.message,
          );
          if (error.fatal) {
            fatalInitError = true;
            this.state = 'error';
            void this.dispose(error.code);
          }
        },
        onStats: (stats) => {
          const reconnect = stats.reconnectCount;
          if (typeof reconnect === 'number') {
            this.reconnectCount = reconnect;
          }

          this.safePost({
            type: 'SESSION_STATS',
            payload: {
              droppedAudioChunks: this.droppedAudioChunks,
              pendingAudioChunks: this.pendingAudioChunks.length,
              reconnectCount: this.reconnectCount,
            },
          });
        },
      });
    } catch (error) {
      this.safePost({
        type: 'SESSION_ERROR',
        payload: {
          code: 'ASR_INIT_FAILED',
          message: error instanceof Error ? error.message : 'ASR initialize failed',
          fatal: true,
        },
      });
      this.debug(
        'error',
        'session.asr',
        'ASR initialize threw',
        error instanceof Error ? error.stack ?? error.message : String(error),
      );
      this.state = 'error';
      await this.dispose('asr_init_failed');
      this.initInProgress = false;
      return;
    }

    if (this.isDisposed || fatalInitError) {
      this.initInProgress = false;
      return;
    }

    this.state = 'running';
    this.safePost({
      type: 'SESSION_READY',
      payload: {
        sessionId: this.sessionId,
        engine: asr.key,
      },
    });
    this.debug('info', 'session.init', 'session ready', asr.key);
    this.initInProgress = false;
  }

  private async handleAudioChunk(payload: {
    sessionTimestampMs: number;
    sampleRate: number;
    channels: 1;
    pcm16: ArrayBuffer;
  }): Promise<void> {
    this.refreshHeartbeat();

    if (this.state !== 'running' || !this.settings) {
      return;
    }

    if (!this.engines) {
      return;
    }

    const maxQueue = this.settings.runtime.maxPendingAudioChunks;
    if (this.pendingAudioChunks.length >= maxQueue) {
      this.droppedAudioChunks += 1;
      if (this.droppedAudioChunks % 10 === 0) {
        this.debug(
          'warn',
          'session.audio',
          'audio chunks dropped',
          `dropped=${this.droppedAudioChunks} queue=${this.pendingAudioChunks.length}`,
        );
      }
      return;
    }

    this.receivedAudioChunks += 1;
    this.pendingAudioChunks.push({
      sampleRate: payload.sampleRate,
      channels: payload.channels,
      pcm16: payload.pcm16,
      sessionTimestampMs: payload.sessionTimestampMs,
    });

    if (!this.flushingAudio) {
      this.flushingAudio = true;
      await this.flushAudioQueue();
      this.flushingAudio = false;
    }
  }

  private async flushAudioQueue(): Promise<void> {
    while (this.pendingAudioChunks.length > 0 && this.engines && !this.isDisposed) {
      const chunk = this.pendingAudioChunks.shift();
      if (!chunk) {
        continue;
      }

      try {
        await this.engines.asr.pushAudio(chunk);
        this.pushedAudioChunks += 1;
        this.debugAudioProgress();
      } catch (error) {
        log('warn', 'tab-session', 'failed to push audio chunk', error);
        this.debug(
          'warn',
          'session.audio',
          'failed to push audio chunk',
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  private async handleAsrSegment(
    text: string,
    isFinal: boolean,
    language?: string,
    startMs?: number,
    endMs?: number,
  ): Promise<void> {
    if (!this.engines || !this.settings) {
      return;
    }

    let translatedText: string | undefined;
    const shouldTranslate =
      this.settings.translation.enabled &&
      (isFinal || this.settings.runtime.partialTranslation);

    if (shouldTranslate) {
      try {
        translatedText = await this.engines.translator.translate({
          text,
          sourceLanguage: this.settings.translation.sourceLanguage,
          targetLanguage: this.settings.translation.targetLanguage,
          isFinal,
        });
      } catch (error) {
        log('warn', 'tab-session', 'translation failed', error);
        this.debug(
          'warn',
          'session.translation',
          'translation failed',
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    this.revision += 1;
    this.safePost({
      type: 'TRANSCRIPT_UPDATE',
      payload: {
        text,
        translatedText,
        isFinal,
        startMs,
        endMs,
        language,
        revision: this.revision,
        createdAt: Date.now(),
      },
    });
    this.debug(
      'debug',
      'session.transcript',
      `segment ${isFinal ? 'final' : 'partial'}`,
      `chars=${text.length} lang=${language ?? 'unknown'}`,
    );
  }

  private safePost(message: BackgroundToContentMessage): void {
    try {
      this.port.postMessage(message);
    } catch {
      void this.dispose('post_failed');
    }
  }

  private debug(
    level: SessionDebugLevel,
    scope: string,
    message: string,
    details?: string,
    extra?: {
      sessionId?: string;
      tabId?: number;
      frameId?: number;
      url?: string;
    },
  ): void {
    this.deps.debug(level, scope, message, details, {
      sessionId: this.sessionId,
      tabId: this.tabId,
      frameId: this.frameId,
      url: this.context?.url,
      ...extra,
    });
  }

  private debugAudioProgress(): void {
    const now = Date.now();
    if (now - this.lastAudioDebugAt < 1000) {
      return;
    }
    this.lastAudioDebugAt = now;
    this.debug(
      'debug',
      'session.audio',
      'audio flow',
      `received=${this.receivedAudioChunks} pushed=${this.pushedAudioChunks} queued=${this.pendingAudioChunks.length} dropped=${this.droppedAudioChunks}`,
    );
  }
}

export class SessionManager {
  private readonly sessions = new Map<string, TabSession>();
  private readonly asrPool = new EnginePool<AsrEngine>(() => this.settingsCache.runtime.engineIdleDisposeMs);
  private readonly translatorPool = new EnginePool<TranslatorEngine>(
    () => this.settingsCache.runtime.engineIdleDisposeMs,
  );
  private readonly healthTimer: ReturnType<typeof setInterval>;

  private settingsCache: UserSettings;

  private constructor(
    initialSettings: UserSettings,
    private readonly debug: (
      level: SessionDebugLevel,
      scope: string,
      message: string,
      details?: string,
      extra?: {
        sessionId?: string;
        tabId?: number;
        frameId?: number;
        url?: string;
      },
    ) => void,
  ) {
    this.settingsCache = initialSettings;
    this.healthTimer = setInterval(() => {
      void this.cleanupExpiredSessions();
    }, 5_000);
  }

  public static async create(
    debug: (
      level: SessionDebugLevel,
      scope: string,
      message: string,
      details?: string,
      extra?: {
        sessionId?: string;
        tabId?: number;
        frameId?: number;
        url?: string;
      },
    ) => void = () => undefined,
  ): Promise<SessionManager> {
    const settings = await getSettings();
    return new SessionManager(settings, debug);
  }

  public attachPort(port: chrome.runtime.Port): void {
    const tabId = port.sender?.tab?.id;
    const frameId = port.sender?.frameId ?? 0;

    if (typeof tabId !== 'number') {
      port.disconnect();
      return;
    }

    this.debug(
      'info',
      'session.manager',
      'port connected',
      undefined,
      { tabId, frameId, url: port.sender?.url },
    );

    const sessionId = `${tabId}:${frameId}`;
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.replacePort(port);
      this.debug(
        'info',
        'session.manager',
        'existing session port replaced',
        sessionId,
        { tabId, frameId, url: port.sender?.url },
      );
      return;
    }

    if (this.sessions.size >= this.settingsCache.runtime.maxSessions) {
      port.postMessage({
        type: 'SESSION_ERROR',
        payload: {
          code: 'MAX_SESSIONS_REACHED',
          message: `Maximum sessions reached (${this.settingsCache.runtime.maxSessions}).`,
          fatal: true,
        },
      } satisfies BackgroundToContentMessage);
      port.disconnect();
      this.debug(
        'warn',
        'session.manager',
        'rejected session: max sessions reached',
        `${this.settingsCache.runtime.maxSessions}`,
        { tabId, frameId, url: port.sender?.url },
      );
      return;
    }

    const session = new TabSession(sessionId, tabId, frameId, port, {
      loadSettings: async () => {
        this.settingsCache = await getSettings();
        return this.settingsCache;
      },
      acquireAsr: (key, create) => this.asrPool.acquire(key, create),
      releaseAsr: (key) => this.asrPool.release(key),
      acquireTranslator: (key, create) => this.translatorPool.acquire(key, create),
      releaseTranslator: (key) => this.translatorPool.release(key),
      onClosed: (id) => {
        this.sessions.delete(id);
      },
      debug: this.debug,
    });

    this.sessions.set(sessionId, session);
    this.debug(
      'info',
      'session.manager',
      'session created',
      sessionId,
      { tabId, frameId, url: port.sender?.url },
    );
  }

  public async detachTab(tabId: number): Promise<void> {
    this.debug('info', 'session.manager', 'detach tab', `${tabId}`);
    const tasks: Array<Promise<void>> = [];
    for (const [sessionId, session] of this.sessions) {
      if (!sessionId.startsWith(`${tabId}:`)) {
        continue;
      }

      tasks.push(session.dispose('tab_closed'));
    }

    await Promise.allSettled(tasks);
  }

  public async shutdown(): Promise<void> {
    clearInterval(this.healthTimer);

    const disposeTasks = [...this.sessions.values()].map((session) => session.dispose('manager_shutdown'));
    this.sessions.clear();

    await Promise.allSettled(disposeTasks);
    await this.asrPool.disposeAll();
    await this.translatorPool.disposeAll();
  }

  public listSessions(): SessionRuntimeStatus[] {
    return [...this.sessions.values()].map((session) => session.getRuntimeStatus());
  }

  public async refreshSettings(): Promise<UserSettings> {
    this.settingsCache = await getSettings();
    return this.settingsCache;
  }

  private async cleanupExpiredSessions(): Promise<void> {
    const now = Date.now();
    const tasks: Array<Promise<void>> = [];

    for (const session of this.sessions.values()) {
      if (session.isHeartbeatExpired(now)) {
        tasks.push(session.dispose('heartbeat_timeout'));
      }
    }

    if (tasks.length > 0) {
      await Promise.allSettled(tasks);
    }
  }
}

