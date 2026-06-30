import * as http from 'http';
import * as url from 'url';
import { AgentLoop } from '../agent/AgentLoop';
import { ProviderGateway } from '../providers/ProviderGateway';
import { ToolRegistry } from '../tools/ToolRegistry';
import { ClientManager, EditorClient } from './ClientManager';
import { PendingToolManager } from './PendingToolManager';
import { ProviderRow } from '../types/provider';
import { ToolExecutionRequest, ToolResult } from '../types/tool';

interface ProviderStore {
  providers: ProviderRow[];
  activeId: string | null;
}

interface SSEClient {
  id: string;
  res: http.ServerResponse;
}

export function startServer(
  port: number,
  providers: ProviderStore,
  providerGateway: ProviderGateway,
  toolRegistry: ToolRegistry
): Promise<number> {
  const clientManager = new ClientManager();
  const pendingTools = new PendingToolManager();
  const sseClients = new Map<string, SSEClient[]>();
  let currentAgentLoop: AgentLoop | null = null;

  const agentLoop = new AgentLoop(providerGateway, toolRegistry);

  agentLoop.setExternalExecutor(async (call: ToolExecutionRequest): Promise<ToolResult | null> => {
    const editorTools = ['edit_node', 'create_node', 'delete_node', 'run_scene', 'stop_scene',
      'create_mesh', 'modify_mesh', 'apply_modifier', 'set_material',
      'open_editor_file', 'show_diagnostic', 'code_action'];

    if (!editorTools.includes(call.name)) return null;

    const capMap: Record<string, string> = {
      edit_node: 'scene:edit', create_node: 'scene:create', delete_node: 'scene:delete',
      run_scene: 'scene:run', stop_scene: 'scene:stop',
      create_mesh: 'mesh:create', modify_mesh: 'mesh:modify', apply_modifier: 'mesh:modifier',
      set_material: 'mesh:material',
      open_editor_file: 'editor:file', show_diagnostic: 'editor:diagnostic', code_action: 'editor:code_action'
    };
    const neededCap = capMap[call.name] || `tool:${call.name}`;
    const client = clientManager.findClientByCapability(neededCap);
    if (!client) return null;

    const toolCallId = call.id || crypto.randomUUID();

    broadcastToClient(client.clientId, {
      type: 'tool_call', id: toolCallId,
      name: call.name, arguments: call.arguments,
      target: 'editor'
    });

    try {
      return await pendingTools.create(toolCallId, client.clientId);
    } catch (err) {
      return { success: false, output: '', error: (err as Error).message, durationMs: 0 };
    }
  });

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Client-Id');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname;

    if (!pathname || !req.method) {
      res.writeHead(404); res.end('Not found');
      return;
    }

    try {
      switch (true) {
        case req.method === 'GET' && pathname === '/health':
          handleHealth(res, clientManager, providers);
          break;

        case req.method === 'GET' && pathname === '/clients':
          handleGetClients(res, clientManager);
          break;

        case req.method === 'POST' && pathname === '/register':
          await handleRegister(req, res, clientManager);
          break;

        case req.method === 'POST' && pathname === '/chat':
          await handleChat(req, res, agentLoop, clientManager, providers, sseClients);
          break;

        case req.method === 'POST' && pathname === '/chat/sync':
          await handleChatSync(req, res, agentLoop, clientManager, providers);
          break;

        case req.method === 'POST' && pathname === '/tools/result':
          await handleToolResult(req, res, pendingTools);
          break;

        case req.method === 'POST' && pathname === '/context':
          await handleContext(req, res, clientManager);
          break;

        case req.method === 'POST' && pathname === '/heartbeat':
          await handleHeartbeat(req, res, clientManager);
          break;

        default:
          res.writeHead(404); res.end('Not found');
      }
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  });

  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    });
  });

  function broadcastToClient(clientId: string, data: Record<string, unknown>): void {
    const clients = sseClients.get(clientId) || [];
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) {
      try { c.res.write(msg); } catch { /* client disconnected */ }
    }
  }
}

function handleHealth(res: http.ServerResponse, clientManager: ClientManager, providers: ProviderStore): void {
  const active = providers.providers.find(p => p.id === providers.activeId);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    providers: providers.providers.length,
    activeProvider: active ? { name: active.name, model: active.model } : null,
    clients: clientManager.getAllClients().map(c => ({
      clientId: c.clientId, name: c.name, type: c.type,
      capabilities: c.capabilities, lastSeen: c.lastSeen
    }))
  }));
}

function handleGetClients(res: http.ServerResponse, clientManager: ClientManager): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(clientManager.getAllClients()));
}

