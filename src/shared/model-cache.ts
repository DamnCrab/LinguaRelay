export type ModelCacheState = 'downloading' | 'ready' | 'error';

export interface ModelDownloadFileInput {
  url: string;
  fallbackUrls?: string[];
  fileName?: string;
}

export interface ModelDownloadRequest {
  modelId: string;
  files: ModelDownloadFileInput[];
}

export interface CachedModelFileSummary {
  modelId: string;
  fileName: string;
  url: string;
  downloadedBytes: number;
  totalBytes: number;
  updatedAt: number;
}

export interface CachedModelSummary {
  modelId: string;
  state: ModelCacheState;
  fileCount: number;
  completedFiles: number;
  totalBytes: number;
  downloadedBytes: number;
  updatedAt: number;
  errorMessage?: string;
}
