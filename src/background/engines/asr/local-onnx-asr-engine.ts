import type { AsrAudioChunk, AsrCallbacks, AsrEngine } from '../contracts';
import type { PlaybackState, StreamContext } from '../../../shared/contracts';
import { env as transformersEnv, pipeline as transformersPipeline } from '@huggingface/transformers';
import localOnnxRuntimeWorkerUrl from './local-onnx-runtime.worker?worker&url';
import { ModelCacheService } from '../../model-cache-service';
import { getModelAdapterByModelKey } from '../../../shared/model-adapters';
import type { CachedModelFileSummary } from '../../../shared/model-cache';
import {
  LOCAL_ONNX_OFFSCREEN_MESSAGE_TYPE,
  type LocalOnnxInitPayload,
  type LocalOnnxOffscreenRequestMessage,
  type LocalOnnxOffscreenResponse,
  type LocalOnnxTranscribePayload,
  type LocalOnnxWhisperOutput,
  type LocalOnnxWhisperTimestampChunk,
} from '../../../shared/offscreen-local-onnx';

const LOCAL_ONNX_ENGINE_IMPLEMENTED = true;
const LOCAL_ONNX_ENGINE_DISABLED_REASON = 'Local @huggingface/transformers runtime worker is unavailable.';
const MODEL_INFERENCE_INTERVAL_MS = 1400;
const PUSH_TRIGGER_INFER_INTERVAL_MS = 700;
const MIN_INFER_WINDOW_SECONDS = 2;
const MAX_INFER_WINDOW_SECONDS = 28;
const MAX_AUDIO_BUFFER_SECONDS = 180;
const DEFAULT_SAMPLE_RATE = 16_000;

type TransformersPipeline = (
  audio: Float32Array | Float64Array,
  options?: Record<string, unknown>,
) => Promise<LocalOnnxWhisperOutput>;
type WhisperTimestampChunk = LocalOnnxWhisperTimestampChunk;
type WhisperOutput = LocalOnnxWhisperOutput | LocalOnnxWhisperOutput[] | string;

interface CacheLike {
  match: (request: string | Request) => Promise<Response | undefined>;
  put: (request: string | Request, response: Response) => Promise<void>;
}

type LocalOnnxWorkerEvent =
  | {
      type: 'STATS';
      payload: {
        modelLoadProgress?: number;
      };
    };

type LocalOnnxWorkerInitPayload = LocalOnnxInitPayload;
type LocalOnnxWorkerTranscribePayload = LocalOnnxTranscribePayload;

interface LocalOnnxRuntimeClient {
  initialize(payload: LocalOnnxWorkerInitPayload): Promise<void>;
  transcribe(payload: LocalOnnxWorkerTranscribePayload): Promise<WhisperOutput>;
  dispose(): Promise<void>;
}

export class LocalOnnxAsrEngine implements AsrEngine {
  public readonly key: string;
  private callbacks: AsrCallbacks | null = null;
  private transcriber: TransformersPipeline | null = null;
  private runtimeClient: LocalOnnxRuntimeClient | null = null;
  private inferenceTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private modelLoading = false;
  private inferenceRunning = false;
  private inferenceRequested = false;
  private sampleRate = DEFAULT_SAMPLE_RATE;
  private ring = createRingBuffer(DEFAULT_SAMPLE_RATE * MAX_AUDIO_BUFFER_SECONDS);
  private totalSamplesPushed = 0;
  private lastInferenceAtSamples = 0;
  private lastTranscript = '';
  private lastRevision = 0;
  private inferInvocation = 0;
  private lastSkipTraceAt = 0;
  private lastProgressBucket = -1;
  private lastAudioLevelTraceAt = 0;
  private lastInferPumpAt = 0;
  private lastInferPumpTraceAt = 0;
  private modelId = '';
  private sourceRepo = '';
  private fileIndex: CachedModelFileSummary[] = [];
  private availableFileLookup = new Map<string, string[]>();
  private readonly inflightFileReads = new Map<string, Promise<ArrayBuffer | null>>();
  private readonly modelCache = new ModelCacheService();

  constructor(
    private readonly model: string,
    private readonly precision: string,
    private readonly backend: 'webgpu' | 'wasm',
    private readonly language: string,
  ) {
    this.key = `asr:local:${model}:${precision}:${backend}`;
  }

