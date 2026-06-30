import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('omricode', {
  // Window
  minimize: () => ipcRenderer.invoke('minimize'),
  maximize: () => ipcRenderer.invoke('maximize'),
  close: () => ipcRenderer.invoke('close'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (partial: unknown) => ipcRenderer.invoke('update-settings', partial),

  // Providers
  getProviders: () => ipcRenderer.invoke('get-providers'),
  addProvider: (row: unknown) => ipcRenderer.invoke('add-provider', row),
  updateProvider: (id: string, updates: unknown) => ipcRenderer.invoke('update-provider', id, updates),
  removeProvider: (id: string) => ipcRenderer.invoke('remove-provider', id),
  setActiveProvider: (id: string) => ipcRenderer.invoke('set-active-provider', id),
  testProvider: (id: string) => ipcRenderer.invoke('test-provider', id),

  // Agent
  sendMessage: (text: string) => ipcRenderer.invoke('send-message', text),
  cancel: () => ipcRenderer.invoke('cancel'),

  // Undo/Redo
  undo: () => ipcRenderer.invoke('undo'),
  redo: () => ipcRenderer.invoke('redo'),
  getUndoStack: () => ipcRenderer.invoke('get-undo-stack'),

  // Workspace
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getWorkspace: () => ipcRenderer.invoke('get-workspace'),

  // Misc
  notify: (title: string, body: string) => ipcRenderer.invoke('notify', title, body),
  clearHistory: () => ipcRenderer.invoke('clear-history'),

  // ─── Events from main ───
  onInit: (cb: (data: unknown) => void) => ipcRenderer.on('init', (_e, data) => cb(data)),
  onSettingsUpdated: (cb: (data: unknown) => void) => ipcRenderer.on('settings-updated', (_e, data) => cb(data)),
  onAgentChunk: (cb: (chunk: string) => void) => ipcRenderer.on('agent-chunk', (_e, chunk) => cb(chunk)),
  onAgentToolCall: (cb: (call: unknown) => void) => ipcRenderer.on('agent-tool-call', (_e, call) => cb(call)),
  onAgentToolResult: (cb: (result: unknown) => void) => ipcRenderer.on('agent-tool-result', (_e, result) => cb(result)),
  onAgentDone: (cb: () => void) => ipcRenderer.on('agent-done', () => cb()),
  onAgentError: (cb: (err: string) => void) => ipcRenderer.on('agent-error', (_e, err) => cb(err)),
  onAgentState: (cb: (state: string) => void) => ipcRenderer.on('agent-state', (_e, state) => cb(state)),
  onNavigate: (cb: (page: string) => void) => ipcRenderer.on('navigate', (_e, page) => cb(page)),
  onWindowState: (cb: (state: string) => void) => ipcRenderer.on('window-state', (_e, state) => cb(state)),
});
