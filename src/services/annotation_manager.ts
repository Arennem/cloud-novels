import { randomUUID } from "crypto";
import { getDb } from "../db/index.js";
import { logger } from "../utils/logger.js";
import { scriptAnnotator } from "./script_annotator.js";
import { computeContentHash } from "./audio_cache.js";
import { ChapterAnnotationSchema } from "../schemas/annotation.schema.js";

/* ───────── 行类型 ───────── */
interface AnnotationRow {
  id: string;
  novel_id: string;
  chapter_title: string;
  content_hash: string;
  annotation_status: string;
  annotation_data: string | null;
  annotation_error: string | null;
  annotation_attempts: number;
  annotation_started_at: string | null;
  annotation_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type AnnotationStatus = "pending" | "processing" | "done" | "failed";

export interface AnnotationResult {
  status: AnnotationStatus;
  segments?: { speaker: string; text: string; emotion?: string }[];
  error?: string;
}

/* ───────── 常量 ───────── */
const MAX_RETRIES = 2;

export class AnnotationManager {
  /**
   * 获取或创建 annotation_jobs 行，返回当前状态。
   * 如果已有 done 且 content_hash 匹配，直接返回缓存的标注结果。
   */
  private getOrCreateRow(
    novelId: string, chapterTitle: string, contentHash: string,
  ): AnnotationRow {
    const db = getDb();

    // 尝试读已有行
    const existing = db.prepare(
      "SELECT * FROM annotation_jobs WHERE novel_id = ? AND chapter_title = ? AND content_hash = ?"
    ).get(novelId, chapterTitle, contentHash) as AnnotationRow | undefined;

    if (existing) return existing;

    // 插入新行（仅当 hash 不同时；若 hash 变了但旧行存在，也新建）
    const id = randomUUID();
    const now = new Date().toISOString();

    // 如果有旧行（不同 content_hash），说明内容已变更，标记旧行失效
    const oldRow = db.prepare(
      "SELECT * FROM annotation_jobs WHERE novel_id = ? AND chapter_title = ?"
    ).get(novelId, chapterTitle) as AnnotationRow | undefined;

    if (oldRow && oldRow.content_hash !== contentHash) {
      db.prepare(
        "UPDATE annotation_jobs SET annotation_status = 'failed', annotation_error = ?, updated_at = ? WHERE id = ?"
      ).run("内容已变更，旧标注失效", now, oldRow.id);
    }

    db.prepare(`
      INSERT INTO annotation_jobs (id, novel_id, chapter_title, content_hash, annotation_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, novelId, chapterTitle, contentHash, now, now);

    return {
      id, novel_id: novelId, chapter_title: chapterTitle,
      content_hash: contentHash, annotation_status: "pending",
      annotation_data: null, annotation_error: null,
      annotation_attempts: 0,
      annotation_started_at: null, annotation_completed_at: null,
      created_at: now, updated_at: now,
    };
  }

  /**
   * 尝试锁定并执行一章的标注。
   * - pending → 尝试原子锁，锁定后调 LLM
   * - processing → 有人正在处理，跳过
   * - done → 直接返回缓存结果
   * - failed → 返回失败状态
   */
  async annotate(
    novelId: string, chapterTitle: string, content: string,
  ): Promise<AnnotationResult> {
    const contentHash = computeContentHash(content);
    const row = this.getOrCreateRow(novelId, chapterTitle, contentHash);

    // ── 缓存命中 ──
    if (row.annotation_status === "done" && row.annotation_data) {
      try {
        const segments = JSON.parse(row.annotation_data);
        logger.info("标注缓存命中", { novelId, chapter: chapterTitle });
        return { status: "done", segments };
      } catch {
        // JSON 损坏，重新标注
        logger.warn("标注缓存损坏，重新标注", { novelId, chapter: chapterTitle });
      }
    }

    // ── 快速失败：已失败或正在处理 ──
    if (row.annotation_status === "failed") {
      return { status: "failed", error: row.annotation_error ?? "标注失败" };
    }
    if (row.annotation_status === "processing") {
      return { status: "processing", error: "其他请求正在标注此章节" };
    }

    // ── 原子锁 ──
    const now = new Date().toISOString();
    const db = getDb();
    const lockResult = db.prepare(`
      UPDATE annotation_jobs
      SET annotation_status = 'processing',
          annotation_started_at = ?,
          updated_at = ?
      WHERE novel_id = ? AND chapter_title = ? AND content_hash = ?
        AND annotation_status = 'pending'
    `).run(now, now, novelId, chapterTitle, contentHash);

    if (lockResult.changes === 0) {
      // 锁已被其他进程拿走
      return { status: "processing", error: "其他请求正在标注此章节" };
    }

    // ── 执行标注（含重试） ──
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const segments = await scriptAnnotator.annotateChapter(chapterTitle, content);

        // 写回 DB
        db.prepare(`
          UPDATE annotation_jobs
          SET annotation_status = 'done',
              annotation_data = ?,
              annotation_attempts = annotation_attempts + 1,
              annotation_completed_at = ?,
              updated_at = ?
          WHERE id = ?
        `).run(JSON.stringify(segments), now, now, row.id);

        logger.info("章节标注完成并已落库", {
          novelId, chapter: chapterTitle, segments: segments.length,
        });

        return { status: "done", segments };
      } catch (err) {
        const errorMsg = String(err);
        logger.warn("章节标注失败", {
          novelId, chapter: chapterTitle, attempt, error: errorMsg,
        });

        // 更新尝试次数
        db.prepare(`
          UPDATE annotation_jobs
          SET annotation_attempts = annotation_attempts + 1,
              annotation_error = ?,
              updated_at = ?
          WHERE id = ?
        `).run(errorMsg, now, row.id);

        if (attempt < MAX_RETRIES) continue;

        // ── 重试耗尽，标记失败 ──
        db.prepare(`
          UPDATE annotation_jobs
          SET annotation_status = 'failed',
              annotation_error = ?,
              annotation_completed_at = ?,
              updated_at = ?
          WHERE id = ?
        `).run(errorMsg, now, now, row.id);

        logger.error("章节标注超过最大重试次数", {
          novelId, chapter: chapterTitle, maxRetries: MAX_RETRIES, error: errorMsg,
        });

        return { status: "failed", error: errorMsg };
      }
    }

    // unreachable
    return { status: "failed", error: "未知错误" };
  }

  /**
   * 查询章节的标注状态（不触发锁定）
   */
  getStatus(novelId: string, chapterTitle: string): AnnotationStatus {
    const db = getDb();
    const row = db.prepare(
      "SELECT annotation_status FROM annotation_jobs WHERE novel_id = ? AND chapter_title = ? ORDER BY updated_at DESC LIMIT 1"
    ).get(novelId, chapterTitle) as { annotation_status: string } | undefined;
    return (row?.annotation_status as AnnotationStatus) ?? "pending";
  }

  /**
   * 重置失败状态（允许重新标注）
   */
  resetFailed(novelId: string, chapterTitle: string): boolean {
    const db = getDb();
    const result = db.prepare(`
      UPDATE annotation_jobs
      SET annotation_status = 'pending',
          annotation_error = NULL,
          annotation_attempts = 0,
          updated_at = ?
      WHERE novel_id = ? AND chapter_title = ? AND annotation_status = 'failed'
    `).run(new Date().toISOString(), novelId, chapterTitle);
    return result.changes > 0;
  }
}

export const annotationManager = new AnnotationManager();
