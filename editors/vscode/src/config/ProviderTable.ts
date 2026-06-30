/**
 * ProviderTable.ts
 * OmriCode — Provider Table Manager (Data Layer)
 *
 * Pure CRUD operations on the provider table array.
 * The ConfigManager owns persistence; this provides
 * validation, deduplication, and helper methods.
 *
 * The provider table is the central configuration primitive —
 * every provider, whether local or remote, is a row in this table.
 */

import { ProviderRow, ConnectionTestResult } from '../types/provider';
import { ConfigManager } from './ConfigManager';

export class ProviderTable {
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
  }

  /**
   * Returns all rows as a flat array (sorted by order).
   */
  getAll(): ProviderRow[] {
    const rows = this.configManager.getProviders();
    return rows.sort((a, b) => a.order - b.order);
  }

  /**
   * Returns the active row.
   */
  getActive(): ProviderRow | undefined {
    return this.configManager.getActiveProvider();
  }

  /**
   * Creates a new blank row with sensible defaults.
   * Does NOT save it — caller must call add().
   */
  createBlank(): ProviderRow {
    return {
      id: crypto.randomUUID(),
      name: 'New Provider',
      endpoint: 'http://localhost:11434/v1',
      model: '',
      apiKey: '',
      isActive: false,
      supportsFC: 'auto',
      maxTokens: 4096,
      temperature: 0.7,
      order: this.getAll().length
    };
  }

  /**
   * Adds a validated row to the table.
   * Marks as active if it's the first row.
   */
  add(row: ProviderRow): void {
    const errors = this.validate(row);
    if (errors.length > 0) {
      throw new Error(`Provider validation failed: ${errors.join('; ')}`);
    }
    const all = this.getAll();
    if (all.length === 0) {
      row.isActive = true;
    }
    this.configManager.addProvider(row);
  }

  /**
   * Updates a row by ID with partial data.
   */
  update(id: string, updates: Partial<ProviderRow>): void {
    this.configManager.updateProvider(id, updates);
  }

  /**
   * Removes a row by ID. If it was active, activates the first remaining row.
   */
  remove(id: string): void {
    const all = this.getAll();
    const wasActive = all.find(p => p.id === id)?.isActive;
    this.configManager.removeProvider(id);
    if (wasActive) {
      const remaining = this.getAll();
      if (remaining.length > 0) {
        this.configManager.setActiveProvider(remaining[0].id);
      }
    }
  }

  /**
   * Sets one row as active, deactivates others.
   */
  setActive(id: string): void {
    this.configManager.setActiveProvider(id);
  }

  /**
   * Swaps row order (for drag-and-drop).
   */
  reorder(fromIndex: number, toIndex: number): void {
    this.configManager.reorderProviders(fromIndex, toIndex);
  }

  /**
   * Tests a connection to a provider endpoint.
   * Used in the UI's "Test Connection" button.
   */
  async testConnection(row: ProviderRow): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const response = await fetch(`${row.endpoint}/models`, {
        headers: row.apiKey
          ? { Authorization: `Bearer ${row.apiKey}` }
          : undefined
      });
      const latencyMs = Date.now() - start;
      if (!response.ok) {
        return {
          success: false,
          latencyMs,
          modelFound: false,
          supportsFC: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }
      const data = await response.json() as Record<string, unknown>;
      const models = (data.data as { id: string }[]) || [];
      const modelFound = models.some((m: { id: string }) => m.id === row.model);
      return {
        success: true,
        latencyMs,
        modelFound,
        supportsFC: row.supportsFC !== false
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      return {
        success: false,
        latencyMs,
        modelFound: false,
        supportsFC: false,
        error: err instanceof Error ? err.message : 'Unknown connection error'
      };
    }
  }

  /**
   * Validates a provider row. Returns array of error messages.
   */
  validate(row: Partial<ProviderRow>): string[] {
    const errors: string[] = [];
    if (!row.name || row.name.trim().length === 0) {
      errors.push('Provider name is required');
    }
    if (!row.endpoint || row.endpoint.trim().length === 0) {
      errors.push('Endpoint URL is required');
    } else {
      try {
        new URL(row.endpoint);
      } catch {
        errors.push('Endpoint URL is not a valid URL');
      }
    }
    if (!row.model || row.model.trim().length === 0) {
      errors.push('Model name is required');
    }
    if (row.temperature !== undefined && (row.temperature < 0 || row.temperature > 2)) {
      errors.push('Temperature must be between 0 and 2');
    }
    if (row.maxTokens !== undefined && row.maxTokens < 1) {
      errors.push('Max tokens must be at least 1');
    }
    return errors;
  }

  /**
   * Masks an API key for display (shows first 4 + last 4 chars).
   */
  static maskApiKey(key: string): string {
    if (key.length <= 8) return '••••••••';
    return key.slice(0, 4) + '••••••••' + key.slice(-4);
  }
}
