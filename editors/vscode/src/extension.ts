/**
 * extension.ts
 * OmriCode VS Code Extension — Activation Entry Point
 *
 * Registers commands, creates the chat panel WebView, and wires
 * the agent loop to VS Code's lifecycle. All state is persisted
 * via memento (workspace + global) and the .omricode/ directory.
 *
 * Commands:
 *   omricode.openChat         — Open the chat panel in the sidebar
 *   omricode.togglePanel      — Toggle panel visibility
 *   omricode.explainSelection — Send selected code to agent for explanation
 *   omricode.searchComments   — Vector search across project comments
 *   omricode.showProviderTable— Open the provider management table
 *   omricode.undoLastEdit     — Revert the last AI-performed edit
 */

import * as vscode from 'vscode';
import { ConfigManager } from './config/ConfigManager';
import { AgentLoop } from './agent/AgentLoop';
import { ToolRegistry } from './tools/ToolRegistry';
import { ChatPanel } from './ui/ChatPanel';

/**
 * Activated when VS Code loads the extension.
 * Initializes config, tool registry, agent loop, and chat panel.
 */
export function activate(context: vscode.ExtensionContext): void {
  // --- Initialize config manager (reads/writes settings.json) ---
  const configManager = new ConfigManager(context);

  // --- Initialize tool registry with all available tools ---
  const toolRegistry = new ToolRegistry(configManager);

  // --- Initialize agent loop (ReAct) with providers via config ---
  const agentLoop = new AgentLoop(configManager, toolRegistry);

  // --- Initialize chat panel (WebView) ---
  const chatPanel = new ChatPanel(context, agentLoop, configManager, toolRegistry);
  chatPanel.initialize();

  // ──────────────────────────────────────────────
  //  Command: Open Chat
  //  Opens or reveals the chat panel in the sidebar.
  // ──────────────────────────────────────────────
  const openChat = vscode.commands.registerCommand('omricode.openChat', () => {
    chatPanel.reveal();
  });

  // ──────────────────────────────────────────────
  //  Command: Toggle Panel
  //  Shows or hides the chat panel.
  // ──────────────────────────────────────────────
  const togglePanel = vscode.commands.registerCommand('omricode.togglePanel', () => {
    chatPanel.toggle();
  });

  // ──────────────────────────────────────────────
  //  Command: Explain Selection
  //  Takes the current editor selection and asks the
  //  agent to explain it. Opens panel if hidden.
  // ──────────────────────────────────────────────
  const explainSelection = vscode.commands.registerCommand('omricode.explainSelection', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('No active editor to explain.');
      return;
    }
    const selection = editor.document.getText(editor.selection);
    if (!selection) {
      vscode.window.showInformationMessage('No text selected. Highlight some code first.');
      return;
    }
    chatPanel.reveal();
    chatPanel.sendUserMessage(`Explain this code:\n\`\`\`\n${selection}\n\`\`\``);
  });

  // ──────────────────────────────────────────────
  //  Command: Search Comments
  //  Opens a quick input to search comment vector index.
  // ──────────────────────────────────────────────
  const searchComments = vscode.commands.registerCommand('omricode.searchComments', async () => {
    const query = await vscode.window.showInputBox({
      placeHolder: 'Search comments across the project...',
      prompt: 'Enter a semantic search query for code comments',
      ignoreFocusOut: true
    });
    if (!query) return;
    chatPanel.reveal();
    chatPanel.sendUserMessage(`/search-comments ${query}`);
  });

  // ──────────────────────────────────────────────
  //  Command: Show Provider Table
  //  Opens the provider management dialog.
  // ──────────────────────────────────────────────
  const showProviders = vscode.commands.registerCommand('omricode.showProviderTable', () => {
    chatPanel.reveal();
    chatPanel.postMessage({ type: 'showProviderTable' });
  });

  // ──────────────────────────────────────────────
  //  Command: Undo Last Edit
  //  Reverts the most recent AI-performed file edit.
  // ──────────────────────────────────────────────
  const undoLastEdit = vscode.commands.registerCommand('omricode.undoLastEdit', () => {
    const undone = toolRegistry.undoLastEdit();
    if (undone) {
      vscode.window.showInformationMessage('OmriCode: Last edit undone.');
    } else {
      vscode.window.showInformationMessage('OmriCode: Nothing to undo.');
    }
  });

  // ──────────────────────────────────────────────
  //  Register all disposables for cleanup
  // ──────────────────────────────────────────────
  context.subscriptions.push(
    openChat,
    togglePanel,
    explainSelection,
    searchComments,
    showProviders,
    undoLastEdit,
    chatPanel
  );

  // Log activation
  console.log('[OmriCode] Extension activated. Version 0.1.0');
}

/**
 * Called when VS Code deactivates the extension.
 * Saves any in-memory state and cleans up resources.
 */
export function deactivate(): void {
  console.log('[OmriCode] Extension deactivated.');
}
