import { AUDIO_TARGET_SAMPLE_RATE } from '../../shared/constants';

type SharedSourceNode = MediaElementAudioSourceNode | MediaStreamAudioSourceNode;

interface SharedAudioGraph {
  context: AudioContext;
  source: SharedSourceNode;
  consumers: number;
}

const SHARED_GRAPH_BY_MEDIA = new WeakMap<HTMLMediaElement, SharedAudioGraph>();

export class AudioCapture {
  private sharedGraph: SharedAudioGraph | null = null;
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

    const sharedGraph = await getOrCreateSharedGraph(this.media);
    const processor = sharedGraph.context.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const downsampled = downsampleFloat32ToInt16(input, event.inputBuffer.sampleRate, AUDIO_TARGET_SAMPLE_RATE);
      const buffer = downsampled.buffer.slice(0) as ArrayBuffer;
      this.onChunk(buffer, AUDIO_TARGET_SAMPLE_RATE);
    };

    sharedGraph.source.connect(processor);
    processor.connect(sharedGraph.context.destination);

    if (sharedGraph.context.state === 'suspended') {
      await sharedGraph.context.resume();
    }

    sharedGraph.consumers += 1;
    this.sharedGraph = sharedGraph;
    this.processorNode = processor;
    this.isRunning = true;
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    const graph = this.sharedGraph;
    const processor = this.processorNode;
    if (graph && processor) {
      try {
        graph.source.disconnect(processor);
      } catch {
        // Ignore disconnect mismatch errors.
      }
    }
    processor?.disconnect();

    this.processorNode = null;
    this.sharedGraph = null;
    this.isRunning = false;

    if (graph) {
      graph.consumers = Math.max(0, graph.consumers - 1);
      if (graph.consumers === 0 && graph.context.state === 'running') {
        await graph.context.suspend().catch(() => undefined);
      }
    }
  }
}

async function getOrCreateSharedGraph(media: HTMLMediaElement): Promise<SharedAudioGraph> {
  const existing = SHARED_GRAPH_BY_MEDIA.get(media);
  if (existing && existing.context.state !== 'closed') {
    return existing;
  }

  const AudioCtx = getAudioContextCtor();
  const context = new AudioCtx({ sampleRate: 48_000 });
  const source = createSourceNode(context, media);
  const graph: SharedAudioGraph = {
    context,
    source,
    consumers: 0,
  };
  SHARED_GRAPH_BY_MEDIA.set(media, graph);
  return graph;
}

function getAudioContextCtor(): typeof AudioContext {
  const AudioCtx =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('AudioContext is not supported by this browser.');
  }
  return AudioCtx;
}

function createSourceNode(
  context: AudioContext,
  media: HTMLMediaElement,
): SharedSourceNode {
  try {
    return context.createMediaElementSource(media);
  } catch (error) {
    const stream = tryCaptureMediaStream(media);
    if (stream) {
      return context.createMediaStreamSource(stream);
    }

    throw error;
  }
}

function tryCaptureMediaStream(media: HTMLMediaElement): MediaStream | null {
  const mediaWithCapture = media as HTMLMediaElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };
  try {
    if (typeof mediaWithCapture.captureStream === 'function') {
      return mediaWithCapture.captureStream();
    }
    if (typeof mediaWithCapture.mozCaptureStream === 'function') {
      return mediaWithCapture.mozCaptureStream();
    }
  } catch {
    return null;
  }
  return null;
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


