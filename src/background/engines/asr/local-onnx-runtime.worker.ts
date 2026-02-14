import { env as transformersEnv, pipeline as transformersPipeline } from '@huggingface/transformers';
import { ModelCacheService } from '../../model-cache-service';
import type { CachedModelFileSummary } from '../../../shared/model-cache';

type TransformersPipeline = (
  audio: Float32Array | Float64Array,
  options?: Record<string, unknown>,
) => Promise<WhisperOutput>;

interface WhisperTimestampChunk {
  timestamp?: [number, number];
}

interface WhisperOutput {
  text?: string;
  chunks?: WhisperTimestampChunk[];
}

interface CacheLike {
  match: (request: string | Request) => Promise<Response | undefined>;
  put: (request: string | Request, response: Response) => Promise<void>;
}

interface LocalOnnxWorkerInitPayload {
  modelId: string;
  sourceRepo: string;
  precision: string;
  backend: 'webgpu' | 'wasm';
}

interface LocalOnnxWorkerTranscribePayload {
  audioBuffer: ArrayBuffer;
  language: string;
}

interface LocalOnnxWorkerRequestMap {
  INIT: LocalOnnxWorkerInitPayload;
  TRANSCRIBE: LocalOnnxWorkerTranscribePayload;
  DISPOSE: Record<string, never>;
}

interface LocalOnnxWorkerResponseMap {
  INIT: { ok: true };
  TRANSCRIBE: WhisperOutput;
  DISPOSE: { ok: true };
}

type LocalOnnxWorkerRequestType = keyof LocalOnnxWorkerRequestMap;

interface LocalOnnxWorkerRequest<T extends LocalOnnxWorkerRequestType = LocalOnnxWorkerRequestType> {
  id: number;
  type: T;
  payload: LocalOnnxWorkerRequestMap[T];
}

type LocalOnnxWorkerEvent =
  | {
      type: 'STATS';
      payload: {
        modelLoadProgress?: number;
      };
    };

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

interface WorkerScopeLike {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<LocalOnnxWorkerRequest>) => void,
  ) => void;
  postMessage: (message: unknown) => void;
}

const workerScope = self as unknown as WorkerScopeLike;

class LocalOnnxWorkerRuntime {
  private transcriber: TransformersPipeline | null = null;
  private modelId = '';
  private sourceRepo = '';
  private precision = 'q4f16';
  private backend: 'webgpu' | 'wasm' = 'wasm';
  private fileIndex: CachedModelFileSummary[] = [];
  private availableFileLookup = new Map<string, string[]>();
  private readonly inflightFileReads = new Map<string, Promise<ArrayBuffer | null>>();
  private readonly modelCache = new ModelCacheService();

  public async initialize(payload: LocalOnnxWorkerInitPayload): Promise<void> {
    this.modelId = payload.modelId;
    this.sourceRepo = payload.sourceRepo;
    this.precision = payload.precision;
    this.backend = payload.backend;

    this.fileIndex = await this.modelCache.listFiles(this.modelId);
    this.availableFileLookup = buildAvailableFileLookup(this.fileIndex);
    this.inflightFileReads.clear();

    ensureXmlHttpRequestPolyfill();
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
    const dtypeCandidates = buildDtypeCandidates(this.precision, this.backend);
    let lastError: unknown;

    for (const dtype of dtypeCandidates) {
      try {
        const transcriber = (await transformersPipeline('automatic-speech-recognition', this.sourceRepo, {
          device: this.backend,
          dtype: dtype as 'q4' | 'q4f16' | 'fp16' | 'fp32',
          progress_callback: (event: unknown) => {
            this.handleProgressEvent(event, progressMap);
          },
          local_files_only: true,
        })) as unknown as TransformersPipeline;
        this.transcriber = transcriber;
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Failed to initialize local ASR pipeline with available dtype candidates.');
  }

  public async transcribe(payload: LocalOnnxWorkerTranscribePayload): Promise<WhisperOutput> {
    if (!this.transcriber) {
      throw new Error('Local runtime is not initialized.');
    }

    const audio = new Float32Array(payload.audioBuffer);
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

    const lang = normalizeAsrLanguage(payload.language);
    if (lang) {
      options.language = lang;
    }

    return this.transcriber(audio, options);
  }

  public async dispose(): Promise<void> {
    const transcriber = this.transcriber as
      | (TransformersPipeline & { dispose?: () => Promise<void> })
      | null;
    this.transcriber = null;
    if (transcriber?.dispose) {
      await transcriber.dispose();
    }
    this.inflightFileReads.clear();
    this.availableFileLookup.clear();
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
        // local-only cache
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
      // not a valid URL
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
      const buffer = await this.readFileBufferWithDedupe(candidate);
      if (buffer) {
        return buffer;
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

  private handleProgressEvent(raw: unknown, progressMap: Map<string, number>): void {
    const event = raw as {
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
    emitEvent({
      type: 'STATS',
      payload: {
        modelLoadProgress: Number(avg.toFixed(2)),
      },
    });
  }
}

const runtime = new LocalOnnxWorkerRuntime();

workerScope.addEventListener('message', (event: MessageEvent<LocalOnnxWorkerRequest>) => {
  void handleRequest(event.data);
});

async function handleRequest(message: LocalOnnxWorkerRequest): Promise<void> {
  if (!message || typeof message !== 'object') {
    return;
  }

  try {
    switch (message.type) {
      case 'INIT': {
        await runtime.initialize(message.payload as LocalOnnxWorkerInitPayload);
        emitResult(message.id, 'INIT', { ok: true });
        return;
      }
      case 'TRANSCRIBE': {
        const output = await runtime.transcribe(message.payload as LocalOnnxWorkerTranscribePayload);
        emitResult(message.id, 'TRANSCRIBE', output);
        return;
      }
      case 'DISPOSE': {
        await runtime.dispose();
        emitResult(message.id, 'DISPOSE', { ok: true });
        return;
      }
      default:
        emitError(message.id, message.type, 'Unsupported worker request.');
    }
  } catch (error) {
    emitError(
      message.id,
      message.type,
      error instanceof Error ? error.message : 'Unknown worker error',
    );
  }
}

function emitResult<T extends LocalOnnxWorkerRequestType>(
  id: number,
  type: T,
  payload: LocalOnnxWorkerResponseMap[T],
): void {
  const message: LocalOnnxWorkerResult<T> = {
    id,
    kind: 'RESULT',
    type,
    ok: true,
    payload,
  };
  workerScope.postMessage(message);
}

function emitError<T extends LocalOnnxWorkerRequestType>(
  id: number,
  type: T,
  error: string,
): void {
  const message: LocalOnnxWorkerResult<T> = {
    id,
    kind: 'RESULT',
    type,
    ok: false,
    error,
  };
  workerScope.postMessage(message);
}

function emitEvent(event: LocalOnnxWorkerEvent): void {
  const message: LocalOnnxWorkerEventEnvelope = {
    kind: 'EVENT',
    event,
  };
  workerScope.postMessage(message);
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
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^onnx\//, '').trim();
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureXmlHttpRequestPolyfill(): void {
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
