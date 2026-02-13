import type { AsrConfig, TranslationConfig } from '../../shared/contracts';
import type { AsrEngine, TranslatorEngine } from './contracts';
import { GatewayWsAsrEngine } from './asr/gateway-ws-asr-engine';
import { LocalOnnxAsrEngine } from './asr/local-onnx-asr-engine';
import { NoopTranslator } from './translation/noop-translator';
import { OpenAICompatibleTranslator } from './translation/openai-compatible-translator';

export function getAsrEngineKey(config: AsrConfig): string {
  if (config.mode === 'online-gateway') {
    return `asr:gateway:${config.model}:${config.language}`;
  }

  return `asr:local:${config.model}:${config.precision}:${config.language}`;
}

export function getTranslatorKey(config: TranslationConfig): string {
  if (!config.enabled || config.provider === 'none') {
    return 'translator:none';
  }

  return `translator:${config.provider}:${config.model ?? 'default'}`;
}

export function createAsrEngine(config: AsrConfig): AsrEngine {
  if (config.mode === 'online-gateway') {
    return new GatewayWsAsrEngine({
      wsUrl: config.wsUrl,
      apiKey: config.apiKey,
      model: config.model,
      language: config.language,
      endpointHeaders: config.endpointHeaders,
    });
  }

  return new LocalOnnxAsrEngine(config.model, config.precision);
}

export function createTranslator(config: TranslationConfig): TranslatorEngine {
  if (!config.enabled || config.provider === 'none') {
    return new NoopTranslator();
  }

  if (!config.endpoint || !config.apiKey || !config.model) {
    return new NoopTranslator();
  }

  return new OpenAICompatibleTranslator({
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    model: config.model,
    temperature: config.temperature,
  });
}

