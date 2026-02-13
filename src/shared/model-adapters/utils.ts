import type { ModelDownloadRequest } from '../model-cache';
import type {
  ModelBackendOption,
  ModelEnvironmentCheckResult,
  ModelEnvironmentContext,
  ModelPrecisionOption,
  ModelRuntimeSelection,
  ModelVariantDownloadStatus,
  ModelVariantStatusInput,
} from './contracts';

const HF_HOST = 'https://huggingface.co';

export function buildHfFileUrl(repo: string, fileName: string): string {
  return `${HF_HOST}/${repo}/resolve/main/${fileName}`;
}

export function getPrecisionOrThrow(
  precisions: ModelPrecisionOption[],
  precisionId: string,
): ModelPrecisionOption {
  const precision = precisions.find((item) => item.id === precisionId);
  if (!precision) {
    throw new Error(`Unsupported precision: ${precisionId}`);
  }
  return precision;
}

export function getBackendOrThrow(
  backends: ModelBackendOption[],
  backendId: string,
): ModelBackendOption {
  const backend = backends.find((item) => item.id === backendId);
  if (!backend) {
    throw new Error(`Unsupported runtime backend: ${backendId}`);
  }
  return backend;
}

export function defaultEnvironmentCheck(
  context: ModelEnvironmentContext,
  selection: ModelRuntimeSelection,
): ModelEnvironmentCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { precisionId, backendId } = selection;

  if (backendId === 'webgpu' && !context.support.webgpu) {
    errors.push('WebGPU backend selected, but current environment has no WebGPU support.');
  }

  if (backendId === 'wasm' && !context.support.wasm) {
    errors.push('WASM backend selected, but WebAssembly is unavailable in current environment.');
  }

  if (backendId === 'wasm') {
    warnings.push('WASM backend runs on CPU, with higher latency than WebGPU.');
  }

  if (/Safari/i.test(context.browser) && backendId === 'webgpu') {
    warnings.push('Safari WebGPU support may be unstable. Validate long-session ASR carefully.');
  }

  if (/Firefox/i.test(context.browser) && backendId === 'webgpu') {
    warnings.push('Firefox WebGPU support varies by version and flags.');
  }

  if (precisionId === 'fp16' && backendId !== 'webgpu') {
    errors.push('FP16 precision requires WebGPU backend in current runtime design.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function buildVariantStatus(
  modelId: string,
  expectedRequest: ModelDownloadRequest,
  input: ModelVariantStatusInput,
): ModelVariantDownloadStatus {
  const expectedFiles = expectedRequest.files.length;
  const summary = input.summary;
  const files = input.files;

  const downloadedFiles = files
    ? Math.min(files.length, expectedFiles)
    : Math.min(summary?.completedFiles ?? 0, expectedFiles);

  const missingFiles = Math.max(expectedFiles - downloadedFiles, 0);

  let progressPercent = 0;
  if (summary && summary.totalBytes > 0) {
    progressPercent = Math.max(
      0,
      Math.min(100, (summary.downloadedBytes / summary.totalBytes) * 100),
    );
  } else if (expectedFiles > 0) {
    progressPercent = (downloadedFiles / expectedFiles) * 100;
  }

  if (!summary) {
    return {
      state: 'not-downloaded',
      modelId,
      expectedFiles,
      downloadedFiles,
      missingFiles,
      progressPercent: 0,
    };
  }

  if (summary.state === 'error') {
    return {
      state: 'error',
      modelId,
      expectedFiles,
      downloadedFiles,
      missingFiles,
      progressPercent,
      detail: summary.errorMessage,
    };
  }

  if (summary.state === 'downloading') {
    return {
      state: 'downloading',
      modelId,
      expectedFiles,
      downloadedFiles,
      missingFiles,
      progressPercent,
    };
  }

  if (summary.state === 'ready' && missingFiles === 0) {
    return {
      state: 'ready',
      modelId,
      expectedFiles,
      downloadedFiles,
      missingFiles,
      progressPercent: 100,
    };
  }

  return {
    state: 'partial',
    modelId,
    expectedFiles,
    downloadedFiles,
    missingFiles,
    progressPercent,
    detail: 'Model files are incomplete. Re-download this model variant.',
  };
}
