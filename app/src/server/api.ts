import * as http from 'http';
import * as url from 'url';
import { AgentLoop } from '../agent/AgentLoop';
import { ProviderGateway } from '../providers/ProviderGateway';
import { ToolRegistry } from '../tools/ToolRegistry';
import { ProviderRow } from '../types/provider';

interface ProviderStore {
  providers: ProviderRow[];
  activeId: string | null;
}

export function startServer(port: number, providers: ProviderStore, providerGateway: ProviderGateway, toolRegistry: ToolRegistry): Promise<number> {
  const agentLoop = new AgentLoop(providerGateway, toolRegistry);

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname;

    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', providers: providers.providers.length }));
      return;
    }

    if (req.method === 'GET' && pathname === '/providers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(providers.providers));
      return;
    }

    if (req.method === 'POST' && pathname === '/chat') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const { message } = JSON.parse(body);
          const active = providers.providers.find(p => p.id === providers.activeId);
          if (!active) { res.writeHead(400); res.end(JSON.stringify({ error: 'No active provider' })); return; }

          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });

          agentLoop.setCallbacks({
            onChunk: (chunk) => res.write(`data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`),
            onDone: () => { res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`); res.end(); },
            onError: (err) => { res.write(`data: ${JSON.stringify({ type: 'error', error: err })}\n\n`); res.end(); }
          });

          await agentLoop.processMessage([{ role: 'user', content: message }], active);
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    });
  });
}
