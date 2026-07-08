import { createHash, randomUUID } from 'crypto';
import { readFileSync, appendFileSync, writeFileSync, existsSync, unlinkSync, renameSync } from 'fs';
import { join, resolve } from 'path';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { ensureDir } from '../utils/file.js';
import { logger } from '../utils/logger.js';

export interface ChapterAudioRecord {
  id: string;
  novel_id: string;
  chapter_title: string;
  content_hash: string;
  format: string;
  file_path: string;
  duration_seconds: number | null;
  created_at: string;
}

export type AudioRecordWithNovel = ChapterAudioRecord & { novel_title: string };

/**
 * 计算章节内容的哈希值，用于检测内容是否已变更
 */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export class AudioCacheService {
  /**
   * 按 novel_id 列出该小说所有已缓存的章节音频记录。
   * 返回结果附带小说标题，按章节标题排序。
   */
  listByNovel(novelId: string): AudioRecordWithNovel[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT a.*, n.title AS novel_title
      FROM audio_cache a
      JOIN novels n ON n.id = a.novel_id
      WHERE a.novel_id = ?
      ORDER BY a.chapter_title
    `).all(novelId) as any[];

    return rows as AudioRecordWithNovel[];
  }


  /**
   * 按章节标题查询音频缓存记录。
   * 可传入 novel_id 或 novel_title 缩小范围（二选一，不传则全局搜索）。
   * 支持模糊匹配（LIKE %title%）。
   */
  listByChapterTitle(chapterTitle: string, novelId?: string): AudioRecordWithNovel[] {
    const db = getDb();
    let sql = `
      SELECT a.*, n.title AS novel_title
      FROM audio_cache a
      JOIN novels n ON n.id = a.novel_id
    `;
    const params: any[] = [];

    if (novelId) {
      sql += ` WHERE a.novel_id = ? AND a.chapter_title LIKE ?`;
      params.push(novelId, `%${chapterTitle}%`);
    } else {
      sql += ` WHERE a.chapter_title LIKE ?`;
      params.push(`%${chapterTitle}%`);
    }

    sql += ` ORDER BY n.title, a.chapter_title`;

    const rows = db.prepare(sql).all(...params) as any[];
    return rows as AudioRecordWithNovel[];
  }

  /**  /**
   * 按小说 + 章节名查找已缓存的章节音频。
   * 如果内容哈希匹配且文件存在，返回音频 Buffer；否则返回 null。
   * 同时会清理上一轮残留的 .tmp 文件。
   */
  getChapterAudio(novelId: string, chapterTitle: string, contentHash: string): Buffer | null {
    const db = getDb();
    const row = db.prepare(
      'SELECT * FROM audio_cache WHERE novel_id = ? AND chapter_title = ?',
    ).get(novelId, chapterTitle) as ChapterAudioRecord | undefined;

    if (!row) {
      logger.debug('章节音频缓存未命中（无记录）', { chapter: chapterTitle });
      // 清除可能残留的 tmp 文件
      this._cleanStaleTemp(novelId, chapterTitle, 'mp3');
      return null;
    }

    // 内容已变更 → 缓存失效，清理旧记录和文件
    if (row.content_hash !== contentHash) {
      logger.info('章节内容已变更，缓存失效', { chapter: chapterTitle });
      this._deleteRecord(row);
      return null;
    }

    const absPath = resolve(row.file_path);
    if (!existsSync(absPath)) {
      logger.warn('缓存记录存在但文件已丢失，清理', { chapter: chapterTitle, path: absPath });
      this._deleteRecord(row);
      return null;
    }

    logger.info('章节音频缓存命中', { chapter: chapterTitle, path: absPath });
    return readFileSync(absPath);
  }

  // ---- 增量追加 API ------------------------------------------------

  /**
   * 准备开始合成一个章节。
   * 清除上一轮可能残留的 .tmp 文件，返回 .tmp 文件路径。
   * 调用方应把每段合成的音频通过 appendSegment() 追加到此文件。
   */
  startChapterAudio(novelId: string, chapterTitle: string, format: string): string {
    const { dir, temp } = this._resolvePaths(novelId, chapterTitle, format);
    ensureDir(dir);
    if (existsSync(temp)) {
      logger.warn('清除上一轮残留的临时文件', { temp });
      unlinkSync(temp);
    }
    return temp;
  }

  /**
   * 追加一段音频到临时文件。
   * 可反复调用，每段都会追加到文件末尾。
   * 如果文件还不存在，会自动创建。
   */
  appendSegment(filePath: string, audioBuffer: Buffer): void {
    appendFileSync(filePath, audioBuffer);
  }

  /**
   * 完成章节合成：将 .tmp 文件原子重命名为最终文件，并写入缓存记录。
   * 只有重命名成功后才会更新数据库。
   * 如果中途崩溃，只有 .tmp 文件残留，下次 startChapterAudio 会清理它。
   *
   * @returns 最终文件路径
   */
  finalizeChapterAudio(
    novelId: string,
    chapterTitle: string,
    contentHash: string,
    format: string,
    tempPath: string,
    durationSeconds?: number,
  ): string {
    const { final: finalPath, temp: expectedTemp } = this._resolvePaths(novelId, chapterTitle, format);

    // 确保传入的是正确的临时路径（防御性检查）
    const actualTemp = resolve(tempPath);
    if (actualTemp !== resolve(expectedTemp)) {
      throw new Error(`临时路径不匹配: 期望 ${expectedTemp}, 收到 ${actualTemp}`);
    }

    // 原子重命名（同一文件系统，原子操作）
    renameSync(actualTemp, finalPath);
    logger.info('章节音频已完成', { chapter: chapterTitle, path: finalPath });

    // 更新数据库
    const db = getDb();
    db.prepare('DELETE FROM audio_cache WHERE novel_id = ? AND chapter_title = ?').run(novelId, chapterTitle);
    db.prepare(`
      INSERT INTO audio_cache (id, novel_id, chapter_title, content_hash, format, file_path, duration_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      novelId,
      chapterTitle,
      contentHash,
      format,
      finalPath,
      durationSeconds ?? null,
    );

    return finalPath;
  }

  /**
   * 保存整章的合成音频到缓存（一次性保存，非增量追加时使用）。
   */
  saveChapterAudio(
    novelId: string,
    chapterTitle: string,
    contentHash: string,
    audioBuffer: Buffer,
    format: string,
    durationSeconds?: number,
  ): Buffer {
    // 先写入 .tmp，再原子重命名，保证完整性
    const { dir, final: finalPath, temp: tempPath } = this._resolvePaths(novelId, chapterTitle, format);
    ensureDir(dir);
    writeFileSync(tempPath, audioBuffer);
    renameSync(tempPath, finalPath);
    logger.info('章节音频已保存', { chapter: chapterTitle, path: finalPath, size: audioBuffer.length });

    const db = getDb();
    db.prepare('DELETE FROM audio_cache WHERE novel_id = ? AND chapter_title = ?').run(novelId, chapterTitle);
    db.prepare(`
      INSERT INTO audio_cache (id, novel_id, chapter_title, content_hash, format, file_path, duration_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      novelId,
      chapterTitle,
      contentHash,
      format,
      finalPath,
      durationSeconds ?? null,
    );

    return audioBuffer;
  }

  // ---- 缓存管理 ----------------------------------------------------

  clearByNovel(novelId: string): number {
    const db = getDb();
    const rows = db.prepare('SELECT file_path FROM audio_cache WHERE novel_id = ?').all(novelId) as { file_path: string }[];
    for (const row of rows) {
      this._deleteFile(row.file_path);
      // 也清理对应的 .tmp
      const tmpPath = row.file_path + '.tmp';
      this._deleteFile(tmpPath);
    }
    const result = db.prepare('DELETE FROM audio_cache WHERE novel_id = ?').run(novelId);
    logger.info('已清除小说所有章节缓存', { novelId, count: result.changes });
    return result.changes;
  }

  clearAll(): number {
    const db = getDb();
    const rows = db.prepare('SELECT file_path FROM audio_cache').all() as { file_path: string }[];
    for (const row of rows) {
      this._deleteFile(row.file_path);
      this._deleteFile(row.file_path + '.tmp');
    }
    const result = db.prepare('DELETE FROM audio_cache').run();
    logger.info('已清除全部章节缓存', { count: result.changes });
    return result.changes;
  }

  // ---- 内部方法 ----------------------------------------------------

  private _resolvePaths(novelId: string, chapterTitle: string, format: string) {
    const ext = format === 'mp3' ? 'mp3' : format === 'wav' ? 'wav' : 'pcm';
    const dir = resolve(config.OUTPUT_DIR, 'audio');
    const name = `${novelId.slice(0, 8)}-${this._sanitizeFilename(chapterTitle)}`;
    return {
      dir,
      final: join(dir, `${name}.${ext}`),
      temp:  join(dir, `${name}.${ext}.tmp`),
    };
  }

  private _cleanStaleTemp(novelId: string, chapterTitle: string, format: string): void {
    const { temp } = this._resolvePaths(novelId, chapterTitle, format);
    if (existsSync(temp)) {
      logger.warn('发现残留临时文件，清理', { temp });
      unlinkSync(temp);
    }
  }

  private _deleteRecord(row: ChapterAudioRecord): void {
    this._deleteFile(row.file_path);
    this._deleteFile(row.file_path + '.tmp');
    getDb().prepare('DELETE FROM audio_cache WHERE id = ?').run(row.id);
  }

  private _deleteFile(filePath: string): void {
    try {
      const absPath = resolve(filePath);
      if (existsSync(absPath)) unlinkSync(absPath);
    } catch { /* 忽略单个文件删除失败 */ }
  }

  private _sanitizeFilename(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
  }
}

export const audioCache = new AudioCacheService();
