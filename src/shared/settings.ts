import { z } from 'zod';

import type { UserSettings } from './contracts';
import { ENGINE_IDLE_DISPOSE_MS } from './constants';

const asrOnlineSchema = z.object({
  mode: z.literal('online-gateway'),
  wsUrl: z.string().url(),
  apiKey: z.string().optional(),
  model: z.string().min(1),
  language: z.string().min(1),
  endpointHeaders: z.record(z.string(), z.string()).optional(),
});

const asrLocalSchema = z.object({
  mode: z.literal('local-onnx'),
  model: z.enum(['whisper-large-v3-turbo', 'whisper-large-v3-onnx']),
  precision: z.enum(['q4f16', 'q4', 'fp16']),
  language: z.string().min(1),
});

const translationSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['none', 'openai-compatible']),
  targetLanguage: z.string().min(1),
  sourceLanguage: z.string().min(1),
  endpoint: z.string().url().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2),
});

const runtimeSchema = z.object({
  maxSessions: z.number().int().min(1).max(12),
  engineIdleDisposeMs: z.number().int().min(10_000).max(300_000),
  partialTranslation: z.boolean(),
  maxPendingAudioChunks: z.number().int().min(4).max(128),
});

export const userSettingsSchema = z.object({
  asr: z.discriminatedUnion('mode', [asrOnlineSchema, asrLocalSchema]),
  translation: translationSchema,
  runtime: runtimeSchema,
});

export const DEFAULT_SETTINGS: UserSettings = {
  asr: {
    mode: 'online-gateway',
    wsUrl: 'ws://127.0.0.1:18080/v1/asr/stream',
    model: 'whisper-large-v3-turbo',
    language: 'auto',
  },
  translation: {
    enabled: true,
    provider: 'openai-compatible',
    targetLanguage: 'zh-CN',
    sourceLanguage: 'auto',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-5-mini',
    temperature: 0,
  },
  runtime: {
    maxSessions: 4,
    engineIdleDisposeMs: ENGINE_IDLE_DISPOSE_MS,
    partialTranslation: false,
    maxPendingAudioChunks: 24,
  },
};

const STORAGE_KEY = 'linguarelay:settings';
const LEGACY_STORAGE_KEY = 'vtrans:settings';

type StorageArea = Pick<chrome.storage.StorageArea, 'get' | 'set'>;

function getStorageArea(): StorageArea {
  return chrome.storage.local;
}

export async function getSettings(): Promise<UserSettings> {
  const storage = getStorageArea();
  const result = await storage.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
  const parsed = userSettingsSchema.safeParse(result[STORAGE_KEY]);
  if (parsed.success) {
    return parsed.data;
  }

  const legacyParsed = userSettingsSchema.safeParse(result[LEGACY_STORAGE_KEY]);
  if (legacyParsed.success) {
    await storage.set({ [STORAGE_KEY]: legacyParsed.data });
    return legacyParsed.data;
  }

  await storage.set({ [STORAGE_KEY]: DEFAULT_SETTINGS });
  return DEFAULT_SETTINGS;
}

export async function setSettings(next: UserSettings): Promise<UserSettings> {
  const parsed = userSettingsSchema.parse(next);
  const storage = getStorageArea();
  await storage.set({ [STORAGE_KEY]: parsed });
  return parsed;
}

export function mergeSettingsWithDefault(partial: unknown): UserSettings {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(typeof partial === 'object' && partial !== null ? partial : {}),
  };
  return userSettingsSchema.parse(merged);
}

