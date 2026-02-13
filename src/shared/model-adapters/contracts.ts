import type { CachedModelFileSummary, CachedModelSummary, ModelDownloadRequest } from '../model-cache';

export type ModelRuntimeBackendId = 'webgpu' | 'wasm';

export interface ModelBackendOption {
  id: ModelRuntimeBackendId;
  label: string;
  description?: string;
}

export interface ModelPrecisionOption {
  id: string;
  label: string;
  estimatedSizeBytes: number;
  description?: string;
}

export interface ModelEnvironmentContext {
  browser: string;
  support: {
    webgpu: boolean;
    wasm: boolean;
    sharedWorker: boolean;
    audioWorklet: boolean;
  };
}

export interface ModelEnvironmentCheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export type ModelVariantDownloadState =
  | 'not-downloaded'
  | 'downloading'
  | 'ready'
  | 'partial'
  | 'error';

export interface ModelVariantDownloadStatus {
  state: ModelVariantDownloadState;
  modelId: string;
  expectedFiles: number;
  downloadedFiles: number;
  missingFiles: number;
  progressPercent: number;
  detail?: string;
}

export interface ModelVariantSelection {
  adapterId: string;
  precisionId: string;
  backendId?: ModelRuntimeBackendId;
}

export interface ModelRuntimeSelection {
  precisionId: string;
  backendId: ModelRuntimeBackendId;
}

export interface ModelVariantStatusInput {
  precisionId: string;
  summary?: CachedModelSummary;
  files?: CachedModelFileSummary[];
}

export interface ModelAdapter {
  id: string;
  modelKey: string;
  title: string;
  sourceRepo: string;
  description: string;
  precisions: ModelPrecisionOption[];
  backends: ModelBackendOption[];
  defaultPrecisionId: string;
  defaultBackendId: ModelRuntimeBackendId;
  getModelId: (precisionId: string) => string;
  getDownloadRequest: (precisionId: string) => ModelDownloadRequest;
  checkEnvironment: (
    context: ModelEnvironmentContext,
    selection: ModelRuntimeSelection,
  ) => ModelEnvironmentCheckResult;
  getDownloadStatus: (input: ModelVariantStatusInput) => ModelVariantDownloadStatus;
}