async function handleRegister(req: http.IncomingMessage, res: http.ServerResponse, clientManager: ClientManager): Promise<void> {
  const body = await readBody(req);
  const { clientId, name, type, capabilities, version } = JSON.parse(body);
  const id = clientManager.register(clientId, name || type, type, capabilities || [], version);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ clientId: id }));
}

async function handleChat(
  req: http.IncomingMessage, res: http.ServerResponse,
  agentLoop: AgentLoop, clientManager: ClientManager,
  providers: ProviderStore, sseClients: Map<string, SSEClient[]>
): Promise<void> {
  const body = await readBody(req);
  const { message, clientId, context } = JSON.parse(body);

  const active = providers.providers.find(p => p.id === providers.activeId);
  if (!active) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No active provider' }));
    return;
  }

  if (clientId) {
    const existing = sseClients.get(clientId) || [];
    existing.push({ id: `sse_${Date.now()}`, res });
    sseClients.set(clientId, existing);
    req.on('close', () => {
      const clients = sseClients.get(clientId) || [];
      sseClients.set(clientId, clients.filter(c => c.res !== res));
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  if (context && clientId) {
    clientManager.heartbeat(clientId);
  }

  agentLoop.setCallbacks({
    onChunk: (chunk) => {
      try { res.write(`data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`); } catch { /* ignore */ }
    },
    onToolCall: (call) => {
      try { res.write(`data: ${JSON.stringify({ type: 'tool_call', id: call.id, name: call.name, arguments: call.arguments, target: getToolTarget(call.name) })}\n\n`); } catch { /* ignore */ }
    },
    onToolResult: (result) => {
      try { res.write(`data: ${JSON.stringify({ type: 'tool_result', ...(result as Record<string, unknown>) })}\n\n`); } catch { /* ignore */ }
    },
    onDone: () => {
      try { res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`); res.end(); } catch { /* ignore */ }
    },
    onError: (err) => {
      try { res.write(`data: ${JSON.stringify({ type: 'error', error: err })}\n\n`); res.end(); } catch { /* ignore */ }
    },
    onStateChange: (state) => {
      try { res.write(`data: ${JSON.stringify({ type: 'state', state })}\n\n`); } catch { /* ignore */ }
    }
  });

  try {
    await agentLoop.processMessage([{ role: 'user', content: message }], active);
  } catch (err) {
    const msg = (err as Error).message;
    try { res.write(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`); res.end(); } catch { /* ignore */ }
  }
}

async function handleToolResult(req: http.IncomingMessage, res: http.ServerResponse, pendingTools: PendingToolManager): Promise<void> {
  const body = await readBody(req);
  const { toolCallId, result } = JSON.parse(body);
  const resolved = pendingTools.resolve(toolCallId, result);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: resolved ? 'ok' : 'not_found' }));
}

async function handleContext(req: http.IncomingMessage, res: http.ServerResponse, clientManager: ClientManager): Promise<void> {
  const body = await readBody(req);
  const { clientId, context } = JSON.parse(body);
  if (clientId) clientManager.heartbeat(clientId);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
}

async function handleChatSync(
  req: http.IncomingMessage, res: http.ServerResponse,
  agentLoop: AgentLoop, clientManager: ClientManager,
  providers: ProviderStore
): Promise<void> {
  const body = await readBody(req);
  const { message, clientId, context } = JSON.parse(body);

  const active = providers.providers.find(p => p.id === providers.activeId);
  if (!active) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No active provider' }));
    return;
  }

  if (context && clientId) clientManager.heartbeat(clientId);

  let fullResponse = '';
  let error: string | null = null;

  agentLoop.setCallbacks({
    onChunk: (chunk) => { fullResponse += chunk; },
    onDone: () => {},
    onError: (err) => { error = err; },
    onStateChange: () => {}
  });

  try {
    await agentLoop.processMessage([{ role: 'user', content: message }], active);
  } catch (err) {
    error = (err as Error).message;
  }

  if (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error }));
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ response: fullResponse }));
  }
}

async function handleHeartbeat(req: http.IncomingMessage, res: http.ServerResponse, clientManager: ClientManager): Promise<void> {
  const body = await readBody(req);
  const { clientId } = JSON.parse(body);
  const ok = clientId ? clientManager.heartbeat(clientId) : false;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: ok ? 'ok' : 'unknown_client' }));
}

function getToolTarget(toolName: string): 'editor' | 'local' {
  const editorTools = ['edit_node', 'create_node', 'delete_node', 'run_scene', 'stop_scene',
    'create_mesh', 'modify_mesh', 'apply_modifier', 'set_material',
    'open_editor_file', 'show_diagnostic', 'code_action'];
  return editorTools.includes(toolName) ? 'editor' : 'local';
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
