/**
 * ConfigManager.ts
 * OmriCode — Configuration Manager
 *
 * Reads and writes VS Code settings.json for all OmriCode
 * configuration values. Acts as the single source of truth
 * for provider table rows, permission modes, panel state,
 * and RAG settings.
 *
 * All config is namespaced under `omricode.*` in settings.json.
 */

import * as vscode from 'vscode';
import { ProviderRow, PermissionMode } from '../types/provider';
import {
  DEFAULT_PROVIDERS,
  DEFAULT_PERMISSION_MODE,
  DEFAULT_PANEL_SNAP_ZONE,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_CONTEXT_BUDGET,
  DEFAULT_RAG_CONFIG
} from './defaults';

export class ConfigManager {
  private context: vscode.ExtensionContext;
  /** Cached provider rows to avoid repeated settings reads */
  private cachedProviders: ProviderRow[] | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  // ──────────────────────────────────────────────
  //  Provider Table (adjustable array of rows)
  // ──────────────────────────────────────────────

  /**
   * Returns all provider rows from settings.
   * If no providers are configured (first run), initializes with defaults.
   */
  getProviders(): ProviderRow[] {
    if (this.cachedProviders) return this.cachedProviders;

    const config = vscode.workspace.getConfiguration('omricode');
    const providers = config.get<ProviderRow[]>('providers', []);

    if (providers.length === 0) {
      this.setProviders(DEFAULT_PROVIDERS);
      this.cachedProviders = DEFAULT_PROVIDERS;
      return DEFAULT_PROVIDERS;
    }

    this.cachedProviders = providers;
    return providers;
  }

  /**
   * Overwrites the full provider table with a new array.
   * Used after drag-reorder, add, delete, or edit operations.
   */
  setProviders(providers: ProviderRow[]): void {
    const config = vscode.workspace.getConfiguration('omricode');
    config.update('providers', providers, vscode.ConfigurationTarget.Global);
    this.cachedProviders = providers;
  }

  /**
   * Returns the currently active provider row.
   * Falls back to the first row if none is marked active.
   */
  getActiveProvider(): ProviderRow | undefined {
    const providers = this.getProviders();
    return providers.find(p => p.isActive) || providers[0];
  }

  /**
   * Sets a specific provider as active and deactivates all others.
   */
  setActiveProvider(providerId: string): void {
    const providers = this.getProviders().map(p => ({
      ...p,
      isActive: p.id === providerId
    }));
    this.setProviders(providers);
  }

  /**
   * Adds a new provider row to the table.
   */
  addProvider(row: ProviderRow): void {
    const providers = this.getProviders();
    providers.push(row);
    this.setProviders(providers);
  }

  /**
   * Removes a provider row by ID.
   */
  removeProvider(providerId: string): void {
    const providers = this.getProviders().filter(p => p.id !== providerId);
    this.setProviders(providers);
  }

  /**
   * Updates a single provider row by ID (partial merge).
   */
  updateProvider(providerId: string, updates: Partial<ProviderRow>): void {
    const providers = this.getProviders().map(p =>
      p.id === providerId ? { ...p, ...updates } : p
    );
    this.setProviders(providers);
  }

  /**
   * Reorders provider rows (drag-and-drop result).
   */
  reorderProviders(fromIndex: number, toIndex: number): void {
    const providers = this.getProviders();
    const [moved] = providers.splice(fromIndex, 1);
    providers.splice(toIndex, 0, moved);
    providers.forEach((p, i) => (p.order = i));
    this.setProviders(providers);
  }

  // ──────────────────────────────────────────────
  //  Simple Config Getters
  // ──────────────────────────────────────────────

  getPermissionMode(): PermissionMode {
    const config = vscode.workspace.getConfiguration('omricode');
    return config.get<PermissionMode>('permissionMode', DEFAULT_PERMISSION_MODE);
  }

  setPermissionMode(mode: PermissionMode): void {
    const config = vscode.workspace.getConfiguration('omricode');
    config.update('permissionMode', mode, vscode.ConfigurationTarget.Global);
  }

  getPanelSnapZone(): string {
    const config = vscode.workspace.getConfiguration('omricode');
    return config.get<string>('panelSnapZone', DEFAULT_PANEL_SNAP_ZONE);
  }

  setPanelSnapZone(zone: string): void {
    const config = vscode.workspace.getConfiguration('omricode');
    config.update('panelSnapZone', zone, vscode.ConfigurationTarget.Global);
  }

  getMaxIterations(): number {
    const config = vscode.workspace.getConfiguration('omricode');
    return config.get<number>('maxIterations', DEFAULT_MAX_ITERATIONS);
  }

  getContextBudget(): typeof DEFAULT_CONTEXT_BUDGET {
    return DEFAULT_CONTEXT_BUDGET;
  }

  getRagConfig(): typeof DEFAULT_RAG_CONFIG {
    const config = vscode.workspace.getConfiguration('omricode');
    const enabled = config.get<boolean>('codebaseRag.enabled', DEFAULT_RAG_CONFIG.enabled);
    const chunkSize = config.get<number>('codebaseRag.chunkSize', DEFAULT_RAG_CONFIG.chunkSize);
    const topK = config.get<number>('codebaseRag.topK', DEFAULT_RAG_CONFIG.topK);
    return { enabled, chunkSize, chunkOverlap: 5, topK };
  }

  // ──────────────────────────────────────────────
  //  Workspace & Global State (memento-based)
  // ──────────────────────────────────────────────

  /** Store a value in workspace memento (per-project) */
  setWorkspaceState<T>(key: string, value: T): void {
    this.context.workspaceState.update(key, value);
  }

  /** Retrieve a value from workspace memento */
  getWorkspaceState<T>(key: string, defaultValue?: T): T | undefined {
    return this.context.workspaceState.get<T>(key, defaultValue!);
  }

  /** Store a value in global memento (cross-project) */
  setGlobalState<T>(key: string, value: T): void {
    this.context.globalState.update(key, value);
  }

  /** Retrieve a value from global memento */
  getGlobalState<T>(key: string, defaultValue?: T): T | undefined {
    return this.context.globalState.get<T>(key, defaultValue!);
  }

  /** Clear all OmriCode workspace state */
  clearWorkspaceState(): void {
    this.context.workspaceState.keys().forEach(key => {
      if (key.startsWith('omricode.')) {
        this.context.workspaceState.update(key, undefined);
      }
    });
  }
}
