import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, Notification, dialog, IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { AgentLoop } from './agent/AgentLoop';
import { ProviderGateway } from './providers/ProviderGateway';
import { ToolRegistry } from './tools/ToolRegistry';
import { SettingsManager, AppSettings, BehaviorProfile } from './settings';
import { startServer } from './server/api';
import { SessionStore } from './memory/SessionStore';
import { ProviderRow, ProviderMessage } from './types/provider';

let isQuitting = false;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let agentLoop: AgentLoop;
let providerGateway: ProviderGateway;
let toolRegistry: ToolRegistry;
let settingsManager: SettingsManager;
let sessionStore: SessionStore;
let terminalProcess: ChildProcess | null = null;

function createWindow(): void {
  const displays = screen.getPrimaryDisplay();
  const winWidth = 520;
  const winHeight = Math.min(displays.workArea.height, 800);
  const winX = Math.round(displays.workArea.x + (displays.workArea.width - winWidth) / 2);
  const winY = Math.round(displays.workArea.y + (displays.workArea.height - winHeight) / 2);

  mainWindow = new BrowserWindow({
    width: winWidth, height: winHeight,
    x: winX, y: winY,
    minWidth: 480, minHeight: 600,
    frame: false,
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, '..', 'ui', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));

  mainWindow.on('close', (event) => {
    if (!isQuitting) { event.preventDefault(); mainWindow?.hide(); }
  });

  mainWindow.on('maximize', () => mainWindow?.webContents.send('window-state', 'maximized'));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window-state', 'normal'));

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send('init', {
      settings: settingsManager.get(),
      themeVars: settingsManager.getThemeVars(),
      providers: settingsManager.getProviders(),
      history: sessionStore.load('chat_history') || []
    });
  });
}

function createTray(): void {
  const iconSize = process.platform === 'darwin' ? 16 : 24;
  const icon = nativeImage.createFromPath(
    path.join(__dirname, '..', 'ui', 'icon.png')
  ).resize({ width: iconSize, height: iconSize });

  tray = new Tray(icon);
  tray.setToolTip('OmriCode');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open OmriCode', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Settings', click: () => { mainWindow?.show(); mainWindow?.webContents.send('navigate', 'settings'); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow?.show());
}

app.whenReady().then(async () => {
  settingsManager = new SettingsManager();
  toolRegistry = new ToolRegistry();
  const initSettings = settingsManager.get();
  if (initSettings.workspacePath) toolRegistry.setWorkspacePath(initSettings.workspacePath);
  providerGateway = new ProviderGateway();
  sessionStore = new SessionStore();

  agentLoop = new AgentLoop(providerGateway, toolRegistry);

  toolRegistry.setUserPromptCallback((question: string, id: string) => {
    mainWindow?.webContents.send('ask-user', { question, id });
  });

  agentLoop.setCallbacks({
    onChunk: (chunk) => mainWindow?.webContents.send('agent-chunk', chunk),
    onToolCall: (call) => mainWindow?.webContents.send('agent-tool-call', call),
    onToolResult: (result) => mainWindow?.webContents.send('agent-tool-result', result),
    onDone: () => mainWindow?.webContents.send('agent-done'),
    onError: (err) => mainWindow?.webContents.send('agent-error', err),
    onStateChange: (state) => mainWindow?.webContents.send('agent-state', state),
    onClear: () => mainWindow?.webContents.send('clear'),
    onReset: () => mainWindow?.webContents.send('reset'),
  });

  // Start local API server for editor plugins
  const settings = settingsManager.get();
  if (settings.enableServer) {
    startServer(settings.serverPort, {
      providers: settingsManager.getProviders(),
      activeId: settingsManager.getActiveProvider()?.id || null
    }, providerGateway, toolRegistry).catch(() => { /* port in use, skip */ });
  }

  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    mainWindow?.show();
  });

  registerIpcHandlers();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC Handlers ───

