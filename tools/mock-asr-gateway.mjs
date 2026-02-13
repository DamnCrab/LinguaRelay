import http from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 18080;
const PATH = '/v1/asr/stream';

const SAMPLE_SENTENCES = [
  'This is a mocked realtime transcription result.',
  'The quick brown fox jumps over the lazy dog.',
  'You can replace this gateway with a real ASR provider.',
  'Streaming subtitles are being emitted from mock server.',
  'For Japanese and English use model routing in your gateway.',
];

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
  if (url.pathname !== PATH) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, url);
  });
});

wss.on('connection', (ws, _request, url) => {
  const model = url.searchParams.get('model') ?? 'unknown';
  const language = url.searchParams.get('language') ?? 'auto';

  console.log(`[mock-gateway] connected model=${model} language=${language}`);

  let audioFrames = 0;
  let cursor = 0;
  let lastFlush = Date.now();

  const flushTimer = setInterval(() => {
    if (ws.readyState !== ws.OPEN) {
      return;
    }

    if (audioFrames === 0) {
      return;
    }

    const sentence = SAMPLE_SENTENCES[cursor % SAMPLE_SENTENCES.length];
    cursor += 1;

    ws.send(
      JSON.stringify({
        type: 'partial',
        text: sentence.slice(0, Math.floor(sentence.length * 0.7)),
        language: language === 'auto' ? 'en' : language,
        revision: cursor * 2 - 1,
        startMs: 0,
        endMs: Date.now() - lastFlush,
      }),
    );

    ws.send(
      JSON.stringify({
        type: 'final',
        text: sentence,
        language: language === 'auto' ? 'en' : language,
        revision: cursor * 2,
        startMs: 0,
        endMs: Date.now() - lastFlush + 320,
      }),
    );

    ws.send(
      JSON.stringify({
        type: 'stats',
        stats: {
          reconnectCount: 0,
          audioFrames,
        },
      }),
    );

    audioFrames = 0;
    lastFlush = Date.now();
  }, 1200);

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      audioFrames += 1;
      return;
    }

    try {
      const message = JSON.parse(data.toString());
      if (message.type === 'session-init') {
        ws.send(
          JSON.stringify({
            type: 'stats',
            stats: {
              reconnectCount: 0,
            },
          }),
        );
      }
    } catch {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'BAD_JSON',
          message: 'invalid json message',
        }),
      );
    }
  });

  ws.on('close', () => {
    clearInterval(flushTimer);
    console.log('[mock-gateway] closed');
  });

  ws.on('error', (error) => {
    clearInterval(flushTimer);
    console.error('[mock-gateway] socket error', error);
  });
});

server.listen(PORT, () => {
  console.log(`[mock-gateway] ws://127.0.0.1:${PORT}${PATH}`);
});
