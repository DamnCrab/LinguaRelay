import type { ModelAdapter, ModelVariantSelection } from './contracts';
import { whisperLargeV3Adapter } from './whisper-large-v3.adapter';
import { whisperLargeV3TurboAdapter } from './whisper-large-v3-turbo.adapter';
import { whisperTinyAdapter } from './whisper-tiny.adapter';

const ADAPTERS: ModelAdapter[] = [
  whisperLargeV3TurboAdapter,
  whisperLargeV3Adapter,
  whisperTinyAdapter,
];

export type ModelAdapterId = (typeof ADAPTERS)[number]['id'];

export function listModelAdapters(): ModelAdapter[] {
  return ADAPTERS.map((adapter) => ({ ...adapter }));
}

export function getModelAdapter(adapterId: string): ModelAdapter {
  const adapter = ADAPTERS.find((item) => item.id === adapterId);
  if (!adapter) {
    throw new Error(`Model adapter not found: ${adapterId}`);
  }
  return adapter;
}

export function getModelAdapterByModelKey(modelKey: string): ModelAdapter | null {
  return ADAPTERS.find((item) => item.modelKey === modelKey) ?? null;
}

export function getDefaultModelVariant(): ModelVariantSelection {
  const adapter = ADAPTERS[0];
  if (!adapter) {
    throw new Error('No model adapters registered');
  }

  return {
    adapterId: adapter.id,
    precisionId: adapter.defaultPrecisionId,
    backendId: adapter.defaultBackendId,
  };
}
