import * as vscode from 'vscode';

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

export async function executeEditorTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const start = Date.now();

  try {
    switch (name) {
      case 'open_editor_file':
        return await openFile(args.path as string);
      case 'show_diagnostic':
        return await showDiagnostic(args.filePath as string, args.message as string, args.severity as string);
      case 'code_action':
        return await applyCodeAction(args.filePath as string, args.action as string);
      default:
        return { success: false, output: '', error: `Unknown tool: ${name}`, durationMs: Date.now() - start };
    }
  } catch (err) {
    return { success: false, output: '', error: (err as Error).message, durationMs: Date.now() - start };
  }
}

async function openFile(filePath: string): Promise<ToolResult> {
  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  return { success: true, output: `Opened: ${filePath}`, durationMs: 0 };
}

async function showDiagnostic(filePath: string, message: string, severity: string): Promise<ToolResult> {
  const uri = vscode.Uri.file(filePath);
  const sev = severity === 'error' ? vscode.DiagnosticSeverity.Error
    : severity === 'warning' ? vscode.DiagnosticSeverity.Warning
    : vscode.DiagnosticSeverity.Information;

  const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), message, sev);
  const collection = vscode.languages.createDiagnosticCollection('omricode');
  collection.set(uri, [diag]);

  setTimeout(() => collection.clear(), 10000);

  return { success: true, output: `Diagnostic shown: ${message}`, durationMs: 0 };
}

async function applyCodeAction(filePath: string, action: string): Promise<ToolResult> {
  const uri = vscode.Uri.file(filePath);

  if (action === 'format') {
    await vscode.commands.executeCommand('editor.action.formatDocument', uri);
    return { success: true, output: `Formatted: ${filePath}`, durationMs: 0 };
  }

  if (action === 'organizeImports') {
    await vscode.commands.executeCommand('editor.action.organizeImports', uri);
    return { success: true, output: `Imports organized: ${filePath}`, durationMs: 0 };
  }

  return { success: false, output: '', error: `Unknown code action: ${action}`, durationMs: 0 };
}