  public async initialize(_context: StreamContext, callbacks: AsrCallbacks): Promise<void> {
    this.callbacks = callbacks;
    this.disposed = false;
    this.lastTranscript = '';
    this.totalSamplesPushed = 0;
    this.lastInferenceAtSamples = 0;
    this.lastRevision = 0;
    this.inferInvocation = 0;
    this.lastSkipTraceAt = 0;
    this.lastProgressBucket = -1;
    this.lastAudioLevelTraceAt = 0;
    this.lastInferPumpAt = 0;
    this.lastInferPumpTraceAt = 0;
    this.ring = createRingBuffer(DEFAULT_SAMPLE_RATE * MAX_AUDIO_BUFFER_SECONDS);
    this.inflightFileReads.clear();

    const adapter = getModelAdapterByModelKey(this.model);
    if (!adapter) {
      callbacks.onError({
        code: 'LOCAL_MODEL_ADAPTER_NOT_FOUND',
        message: `No model adapter for ${this.model}.`,
        fatal: true,
      });
      return;
    }

    this.modelId = adapter.getModelId(this.precision);
    this.sourceRepo = adapter.sourceRepo;
    this.fileIndex = await this.modelCache.listFiles(this.modelId);
    this.availableFileLookup = buildAvailableFileLookup(this.fileIndex);
    this.trace(
      'info',
      'init',
      'local ASR initialize',
      `modelId=${this.modelId} backend=${this.backend} language=${this.language} cachedFiles=${this.fileIndex.length}`,
    );

    const runtimeBackend = this.backend;
    const useRuntimeWorker = shouldUseLocalRuntimeWorker();

    if (runtimeBackend === 'webgpu' && !isWebGpuAvailable() && !useRuntimeWorker) {
      callbacks.onError({
        code: 'LOCAL_BACKEND_UNSUPPORTED',
        message: 'Selected local backend "webgpu" is not supported in current browser environment.',
        fatal: true,
      });
      return;
    }

    if (runtimeBackend === 'wasm' && !isWasmAvailable()) {
      callbacks.onError({
        code: 'LOCAL_BACKEND_UNSUPPORTED',
        message: 'WASM backend is not supported in current browser environment.',
        fatal: true,
      });
      return;
    }

    try {
      this.modelLoading = true;
      this.transcriber = null;
      this.runtimeClient = null;

      if (useRuntimeWorker) {
        const onEvent = (event: LocalOnnxWorkerEvent): void => {
          if (event.type === 'STATS' && event.payload.modelLoadProgress !== undefined) {
            this.handleProgressValue(event.payload.modelLoadProgress);
          }
        };

        if (isDedicatedWorkerAvailable()) {
          this.runtimeClient = new LocalOnnxRuntimeWorkerClient(onEvent);
        } else if (isOffscreenRuntimeAvailable()) {
          this.runtimeClient = new LocalOnnxOffscreenRuntimeClient();
        } else {
          throw new Error(
            'No local runtime host available. Dedicated Worker and chrome.offscreen are both unavailable.',
          );
        }

        await this.runtimeClient.initialize({
          modelId: this.modelId,
          sourceRepo: this.sourceRepo,
          precision: this.precision,
          backend: runtimeBackend,
        });
      } else {
        this.transcriber = await this.createTranscriber(runtimeBackend);
      }

      this.modelLoading = false;
      this.trace('info', 'init', 'local ASR model ready', `modelId=${this.modelId}`);
    } catch (error) {
      this.modelLoading = false;
      this.trace(
        'error',
        'init',
        'local ASR model load failed',
        error instanceof Error ? error.message : String(error),
      );
      callbacks.onError({
        code: 'LOCAL_MODEL_LOAD_FAILED',
        message: error instanceof Error ? error.message : 'Failed to load local ASR model.',
        fatal: true,
      });
      return;
    }

    if (!this.transcriber && !this.runtimeClient) {
      callbacks.onError({
        code: 'LOCAL_MODEL_LOAD_FAILED',
        message: 'ASR model pipeline initialization returned empty result.',
        fatal: true,
      });
      return;
    }

    this.inferenceTimer = setInterval(() => {
      this.pumpInference('timer');
    }, MODEL_INFERENCE_INTERVAL_MS);
    this.trace(
      'debug',
      'init',
      'inference scheduler started',
      `intervalMs=${MODEL_INFERENCE_INTERVAL_MS}`,
    );
    this.pumpInference('ready');
  }

  public async pushAudio(chunk: AsrAudioChunk): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (!this.modelLoading && !this.transcriber && !this.runtimeClient) {
      return;
    }

    if (chunk.sampleRate <= 0) {
      return;
    }

    this.sampleRate = chunk.sampleRate;
    const pcm = new Int16Array(chunk.pcm16);
    if (pcm.length === 0) {
      return;
    }

    const now = Date.now();
    if (now - this.lastAudioLevelTraceAt > 1500) {
      this.lastAudioLevelTraceAt = now;
      const energy = measurePcmEnergy(pcm);
      this.trace(
        'debug',
        'audio',
        'pcm level',
        `samples=${pcm.length} rms=${energy.rms.toFixed(4)} peak=${energy.peak.toFixed(4)}`,
      );
    }

