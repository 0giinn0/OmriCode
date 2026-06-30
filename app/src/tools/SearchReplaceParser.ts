import { SearchReplaceBlock } from '../types/tool';

const BLOCK_REGEX = /<<<<<<<\s*SEARCH\s*([\s\S]*?)=======\s*([\s\S]*?)>>>>>>>\s*REPLACE/g;

export class SearchReplaceParser {
  static parse(text: string): SearchReplaceBlock[] {
    const blocks: SearchReplaceBlock[] = [];
    let match;
    while ((match = BLOCK_REGEX.exec(text)) !== null) {
      blocks.push({ filePath: '', searchText: match[1], replaceText: match[2], matched: false });
    }
    return blocks;
  }

  static detectFilepath(text: string): string | null {
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      if (trimmed.startsWith('file:') || trimmed.startsWith('path:') || trimmed.startsWith('//') || trimmed.startsWith('#')) {
        const val = line.split(/[:]/).slice(1).join(':').trim();
        if (val && (val.includes('/') || val.includes('\\') || val.includes('.'))) return val;
      }
    }
    return null;
  }
}
