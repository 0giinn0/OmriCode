/**
 * SearchReplaceParser.ts
 * OmriCode — SEARCH/REPLACE Block Parser
 *
 * Parses SEARCH/REPLACE blocks from model text output.
 * This is the fallback tool calling mechanism — when a model
 * doesn't support native function calling, it writes edits
 * in this format and OmriCode converts them to tool executions.
 *
 * Format:
 *   <<<<<<< SEARCH
 *   [exact text to find]
 *   =======
 *   [replacement text]
 *   >>>>>>> REPLACE
 *
 * The parser uses a regex to extract all blocks, then validates
 * each one. Multiple blocks can exist in a single response.
 */

import { SearchReplaceBlock } from '../types/tool';

export class SearchReplaceParser {
  /**
   * Regex that matches SEARCH/REPLACE blocks.
   * Captures two groups: search text and replace text.
   * 'm' flag for multiline, 'g' for all occurrences.
   */
  private static readonly BLOCK_REGEX =
    /<<<<<<< SEARCH\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> REPLACE/gm;

  /**
   * Try to infer the file path from context around the block.
   * Looks for lines like: `File: path/to/file.ts` or `### path/to/file.ts`
   */
  private static readonly FILE_HINT_REGEX =
    /(?:File|file|path):\s*(.+)$|###\s*(.+)$|`(.+?)`/m;

  /**
   * Parse all SEARCH/REPLACE blocks from a text string.
   */
  static parse(text: string): SearchReplaceBlock[] {
    const blocks: SearchReplaceBlock[] = [];
    let match;

    // Reset regex state
    this.BLOCK_REGEX.lastIndex = 0;

    while ((match = this.BLOCK_REGEX.exec(text)) !== null) {
      const searchText = match[1].trimEnd();
      const replaceText = match[2].trimEnd();

      // Try to find a file path hint near this block
      const contextStart = Math.max(0, match.index - 500);
      const context = text.slice(contextStart, match.index);
      const filePath = this.inferFilePath(context);

      blocks.push({
        filePath: filePath || '(unknown file — check context)',
        searchText,
        replaceText,
        matched: false // set after execution attempt
      });
    }

    return blocks;
  }

  /**
   * Check if text contains any SEARCH/REPLACE blocks.
   */
  static containsBlocks(text: string): boolean {
    this.BLOCK_REGEX.lastIndex = 0;
    return this.BLOCK_REGEX.test(text);
  }

  /**
   * Count the number of blocks in a text string.
   */
  static countBlocks(text: string): number {
    let count = 0;
    this.BLOCK_REGEX.lastIndex = 0;
    while (this.BLOCK_REGEX.exec(text) !== null) {
      count++;
    }
    return count;
  }

  /**
   * Infer file path from context text before a block.
   * Looks for common file path patterns.
   */
  private static inferFilePath(context: string): string | null {
    // Check for explicit file hints
    const hintMatch = context.match(this.FILE_HINT_REGEX);
    if (hintMatch) {
      const path = hintMatch[1] || hintMatch[2] || hintMatch[3];
      if (path && path.trim()) return path.trim();
    }

    // Check for backtick-wrapped paths (common in model output)
    const backtickMatch = context.match(/`([^`]+\.\w+)`/);
    if (backtickMatch) return backtickMatch[1];

    return null;
  }

  /**
   * Validate a parsed block.
   * Returns an error string or null if valid.
   */
  static validate(block: SearchReplaceBlock): string | null {
    if (!block.searchText || block.searchText.length === 0) {
      return 'SEARCH section is empty';
    }
    if (!block.replaceText || block.replaceText.length === 0) {
      return 'REPLACE section is empty';
    }
    if (block.searchText === block.replaceText) {
      return 'SEARCH and REPLACE are identical — no change needed';
    }
    if (!block.filePath || block.filePath.includes('unknown')) {
      return 'Could not determine the target file path';
    }
    return null;
  }
}
