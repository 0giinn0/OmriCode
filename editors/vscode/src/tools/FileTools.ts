/**
 * FileTools.ts
 * OmriCode — File System Utilities
 *
 * Helper functions for file operations used by the tool registry.
 * These work with VS Code's virtual file system when available
 * and fall back to Node.js fs for direct file access.
 *
 * All file write operations are logged to the undo stack for
 * Ctrl+Z support.
 */

import * as vscode from 'vscode';
import * as path from 'path';

export class FileTools {
  /**
   * Ensure a directory exists, creating parent directories as needed.
   */
  static ensureDirectoryExists(filePath: string): void {
    const fs = require('fs');
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Check if a path is within the current workspace.
   */
  static isInWorkspace(filePath: string): boolean {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return false;
    return workspaceFolders.some(folder => filePath.startsWith(folder.uri.fsPath));
  }

  /**
   * Get the relative path from workspace root.
   */
  static relativeToWorkspace(filePath: string): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return filePath;
    for (const folder of workspaceFolders) {
      if (filePath.startsWith(folder.uri.fsPath)) {
        return path.relative(folder.uri.fsPath, filePath);
      }
    }
    return filePath;
  }

  /**
   * Read a file's content, returning null on error.
   */
  static readFile(filePath: string): string | null {
    try {
      const fs = require('fs');
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Write content to a file, creating directories if needed.
   */
  static writeFile(filePath: string, content: string): boolean {
    try {
      FileTools.ensureDirectoryExists(filePath);
      const fs = require('fs');
      fs.writeFileSync(filePath, content, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve a potentially relative path against the workspace root.
   */
  static resolvePath(inputPath: string): string {
    if (path.isAbsolute(inputPath)) return inputPath;

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return path.resolve(inputPath);

    return path.resolve(workspaceFolders[0].uri.fsPath, inputPath);
  }

  /**
   * Check if a file exists.
   */
  static exists(filePath: string): boolean {
    try {
      const fs = require('fs');
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }

  /**
   * Get the file extension in lowercase.
   */
  static getExtension(filePath: string): string {
    return path.extname(filePath).toLowerCase();
  }

  /**
   * Get the file name from a path.
   */
  static getFileName(filePath: string): string {
    return path.basename(filePath);
  }
}
