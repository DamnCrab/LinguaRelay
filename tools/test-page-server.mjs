import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const PORT = process.env.TEST_PAGE_PORT ? Number.parseInt(process.env.TEST_PAGE_PORT, 10) : 5179;
const ROOT = process.cwd();
const PAGE_FILE = path.join(ROOT, 'tools', 'test-pages', 'local-audio-test.html');
const AUDIO_FILE = path.join(ROOT, 'HNWT8H9D.mp3');

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const route = reqUrl.pathname;

  if (route === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }

  if (route === '/' || route === '/local-audio-test.html') {
    try {
      const html = await readFile(PAGE_FILE, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(html);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Failed to read test page: ${error instanceof Error ? error.message : 'unknown'}`);
    }
    return;
  }

  if (route === '/HNWT8H9D.mp3') {
    try {
      const stats = statSync(AUDIO_FILE);
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': stats.size,
        'Cache-Control': 'no-store',
      });
      createReadStream(AUDIO_FILE).pipe(res);
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Audio file not found: ${error instanceof Error ? error.message : 'unknown'}`);
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`Not found: ${route}`);
});

server.listen(PORT, () => {
  console.log(`[test-page] http://127.0.0.1:${PORT}/local-audio-test.html`);
});
