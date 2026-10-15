import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const testMode = process.argv.includes('--test');
const port = Number(process.env.PORT || (testMode ? 4174 : 4173));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const serveRoot = testMode && pathname.startsWith('/__tests__/') ? fileURLToPath(new URL('../tests/', import.meta.url)) : root;
    const localPath = testMode && pathname.startsWith('/__tests__/') ? pathname.slice('/__tests__'.length) : pathname;
    const path = resolve(serveRoot, '.' + localPath);
    if (path !== resolve(serveRoot) && !path.startsWith(resolve(serveRoot) + sep)) {
      res.writeHead(403).end('Forbidden'); return;
    }
    const info = await stat(path);
    const file = info.isDirectory() ? resolve(path, 'index.html') : path;
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Файл не найден');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Local: http://localhost:${port}${testMode ? '/__tests__/browser.html' : ''}`));