function registerIpcHandlers(): void {
  // Window
  ipcMain.handle('minimize', () => mainWindow?.minimize());
  ipcMain.handle('maximize', () => { if (mainWindow?.isMaximized()) mainWindow.unmaximize(); else mainWindow?.maximize(); });
  ipcMain.handle('close', () => mainWindow?.hide());

  // Workspace / Project
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const folder = result.filePaths[0];
    settingsManager.update({ workspacePath: folder });
    return folder;
  });

  ipcMain.handle('get-workspace', () => settingsManager.get().workspacePath || '');

  // Settings
  ipcMain.handle('get-settings', () => ({ settings: settingsManager.get(), themeVars: settingsManager.getThemeVars() }));
  ipcMain.handle('update-settings', (_event: IpcMainInvokeEvent, partial: Partial<AppSettings>) => {
    const updated = settingsManager.update(partial);
    if (partial.workspacePath !== undefined) toolRegistry.setWorkspacePath(partial.workspacePath);
    mainWindow?.webContents.send('settings-updated', { settings: updated, themeVars: settingsManager.getThemeVars() });
    return updated;
  });

  // Providers
  ipcMain.handle('get-providers', () => settingsManager.getProviders());
  ipcMain.handle('add-provider', (_event: IpcMainInvokeEvent, row: ProviderRow) => { settingsManager.addProvider(row); return settingsManager.getProviders(); });
  ipcMain.handle('update-provider', (_event: IpcMainInvokeEvent, id: string, updates: Partial<ProviderRow>) => { settingsManager.updateProvider(id, updates); return settingsManager.getProviders(); });
  ipcMain.handle('remove-provider', (_event: IpcMainInvokeEvent, id: string) => { settingsManager.removeProvider(id); return settingsManager.getProviders(); });
  ipcMain.handle('set-active-provider', (_event: IpcMainInvokeEvent, id: string) => { settingsManager.setActiveProvider(id); return settingsManager.getProviders(); });

  ipcMain.handle('test-provider', async (_event: IpcMainInvokeEvent, id: string) => {
    const row = settingsManager.getProviders().find(p => p.id === id);
    if (!row) return { success: false, error: 'Provider not found' };
    const provider = providerGateway.create(row);
    try {
      const result = await provider.testConnection();
      if (result.success && row.supportsFC === 'auto') {
        const fc = await provider.supportsFunctionCalling();
        settingsManager.updateProvider(id, { supportsFC: fc });
      }
      return result;
    } catch (err) { return { success: false, error: (err as Error).message, latencyMs: 0, modelFound: false, supportsFC: false }; }
  });

  // Profiles
  ipcMain.handle('get-profiles', () => settingsManager.getProfiles());
  ipcMain.handle('get-active-profile', () => settingsManager.getActiveProfile());
  ipcMain.handle('set-active-profile', (_event: IpcMainInvokeEvent, id: string) => { settingsManager.setActiveProfile(id); return settingsManager.getProfiles(); });
  ipcMain.handle('add-profile', (_event: IpcMainInvokeEvent, profile: BehaviorProfile) => { settingsManager.addProfile(profile); return settingsManager.getProfiles(); });
  ipcMain.handle('update-profile', (_event: IpcMainInvokeEvent, id: string, updates: Partial<BehaviorProfile>) => { settingsManager.updateProfile(id, updates); return settingsManager.getProfiles(); });
  ipcMain.handle('remove-profile', (_event: IpcMainInvokeEvent, id: string) => { settingsManager.removeProfile(id); return settingsManager.getProfiles(); });

  // Agent
  ipcMain.handle('send-message', async (_event: IpcMainInvokeEvent, text: string) => {
    const provider = settingsManager.getActiveProvider();
    if (!provider) return { error: 'No active provider' };

    // Save to history
    sessionStore.append('chat_history', { role: 'user', content: text, timestamp: Date.now() });

    const messages: ProviderMessage[] = [{ role: 'user', content: text }];
    await agentLoop.processMessage(messages, provider);
    return { ok: true };
  });

  ipcMain.handle('cancel', () => agentLoop.cancel());

  // Undo/Redo
  ipcMain.handle('undo', () => toolRegistry.undoLastEdit());
  ipcMain.handle('redo', () => toolRegistry.redoLastEdit());
  ipcMain.handle('get-undo-stack', () => ({ undo: toolRegistry.getUndoStack(), redo: toolRegistry.getRedoStack() }));

  // Notification
  ipcMain.handle('notify', (_event: IpcMainInvokeEvent, title: string, body: string) => {
    new Notification({ title, body }).show();
  });

  // Clear history
  ipcMain.handle('clear-history', () => { sessionStore.clear('chat_history'); });



  // User prompt (ask_user tool)
  ipcMain.handle('resolve-user-prompt', (_event: IpcMainInvokeEvent, id: string, answer: string) => {
    toolRegistry.resolveUserPrompt(id, answer);
  });

  // ─── Terminal ───
  ipcMain.handle('terminal-start', async () => {
    if (terminalProcess) { terminalProcess.kill(); terminalProcess = null; }
    const shell = process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || '/bin/bash');
    terminalProcess = spawn(shell, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color' },
      windowsHide: true
    });
    terminalProcess.stdout?.on('data', (data: Buffer) => {
      mainWindow?.webContents.send('terminal-output', data.toString());
    });
    terminalProcess.stderr?.on('data', (data: Buffer) => {
      mainWindow?.webContents.send('terminal-output', data.toString());
    });
    terminalProcess.on('exit', () => {
      terminalProcess = null;
      mainWindow?.webContents.send('terminal-output', '\r\n\x1b[31m[process exited]\x1b[0m\r\n');
    });
    return { ok: true, shell };
  });

  ipcMain.handle('terminal-input', (_event: IpcMainInvokeEvent, data: string) => {
    if (terminalProcess?.stdin?.writable) {
      terminalProcess.stdin.write(data);
      return { ok: true };
    }
    return { ok: false, error: 'No terminal' };
  });

  ipcMain.handle('terminal-resize', (_event: IpcMainInvokeEvent, cols: number, rows: number) => {
    if (terminalProcess?.stdin?.writable) {
      terminalProcess.stdin.write(`\x1b[8;${rows};${cols}t`);
    }
    return { ok: true };
  });

  ipcMain.handle('terminal-stop', () => {
    if (terminalProcess) { terminalProcess.kill(); terminalProcess = null; }
    return { ok: true };
  });

  // Auto-detect models for a provider
  ipcMain.handle('detect-models', async (_event: IpcMainInvokeEvent, id: string) => {
    const row = settingsManager.getProviders().find(p => p.id === id);
    if (!row) return { success: false, error: 'Provider not found' };
    const endpoint = row.endpoint.replace(/\/+$/, '');
    const apiKey = row.apiKey;
    try {
      if (endpoint.includes('localhost:11434') || endpoint.includes('ollama')) {
        // Ollama
        const resp = await fetch(endpoint.includes('/v1') ? endpoint.replace('/v1', '/api/tags') : `${endpoint}/api/tags`);
        const data = await resp.json() as Record<string, unknown>;
        const models = (data.models as Array<Record<string, unknown>> || []).map((m: Record<string, unknown>) => m.name as string);
        settingsManager.updateProvider(id, { detectedModels: models });
        return { success: true, models };
      } else if (endpoint.includes('anthropic')) {
        const models = ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'];
        settingsManager.updateProvider(id, { detectedModels: models });
        return { success: true, models };
      } else {
        // OpenAI-compatible: GET /models
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        const resp = await fetch(`${endpoint}/models`, { headers });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json() as Record<string, unknown>;
        const models = (data.data as Array<Record<string, unknown>> || []).map((m: Record<string, unknown>) => m.id as string);
        const detectedModels = models.slice(0, 20);
        settingsManager.updateProvider(id, { detectedModels });
        return { success: true, models: detectedModels };
      }
    } catch (err) {
      return { success: false, error: (err as Error).message, models: [] };
    }
  });
}
