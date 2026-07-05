export interface TextChunk {
  text: string;
  role?: string;
}

export class TextSplitter {
  private roleRegex = /^\[(.+?)\]\s*(.*)$/;

  /**
   * 解析角色标记文本，返回带角色标注的文本块
   */
  parseRoles(text: string): TextChunk[] {
    const lines = text.split('\n');
    const chunks: TextChunk[] = [];

    for (const line of lines) {
      const match = line.match(this.roleRegex);
      if (match) {
        chunks.push({ role: match[1], text: match[2] });
      } else if (line.trim()) {
        chunks.push({ text: line });
      }
    }

    return chunks;
  }

  /**
   * 从所有章节内容中提取所有出现的角色名
   */
  extractCharacters(chapters: { content: string }[]): string[] {
    const names = new Set<string>();

    for (const chapter of chapters) {
      const lines = chapter.content.split('\n');
      for (const line of lines) {
        const match = line.match(this.roleRegex);
        if (match) {
          names.add(match[1]);
        }
      }
    }

    return [...names];
  }

  /**
   * 将长文本按最大字数分片
   */
  splitByLength(text: string, maxLength: number = 500): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      chunks.push(text.slice(start, start + maxLength));
      start += maxLength;
    }
    return chunks;
  }
}

export const textSplitter = new TextSplitter();
