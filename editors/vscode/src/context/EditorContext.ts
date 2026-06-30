import * as vscode from 'vscode';

export function gatherEditorContext(): Record<string, unknown> {
  const editor = vscode.window.activeTextEditor;
  const workspaceFolders = vscode.workspace.workspaceFolders;

  return {
    workspace: workspaceFolders?.map(w => w.uri.fsPath) || [],
    activeFile: editor ? {
      path: editor.document.uri.fsPath,
      language: editor.document.languageId,
      selection: editor.selection.isEmpty ? '' : editor.document.getText(editor.selection),
      lineCount: editor.document.lineCount
    } : null,
    diagnostics: getWorkspaceDiagnostics(),
    timestamp: Date.now()
  };
}

function getWorkspaceDiagnostics(): Array<{ file: string; severity: string; message: string; line: number }> {
  const result: Array<{ file: string; severity: string; message: string; line: number }> = [];
  const diags = vscode.languages.getDiagnostics();
  for (const [uri, diagnostics] of diags) {
    for (const d of diagnostics) {
      result.push({
        file: uri.fsPath,
        severity: vscode.DiagnosticSeverity[d.severity],
        message: d.message,
        line: d.range.start.line + 1
      });
    }
  }
  return result.slice(0, 100);
}
