export interface TextChunk {
  text: string;
  role?: string;
}

export interface RawChapter {
  title: string;
  content: string;
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
   * 将原始小说文本按章节标题拆分为章节列表。
   *
   * 规则链（优先级从高到低）：
   *   1. 中文：第X章/节/回/部/卷/篇/集/幕
   *   2. 英文：Chapter/Part/Section/Volume/Act + 数字
   *   3. Markdown 标题：## 标题
   *
   * 如果全文找不到任何标题，整篇作为单个章节返回。
   * 空行会被保留在章节内容中（维持段落间距）。
   */
  parseChaptersFromText(text: string): RawChapter[] {
    const lines = text.split('\n');
    const chapters: { title: string; contentLines: string[] }[] = [];
    let current: { title: string; contentLines: string[] } | null = null;

    // ── 规则链 ──
    const cnHeader = /^#{0,3}\s*第[零一二三四五六七八九十百千\d]+[章节回部卷篇集幕][：:\s]*(.*)$/;
    const enHeader = /^#{0,3}\s*(Chapter|Part|Section|Volume|Act|Ch\.?)\s+\d+[：:\s]*(.*)$/i;
    const mdHeader = /^#{1,4}\s+(.+)$/;

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();

      // 空行：还没进入任何章节时忽略，进了章节则保留（维持段落间距）
      if (!trimmed) {
        if (current) current.contentLines.push(rawLine);
        continue;
      }

      const cnMatch = trimmed.match(cnHeader);
      const enMatch = !cnMatch && trimmed.match(enHeader);
      const mdMatch = !cnMatch && !enMatch && trimmed.match(mdHeader);

      if (cnMatch || enMatch) {
        if (current) chapters.push(current);
        current = { title: trimmed.replace(/^#+\s*/, '').trim(), contentLines: [] };
      } else if (mdMatch) {
        if (current) chapters.push(current);
        current = { title: mdMatch[1].trim(), contentLines: [] };
      } else {
        if (!current) {
          current = { title: '正文', contentLines: [] };
        }
        current.contentLines.push(rawLine);
      }
    }

    if (current) chapters.push(current);

    return chapters.map((ch) => ({
      title: ch.title,
      content: ch.contentLines.join('\n'),
    }));
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
