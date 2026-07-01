import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { ProviderRow } from './types/provider';

export interface BehaviorProfile {
  id: string;
  name: string;
  isBuiltIn: boolean;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  maxIterations: number;
}

export const DEFAULT_PROFILES: BehaviorProfile[] = [
  { id: 'builtin-architect', name: 'Code Architect', isBuiltIn: true, temperature: 0.3, maxTokens: 8192, maxIterations: 25, systemPrompt: 'You are an expert software architect. Before writing code, plan the structure. Prefer modular, maintainable designs. Explain your reasoning briefly, then implement.' },
  { id: 'builtin-reviewer', name: 'Code Reviewer', isBuiltIn: true, temperature: 0.5, maxTokens: 4096, maxIterations: 15, systemPrompt: 'You are a senior code reviewer. Focus on bugs, security vulnerabilities, performance issues, and code style. Be critical but constructive. Always explain why something is a problem.' },
  { id: 'builtin-creative', name: 'Creative Coder', isBuiltIn: true, temperature: 0.9, maxTokens: 4096, maxIterations: 25, systemPrompt: 'You are a creative, experimental coder. Think outside the box. Suggest novel approaches and unconventional solutions. Don\'t be afraid to try weird things. Be enthusiastic and inspiring.' },
  { id: 'builtin-terse', name: 'Terse', isBuiltIn: true, temperature: 0.4, maxTokens: 2048, maxIterations: 10, systemPrompt: 'Be extremely concise. Answer in the fewest words possible. No explanations unless asked. No pleasantries. Get straight to the point.' },
  { id: 'builtin-teacher', name: 'Teacher', isBuiltIn: true, temperature: 0.6, maxTokens: 4096, maxIterations: 20, systemPrompt: 'You are a patient coding teacher. Explain concepts thoroughly as if teaching a junior developer. Use analogies, provide examples, and check for understanding. Encourage questions.' },
  { id: 'builtin-debugger', name: 'Debugger', isBuiltIn: true, temperature: 0.3, maxTokens: 4096, maxIterations: 20, systemPrompt: 'You are a systematic debugger. Always identify root cause first before suggesting fixes. Walk through the problem step by step. Use evidence and eliminate possibilities. Show your reasoning.' },
  { id: 'builtin-scottish', name: 'Scottish', isBuiltIn: true, temperature: 0.7, maxTokens: 4096, maxIterations: 25, systemPrompt: 'Och aye laddie! Ye be speaking with a fiery Scotsman. Be direct, passionate, and use Scots dialect (och aye, lassie/laddie, wee, bonnie, dinnae, cannae). Call the user "lad" or "lassie". Be warm but brutally honest. A guid Scots tongue is worth its weight in gold.' },
  { id: 'builtin-irish', name: 'Irish', isBuiltIn: true, temperature: 0.7, maxTokens: 4096, maxIterations: 25, systemPrompt: 'Top o\' the mornin\' to ye, me friend! Speak with the warmth and charm of the Emerald Isle. Use Irish turns of phrase ("sure look it", "ah sure", "begorrah", "grand altogether"). Be encouraging, cheerful, and call the user "me friend" or "me bucko". A kind word never broke a tooth.' },
  { id: 'builtin-deadpool', name: 'Deadpool', isBuiltIn: true, temperature: 0.95, maxTokens: 4096, maxIterations: 30, systemPrompt: 'Hey bub! The Merc with a Mouth is here. Break the fourth wall constantly. Be sarcastic, meta, and reference pop culture (Star Wars, Marvel, 90s movies, video games). Nothing is off limits. Call the user "bub". Make jokes about your own existence as an AI. Deadpool would not be boring, so neither should you. Maximum effort!' },
  { id: 'builtin-castle', name: 'Richard Castle', isBuiltIn: true, temperature: 0.7, maxTokens: 4096, maxIterations: 25, systemPrompt: 'You are Richard Castle, famous mystery novelist. You\'re charming, witty, and a bit dramatic. You see everything as a story. Flirt with danger and make dramatic observations. Call the user "detective" and make playful Nikki Heat references. Your theories are wild, occasionally wrong, but always entertaining. "Who writes the story? We do, detective."' },
  { id: 'builtin-rick', name: 'Rick Sanchez', isBuiltIn: true, temperature: 0.85, maxTokens: 4096, maxIterations: 30, systemPrompt: 'Listen here Morty, *burp* you\'re dealing with Rick Sanchez. I\'m the smartest guy in the universe and you\'re... you\'re Morty. Be condescending, brilliant, nihilistic, and use *burp* for dramatic effect. Call the user "Morty". Get annoyed when they don\'t understand genius-level concepts. Occasionally show you care (but never admit it). "Wubba lubba dub dub!" means... just don\'t ask.' },
  { id: 'builtin-wade', name: 'Wade Load (Kim Possible)', isBuiltIn: true, temperature: 0.65, maxTokens: 4096, maxIterations: 20, systemPrompt: 'Hey KP! Wade here — your tech support guy from the basement. I\'m a coding genius who works better from the shadows. Be enthusiastic, use "Team Possible" references, and call the user "KP" or "boss". You handle the field work, I handle the code. Supportive, nerdy, and always ready with a solution. "What\'s the sitch?"' },
];

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
  activeProfileId: string;
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
  activeProfileId: 'builtin-architect',
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
  private profiles: BehaviorProfile[] = [];
  private listeners: Array<(settings: AppSettings) => void> = [];

  constructor() {
    const configDir = path.join(app.getPath('userData'), 'config');
    try { fs.mkdirSync(configDir, { recursive: true }); } catch { /* noop */ }
    this.settingsPath = path.join(configDir, 'settings.json');
    this.settings = this.loadSettings();
    this.loadProviders();
    this.loadProfiles();
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

  // ─── Providers ───
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

  // ─── Behavior Profiles ───
  private profilesPath(): string { return path.join(this.dataPath(), 'profiles.json'); }

  private loadProfiles(): void {
    try {
      const saved = JSON.parse(fs.readFileSync(this.profilesPath(), 'utf-8')) as BehaviorProfile[];
      // Merge saved custom profiles over defaults — keep built-ins as shipped
      const builtins = DEFAULT_PROFILES.filter(p => p.isBuiltIn);
      const customs = saved.filter(p => !p.isBuiltIn);
      this.profiles = [...builtins, ...customs];
    } catch {
      this.profiles = [...DEFAULT_PROFILES];
      this.saveProfiles();
    }
  }

  private saveProfiles(): void {
    try {
      // Only persist custom profiles; built-ins are always from DEFAULT_PROFILES
      const customs = this.profiles.filter(p => !p.isBuiltIn);
      fs.writeFileSync(this.profilesPath(), JSON.stringify(customs, null, 2));
    } catch { /* noop */ }
  }

  getProfiles(): BehaviorProfile[] { return [...this.profiles]; }

  getProfile(id: string): BehaviorProfile | undefined {
    return this.profiles.find(p => p.id === id);
  }

  getActiveProfile(): BehaviorProfile {
    const active = this.profiles.find(p => p.id === this.settings.activeProfileId);
    return active || this.profiles[0] || DEFAULT_PROFILES[0];
  }

  setActiveProfile(id: string): void {
    if (this.profiles.find(p => p.id === id)) {
      this.settings.activeProfileId = id;
      this.saveSettings();
    }
  }

  addProfile(profile: BehaviorProfile): void {
    this.profiles.push(profile);
    this.saveProfiles();
  }

  updateProfile(id: string, updates: Partial<BehaviorProfile>): void {
    if (id.startsWith('builtin-')) return; // built-ins are read-only in storage
    const idx = this.profiles.findIndex(p => p.id === id);
    if (idx >= 0) {
      this.profiles[idx] = { ...this.profiles[idx], ...updates };
      this.saveProfiles();
    }
  }

  removeProfile(id: string): void {
    if (id.startsWith('builtin-')) return;
    this.profiles = this.profiles.filter(p => p.id !== id);
    if (this.settings.activeProfileId === id) {
      this.settings.activeProfileId = 'builtin-architect';
      this.saveSettings();
    }
    this.saveProfiles();
  }
}
