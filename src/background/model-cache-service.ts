import type {
  CachedModelFileSummary,
  CachedModelSummary,
  ModelDownloadFileInput,
  ModelDownloadRequest,
} from '../shared/model-cache';
import { getSettings } from '../shared/settings';

const DB_NAME = 'linguarelay-model-cache';
const DB_VERSION = 1;

const MODELS_STORE = 'models';
const FILES_STORE = 'files';
const CHUNKS_STORE = 'chunks';

const FILES_BY_MODEL_INDEX = 'by_model';
const CHUNKS_BY_MODEL_INDEX = 'by_model';
const CHUNKS_BY_MODEL_FILE_INDEX = 'by_model_file';

interface ModelRow extends CachedModelSummary {
  createdAt: number;
}

interface FileRow extends CachedModelFileSummary {
  chunkCount: number;
}

interface ChunkRow {
  modelId: string;
  fileName: string;
  index: number;
  data: ArrayBuffer;
}

interface ActiveDownload {
  controller: AbortController;
  done: Promise<void>;
  settleDone: () => void;
}

interface DownloadSnapshot {
  modelId: string;
  totalBytes: number;
  downloadedBytes: number;
  fileCount: number;
  completedFiles: number;
  updatedAt: number;
}

interface PlannedDownloadFile {
  file: ModelDownloadFileInput;
  fileName: string;
  resolvedUrl?: string;
  expectedBytes: number;
}

interface DownloadAuthContext {
  huggingFaceToken?: string;
}

export class ModelCacheService {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly activeDownloads = new Map<string, ActiveDownload>();
  private readonly cancelledDownloads = new Set<string>();

