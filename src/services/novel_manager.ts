import { randomUUID } from 'crypto';
import { getDb } from '../db/index.js';
import { logger } from '../utils/logger.js';

export interface NovelRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export class NovelManager {
  /**
   * 根据小说名查找或创建 novel 记录
   * 同一标题永远映射到同一个 novel_id
   */
  getOrCreate(title: string): NovelRecord {
    const db = getDb();

    // 按标题精确查找
    let row = db.prepare('SELECT * FROM novels WHERE title = ?').get(title) as NovelRecord | undefined;

    if (row) {
      logger.debug('找到已有小说', { title, novelId: row.id });
      return {
        id: row.id,
        title: row.title,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }

    // 不存在，创建新记录
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO novels (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(id, title, now, now);

    logger.info('创建新小说记录', { title, novelId: id });
    return { id, title, createdAt: now, updatedAt: now };
  }

  /**
   * 按 ID 查询
   */
  getById(id: string): NovelRecord | undefined {
    const row = getDb().prepare('SELECT * FROM novels WHERE id = ?').get(id) as any;
    return row ? this.rowToRecord(row) : undefined;
  }

  /**
   * 按标题查询
   */
  getByTitle(title: string): NovelRecord | undefined {
    const row = getDb().prepare('SELECT * FROM novels WHERE title = ?').get(title) as any;
    return row ? this.rowToRecord(row) : undefined;
  }

  /**
   * 列出所有小说
   */
  listAll(): NovelRecord[] {
    const rows = getDb().prepare('SELECT * FROM novels ORDER BY created_at DESC').all() as any[];
    return rows.map((r) => this.rowToRecord(r));
  }

  /**
   * 删除小说及其级联的角色声音
   */
  delete(id: string): boolean {
    const result = getDb().prepare('DELETE FROM novels WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * 持久化章节列表（先删后插，原子事务）
   */
  saveChapters(novelId: string, chapters: Array<{ title: string; content: string }>): number {
    const db = getDb();
    const insert = db.transaction((items: Array<{ title: string; content: string }>) => {
      db.prepare('DELETE FROM novel_chapters WHERE novel_id = ?').run(novelId);
      const stmt = db.prepare(
        'INSERT INTO novel_chapters (id, novel_id, title, content, sort_order) VALUES (?, ?, ?, ?, ?)',
      );
      for (let i = 0; i < items.length; i++) {
        stmt.run(randomUUID(), novelId, items[i].title, items[i].content, i + 1);
      }
    });
    insert(chapters);
    logger.info('章节已持久化', { novelId, count: chapters.length });
    return chapters.length;
  }

  /**
   * 按 novel_id 查询章节列表（按 sort_order 排序）
   */
  getChapters(novelId: string): Array<{ id: string; title: string; content: string; sortOrder: number }> {
    const rows = getDb().prepare(
      'SELECT id, title, content, sort_order FROM novel_chapters WHERE novel_id = ? ORDER BY sort_order',
    ).all(novelId) as any[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      sortOrder: r.sort_order,
    }));
  }

  /**
   * 根据小说标题查询章节列表
   */
  getChaptersByNovelTitle(title: string): Array<{ id: string; title: string; content: string; sortOrder: number }> | undefined {
    const novel = this.getByTitle(title);
    if (!novel) return undefined;
    return this.getChapters(novel.id);
  }

  private rowToRecord(row: any): NovelRecord {
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const novelManager = new NovelManager();


