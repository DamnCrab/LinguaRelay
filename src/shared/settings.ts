import { z } from 'zod';

import type { UserSettings } from './contracts';
import { ENGINE_IDLE_DISPOSE_MS } from './constants';
import { UI_LOCALE_AUTO } from './i18n';

const requiredTrimmedString = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() : value),
  z.string().min(1),
);

const optionalTrimmedString = z.preprocess(
  (value) => {
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().min(1).optional(),
);

const wsUrlSchema = requiredTrimmedString.refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'ws:' || protocol === 'wss:';
  } catch {
    return false;
  }
}, 'WebSocket URL must use ws:// or wss://');

const asrOnlineSchema = z.object({
  mode: z.literal('online-gateway'),
  wsUrl: wsUrlSchema,
  apiKey: optionalTrimmedString,
  model: requiredTrimmedString,
  language: requiredTrimmedString,
  endpointHeaders: z.record(z.string(), z.string()).optional(),
});

const asrLocalSchema = z.object({
  mode: z.literal('local-onnx'),
  model: z.enum(['whisper-large-v3-turbo', 'whisper-large-v3-onnx']),
  precision: z.enum(['q4f16', 'q4', 'fp16']),
  backend: z.enum(['webgpu', 'wasm']).default('webgpu'),
  language: requiredTrimmedString,
});

const translationSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(['none', 'openai-compatible']),
    targetLanguage: requiredTrimmedString,
    sourceLanguage: requiredTrimmedString,
    endpoint: optionalTrimmedString,
    apiKey: optionalTrimmedString,
    model: optionalTrimmedString,
    temperature: z.number().min(0).max(2),
  })
  .superRefine((value, context) => {
    if (!value.enabled) {
      return;
    }

    if (value.provider !== 'openai-compatible') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose a translation provider when translation is enabled.',
        path: ['provider'],
      });
      return;
    }

    if (!value.endpoint) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Endpoint is required when translation is enabled.',
        path: ['endpoint'],
      });
    } else {
      try {
        const endpoint = new URL(value.endpoint);
        if (!['http:', 'https:'].includes(endpoint.protocol)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Endpoint must be a valid HTTP(S) URL.',
            path: ['endpoint'],
          });
        }
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Endpoint must be a valid HTTP(S) URL.',
          path: ['endpoint'],
        });
      }
    }

    if (!value.model) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Model is required when translation is enabled.',
        path: ['model'],
      });
    }
  });

const runtimeSchema = z.object({
  maxSessions: z.number().int().min(1).max(12),
  engineIdleDisposeMs: z.number().int().min(10_000).max(300_000),
  partialTranslation: z.boolean(),
  maxPendingAudioChunks: z.number().int().min(4).max(128),
});

const uiSchema = z.object({
  locale: requiredTrimmedString.default(UI_LOCALE_AUTO),
});

const modelHubSchema = z.object({
  huggingFaceToken: optionalTrimmedString,
});

export const userSettingsSchema = z.object({
  asr: z.discriminatedUnion('mode', [asrOnlineSchema, asrLocalSchema]),
  translation: translationSchema,
  runtime: runtimeSchema,
  ui: uiSchema.default({ locale: UI_LOCALE_AUTO }),
  modelHub: modelHubSchema.default({}),
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
  ui: {
    locale: UI_LOCALE_AUTO,
  },
  modelHub: {},
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

