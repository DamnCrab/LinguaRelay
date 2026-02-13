import type { TranslatorEngine } from '../contracts';

interface OpenAICompatibleTranslatorOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  temperature: number;
}

export class OpenAICompatibleTranslator implements TranslatorEngine {
  public readonly key: string;

  constructor(private readonly options: OpenAICompatibleTranslatorOptions) {
    this.key = `translator:openai-compatible:${options.model}`;
  }

  public async translate(input: {
    text: string;
    sourceLanguage: string;
    targetLanguage: string;
    isFinal: boolean;
  }): Promise<string> {
    const source = input.sourceLanguage === 'auto' ? 'auto-detected' : input.sourceLanguage;

    const prompt = [
      'You are a low-latency subtitle translator.',
      'Return only translated text, no explanation.',
      `Source language: ${source}`,
      `Target language: ${input.targetLanguage}`,
      input.isFinal
        ? 'Input is final subtitle, keep punctuation natural.'
        : 'Input is partial subtitle, keep it short and stable.',
      `Text: ${input.text}`,
    ].join('\n');

    const response = await fetch(this.options.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: this.options.temperature,
        messages: [
          {
            role: 'system',
            content: 'Translate subtitles with minimal latency.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Translator HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    const translated = data.choices?.[0]?.message?.content?.trim();
    return translated && translated.length > 0 ? translated : input.text;
  }

  public async dispose(): Promise<void> {
    return;
  }
}

