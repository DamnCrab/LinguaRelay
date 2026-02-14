import localOnnxRuntimeWorkerUrl from '../background/engines/asr/local-onnx-runtime.worker?worker&url';
import {
  LOCAL_ONNX_OFFSCREEN_MESSAGE_TYPE,
  type LocalOnnxInitPayload,
  type LocalOnnxOffscreenRequest,
  type LocalOnnxOffscreenRequestMessage,
  type LocalOnnxOffscreenResponse,
  type LocalOnnxTranscribePayload,
  type LocalOnnxWhisperOutput,
} from '../shared/offscreen-local-onnx';

type WorkerRequestMap = {
  INIT: LocalOnnxInitPayload;
  TRANSCRIBE: LocalOnnxTranscribePayload;
  DISPOSE: Record<string, never>;
};

type WorkerResponseMap = {
  INIT: { ok: true };
  TRANSCRIBE: LocalOnnxWhisperOutput;
  DISPOSE: { ok: true };
};

type WorkerRequestType = keyof WorkerRequestMap;

interface WorkerRequest<T extends WorkerRequestType = WorkerRequestType> {
  id: number;
  type: T;
  payload: WorkerRequestMap[T];
}

interface WorkerResult<T extends WorkerRequestType = WorkerRequestType> {
  id: number;
  kind: 'RESULT';
  type: T;
  ok: boolean;
  payload?: WorkerResponseMap[T];
  error?: string;
}

interface WorkerEventEnvelope {
  kind: 'EVENT';
  event: {
    type: 'STATS';
    payload: {
      modelLoadProgress?: number;
    };
  };
}

type WorkerMessage = WorkerResult | WorkerEventEnvelope;

class LocalOnnxRuntimeWorkerClient {
  private worker: Worker | null = null;
  private seq = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }
  >();

  public async initialize(payload: LocalOnnxInitPayload): Promise<void> {
    this.ensureWorker();
    await this.request('INIT', payload);
  }

  public async transcribe(payload: LocalOnnxTranscribePayload): Promise<LocalOnnxWhisperOutput> {
    this.ensureWorker();
    // Some extension runtimes reject transferable lists on this path.
    // Use structured clone by default for compatibility.
    return this.request('TRANSCRIBE', payload);
  }

  public async dispose(): Promise<void> {
    if (!this.worker) {
      return;
    }

    try {
      await this.request('DISPOSE', {});
    } catch {
      // ignore dispose handshake failures
    }

    for (const [, entry] of this.pending) {
      clearTimeout(entry.timeoutId);
      entry.reject(new Error('Offscreen runtime worker terminated.'));
    }
    this.pending.clear();

    this.worker.terminate();
    this.worker = null;
  }

  private ensureWorker(): void {
    if (this.worker) {
      return;
    }
    this.worker = new Worker(localOnnxRuntimeWorkerUrl, { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (!message || typeof message !== 'object') {
        return;
      }
      if (message.kind !== 'RESULT') {
        return;
      }

      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeoutId);
      this.pending.delete(message.id);

      if (!message.ok) {
        pending.reject(new Error(message.error ?? 'Offscreen worker request failed.'));
        return;
      }

      pending.resolve(message.payload);
    };

    this.worker.onerror = (event: ErrorEvent) => {
      const reason = event.error instanceof Error
        ? event.error
        : new Error(event.message || 'Offscreen worker crashed.');
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timeoutId);
        entry.reject(reason);
      }
      this.pending.clear();
    };
  }

  private request<T extends WorkerRequestType>(
    type: T,
    payload: WorkerRequestMap[T],
    transfer: Transferable[] = [],
  ): Promise<WorkerResponseMap[T]> {
    const worker = this.worker;
    if (!worker) {
      return Promise.reject(new Error('Offscreen worker is not initialized.'));
    }

    const id = this.seq++;
    const message: WorkerRequest<T> = {
      id,
      type,
      payload,
    };

    return new Promise<WorkerResponseMap[T]>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Offscreen worker request timed out: ${type}`));
      }, 180_000);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
      });

      try {
        if (transfer.length > 0) {
          try {
            worker.postMessage(message, transfer);
          } catch (error) {
            if (!isTransferPostMessageError(error)) {
              throw error;
            }
            worker.postMessage(message);
          }
        } else {
          worker.postMessage(message);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
}

function isTransferPostMessageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /transferable type|DataCloneError|could not be cloned/i.test(message);
}

const runtimeWorker = new LocalOnnxRuntimeWorkerClient();

chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  const message = raw as LocalOnnxOffscreenRequestMessage;
  if (!message || message.type !== LOCAL_ONNX_OFFSCREEN_MESSAGE_TYPE) {
    return;
  }

  void handleRuntimeRequest(message.payload)
    .then((response) => {
      sendResponse(response);
    })
    .catch((error) => {
      const fallback: LocalOnnxOffscreenResponse = {
        id: message.payload.id,
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown offscreen runtime error',
      };
      sendResponse(fallback);
    });

  return true;
});

async function handleRuntimeRequest(request: LocalOnnxOffscreenRequest): Promise<LocalOnnxOffscreenResponse> {
  try {
    switch (request.type) {
      case 'INIT':
        await runtimeWorker.initialize(request.payload);
        return {
          id: request.id,
          ok: true,
          payload: { ok: true },
        };
      case 'TRANSCRIBE': {
        const result = await runtimeWorker.transcribe(request.payload);
        return {
          id: request.id,
          ok: true,
          payload: result,
        };
      }
      case 'DISPOSE':
        await runtimeWorker.dispose();
        return {
          id: request.id,
          ok: true,
          payload: { ok: true },
        };
    }

    const exhaustive: never = request;
    return {
      id: (exhaustive as { id?: number }).id ?? 0,
      ok: false,
      error: 'Unsupported offscreen runtime request.',
    };
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown offscreen runtime error',
    };
  }
}
