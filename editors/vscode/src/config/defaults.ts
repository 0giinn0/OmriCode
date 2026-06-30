/**
 * defaults.ts
 * OmriCode — Default Configuration Values
 *
 * Sensible defaults for first-run experience. Users override
 * these through the Provider Table UI and settings panel.
 */

import { ProviderRow, PermissionMode } from '../types/provider';

/**
 * Default providers shown on first launch.
 * Local (Ollama/llmaker) is active; OpenAI and Anthropic are
 * pre-configured as templates for the user to fill in.
 */
export const DEFAULT_PROVIDERS: ProviderRow[] = [
  {
    id: 'local-default',
    name: 'Local',
    endpoint: 'http://localhost:11434/v1',
    model: 'nous-hermes-gguf',
    apiKey: '',
    isActive: true,
    supportsFC: 'auto',
    maxTokens: 4096,
    temperature: 0.7,
    order: 0,
    apiKeyHint: 'Not needed for local models'
  },
  {
    id: 'openai-default',
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    apiKey: '',
    isActive: false,
    supportsFC: true,
    maxTokens: 4096,
    temperature: 0.7,
    order: 1,
    apiKeyHint: 'sk-...'
  },
  {
    id: 'anthropic-default',
    name: 'Anthropic',
    endpoint: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
    apiKey: '',
    isActive: false,
    supportsFC: true,
    maxTokens: 4096,
    temperature: 0.7,
    order: 2,
    apiKeyHint: 'sk-ant-...'
  },
  {
    id: 'openrouter-default',
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4',
    apiKey: '',
    isActive: false,
    supportsFC: 'auto',
    maxTokens: 4096,
    temperature: 0.7,
    order: 3,
    apiKeyHint: 'sk-or-...'
  }
];

/**
 * Default permission mode.
 * 'normal' — auto-approve workspace-scoped tools,
 *            confirm bash/web/network tools.
 */
export const DEFAULT_PERMISSION_MODE: PermissionMode = 'normal';

/**
 * Default panel snap zone.
 */
export const DEFAULT_PANEL_SNAP_ZONE = 'right-50' as const;

/**
 * Default agent loop iteration limit.
 */
export const DEFAULT_MAX_ITERATIONS = 25;

/**
 * Token budget allocation for context window assembly.
 * Values in approximate token counts.
 */
export const DEFAULT_CONTEXT_BUDGET = {
  systemPrompt: 2000,
  toolDefinitions: 3000,
  sessionHistory: 8000,
  currentFile: 4000,
  selection: 500,
  terminalOutput: 1000,
  problems: 500,
  codebaseRagChunks: 4000,
  userMessage: 1000,
  /** Total soft limit before truncation strategies kick in */
  totalSoftLimit: 25000
};

/**
 * Codebase RAG defaults.
 */
export const DEFAULT_RAG_CONFIG = {
  enabled: true,
  chunkSize: 50,
  chunkOverlap: 5,
  topK: 8
};
