import type {
  AsrConfig,
  AsrLocalConfig,
  AsrMode,
  AsrOnlineConfig,
  RuntimeConfig,
  TranslationConfig,
  UserSettings,
} from './contracts';
import { UI_LOCALE_AUTO } from './i18n';
import { DEFAULT_SETTINGS, userSettingsSchema } from './settings';

const LOCAL_MODELS = new Set<AsrLocalConfig['model']>([
  'whisper-large-v3-turbo',
  'whisper-large-v3-onnx',
]);
const LOCAL_PRECISIONS = new Set<AsrLocalConfig['precision']>(['q4f16', 'q4', 'fp16']);
const LOCAL_BACKENDS = new Set<AsrLocalConfig['backend']>(['webgpu', 'wasm']);

const DEFAULT_ONLINE_ASR: AsrOnlineConfig = {
  mode: 'online-gateway',
  wsUrl: 'ws://127.0.0.1:18080/v1/asr/stream',
  model: 'whisper-large-v3-turbo',
  language: 'auto',
};

const DEFAULT_LOCAL_ASR: AsrLocalConfig = {
  mode: 'local-onnx',
  model: 'whisper-large-v3-turbo',
  precision: 'q4f16',
  backend: 'webgpu',
  language: 'auto',
};

export interface SettingsValidationIssue {
  path: string;
  message: string;
}

export interface SettingsValidationResult {
  valid: boolean;
  normalized: UserSettings;
  errors: SettingsValidationIssue[];
  warnings: SettingsValidationIssue[];
  errorMap: Record<string, string>;
  warningMap: Record<string, string>;
}

export function normalizeUserSettings(input: UserSettings): UserSettings {
  return {
    asr: normalizeAsrConfig(input.asr),
    translation: normalizeTranslationConfig(input.translation),
    runtime: normalizeRuntimeConfig(input.runtime),
    ui: {
      locale: normalizeRequired(input.ui?.locale, UI_LOCALE_AUTO),
    },
    modelHub: {
      huggingFaceToken: normalizeOptional(input.modelHub?.huggingFaceToken),
    },
  };
}

export function switchAsrMode(current: AsrConfig, mode: AsrMode): AsrConfig {
  if (mode === 'online-gateway') {
    return normalizeAsrOnlineConfig({
      mode,
      wsUrl: readAsrString(current, 'wsUrl', DEFAULT_ONLINE_ASR.wsUrl),
      apiKey: readAsrOptionalString(current, 'apiKey'),
      model: readAsrString(current, 'model', DEFAULT_ONLINE_ASR.model),
      language: readAsrString(current, 'language', DEFAULT_ONLINE_ASR.language),
      endpointHeaders: readAsrHeaders(current),
    });
  }

  return normalizeAsrLocalConfig({
    mode,
    model: readAsrLocalModel(current, DEFAULT_LOCAL_ASR.model),
    precision: readAsrPrecision(current, DEFAULT_LOCAL_ASR.precision),
    backend: readAsrBackend(current, DEFAULT_LOCAL_ASR.backend),
    language: readAsrString(current, 'language', DEFAULT_LOCAL_ASR.language),
  });
}

export function settingsFingerprint(input: UserSettings): string {
  return JSON.stringify(normalizeUserSettings(input));
}

export function validateUserSettings(input: UserSettings): SettingsValidationResult {
  const normalized = normalizeUserSettings(input);
  const errors: SettingsValidationIssue[] = [];
  const warnings: SettingsValidationIssue[] = [];
  const errorMap: Record<string, string> = {};
  const warningMap: Record<string, string> = {};

  const parsed = userSettingsSchema.safeParse(normalized);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      addIssue(errors, errorMap, toPath(issue.path), issue.message);
    }
  }

  validateAsr(normalized, errors, warnings, errorMap, warningMap);
  validateTranslation(normalized, errors, warnings, errorMap, warningMap);

  return {
    valid: errors.length === 0,
    normalized,
    errors,
    warnings,
    errorMap,
    warningMap,
  };
}

function normalizeAsrConfig(input: AsrConfig): AsrConfig {
  if (input.mode === 'online-gateway') {
    return normalizeAsrOnlineConfig(input);
  }
  return normalizeAsrLocalConfig(input);
}

function normalizeAsrOnlineConfig(input: AsrOnlineConfig): AsrOnlineConfig {
  return {
    mode: 'online-gateway',
    wsUrl: normalizeRequired(input.wsUrl, DEFAULT_ONLINE_ASR.wsUrl),
    apiKey: normalizeOptional(input.apiKey),
    model: normalizeRequired(input.model, DEFAULT_ONLINE_ASR.model),
    language: normalizeRequired(input.language, DEFAULT_ONLINE_ASR.language),
    endpointHeaders: normalizeHeaders(input.endpointHeaders),
  };
}

function normalizeAsrLocalConfig(input: AsrLocalConfig): AsrLocalConfig {
  const model = LOCAL_MODELS.has(input.model) ? input.model : DEFAULT_LOCAL_ASR.model;
  const precision = LOCAL_PRECISIONS.has(input.precision)
    ? input.precision
    : DEFAULT_LOCAL_ASR.precision;
  const backend = LOCAL_BACKENDS.has(input.backend) ? input.backend : DEFAULT_LOCAL_ASR.backend;
  return {
    mode: 'local-onnx',
    model,
    precision,
    backend,
    language: normalizeRequired(input.language, DEFAULT_LOCAL_ASR.language),
  };
}

