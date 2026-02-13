import type { TranslatorEngine } from '../contracts';

export class NoopTranslator implements TranslatorEngine {
  public readonly key = 'translator:none';

  public async translate(input: {
    text: string;
    sourceLanguage: string;
    targetLanguage: string;
    isFinal: boolean;
  }): Promise<string> {
    return input.text;
  }

  public async dispose(): Promise<void> {
    return;
  }
}

