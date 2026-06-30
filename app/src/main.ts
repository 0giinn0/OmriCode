import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, Notification, IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import { AgentLoop } from './agent/AgentLoop';
import { ProviderGateway } from './providers/ProviderGateway';
import { ToolRegistry } from './tools/ToolRegistry';
import { SettingsManager, AppSettings } from './settings';
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

function createWindow(): void {
  const displays = screen.getPrimaryDisplay();
  const winWidth = 520;
  const winHeight = Math.min(displays.workArea.height, 800);
  const winX = displays.workArea.x + displays.workArea.width - winWidth;
  const winY = displays.workArea.y;

  mainWindow = new BrowserWindow({
    width: winWidth, height: winHeight,
    x: winX, y: winY,
    minWidth: 320, minHeight: 480,
    frame: false, transparent: true,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, '..', 'ui', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));

  mainWindow.on('blur', () => {
    if (settingsManager.get().minimizeToTray) mainWindow?.hide();
  });

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
  providerGateway = new ProviderGateway();
  sessionStore = new SessionStore();

  agentLoop = new AgentLoop(providerGateway, toolRegistry);

  agentLoop.setCallbacks({
    onChunk: (chunk) => mainWindow?.webContents.send('agent-chunk', chunk),
    onToolCall: (call) => mainWindow?.webContents.send('agent-tool-call', call),
    onToolResult: (result) => mainWindow?.webContents.send('agent-tool-result', result),
    onDone: () => mainWindow?.webContents.send('agent-done'),
    onError: (err) => mainWindow?.webContents.send('agent-error', err),
    onStateChange: (state) => mainWindow?.webContents.send('agent-state', state),
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

  // Settings
  ipcMain.handle('get-settings', () => ({ settings: settingsManager.get(), themeVars: settingsManager.getThemeVars() }));
  ipcMain.handle('update-settings', (_event: IpcMainInvokeEvent, partial: Partial<AppSettings>) => {
    const updated = settingsManager.update(partial);
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

}
