import type { ModelDownloadRequest } from '../model-cache';
import type { ModelAdapter } from './contracts';
import {
  buildHfFileUrl,
  buildVariantStatus,
  defaultEnvironmentCheck,
  getBackendOrThrow,
  getPrecisionOrThrow,
} from './utils';

const REPO = 'onnx-community/whisper-tiny';
const REPO_FALLBACK = 'Xenova/whisper-tiny';
const ADAPTER_ID = 'whisper-tiny';

const PRECISIONS = [
  {
    id: 'q4f16',
    label: 'Q4F16',
    estimatedSizeBytes: 96_000_000,
    description: 'Fast startup with good readability for quick validation.',
  },
  {
    id: 'q4',
    label: 'Q4',
    estimatedSizeBytes: 78_000_000,
    description: 'Smallest download size for smoke tests.',
  },
  {
    id: 'fp16',
    label: 'FP16',
    estimatedSizeBytes: 180_000_000,
    description: 'Higher quality than q4/q4f16 with larger memory usage.',
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
  const decoderCandidates = getDecoderCandidates(precisionId);

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

  if (precisionId === 'q4f16') {
    return [
      'onnx/encoder_model_q4f16.onnx',
      'encoder_model_q4f16.onnx',
      'onnx/encoder_model_q4.onnx',
      'encoder_model_q4.onnx',
      'onnx/encoder_model_uint8.onnx',
      'encoder_model_uint8.onnx',
      'onnx/encoder_model_quantized.onnx',
      'encoder_model_quantized.onnx',
    ];
  }

  return [
    'onnx/encoder_model_q4.onnx',
    'encoder_model_q4.onnx',
    'onnx/encoder_model_uint8.onnx',
    'encoder_model_uint8.onnx',
    'onnx/encoder_model_quantized.onnx',
    'encoder_model_quantized.onnx',
  ];
}

function getDecoderCandidates(precisionId: string): string[] {
  if (precisionId === 'fp16') {
    return [
      'onnx/decoder_model_merged_fp16.onnx',
      'decoder_model_merged_fp16.onnx',
      'onnx/decoder_model_fp16.onnx',
      'decoder_model_fp16.onnx',
      'onnx/decoder_model_merged.onnx',
      'decoder_model_merged.onnx',
    ];
  }

  if (precisionId === 'q4f16') {
    return [
      'onnx/decoder_model_merged_q4f16.onnx',
      'decoder_model_merged_q4f16.onnx',
      'onnx/decoder_model_q4f16.onnx',
      'decoder_model_q4f16.onnx',
      'onnx/decoder_model_merged_q4.onnx',
      'decoder_model_merged_q4.onnx',
      'onnx/decoder_model_q4.onnx',
      'decoder_model_q4.onnx',
    ];
  }

  return [
    'onnx/decoder_model_merged_q4.onnx',
    'decoder_model_merged_q4.onnx',
    'onnx/decoder_model_q4.onnx',
    'decoder_model_q4.onnx',
    'onnx/decoder_model_merged_quantized.onnx',
    'decoder_model_merged_quantized.onnx',
    'onnx/decoder_model_quantized.onnx',
    'decoder_model_quantized.onnx',
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

export const whisperTinyAdapter: ModelAdapter = {
  id: ADAPTER_ID,
  modelKey: 'whisper-tiny-onnx',
  title: 'Whisper Tiny',
  sourceRepo: REPO,
  description: 'Lightweight Whisper model for quick local ASR validation.',
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