    writePcm16ToRing(this.ring, pcm);
    this.totalSamplesPushed += pcm.length;
    this.inferenceRequested = true;
    this.pumpInference('push');
  }

  public async setPlaybackState(state: PlaybackState): Promise<void> {
    if (this.disposed) {
      return;
    }

    if (state === 'paused' || state === 'ended') {
      await this.inferIfNeeded(true);
      if (state === 'ended') {
        this.lastTranscript = '';
      }
    }
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    this.inferenceRequested = false;
    this.modelLoading = false;

    if (this.inferenceTimer) {
      clearInterval(this.inferenceTimer);
      this.inferenceTimer = null;
    }

    const transcriber = this.transcriber as
      | (TransformersPipeline & { dispose?: () => Promise<void> })
      | null;
    this.transcriber = null;

    if (transcriber?.dispose) {
      try {
        await transcriber.dispose();
      } catch {
        // ignore dispose failures
      }
    }

    if (this.runtimeClient) {
      try {
        await this.runtimeClient.dispose();
      } catch {
        // ignore dispose failures
      }
      this.runtimeClient = null;
    }

    this.callbacks = null;
    this.inflightFileReads.clear();
    this.availableFileLookup.clear();
  }

  private async createTranscriber(runtimeBackend: 'webgpu' | 'wasm'): Promise<TransformersPipeline> {
    ensureServiceWorkerXmlHttpRequestPolyfill();

    const onnxEnv = transformersEnv.backends.onnx as {
      wasm?: {
        wasmPaths?: string | Record<string, string>;
        proxy?: boolean;
      };
    };

    if (onnxEnv?.wasm) {
      if (!onnxEnv.wasm.wasmPaths) {
        onnxEnv.wasm.wasmPaths =
          `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${transformersEnv.version}/dist/`;
      }
      onnxEnv.wasm.proxy = false;
    }

    const customCache = this.createCustomCache();
    transformersEnv.useCustomCache = true;
    transformersEnv.customCache = customCache as unknown as CacheLike;
    transformersEnv.useBrowserCache = false;
    transformersEnv.allowLocalModels = true;
    transformersEnv.allowRemoteModels = false;

    const progressMap = new Map<string, number>();
    const dtypeCandidates = buildDtypeCandidates(this.precision, runtimeBackend);
    let lastError: unknown;

    for (const dtype of dtypeCandidates) {
      try {
        const transcriber = (await transformersPipeline('automatic-speech-recognition', this.sourceRepo, {
          device: runtimeBackend,
          dtype: dtype as 'q4' | 'q4f16' | 'fp16' | 'fp32',
          progress_callback: (event: unknown) => {
            this.handleProgressEvent(event, progressMap);
          },
          local_files_only: true,
        })) as unknown as TransformersPipeline;
        return transcriber;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Failed to initialize local ASR pipeline with available dtype candidates.');
  }

  private createCustomCache(): CacheLike {
    return {
      match: async (request: string | Request): Promise<Response | undefined> => {
        const key = typeof request === 'string' ? request : request.url;
        const candidateFileNames = this.resolveCandidateFileNames(key);
        for (const fileName of candidateFileNames) {
          const buffer = await this.readFileBuffer(fileName);
          if (!buffer) {
            continue;
          }
          return new Response(buffer, {
            status: 200,
            headers: {
              'Content-Length': `${buffer.byteLength}`,
              'Content-Type': guessContentType(fileName),
            },
          });
        }
        return undefined;
      },
      put: async () => {
        // We only serve from extension-managed IndexedDB cache in local mode.
      },
    };
  }

  private resolveCandidateFileNames(requestKey: string): string[] {
    const values = new Set<string>();
    const normalized = requestKey.trim();
    if (!normalized) {
      return [];
    }

    try {
      const parsed = new URL(normalized);
      const path = parsed.pathname;
      const last = path.split('/').filter(Boolean).at(-1);
      if (last) {
        values.add(decodeURIComponent(last));
      }
      const resolveMark = '/resolve/';
      const marker = path.indexOf(resolveMark);
      if (marker >= 0) {
        const suffix = path.slice(marker + resolveMark.length);
        const segments = suffix.split('/').filter(Boolean);
        if (segments.length >= 3) {
          const filePath = segments.slice(2).join('/');
          if (filePath) {
            values.add(decodeURIComponent(filePath));
          }
        }
      }
    } catch {
      // Not an URL. Continue with plain path handling.
    }

    const segments = normalized.split('/').filter(Boolean);
    const tail = segments.at(-1);
    if (tail) {
      values.add(decodeURIComponent(tail));
      if (segments.length >= 2) {
        values.add(decodeURIComponent(`${segments[segments.length - 2]}/${tail}`));
      }
    }

    const localModelPrefix = '/models/';
    const localIndex = normalized.indexOf(localModelPrefix);
    if (localIndex >= 0) {
      const suffix = normalized.slice(localIndex + localModelPrefix.length);
      const localSegments = suffix.split('/').filter(Boolean);
      if (localSegments.length >= 3) {
        const filePath = localSegments.slice(2).join('/');
        if (filePath) {
          values.add(decodeURIComponent(filePath));
        }
      }
    }

    return [...values];
  }

  private async readFileBuffer(fileName: string): Promise<ArrayBuffer | null> {
    const candidates = resolveStoredWhisperFileCandidates(
      fileName,
      this.precision,
      this.fileIndex,
      this.availableFileLookup,
    );

    for (const candidate of candidates) {
      try {
        const buffer = await this.readFileBufferWithDedupe(candidate);
        if (buffer) {
          return buffer;
        }
      } catch (error) {
        this.callbacks?.onError({
          code: 'LOCAL_MODEL_CACHE_READ_FAILED',
          message: `Failed to read local model cache file "${candidate}": ${error instanceof Error ? error.message : 'unknown'}`,
          fatal: false,
        });
      }
    }

    return null;
  }

  private async readFileBufferWithDedupe(fileName: string): Promise<ArrayBuffer | null> {
    const existing = this.inflightFileReads.get(fileName);
    if (existing) {
      return existing;
    }

    const pending = this.modelCache
      .readModelFile(this.modelId, fileName)
      .finally(() => {
        this.inflightFileReads.delete(fileName);
      });
    this.inflightFileReads.set(fileName, pending);
    return pending;
  }

  private handleProgressEvent(
    raw: unknown,
    progressMap: Map<string, number>,
  ): void {
    if (!this.callbacks?.onStats) {
      return;
    }

    const event = raw as {
      status?: string;
      file?: string;
      progress?: number;
    };

    if (!event || typeof event !== 'object') {
      return;
    }

    const file = typeof event.file === 'string' ? event.file : undefined;
    const progress =
      typeof event.progress === 'number' && Number.isFinite(event.progress)
        ? Math.max(0, Math.min(100, event.progress))
        : undefined;

    if (file && progress !== undefined) {
      progressMap.set(file, progress);
    }

    if (progressMap.size === 0) {
      return;
    }

    let sum = 0;
    for (const value of progressMap.values()) {
      sum += value;
    }

    const avg = sum / progressMap.size;
    this.handleProgressValue(avg);
  }

  private async inferIfNeeded(force: boolean): Promise<void> {
    if (this.disposed || this.modelLoading || this.inferenceRunning) {
      return;
    }
    if (!force && !this.inferenceRequested) {
      return;
    }

    const minSamples = Math.max(1, Math.round(this.sampleRate * MIN_INFER_WINDOW_SECONDS));
    const stepSamples = Math.max(1, Math.round(this.sampleRate * 2.2));
    const availableSamples = Math.min(this.ring.length, this.totalSamplesPushed);
    const unseenSamples = this.totalSamplesPushed - this.lastInferenceAtSamples;
    if (availableSamples < minSamples) {
      this.traceSkip('buffer-too-small', `available=${availableSamples} min=${minSamples}`);
      return;
    }
    if (!force && unseenSamples < stepSamples) {
      this.traceSkip('step-not-reached', `unseen=${unseenSamples} step=${stepSamples}`);
      return;
    }

    const windowSamples = Math.min(
      availableSamples,
      Math.max(minSamples, Math.round(this.sampleRate * MAX_INFER_WINDOW_SECONDS)),
    );

    this.inferenceRunning = true;
    this.inferenceRequested = false;
    this.inferInvocation += 1;
    const inferNo = this.inferInvocation;
    const inferStartedAt = Date.now();

    try {
      const audio = this.ring.readLatest(windowSamples);
      if (audio.length < minSamples) {
        this.traceSkip('window-read-too-small', `audio=${audio.length} min=${minSamples}`);
        return;
      }
      this.trace(
        'info',
        'infer',
        'inference started',
        `#${inferNo} force=${force} audioSamples=${audio.length} sampleRate=${this.sampleRate}`,
      );
      let output: WhisperOutput;
      if (this.runtimeClient) {
        const audioCopy = new Float32Array(audio.length);
        audioCopy.set(audio);
        output = await this.runtimeClient.transcribe({
          audioBuffer: audioCopy.buffer,
          language: this.language,
        });
      } else {
        if (!this.transcriber) {
          return;
        }
        const options: Record<string, unknown> = {
          return_timestamps: true,
          chunk_length_s: 20,
          stride_length_s: 4,
          force_full_sequences: false,
          task: 'transcribe',
          condition_on_prev_tokens: true,
          no_speech_threshold: 0.6,
          num_beams: 1,
        };

        const lang = normalizeAsrLanguage(this.language);
        if (lang) {
          options.language = lang;
        }

        output = await this.transcriber(audio, options);
      }
      this.trace(
        'info',
        'infer',
        'inference raw output',
        `#${inferNo} ${summarizeWhisperOutput(output)}`,
      );

      const text = extractTranscriptText(output);
      if (!text) {
        this.trace(
          'debug',
          'infer',
          'inference empty result',
          `#${inferNo} elapsedMs=${Date.now() - inferStartedAt}`,
        );
        this.lastInferenceAtSamples = this.totalSamplesPushed;
        return;
      }

      const delta = extractTranscriptDelta(this.lastTranscript, text);
      const emitText = delta || text;
      if (!emitText.trim()) {
        this.trace(
          'debug',
          'infer',
          'inference delta empty',
          `#${inferNo} fullChars=${text.length} elapsedMs=${Date.now() - inferStartedAt}`,
        );
        this.lastInferenceAtSamples = this.totalSamplesPushed;
        return;
      }

      const [startMs, endMs] = extractTimeRange(extractTimestampChunks(output));
      this.lastRevision += 1;
      this.callbacks?.onSegment({
        text: sanitizeTranscript(emitText),
        isFinal: force,
        language: normalizeAsrLanguage(this.language) ?? undefined,
        startMs,
        endMs,
        revision: this.lastRevision,
        createdAt: Date.now(),
      });
      this.trace(
        'info',
        'infer',
        'inference segment emitted',
        `#${inferNo} fullChars=${text.length} emitChars=${emitText.length} elapsedMs=${Date.now() - inferStartedAt} text="${debugExcerpt(emitText)}"`,
      );

      this.lastTranscript = text;
      this.lastInferenceAtSamples = this.totalSamplesPushed;
    } catch (error) {
      this.trace(
        'warn',
        'infer',
        'inference failed',
        `#${inferNo} ${error instanceof Error ? error.message : String(error)}`,
      );
      this.callbacks?.onError({
        code: 'LOCAL_INFER_FAILED',
        message: error instanceof Error ? error.message : 'Local inference failed.',
        fatal: false,
      });
    } finally {
      this.inferenceRunning = false;
    }
  }

  private handleProgressValue(progress: number): void {
    const normalized = Number.isFinite(progress)
      ? Math.max(0, Math.min(100, progress))
      : 0;
    this.callbacks?.onStats?.({
      modelLoadProgress: Number(normalized.toFixed(2)),
    });
    const bucket = Math.floor(normalized / 10);
    if (bucket !== this.lastProgressBucket) {
      this.lastProgressBucket = bucket;
      this.trace('info', 'init', 'model loading progress', `${bucket * 10}%`);
    }
  }

  private trace(
    level: 'debug' | 'info' | 'warn' | 'error',
    scope: string,
    message: string,
    details?: string,
  ): void {
    this.callbacks?.onTrace?.({
      level,
      scope: `local-onnx.${scope}`,
      message,
      details,
    });
  }

  private traceSkip(reason: string, details?: string): void {
    const now = Date.now();
    if (now - this.lastSkipTraceAt < 1500) {
      return;
    }
    this.lastSkipTraceAt = now;
    this.trace('debug', 'infer.skip', reason, details);
  }

  private pumpInference(trigger: 'timer' | 'push' | 'ready'): void {
    if (this.disposed || this.modelLoading) {
      return;
    }
    if (!this.transcriber && !this.runtimeClient) {
      return;
    }
    if (this.inferenceRunning) {
      return;
    }

    const now = Date.now();
    if (now - this.lastInferPumpTraceAt >= 2000) {
      this.lastInferPumpTraceAt = now;
      this.trace(
        'debug',
        'infer.pump',
        'pump tick',
        `trigger=${trigger} requested=${this.inferenceRequested} running=${this.inferenceRunning} samples=${this.totalSamplesPushed}`,
      );
    }
    if (trigger === 'push' && now - this.lastInferPumpAt < PUSH_TRIGGER_INFER_INTERVAL_MS) {
      return;
    }
    this.lastInferPumpAt = now;
    void this.inferIfNeeded(false);
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

function guessContentType(fileName: string): string {
  const lowered = fileName.toLowerCase();
  if (lowered.endsWith('.json')) {
    return 'application/json';
  }
  if (lowered.endsWith('.onnx') || lowered.endsWith('.onnx_data')) {
    return 'application/octet-stream';
  }
  if (lowered.endsWith('.txt')) {
    return 'text/plain';
  }
  return 'application/octet-stream';
}

function normalizeAsrLanguage(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (!value || value === 'auto') {
    return null;
  }
  return value;
}

function isServiceWorkerRuntime(): boolean {
  try {
    const ctorName =
      (globalThis as { constructor?: { name?: string } }).constructor?.name ?? '';
    return ctorName === 'ServiceWorkerGlobalScope';
  } catch {
    return false;
  }
}

function shouldUseLocalRuntimeWorker(): boolean {
  return isServiceWorkerRuntime();
}

function isDedicatedWorkerAvailable(): boolean {
  return typeof Worker !== 'undefined';
}

function isOffscreenRuntimeAvailable(): boolean {
  const chromeRuntime = globalThis.chrome as typeof chrome | undefined;
  if (!chromeRuntime?.offscreen) {
    return false;
  }
  return typeof chromeRuntime.offscreen.createDocument === 'function';
}

function buildDtypeCandidates(
  precision: string,
  backend: 'webgpu' | 'wasm',
): string[] {
  const candidates: string[] = [];
  if (precision === 'q4f16' || precision === 'q4' || precision === 'fp16' || precision === 'fp32') {
    candidates.push(precision);
  }

  if (backend === 'wasm') {
    if (!candidates.includes('q4f16')) {
      candidates.push('q4f16');
    }
    if (!candidates.includes('q4')) {
      candidates.push('q4');
    }
    if (!candidates.includes('fp32')) {
      candidates.push('fp32');
    }
  } else if (!candidates.includes('q4f16')) {
    candidates.push('q4f16');
  }

  return candidates;
}

function sanitizeTranscript(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function measurePcmEnergy(pcm: Int16Array): { rms: number; peak: number } {
  if (pcm.length === 0) {
    return { rms: 0, peak: 0 };
  }

  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < pcm.length; i += 1) {
    const normalized = (pcm[i] ?? 0) / 32768;
    const abs = Math.abs(normalized);
    if (abs > peak) {
      peak = abs;
    }
    sumSquares += normalized * normalized;
  }

  const rms = Math.sqrt(sumSquares / pcm.length);
  return { rms, peak };
}

function debugExcerpt(text: string, max = 72): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}...`;
}

function summarizeWhisperOutput(output: WhisperOutput): string {
  if (typeof output === 'string') {
    return `string chars=${output.trim().length}`;
  }

  if (Array.isArray(output)) {
    const items = output.slice(0, 2).map((item) => summarizeWhisperOutput(item)).join(' | ');
    return `array len=${output.length} [${items}]`;
  }

  if (!output || typeof output !== 'object') {
    return `unknown type=${typeof output}`;
  }

  const candidate = output as {
    text?: unknown;
    chunks?: unknown;
  };
  const textChars = typeof candidate.text === 'string' ? candidate.text.trim().length : 0;
  const chunks = Array.isArray(candidate.chunks) ? candidate.chunks : [];
  const firstChunk = chunks[0] as { text?: unknown } | undefined;
  const firstChunkText =
    firstChunk && typeof firstChunk.text === 'string'
      ? ` firstChunk="${debugExcerpt(firstChunk.text, 28)}"`
      : '';

  return `object textChars=${textChars} chunks=${chunks.length}${firstChunkText}`;
}

function extractTranscriptDelta(previous: string, current: string): string {
  const prev = previous.trim();
  const next = current.trim();
  if (!prev) {
    return next;
  }
  if (next.startsWith(prev)) {
    return next.slice(prev.length).trim();
  }

  let idx = 0;
  const max = Math.min(prev.length, next.length);
  while (idx < max && prev[idx] === next[idx]) {
    idx += 1;
  }
  return next.slice(idx).trim();
}

function extractTimeRange(chunks: WhisperTimestampChunk[] | undefined): [number | undefined, number | undefined] {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return [undefined, undefined];
  }
  const first = chunks[0];
  const last = chunks[chunks.length - 1];
  const start = first?.timestamp?.[0];
  const end = last?.timestamp?.[1];

  const startMs = Number.isFinite(start) ? Math.round((start ?? 0) * 1000) : undefined;
  const endMs = Number.isFinite(end) ? Math.round((end ?? 0) * 1000) : undefined;
  return [startMs, endMs];
}

function extractTranscriptText(output: WhisperOutput): string {
  if (typeof output === 'string') {
    return output.trim();
  }

  if (Array.isArray(output)) {
    const texts = output
      .map((item) => extractTranscriptText(item))
      .filter((item) => item.length > 0);
    return texts.join(' ').trim();
  }

  if (!output || typeof output !== 'object') {
    return '';
  }

  if (typeof output.text === 'string' && output.text.trim().length > 0) {
    return output.text.trim();
  }

  if (!Array.isArray(output.chunks)) {
    return '';
  }

  const fromChunks = output.chunks
    .map((item) =>
      item && typeof item === 'object' && 'text' in item && typeof (item as { text?: unknown }).text === 'string'
        ? ((item as { text: string }).text.trim())
        : '',
    )
    .filter((item) => item.length > 0);

  return fromChunks.join(' ').trim();
}

function extractTimestampChunks(output: WhisperOutput): WhisperTimestampChunk[] | undefined {
  if (Array.isArray(output)) {
    for (const item of output) {
      const chunks = extractTimestampChunks(item);
      if (chunks && chunks.length > 0) {
        return chunks;
      }
    }
    return undefined;
  }

  if (!output || typeof output !== 'object') {
    return undefined;
  }

  return Array.isArray(output.chunks) ? output.chunks : undefined;
}

interface RingBuffer {
  length: number;
  writeIndex: number;
  filled: boolean;
  data: Float32Array;
  readLatest: (sampleCount: number) => Float32Array;
}

function createRingBuffer(length: number): RingBuffer {
  const size = Math.max(1, Math.floor(length));
  const data = new Float32Array(size);
  return {
    length: size,
    writeIndex: 0,
    filled: false,
    data,
    readLatest(sampleCount: number): Float32Array {
      const count = Math.max(0, Math.min(sampleCount, this.filled ? this.length : this.writeIndex));
      if (count === 0) {
        return new Float32Array(0);
      }

      const out = new Float32Array(count);
      const end = this.writeIndex;
      const start = (end - count + this.length) % this.length;
      if (start < end || !this.filled) {
        out.set(this.data.subarray(start, start + count), 0);
        return out;
      }

      const firstLen = this.length - start;
      out.set(this.data.subarray(start), 0);
      out.set(this.data.subarray(0, end), firstLen);
      return out;
    },
  };
}

function writePcm16ToRing(ring: RingBuffer, pcm: Int16Array): void {
  for (let i = 0; i < pcm.length; i += 1) {
    const sample = pcm[i] ?? 0;
    ring.data[ring.writeIndex] = sample < 0 ? sample / 0x8000 : sample / 0x7fff;
    ring.writeIndex = (ring.writeIndex + 1) % ring.length;
    if (ring.writeIndex === 0) {
      ring.filled = true;
    }
  }
}

function buildWhisperFileNameCandidates(requestedFileName: string, precision: string): string[] {
  const set = new Set<string>();
  const normalized = requestedFileName.replace(/^\/+/, '');
  const base = normalized.replace(/^onnx\//, '');

  pushFileAliases(set, base);

  if (base === 'decoder_model_merged.onnx' || base === 'decoder_model.onnx') {
    pushFileAliases(set, `decoder_model_merged_${precision}.onnx`);
    pushFileAliases(set, `decoder_model_${precision}.onnx`);
    pushFileAliases(set, 'decoder_model_merged_quantized.onnx');
    pushFileAliases(set, 'decoder_model_quantized.onnx');
    pushFileAliases(set, 'decoder_model_merged_uint8.onnx');
    pushFileAliases(set, 'decoder_model_uint8.onnx');
  }

  if (base === 'encoder_model.onnx') {
    if (precision === 'fp16') {
      pushFileAliases(set, 'encoder_model_fp16.onnx');
    } else {
      pushFileAliases(set, `encoder_model_${precision}.onnx`);
      pushFileAliases(set, 'encoder_model_quantized.onnx');
      pushFileAliases(set, 'encoder_model_uint8.onnx');
    }
  }

  const decoderMergedDataSuffix = getOnnxDataSuffix(base, 'decoder_model_merged');
  const decoderDataSuffix = getOnnxDataSuffix(base, 'decoder_model');
  const decoderData = decoderMergedDataSuffix ?? decoderDataSuffix;
  if (decoderData !== null) {
    pushFileAliases(set, `decoder_model_merged_${precision}.onnx_data${decoderData}`);
    pushFileAliases(set, `decoder_model_${precision}.onnx_data${decoderData}`);
    pushFileAliases(set, `decoder_model_merged_quantized.onnx_data${decoderData}`);
    pushFileAliases(set, `decoder_model_quantized.onnx_data${decoderData}`);
    pushFileAliases(set, `decoder_model_merged_uint8.onnx_data${decoderData}`);
    pushFileAliases(set, `decoder_model_uint8.onnx_data${decoderData}`);
  }

  const encoderDataSuffix = getOnnxDataSuffix(base, 'encoder_model');
  if (encoderDataSuffix !== null) {
    if (precision === 'fp16') {
      pushFileAliases(set, `encoder_model_fp16.onnx_data${encoderDataSuffix}`);
    } else {
      pushFileAliases(set, `encoder_model_${precision}.onnx_data${encoderDataSuffix}`);
      pushFileAliases(set, `encoder_model_quantized.onnx_data${encoderDataSuffix}`);
      pushFileAliases(set, `encoder_model_uint8.onnx_data${encoderDataSuffix}`);
    }
  }

  return [...set];
}

function pushFileAliases(target: Set<string>, fileName: string): void {
  const normalized = fileName.replace(/^\/+/, '').replace(/^onnx\//, '');
  if (!normalized) {
    return;
  }
  target.add(normalized);
  target.add(`onnx/${normalized}`);
}

function getOnnxDataSuffix(base: string, prefix: string): string | null {
  const marker = `${prefix}.onnx_data`;
  if (base === marker) {
    return '';
  }
  if (base.startsWith(`${marker}_`)) {
    return base.slice(marker.length);
  }
  return null;
}

function resolveStoredWhisperFileCandidates(
  requestedFileName: string,
  precision: string,
  fileIndex: CachedModelFileSummary[],
  fileLookup: Map<string, string[]>,
): string[] {
  const requestedAliases = buildWhisperFileNameCandidates(requestedFileName, precision);
  const resolved = new Set<string>();

  for (const alias of requestedAliases) {
    const keys = buildLookupKeys(alias);
    for (const key of keys) {
      const matches = fileLookup.get(key);
      if (!matches) {
        continue;
      }
      for (const actual of matches) {
        resolved.add(actual);
      }
    }
  }

  if (resolved.size > 0) {
    return [...resolved];
  }

  // Last resort: if the request is for a Whisper ONNX model, accept any precision-suffixed
  // variant that matches the same logical file family.
  const normalizedRequest = normalizeLookupName(requestedFileName);
  const fallbackPatterns = buildWhisperFallbackPatterns(normalizedRequest, precision);
  if (fallbackPatterns.length === 0) {
    return [];
  }

  for (const file of fileIndex) {
    const normalized = normalizeLookupName(file.fileName);
    for (const pattern of fallbackPatterns) {
      if (pattern.test(normalized)) {
        resolved.add(file.fileName);
        break;
      }
    }
  }

  return [...resolved];
}

function buildWhisperFallbackPatterns(requestedName: string, precision: string): RegExp[] {
  const escapedPrecision = escapeRegExp(precision);
  const patterns: RegExp[] = [];

  if (requestedName === 'decoder_model_merged.onnx' || requestedName === 'decoder_model.onnx') {
    patterns.push(
      new RegExp(
        `^decoder_model(?:_merged)?_(?:${escapedPrecision}|q4f16|q4|fp16|quantized|uint8)\\.onnx$`,
      ),
    );
  }

  if (
    requestedName.startsWith('decoder_model_merged.onnx_data') ||
    requestedName.startsWith('decoder_model.onnx_data')
  ) {
    patterns.push(
      new RegExp(
        `^decoder_model(?:_merged)?_(?:${escapedPrecision}|q4f16|q4|fp16|quantized|uint8)\\.onnx_data(?:_\\d+)?$`,
      ),
    );
  }

  if (requestedName === 'encoder_model.onnx') {
    patterns.push(
      new RegExp(`^encoder_model_(?:${escapedPrecision}|q4f16|q4|fp16|quantized|uint8)\\.onnx$`),
    );
  }

  if (requestedName.startsWith('encoder_model.onnx_data')) {
    patterns.push(
      new RegExp(
        `^encoder_model_(?:${escapedPrecision}|q4f16|q4|fp16|quantized|uint8)\\.onnx_data(?:_\\d+)?$`,
      ),
    );
  }

  return patterns;
}

function buildAvailableFileLookup(files: CachedModelFileSummary[]): Map<string, string[]> {
  const lookup = new Map<string, string[]>();
  for (const file of files) {
    const keys = buildLookupKeys(file.fileName);
    for (const key of keys) {
      const existing = lookup.get(key);
      if (existing) {
        if (!existing.includes(file.fileName)) {
          existing.push(file.fileName);
        }
      } else {
        lookup.set(key, [file.fileName]);
      }
    }
  }
  return lookup;
}

function buildLookupKeys(fileName: string): string[] {
  const normalized = normalizeLookupName(fileName);
  if (!normalized) {
    return [];
  }

  const keys = new Set<string>();
  keys.add(normalized);
  keys.add(`onnx/${normalized}`);

  const tail = normalized.split('/').filter(Boolean).at(-1);
  if (tail) {
    keys.add(tail);
  }

  return [...keys];
}

function normalizeLookupName(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^onnx\//, '').trim();
  return normalized;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureServiceWorkerXmlHttpRequestPolyfill(): void {
  const runtime = globalThis as typeof globalThis & {
    XMLHttpRequest?: typeof XMLHttpRequest;
  };
  if (typeof runtime.XMLHttpRequest !== 'undefined') {
    return;
  }

  class ExtensionXmlHttpRequest {
    public responseType = '';
    public response: unknown = null;
    public responseText = '';
    public status = 0;
    public onload: ((this: ExtensionXmlHttpRequest) => void) | null = null;
    public onerror: ((this: ExtensionXmlHttpRequest) => void) | null = null;

    private method = 'GET';
    private url = '';
    private asyncFlag = true;

    public open(method: string, url: string, async = true): void {
      this.method = method;
      this.url = url;
      this.asyncFlag = async;
    }

    public send(_body: Document | XMLHttpRequestBodyInit | null = null): void {
      if (!this.asyncFlag) {
        this.status = 0;
        this.onerror?.call(this);
        return;
      }

      void this.doRequest();
    }

    private async doRequest(): Promise<void> {
      try {
        const response = await fetch(this.url, {
          method: this.method,
          credentials: 'same-origin',
        });
        this.status = response.status;
        if (this.responseType === 'arraybuffer') {
          this.response = await response.arrayBuffer();
        } else {
          this.responseText = await response.text();
          this.response = this.responseText;
        }
        this.onload?.call(this);
      } catch {
        this.status = 0;
        this.onerror?.call(this);
      }
    }
  }

  (runtime as unknown as Record<string, unknown>).XMLHttpRequest =
    ExtensionXmlHttpRequest as unknown;
}

interface LocalOnnxWorkerRequestMap {
  INIT: LocalOnnxWorkerInitPayload;
  TRANSCRIBE: LocalOnnxWorkerTranscribePayload;
  DISPOSE: Record<string, never>;
}

type LocalOnnxWorkerResponseMap = {
  INIT: { ok: true };
  TRANSCRIBE: WhisperOutput;
  DISPOSE: { ok: true };
};

type LocalOnnxWorkerRequestType = keyof LocalOnnxWorkerRequestMap;

interface LocalOnnxWorkerRequest<T extends LocalOnnxWorkerRequestType = LocalOnnxWorkerRequestType> {
  id: number;
  type: T;
  payload: LocalOnnxWorkerRequestMap[T];
}

interface LocalOnnxWorkerResult<T extends LocalOnnxWorkerRequestType = LocalOnnxWorkerRequestType> {
  id: number;
  kind: 'RESULT';
  type: T;
  ok: boolean;
  payload?: LocalOnnxWorkerResponseMap[T];
  error?: string;
}

interface LocalOnnxWorkerEventEnvelope {
  kind: 'EVENT';
  event: LocalOnnxWorkerEvent;
}

type LocalOnnxWorkerMessage = LocalOnnxWorkerResult | LocalOnnxWorkerEventEnvelope;

class LocalOnnxRuntimeWorkerClient implements LocalOnnxRuntimeClient {
  private worker: Worker | null = null;
  private seq = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private readonly onEvent: (event: LocalOnnxWorkerEvent) => void,
  ) {}

  public async initialize(payload: LocalOnnxWorkerInitPayload): Promise<void> {
    this.ensureWorker();
    await this.request('INIT', payload);
  }

  public async transcribe(payload: LocalOnnxWorkerTranscribePayload): Promise<WhisperOutput> {
    this.ensureWorker();
    // Some extension runtimes reject transfer lists for this worker message path.
    // Use structured clone fallback for compatibility.
    return this.request('TRANSCRIBE', payload);
  }

  public async dispose(): Promise<void> {
    if (!this.worker) {
      return;
    }

    try {
      await this.request('DISPOSE', {});
    } catch {
      // ignore dispose handshake errors
    }

    for (const [, entry] of this.pending) {
      clearTimeout(entry.timeoutId);
      entry.reject(new Error('Local runtime worker terminated.'));
    }
    this.pending.clear();

    this.worker.terminate();
    this.worker = null;
  }

  private ensureWorker(): void {
    if (this.worker) {
      return;
    }
    if (typeof Worker === 'undefined') {
      throw new Error('Dedicated Worker is not available in this runtime.');
    }

    this.worker = new Worker(localOnnxRuntimeWorkerUrl, {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent<LocalOnnxWorkerMessage>) => {
      const message = event.data;
      if (!message || typeof message !== 'object') {
        return;
      }

      if (message.kind === 'EVENT') {
        this.onEvent(message.event);
        return;
      }

      if (message.kind !== 'RESULT') {
        return;
      }

      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeoutId);
      this.pending.delete(message.id);

      if (!message.ok) {
        pending.reject(new Error(message.error ?? 'Local runtime worker request failed.'));
        return;
      }

      pending.resolve(message.payload);
    };

    this.worker.onerror = (event: ErrorEvent) => {
      const reason = event.error instanceof Error
        ? event.error
        : new Error(event.message || 'Local runtime worker crashed.');
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timeoutId);
        entry.reject(reason);
      }
      this.pending.clear();
    };
  }

  private request<T extends LocalOnnxWorkerRequestType>(
    type: T,
    payload: LocalOnnxWorkerRequestMap[T],
    transfer: Transferable[] = [],
  ): Promise<LocalOnnxWorkerResponseMap[T]> {
    const worker = this.worker;
    if (!worker) {
      return Promise.reject(new Error('Local runtime worker is not initialized.'));
    }

    const id = this.seq++;
    const message: LocalOnnxWorkerRequest<T> = {
      id,
      type,
      payload,
    };

    return new Promise<LocalOnnxWorkerResponseMap[T]>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Local runtime worker request timed out: ${type}`));
      }, 120_000);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
      });

      try {
        if (transfer.length > 0) {
          try {
            worker.postMessage(message, transfer);
          } catch (error) {
            if (!isTransferPostMessageError(error)) {
              throw error;
            }
            worker.postMessage(message);
          }
        } else {
          worker.postMessage(message);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
}

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let offscreenDocumentEnsurePromise: Promise<void> | null = null;

class LocalOnnxOffscreenRuntimeClient implements LocalOnnxRuntimeClient {
  private seq = 1;

  public async initialize(payload: LocalOnnxWorkerInitPayload): Promise<void> {
    await this.request('INIT', payload);
  }

  public async transcribe(payload: LocalOnnxWorkerTranscribePayload): Promise<WhisperOutput> {
    return this.request('TRANSCRIBE', payload);
  }

  public async dispose(): Promise<void> {
    try {
      await this.request('DISPOSE', {});
    } catch {
      // ignore offscreen dispose failures
    }
  }

  private async request<T extends LocalOnnxWorkerRequestType>(
    type: T,
    payload: LocalOnnxWorkerRequestMap[T],
  ): Promise<LocalOnnxWorkerResponseMap[T]> {
    await ensureOffscreenDocumentReady();

    const id = this.seq++;
    const message: LocalOnnxOffscreenRequestMessage = {
      type: LOCAL_ONNX_OFFSCREEN_MESSAGE_TYPE,
      payload: {
        id,
        type,
        payload,
      } as LocalOnnxOffscreenRequestMessage['payload'],
    };

    const response = await chrome.runtime.sendMessage(message) as
      | LocalOnnxOffscreenResponse
      | undefined;

    if (!response || typeof response !== 'object') {
      throw new Error('Invalid offscreen runtime response.');
    }

    if (response.id !== id) {
      throw new Error(`Mismatched offscreen runtime response id: expected ${id}, got ${response.id}`);
    }

    if (!response.ok) {
      throw new Error(response.error || 'Offscreen runtime request failed.');
    }

    return response.payload as LocalOnnxWorkerResponseMap[T];
  }
}

async function ensureOffscreenDocumentReady(): Promise<void> {
  const offscreenApi = chrome.offscreen;
  if (!offscreenApi?.createDocument) {
    throw new Error('chrome.offscreen API is unavailable in this runtime.');
  }

  if (!offscreenDocumentEnsurePromise) {
    offscreenDocumentEnsurePromise = (async () => {
      const documentUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
      const runtimeAny = chrome.runtime as typeof chrome.runtime & {
        getContexts?: (options: unknown) => Promise<unknown>;
      };

      if (typeof runtimeAny.getContexts === 'function') {
        try {
          const contexts = await runtimeAny.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            documentUrls: [documentUrl],
          });
          if (Array.isArray(contexts) && contexts.length > 0) {
            return;
          }
        } catch {
          // continue with createDocument fallback
        }
      }

      try {
        await offscreenApi.createDocument({
          url: OFFSCREEN_DOCUMENT_PATH,
          reasons: ['WORKERS'],
          justification: 'Run local ASR runtime outside service worker constraints.',
        });
      } catch (error) {
        if (isOffscreenAlreadyExistsError(error)) {
          return;
        }
        throw error;
      }
    })().finally(() => {
      offscreenDocumentEnsurePromise = null;
    });
  }

  await offscreenDocumentEnsurePromise;
}

function isOffscreenAlreadyExistsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /only a single offscreen document|already exists/i.test(message);
}

function isTransferPostMessageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /transferable type|DataCloneError|could not be cloned/i.test(message);
}