  public async listModels(): Promise<CachedModelSummary[]> {
    const db = await this.getDb();
    const tx = db.transaction(MODELS_STORE, 'readonly');
    const rows = await requestToPromise<ModelRow[]>(tx.objectStore(MODELS_STORE).getAll());
    await waitForTransaction(tx);

    return rows
      .map((row) => ({ ...row }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public async listFiles(modelId: string): Promise<CachedModelFileSummary[]> {
    const db = await this.getDb();
    const tx = db.transaction(FILES_STORE, 'readonly');
    const store = tx.objectStore(FILES_STORE);
    const index = store.index(FILES_BY_MODEL_INDEX);
    const rows = await requestToPromise<FileRow[]>(index.getAll(IDBKeyRange.only(modelId)));
    await waitForTransaction(tx);

    return rows
      .map((row) => ({ ...row }))
      .sort((a, b) => a.fileName.localeCompare(b.fileName));
  }

  public async readModelFile(modelId: string, fileName: string): Promise<ArrayBuffer | null> {
    const normalizedModelId = modelId.trim();
    const normalizedFileName = fileName.trim();
    if (!normalizedModelId || !normalizedFileName) {
      return null;
    }

    const db = await this.getDb();
    const tx = db.transaction([FILES_STORE, CHUNKS_STORE], 'readonly');

    const file = await requestToPromise<FileRow | undefined>(
      tx.objectStore(FILES_STORE).get([normalizedModelId, normalizedFileName]),
    );
    if (!file) {
      await waitForTransaction(tx);
      return null;
    }

    const chunkIndex = tx.objectStore(CHUNKS_STORE).index(CHUNKS_BY_MODEL_FILE_INDEX);
    const chunks = await requestToPromise<ChunkRow[]>(
      chunkIndex.getAll(IDBKeyRange.only([normalizedModelId, normalizedFileName])),
    );
    await waitForTransaction(tx);

    if (!chunks.length) {
      return null;
    }

    chunks.sort((a, b) => a.index - b.index);

    let total = 0;
    for (const chunk of chunks) {
      total += chunk.data.byteLength;
    }

    if (total <= 0) {
      return null;
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      const view = new Uint8Array(chunk.data);
      merged.set(view, offset);
      offset += view.byteLength;
    }

    return merged.buffer;
  }

  public async deleteModel(modelId: string): Promise<void> {
    await this.cancelDownload(modelId);
    await this.waitForDownloadToSettle(modelId, 1500);

    const db = await this.getDb();
    const tx = db.transaction([MODELS_STORE, FILES_STORE, CHUNKS_STORE], 'readwrite');

    tx.objectStore(MODELS_STORE).delete(modelId);

    await this.deleteByIndex(
      tx.objectStore(FILES_STORE),
      FILES_BY_MODEL_INDEX,
      IDBKeyRange.only(modelId),
    );

    await this.deleteByIndex(
      tx.objectStore(CHUNKS_STORE),
      CHUNKS_BY_MODEL_INDEX,
      IDBKeyRange.only(modelId),
    );

    await waitForTransaction(tx);
    this.cancelledDownloads.delete(modelId);
  }

  public async cancelDownload(modelId: string): Promise<boolean> {
    this.cancelledDownloads.add(modelId);
    const active = this.activeDownloads.get(modelId);
    if (active) {
      active.controller.abort();
    }
    await this.upsertModel({
      modelId,
      state: 'error',
      fileCount: 0,
      completedFiles: 0,
      totalBytes: 0,
      downloadedBytes: 0,
      updatedAt: Date.now(),
      errorMessage: 'Download cancelled by user.',
      createdAt: Date.now(),
    });
    return Boolean(active);
  }

  public async startDownload(request: ModelDownloadRequest): Promise<void> {
    const normalizedModelId = request.modelId.trim();
    if (!normalizedModelId) {
      throw new Error('modelId is required');
    }

    const files = normalizeFiles(request.files);
    if (files.length === 0) {
      throw new Error('at least one file url is required');
    }

    if (this.activeDownloads.has(normalizedModelId)) {
      throw new Error('model download is already running');
    }

    this.cancelledDownloads.delete(normalizedModelId);

    const controller = new AbortController();
    const deferred = createDeferred<void>();
    this.activeDownloads.set(normalizedModelId, {
      controller,
      done: deferred.promise,
      settleDone: deferred.resolve,
    });

    void this.runDownload({ modelId: normalizedModelId, files }, controller)
      .catch(() => undefined)
      .finally(() => {
        const active = this.activeDownloads.get(normalizedModelId);
        this.activeDownloads.delete(normalizedModelId);
        this.cancelledDownloads.delete(normalizedModelId);
        active?.settleDone();
      });
  }

  private async runDownload(request: ModelDownloadRequest, controller: AbortController): Promise<void> {
    const startedAt = Date.now();
    const auth = await this.loadDownloadAuthContext();
    const plannedFiles = await this.planDownloadFiles(
      request.modelId,
      request.files,
      controller.signal,
      auth,
    );
    const plannedTotalBytes = plannedFiles.reduce((sum, item) => sum + item.expectedBytes, 0);
    const snapshot: DownloadSnapshot = {
      modelId: request.modelId,
      totalBytes: plannedTotalBytes,
      downloadedBytes: 0,
      fileCount: plannedFiles.length,
      completedFiles: 0,
      updatedAt: startedAt,
    };

    await this.deleteModelDataOnly(request.modelId);
    this.throwIfDownloadCancelled(request.modelId, controller.signal);

    await this.upsertModel({
      modelId: request.modelId,
      state: 'downloading',
      fileCount: snapshot.fileCount,
      completedFiles: 0,
      totalBytes: snapshot.totalBytes,
      downloadedBytes: 0,
      updatedAt: startedAt,
      errorMessage: undefined,
      createdAt: startedAt,
    });
    this.throwIfDownloadCancelled(request.modelId, controller.signal);

    try {
      for (const plannedFile of plannedFiles) {
        this.throwIfDownloadCancelled(request.modelId, controller.signal);
        await this.downloadSingleFile(request.modelId, plannedFile, snapshot, controller.signal, auth);
      }
      this.throwIfDownloadCancelled(request.modelId, controller.signal);

      snapshot.updatedAt = Date.now();
      await this.upsertModel({
        modelId: request.modelId,
        state: 'ready',
        fileCount: snapshot.fileCount,
        completedFiles: snapshot.fileCount,
        totalBytes: snapshot.totalBytes,
        downloadedBytes: snapshot.downloadedBytes,
        updatedAt: snapshot.updatedAt,
        errorMessage: undefined,
        createdAt: startedAt,
      });
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'AbortError'
          ? 'Download cancelled.'
          : error instanceof Error
            ? error.message
            : 'Unknown model download error';

      if (!this.cancelledDownloads.has(request.modelId) && !controller.signal.aborted) {
        await this.upsertModel({
          modelId: request.modelId,
          state: 'error',
          fileCount: snapshot.fileCount,
          completedFiles: snapshot.completedFiles,
          totalBytes: snapshot.totalBytes,
          downloadedBytes: snapshot.downloadedBytes,
          updatedAt: Date.now(),
          errorMessage: message,
          createdAt: startedAt,
        });
      }

      throw error;
    }
  }

  private async planDownloadFiles(
    modelId: string,
    files: ModelDownloadFileInput[],
    signal: AbortSignal,
    auth: DownloadAuthContext,
  ): Promise<PlannedDownloadFile[]> {
    const planned: PlannedDownloadFile[] = [];

    for (const file of files) {
      const fileName = file.fileName ?? deriveFileName(file.url);
      this.throwIfDownloadCancelled(modelId, signal);

      const metadata = await this.probeModelFileWithFallback(file, signal, auth, fileName);
      planned.push({
        file,
        fileName,
        resolvedUrl: metadata.resolvedUrl,
        expectedBytes: metadata.sizeBytes,
      });
    }

    return planned;
  }

  private async probeModelFileWithFallback(
    file: ModelDownloadFileInput,
    signal: AbortSignal,
    auth: DownloadAuthContext,
    fileName: string,
  ): Promise<{ resolvedUrl?: string; sizeBytes: number }> {
    const urls = dedupeUrls([file.url, ...(file.fallbackUrls ?? [])]);
    let lastResponse: Response | null = null;

    for (const url of urls) {
      const response = await this.fetchModelFileMetadata(url, signal, auth);
      lastResponse = response;

      if (response.ok) {
        return {
          resolvedUrl: url,
          sizeBytes:
            parseByteCount(response.headers.get('content-length')) ||
            parseContentRangeTotal(response.headers.get('content-range')),
        };
      }

      if (response.status === 401 && isHuggingFaceUrl(url)) {
        const reason = auth.huggingFaceToken
          ? 'Hugging Face rejected current token. Verify token permission and repository access.'
          : 'Hugging Face requires authentication in current environment. Set Model Hub -> Hugging Face Token in settings.';
        throw new Error(`Failed to download ${fileName}: HTTP 401 (${reason})`);
      }

      if (response.status !== 404 && response.status !== 405) {
        return { resolvedUrl: url, sizeBytes: 0 };
      }
    }

    if (lastResponse?.status === 404) {
      // Keep download behavior tolerant; actual GET still retries with fallbacks.
      return { sizeBytes: 0 };
    }

    return { sizeBytes: 0 };
  }

  private async downloadSingleFile(
    modelId: string,
    plannedFile: PlannedDownloadFile,
    snapshot: DownloadSnapshot,
    signal: AbortSignal,
    auth: DownloadAuthContext,
  ): Promise<void> {
    this.throwIfDownloadCancelled(modelId, signal);
    const fileName = plannedFile.fileName;
    const file = plannedFile.file;

    await this.deleteFileData(modelId, fileName);
    this.throwIfDownloadCancelled(modelId, signal);

    const resolved = await this.fetchModelFileWithFallback(
      file,
      signal,
      auth,
      fileName,
      plannedFile.resolvedUrl,
    );
    this.throwIfDownloadCancelled(modelId, signal);
    const response = resolved.response;
    const resolvedUrl = resolved.resolvedUrl;
    if (!response.ok) {
      if (response.status === 401 && isHuggingFaceUrl(file.url)) {
        const reason = auth.huggingFaceToken
          ? 'Hugging Face rejected current token. Verify token permission and repository access.'
          : 'Hugging Face requires authentication in current environment. Set Model Hub -> Hugging Face Token in settings.';
        throw new Error(`Failed to download ${fileName}: HTTP 401 (${reason})`);
      }
      throw new Error(`Failed to download ${fileName}: HTTP ${response.status}`);
    }

    const measuredContentLength =
      parseByteCount(response.headers.get('content-length')) ||
      parseContentRangeTotal(response.headers.get('content-range'));
    let contentLength = plannedFile.expectedBytes;

    if (measuredContentLength > 0 && measuredContentLength !== contentLength) {
      snapshot.totalBytes += measuredContentLength - contentLength;
      contentLength = measuredContentLength;
    } else if (measuredContentLength > 0 && contentLength === 0) {
      snapshot.totalBytes += measuredContentLength;
      contentLength = measuredContentLength;
    }

    const now = Date.now();
    await this.upsertFile({
      modelId,
      fileName,
      url: resolvedUrl,
      downloadedBytes: 0,
      totalBytes: contentLength,
      updatedAt: now,
      chunkCount: 0,
    });
    this.throwIfDownloadCancelled(modelId, signal);

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error(`ReadableStream is unavailable for ${fileName}`);
    }

    let chunkIndex = 0;
    let fileDownloaded = 0;
    let lastProgressPersistAt = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (!value || value.byteLength === 0) {
        continue;
      }

      const chunk = value.slice();
      await this.putChunk({
        modelId,
        fileName,
        index: chunkIndex,
        data: chunk.buffer,
      });
      this.throwIfDownloadCancelled(modelId, signal);
      chunkIndex += 1;

      const delta = chunk.byteLength;
      fileDownloaded += delta;
      snapshot.downloadedBytes += delta;
      if (contentLength === 0) {
        snapshot.totalBytes += delta;
      }

      const nowTs = Date.now();
      const shouldPersist = nowTs - lastProgressPersistAt > 250;
      if (shouldPersist) {
        this.throwIfDownloadCancelled(modelId, signal);
        snapshot.updatedAt = nowTs;
        await this.upsertFile({
          modelId,
          fileName,
          url: resolvedUrl,
          downloadedBytes: fileDownloaded,
          totalBytes: contentLength > 0 ? contentLength : fileDownloaded,
          updatedAt: nowTs,
          chunkCount: chunkIndex,
        });

        await this.upsertModel({
          modelId,
          state: 'downloading',
          fileCount: snapshot.fileCount,
          completedFiles: snapshot.completedFiles,
          totalBytes: snapshot.totalBytes,
          downloadedBytes: snapshot.downloadedBytes,
          updatedAt: nowTs,
          errorMessage: undefined,
          createdAt: snapshot.updatedAt,
        });
        this.throwIfDownloadCancelled(modelId, signal);
        lastProgressPersistAt = nowTs;
      }
    }

    this.throwIfDownloadCancelled(modelId, signal);
    snapshot.completedFiles += 1;
    snapshot.updatedAt = Date.now();

    await this.upsertFile({
      modelId,
      fileName,
      url: resolvedUrl,
      downloadedBytes: fileDownloaded,
      totalBytes: contentLength > 0 ? contentLength : fileDownloaded,
      updatedAt: snapshot.updatedAt,
      chunkCount: chunkIndex,
    });

    await this.upsertModel({
      modelId,
      state: 'downloading',
      fileCount: snapshot.fileCount,
      completedFiles: snapshot.completedFiles,
      totalBytes: snapshot.totalBytes,
      downloadedBytes: snapshot.downloadedBytes,
      updatedAt: snapshot.updatedAt,
      errorMessage: undefined,
      createdAt: snapshot.updatedAt,
    });
    this.throwIfDownloadCancelled(modelId, signal);
  }

  private async putChunk(row: ChunkRow): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(CHUNKS_STORE, 'readwrite');
    tx.objectStore(CHUNKS_STORE).put(row);
    await waitForTransaction(tx);
  }

