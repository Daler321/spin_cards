import { createServer, type Server } from 'node:http';

export function startHealthServer(port: number, isHealthy: () => boolean): Server {
  const server = createServer((req, res) => {
    const ok = req.url === '/health' && isHealthy();
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: ok ? 'ok' : 'fail' }));
  });
  return server.listen(port, '0.0.0.0');
}
