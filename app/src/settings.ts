import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { ProviderRow } from './types/provider';

export interface AppSettings {
  theme: 'dark' | 'dark-blue' | 'dark-green' | 'dark-purple' | 'warm' | 'cool' | 'amber' | 'rose' | 'light';
  accentColor: string;
  fontSize: number;
  fontFamily: string;
  snapZone: 'right-50' | 'right-33' | 'left-33' | 'float' | 'full';
  permissionMode: 'trusted' | 'normal' | 'paranoid';
  maxIterations: number;
  maxTokens: number;
  temperature: number;
  agentDefaults: string;
  autoSnap: boolean;
  minimizeToTray: boolean;
  startMinimized: boolean;
  serverPort: number;
  enableServer: boolean;
  workspacePath: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  accentColor: '#b0b0b0',
  fontSize: 13,
  fontFamily: "'SF Mono','Fira Code','Cascadia Code','JetBrains Mono','IBM Plex Mono',monospace",
  snapZone: 'right-50',
  permissionMode: 'normal',
  maxIterations: 25,
  maxTokens: 4096,
  temperature: 0.7,
  agentDefaults: 'max_tokens=4096\ntemperature=0.7\nmax_iterations=25\nsystem_prompt=You are OmriCode, a helpful AI coding assistant.',

  autoSnap: true,
  minimizeToTray: true,
  startMinimized: false,
  serverPort: 18427,
  enableServer: true,
  workspacePath: '',
};

export const THEMES: Record<string, { bg: string; surface: string; surface2: string; surface3: string; text: string; textSecondary: string; textMuted: string; border: string; borderLight: string; glassBg: string }> = {
  'dark': { bg: '#0a0a0a', surface: '#111111', surface2: '#1a1a1a', surface3: '#242424', text: '#d0d0d0', textSecondary: '#999999', textMuted: '#666666', border: '#222222', borderLight: '#2a2a2a', glassBg: 'rgba(17,17,17,0.85)' },
  'dark-blue': { bg: '#0a0a14', surface: '#111122', surface2: '#1a1a2e', surface3: '#242440', text: '#d0d0e0', textSecondary: '#9999aa', textMuted: '#666677', border: '#222244', borderLight: '#2a2a55', glassBg: 'rgba(17,17,34,0.85)' },
  'dark-green': { bg: '#0a0f0a', surface: '#111a11', surface2: '#1a2a1a', surface3: '#243a24', text: '#d0e0d0', textSecondary: '#99aa99', textMuted: '#667766', border: '#223a22', borderLight: '#2a4a2a', glassBg: 'rgba(17,26,17,0.85)' },
  'dark-purple': { bg: '#0f0a14', surface: '#1a1122', surface2: '#2a1a3a', surface3: '#3a244a', text: '#e0d0f0', textSecondary: '#aa99bb', textMuted: '#776688', border: '#3a2244', borderLight: '#4a2a55', glassBg: 'rgba(26,17,34,0.85)' },
  'warm': { bg: '#1a0f0a', surface: '#241510', surface2: '#2e1e18', surface3: '#382820', text: '#e0d0c0', textSecondary: '#aa8a70', textMuted: '#7a6050', border: '#3a2518', borderLight: '#4a3020', glassBg: 'rgba(26,15,10,0.85)' },
  'cool': { bg: '#0a0e1a', surface: '#0e1425', surface2: '#121a30', surface3: '#182040', text: '#c8d8f0', textSecondary: '#7088b0', textMuted: '#506080', border: '#1a2a40', borderLight: '#1e3050', glassBg: 'rgba(10,14,26,0.85)' },
  'amber': { bg: '#0f0b00', surface: '#1a1400', surface2: '#251e00', surface3: '#302800', text: '#ffe0a0', textSecondary: '#b89850', textMuted: '#887030', border: '#3a2e00', borderLight: '#4a3a00', glassBg: 'rgba(15,11,0,0.85)' },
  'rose': { bg: '#1a0a10', surface: '#251018', surface2: '#301420', surface3: '#3a1a28', text: '#e8c0d0', textSecondary: '#b07090', textMuted: '#805068', border: '#3a1a2a', borderLight: '#452035', glassBg: 'rgba(26,10,16,0.85)' },
  'light': { bg: '#f5f5f5', surface: '#ffffff', surface2: '#eeeeee', surface3: '#dddddd', text: '#1a1a1a', textSecondary: '#666666', textMuted: '#999999', border: '#dddddd', borderLight: '#cccccc', glassBg: 'rgba(255,255,255,0.85)' },
};

