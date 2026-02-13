import { AUDIO_TARGET_SAMPLE_RATE } from '../../shared/constants';

export class AudioCapture {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private isRunning = false;

  constructor(
    private readonly media: HTMLMediaElement,
    private readonly onChunk: (chunk: ArrayBuffer, sampleRate: number) => void,
  ) {}

  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      throw new Error('AudioContext is not supported by this browser.');
    }

    const context = new AudioCtx({ sampleRate: 48_000 });
    const source = context.createMediaElementSource(this.media);
    const processor = context.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const downsampled = downsampleFloat32ToInt16(input, event.inputBuffer.sampleRate, AUDIO_TARGET_SAMPLE_RATE);
      const buffer = downsampled.buffer.slice(0) as ArrayBuffer;
      this.onChunk(buffer, AUDIO_TARGET_SAMPLE_RATE);
    };

    source.connect(processor);
    processor.connect(context.destination);

    if (context.state === 'suspended') {
      await context.resume();
    }

    this.audioContext = context;
    this.sourceNode = source;
    this.processorNode = processor;
    this.isRunning = true;
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.processorNode?.disconnect();
    this.sourceNode?.disconnect();

    if (this.audioContext) {
      await this.audioContext.close();
    }

    this.processorNode = null;
    this.sourceNode = null;
    this.audioContext = null;
    this.isRunning = false;
  }
}

function downsampleFloat32ToInt16(
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Int16Array {
  if (targetSampleRate === sourceSampleRate) {
    return floatTo16BitPCM(input);
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(outputLength);

  let outputIndex = 0;
  let inputIndex = 0;

  while (outputIndex < outputLength) {
    const nextInputIndex = Math.min(input.length, Math.round((outputIndex + 1) * ratio));
    let accum = 0;
    let count = 0;

    for (let i = Math.floor(inputIndex); i < nextInputIndex; i += 1) {
      accum += input[i] ?? 0;
      count += 1;
    }

    const sample = count > 0 ? accum / count : 0;
    output[outputIndex] = toInt16(sample);

    outputIndex += 1;
    inputIndex = nextInputIndex;
  }

  return output;
}

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    output[i] = toInt16(input[i] ?? 0);
  }
  return output;
}

function toInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}


