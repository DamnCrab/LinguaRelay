import type { ModelDownloadRequest } from '../model-cache';
import type { ModelAdapter } from './contracts';
import {
  buildHfFileUrl,
  buildVariantStatus,
  defaultEnvironmentCheck,
  getBackendOrThrow,
  getPrecisionOrThrow,
} from './utils';

const REPO = 'onnx-community/whisper-large-v3-ONNX';
const REPO_FALLBACK = 'Felladrin/whisper-large-v3-ONNX';
const ADAPTER_ID = 'whisper-large-v3';

const PRECISIONS = [
  {
    id: 'q4f16',
    label: 'Q4F16',
    estimatedSizeBytes: 1_700_000_000,
    description: 'Recommended balance for Whisper Large V3.',
  },
  {
    id: 'q4',
    label: 'Q4',
    estimatedSizeBytes: 1_950_000_000,
    description: 'Smaller VRAM footprint.',
  },
  {
    id: 'fp16',
    label: 'FP16',
    estimatedSizeBytes: 5_000_000_000,
    description: 'Highest quality and largest footprint.',
  },
] as const;

const BACKENDS = [
  {
    id: 'webgpu',
    label: 'WebGPU',
    description: 'GPU acceleration via @huggingface/transformers.',
  },
  {
    id: 'wasm',
    label: 'WASM',
    description: 'CPU fallback via @huggingface/transformers.',
  },
] as const;

const COMMON_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
] as const;

function buildFiles(precisionId: string): ModelDownloadRequest['files'] {
  const encoderCandidates = getEncoderCandidates(precisionId);
  const decoderCandidates = [
    `onnx/decoder_model_merged_${precisionId}.onnx`,
    `decoder_model_merged_${precisionId}.onnx`,
    `onnx/decoder_model_${precisionId}.onnx`,
    `decoder_model_${precisionId}.onnx`,
  ];

  const files: ModelDownloadRequest['files'] = [
    toDownloadFile(encoderCandidates),
    toDownloadFile(decoderCandidates),
  ];

  for (const commonFile of COMMON_FILES) {
    files.push(toDownloadFile([commonFile]));
  }

  return files;
}

function buildDownloadRequest(precisionId: string): ModelDownloadRequest {
  getPrecisionOrThrow([...PRECISIONS], precisionId);
  return {
    modelId: `${ADAPTER_ID}:${precisionId}`,
    files: buildFiles(precisionId),
  };
}

function getEncoderCandidates(precisionId: string): string[] {
  if (precisionId === 'fp16') {
    return [
      'onnx/encoder_model_fp16.onnx',
      'encoder_model_fp16.onnx',
      'onnx/encoder_model.onnx',
      'encoder_model.onnx',
    ];
  }

  return [
    `onnx/encoder_model_${precisionId}.onnx`,
    `encoder_model_${precisionId}.onnx`,
    'onnx/encoder_model_uint8.onnx',
    'encoder_model_uint8.onnx',
    'onnx/encoder_model_quantized.onnx',
    'encoder_model_quantized.onnx',
  ];
}

function toDownloadFile(paths: string[]): ModelDownloadRequest['files'][number] {
  const primaryPath = paths[0];
  if (!primaryPath) {
    throw new Error('Model adapter path list must not be empty');
  }

  const urls = buildRepoCandidateUrls(paths);
  if (urls.length === 0) {
    throw new Error('Model adapter URL list must not be empty');
  }
  const [url, ...fallbackUrls] = urls;
  return {
    url: url!,
    fallbackUrls,
  };
}

function buildRepoCandidateUrls(paths: string[]): string[] {
  const urls = new Set<string>();
  for (const path of paths) {
    urls.add(buildHfFileUrl(REPO, path));
    urls.add(buildHfFileUrl(REPO_FALLBACK, path));
  }
  return [...urls];
}

export const whisperLargeV3Adapter: ModelAdapter = {
  id: ADAPTER_ID,
  modelKey: 'whisper-large-v3-onnx',
  title: 'Whisper Large V3',
  sourceRepo: REPO,
  description: 'Whisper Large V3 ONNX variant with higher accuracy and heavier footprint.',
  precisions: [...PRECISIONS],
  backends: [...BACKENDS],
  defaultPrecisionId: 'q4f16',
  defaultBackendId: 'webgpu',
  getModelId: (precisionId) => `${ADAPTER_ID}:${precisionId}`,
  getDownloadRequest: (precisionId) => buildDownloadRequest(precisionId),
  checkEnvironment: (context, selection) => {
    getPrecisionOrThrow([...PRECISIONS], selection.precisionId);
    getBackendOrThrow([...BACKENDS], selection.backendId);
    return defaultEnvironmentCheck(context, selection);
  },
  getDownloadStatus: (input) => {
    const modelId = `${ADAPTER_ID}:${input.precisionId}`;
    return buildVariantStatus(modelId, buildDownloadRequest(input.precisionId), input);
  },
};
