import * as vscode from 'vscode';
import { OmriClient } from './OmriClient';
import { ChatPanel } from './ui/ChatPanel';
import { gatherEditorContext } from './context/EditorContext';
import { executeEditorTool } from './tools/EditorTools';

let omriClient: OmriClient;
let chatPanel: ChatPanel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  omriClient = new OmriClient();

  const connected = await omriClient.connect('VS Code');

  // Register tool handler — app delegates editor-specific tools here
  omriClient.onToolCall(async (_toolCallId, name, args) => {
    const result = await executeEditorTool(name, args);
    return { success: result.success, output: result.output, error: result.error, durationMs: result.durationMs };
  });

  // Push context periodically
  const pushContext = () => {
    if (omriClient.isConnected) {
      const ctx = gatherEditorContext();
      fetch(`http://127.0.0.1:18427/context`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: omriClient.id, context: ctx })
      }).catch(() => {});
    }
  };

  chatPanel = new ChatPanel(context, omriClient);
  chatPanel.initialize();
  if (!connected) chatPanel.showAppNotRunning();

  context.subscriptions.push(
    vscode.commands.registerCommand('omricode.openChat', () => chatPanel.reveal()),
    vscode.commands.registerCommand('omricode.togglePanel', () => chatPanel.toggle()),
    vscode.commands.registerCommand('omricode.explainSelection', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { vscode.window.showInformationMessage('No active editor.'); return; }
      const sel = editor.document.getText(editor.selection);
      if (!sel) { vscode.window.showInformationMessage('Select some code first.'); return; }
      chatPanel.reveal();
      chatPanel.sendMessage(`Explain this code:\n\`\`\`\n${sel}\n\`\`\``);
    }),
    vscode.commands.registerCommand('omricode.undoLastEdit', () => {
      chatPanel.postMessage({ type: 'undo', payload: {} });
    }),
    vscode.workspace.onDidSaveTextDocument(pushContext),
    vscode.window.onDidChangeActiveTextEditor(pushContext),
    vscode.workspace.onDidChangeWorkspaceFolders(pushContext),
    chatPanel
  );

  console.log('[OmriCode] VS Code extension activated. App connected:', connected);
}

export function deactivate(): void {
  omriClient?.disconnect();
}