  private async upsertFile(row: FileRow): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(FILES_STORE, 'readwrite');
    tx.objectStore(FILES_STORE).put(row);
    await waitForTransaction(tx);
  }

  private async upsertModel(row: ModelRow): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(MODELS_STORE, 'readwrite');

    const current = await requestToPromise<ModelRow | undefined>(
      tx.objectStore(MODELS_STORE).get(row.modelId),
    );

    tx.objectStore(MODELS_STORE).put({
      ...row,
      createdAt: current?.createdAt ?? row.createdAt,
    });

    await waitForTransaction(tx);
  }

  private async deleteModelDataOnly(modelId: string): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction([FILES_STORE, CHUNKS_STORE], 'readwrite');

    await this.deleteByIndex(
      tx.objectStore(FILES_STORE),
      FILES_BY_MODEL_INDEX,
      IDBKeyRange.only(modelId),
    );

    await this.deleteByIndex(
      tx.objectStore(CHUNKS_STORE),
      CHUNKS_BY_MODEL_INDEX,
      IDBKeyRange.only(modelId),
    );

    await waitForTransaction(tx);
  }

  private async deleteFileData(modelId: string, fileName: string): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction([FILES_STORE, CHUNKS_STORE], 'readwrite');

    tx.objectStore(FILES_STORE).delete([modelId, fileName]);

    await this.deleteByIndex(
      tx.objectStore(CHUNKS_STORE),
      CHUNKS_BY_MODEL_FILE_INDEX,
      IDBKeyRange.only([modelId, fileName]),
    );

    await waitForTransaction(tx);
  }

  private async deleteByIndex(
    store: IDBObjectStore,
    indexName: string,
    query: IDBKeyRange,
  ): Promise<void> {
    const index = store.index(indexName);

    await new Promise<void>((resolve, reject) => {
      const request = index.openKeyCursor(query);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }

        store.delete(cursor.primaryKey);
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error('index cursor failed'));
    });
  }

  private async fetchModelFile(
    url: string,
    signal: AbortSignal,
    auth: DownloadAuthContext,
  ): Promise<Response> {
    const headers = this.buildDownloadHeaders(url, auth);

    return fetch(url, {
      signal,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    });
  }

  private async fetchModelFileMetadata(
    url: string,
    signal: AbortSignal,
    auth: DownloadAuthContext,
  ): Promise<Response> {
    const headers = this.buildDownloadHeaders(url, auth);
    let response = await fetch(url, {
      method: 'HEAD',
      signal,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    });

    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        method: 'GET',
        signal,
        headers: {
          ...headers,
          Range: 'bytes=0-0',
        },
      });
    }

    return response;
  }

  private buildDownloadHeaders(url: string, auth: DownloadAuthContext): Record<string, string> {
    const headers: Record<string, string> = {};
    if (auth.huggingFaceToken && isHuggingFaceUrl(url)) {
      headers.Authorization = `Bearer ${auth.huggingFaceToken}`;
    }
    return headers;
  }

  private async fetchModelFileWithFallback(
    file: ModelDownloadFileInput,
    signal: AbortSignal,
    auth: DownloadAuthContext,
    fileName: string,
    preferredResolvedUrl?: string,
  ): Promise<{ response: Response; resolvedUrl: string }> {
    const urls = dedupeUrls([preferredResolvedUrl ?? '', file.url, ...(file.fallbackUrls ?? [])]);
    let lastResponse: Response | null = null;

    for (const url of urls) {
      const response = await this.fetchModelFile(url, signal, auth);
      lastResponse = response;

      if (response.ok) {
        return { response, resolvedUrl: url };
      }

      if (response.status === 401) {
        return { response, resolvedUrl: url };
      }

      if (response.status !== 404) {
        return { response, resolvedUrl: url };
      }
    }

    if (lastResponse) {
      throw new Error(
        `Failed to download ${fileName}: HTTP 404 (tried ${urls.length} candidates)`,
      );
    }

    throw new Error(`Failed to download ${fileName}: no downloadable URL candidates`);
  }

  private async loadDownloadAuthContext(): Promise<DownloadAuthContext> {
    try {
      const settings = await getSettings();
      return {
        huggingFaceToken: settings.modelHub?.huggingFaceToken?.trim() || undefined,
      };
    } catch {
      return {};
    }
  }

  private async getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDatabase();
    }
    return this.dbPromise;
  }

  private throwIfDownloadCancelled(modelId: string, signal: AbortSignal): void {
    if (this.cancelledDownloads.has(modelId) || signal.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }
  }

  private async waitForDownloadToSettle(modelId: string, timeoutMs: number): Promise<void> {
    const active = this.activeDownloads.get(modelId);
    if (!active) {
      return;
    }

    await Promise.race([
      active.done,
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
}

function normalizeFiles(files: ModelDownloadFileInput[]): ModelDownloadFileInput[] {
  const dedup = new Map<string, ModelDownloadFileInput>();

  for (const file of files) {
    const url = file.url.trim();
    if (!url) {
      continue;
    }

    const parsed = new URL(url);
    if (parsed.hostname !== 'huggingface.co') {
      throw new Error(`Only huggingface.co downloads are allowed in current build: ${url}`);
    }

    const normalized: ModelDownloadFileInput = {
      url: parsed.toString(),
      fallbackUrls: file.fallbackUrls
        ?.map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => {
          const parsedFallback = new URL(item);
          if (parsedFallback.hostname !== 'huggingface.co') {
            throw new Error(
              `Only huggingface.co downloads are allowed in current build: ${item}`,
            );
          }
          return parsedFallback.toString();
        }),
      fileName: file.fileName?.trim() || undefined,
    };

    const key = normalized.fileName ? `${normalized.fileName}::${normalized.url}` : normalized.url;
    dedup.set(key, normalized);
  }

  return [...dedup.values()];
}

function parseByteCount(headerValue: string | null): number {
  if (!headerValue) {
    return 0;
  }

  const value = Number.parseInt(headerValue, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value;
}

function parseContentRangeTotal(headerValue: string | null): number {
  if (!headerValue) {
    return 0;
  }

  const match = /\/(\d+)\s*$/i.exec(headerValue.trim());
  if (!match || !match[1]) {
    return 0;
  }

  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value;
}

function dedupeUrls(urls: string[]): string[] {
  const dedup = new Set<string>();
  for (const url of urls) {
    const normalized = url.trim();
    if (!normalized) {
      continue;
    }
    dedup.add(normalized);
  }
  return [...dedup];
}

function deriveFileName(url: string): string {
  const parsed = new URL(url);
  const segments = parsed.pathname.split('/').filter(Boolean);
  const tail = segments.at(-1);
  if (!tail) {
    return `file-${Date.now()}`;
  }

  return decodeURIComponent(tail);
}

function isHuggingFaceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'huggingface.co' || parsed.hostname.endsWith('.huggingface.co');
  } catch {
    return false;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(MODELS_STORE)) {
        db.createObjectStore(MODELS_STORE, { keyPath: 'modelId' });
      }

      if (!db.objectStoreNames.contains(FILES_STORE)) {
        const fileStore = db.createObjectStore(FILES_STORE, {
          keyPath: ['modelId', 'fileName'],
        });
        fileStore.createIndex(FILES_BY_MODEL_INDEX, 'modelId', { unique: false });
      }

      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        const chunkStore = db.createObjectStore(CHUNKS_STORE, {
          keyPath: ['modelId', 'fileName', 'index'],
        });
        chunkStore.createIndex(CHUNKS_BY_MODEL_INDEX, 'modelId', { unique: false });
        chunkStore.createIndex(CHUNKS_BY_MODEL_FILE_INDEX, ['modelId', 'fileName'], {
          unique: false,
        });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open model cache database'));
    };
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