function normalizeTranslationConfig(input: TranslationConfig): TranslationConfig {
  const provider = input.provider === 'openai-compatible' ? 'openai-compatible' : 'none';
  return {
    enabled: Boolean(input.enabled),
    provider,
    targetLanguage: normalizeRequired(input.targetLanguage, DEFAULT_SETTINGS.translation.targetLanguage),
    sourceLanguage: normalizeRequired(input.sourceLanguage, DEFAULT_SETTINGS.translation.sourceLanguage),
    endpoint: normalizeOptional(input.endpoint),
    apiKey: normalizeOptional(input.apiKey),
    model: normalizeOptional(input.model),
    temperature: clampNumber(input.temperature, 0, 2, DEFAULT_SETTINGS.translation.temperature),
  };
}

function normalizeRuntimeConfig(input: RuntimeConfig): RuntimeConfig {
  return {
    maxSessions: clampInteger(input.maxSessions, 1, 12, DEFAULT_SETTINGS.runtime.maxSessions),
    engineIdleDisposeMs: clampInteger(
      input.engineIdleDisposeMs,
      10_000,
      300_000,
      DEFAULT_SETTINGS.runtime.engineIdleDisposeMs,
    ),
    partialTranslation: Boolean(input.partialTranslation),
    maxPendingAudioChunks: clampInteger(
      input.maxPendingAudioChunks,
      4,
      128,
      DEFAULT_SETTINGS.runtime.maxPendingAudioChunks,
    ),
  };
}

function validateAsr(
  settings: UserSettings,
  _errors: SettingsValidationIssue[],
  warnings: SettingsValidationIssue[],
  _errorMap: Record<string, string>,
  warningMap: Record<string, string>,
): void {
  if (settings.asr.mode !== 'online-gateway') {
    return;
  }

  const wsUrl = safeParseUrl(settings.asr.wsUrl);
  if (!wsUrl) {
    return;
  }

  if (wsUrl.protocol === 'ws:') {
    addIssue(
      warnings,
      warningMap,
      'asr.wsUrl',
      'Unencrypted ws:// is fine for local testing. Use wss:// for remote services.',
    );
  }
}

function validateTranslation(
  settings: UserSettings,
  _errors: SettingsValidationIssue[],
  warnings: SettingsValidationIssue[],
  _errorMap: Record<string, string>,
  warningMap: Record<string, string>,
): void {
  if (!settings.translation.enabled) {
    return;
  }

  if (settings.translation.provider !== 'openai-compatible') {
    return;
  }

  if (!settings.translation.apiKey) {
    addIssue(
      warnings,
      warningMap,
      'translation.apiKey',
      'API key is empty. Requests may fail if your provider does not allow anonymous access.',
    );
  }

  if (
    settings.translation.sourceLanguage !== 'auto' &&
    settings.translation.sourceLanguage.toLowerCase() ===
      settings.translation.targetLanguage.toLowerCase()
  ) {
    addIssue(
      warnings,
      warningMap,
      'translation.targetLanguage',
      'Source language and target language are the same.',
    );
  }
}

function addIssue(
  list: SettingsValidationIssue[],
  map: Record<string, string>,
  path: string,
  message: string,
): void {
  const normalizedPath = path || 'form';
  if (!map[normalizedPath]) {
    map[normalizedPath] = message;
  }
  if (!list.some((item) => item.path === normalizedPath && item.message === message)) {
    list.push({ path: normalizedPath, message });
  }
}

function toPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) {
    return 'form';
  }
  return path
    .filter((segment) => typeof segment === 'string' || typeof segment === 'number')
    .map((segment) => String(segment))
    .join('.');
}

function normalizeRequired(value: string | undefined, fallback: string): string {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  const pairs = Object.entries(headers)
    .map(([key, value]) => [key.trim(), value.trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0);
  if (pairs.length === 0) {
    return undefined;
  }
  return Object.fromEntries(pairs);
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  const numberValue = Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, numberValue));
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  const numberValue = Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, numberValue));
}

function safeParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function readAsrString(
  input: AsrConfig,
  key: 'model' | 'language' | 'wsUrl',
  fallback: string,
): string {
  const candidate = (input as Partial<Record<typeof key, string>>)[key];
  if (typeof candidate === 'string') {
    return candidate;
  }
  return fallback;
}

function readAsrOptionalString(input: AsrConfig, key: 'apiKey'): string | undefined {
  const candidate = (input as Partial<Record<typeof key, string>>)[key];
  if (typeof candidate === 'string') {
    return candidate;
  }
  return undefined;
}

function readAsrHeaders(input: AsrConfig): Record<string, string> | undefined {
  const candidate = (input as Partial<Record<'endpointHeaders', Record<string, string>>>).endpointHeaders;
  return candidate && typeof candidate === 'object' ? candidate : undefined;
}

function readAsrLocalModel(input: AsrConfig, fallback: AsrLocalConfig['model']): AsrLocalConfig['model'] {
  const candidate = (input as Partial<Record<'model', string>>).model;
  if (candidate === 'whisper-large-v3-turbo' || candidate === 'whisper-large-v3-onnx') {
    return candidate;
  }
  return fallback;
}

function readAsrPrecision(
  input: AsrConfig,
  fallback: AsrLocalConfig['precision'],
): AsrLocalConfig['precision'] {
  const candidate = (input as Partial<Record<'precision', string>>).precision;
  if (candidate === 'q4f16' || candidate === 'q4' || candidate === 'fp16') {
    return candidate;
  }
  return fallback;
}

function readAsrBackend(input: AsrConfig, fallback: AsrLocalConfig['backend']): AsrLocalConfig['backend'] {
  const candidate = (input as Partial<Record<'backend', string>>).backend;
  if (candidate === 'webgpu' || candidate === 'wasm') {
    return candidate;
  }
  return fallback;
}