export class SettingsManager {
  private settingsPath: string;
  private settings: AppSettings;
  private providers: ProviderRow[] = [];
  private listeners: Array<(settings: AppSettings) => void> = [];

  constructor() {
    const configDir = path.join(app.getPath('userData'), 'config');
    try { fs.mkdirSync(configDir, { recursive: true }); } catch { /* noop */ }
    this.settingsPath = path.join(configDir, 'settings.json');
    this.settings = this.loadSettings();
    this.loadProviders();
  }

  private dataPath(): string { return path.join(app.getPath('userData'), 'config'); }

  private loadSettings(): AppSettings {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8')) }; }
    catch { return { ...DEFAULT_SETTINGS }; }
  }

  private saveSettings(): void {
    try { fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2)); } catch { /* noop */ }
  }

  get(): AppSettings { return { ...this.settings }; }

  update(partial: Partial<AppSettings>): AppSettings {
    this.settings = { ...this.settings, ...partial };
    this.saveSettings();
    this.listeners.forEach(cb => cb(this.settings));
    return { ...this.settings };
  }

  onChange(cb: (settings: AppSettings) => void): void { this.listeners.push(cb); }

  getThemeVars(): Record<string, string> {
    const theme = THEMES[this.settings.theme] || THEMES.dark;
    return {
      '--bg': theme.bg, '--surface': theme.surface, '--surface-2': theme.surface2,
      '--surface-3': theme.surface3, '--text': theme.text, '--text-secondary': theme.textSecondary,
      '--text-muted': theme.textMuted, '--border': theme.border, '--border-light': theme.borderLight,
      '--glass-bg': theme.glassBg, '--accent': this.settings.accentColor,
      '--font-mono': this.settings.fontFamily, '--font-size': `${this.settings.fontSize}px`
    };
  }

  private providersPath(): string { return path.join(this.dataPath(), 'providers.json'); }

  private loadProviders(): void {
    try { this.providers = JSON.parse(fs.readFileSync(this.providersPath(), 'utf-8')); }
    catch {
      this.providers = [{
        id: crypto.randomUUID(), name: 'Local', endpoint: 'http://localhost:11434',
        model: 'nous-hermes', apiKey: '', isActive: true, supportsFC: true,
        maxTokens: 4096, temperature: 0.7, order: 0
      }];
      this.saveProviders();
    }
  }

  private saveProviders(): void {
    try { fs.writeFileSync(this.providersPath(), JSON.stringify(this.providers, null, 2)); } catch { /* noop */ }
  }

  getProviders(): ProviderRow[] { return [...this.providers]; }
  getActiveProvider(): ProviderRow | undefined { return this.providers.find(p => p.isActive); }

  addProvider(row: ProviderRow): void { this.providers.push(row); this.saveProviders(); }
  updateProvider(id: string, updates: Partial<ProviderRow>): void {
    const idx = this.providers.findIndex(p => p.id === id);
    if (idx >= 0) { this.providers[idx] = { ...this.providers[idx], ...updates }; this.saveProviders(); }
  }
  removeProvider(id: string): void { this.providers = this.providers.filter(p => p.id !== id); this.saveProviders(); }
  setActiveProvider(id: string): void {
    this.providers = this.providers.map(p => ({ ...p, isActive: p.id === id }));
    this.saveProviders();
  }
}
