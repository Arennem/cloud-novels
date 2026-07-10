/**
 * ── 音频缓存查询 ──
 * GET /novel/audio          → 分页查询小说级别的音频缓存记录。
 * GET /novel/audio/chapter  → 按章节标题查询音频缓存记录。
 */
import type { FastifyInstance } from "fastify";
import { success, fail, paginated } from "../utils/response.js";
import { audioCache } from "../services/audio_cache.js";
import { novelManager } from "../services/novel_manager.js";
import {
  NovelAudioQuerySchema,
  ChapterAudioQuerySchema,
} from "../schemas/novel.schema.js";
import { PaginationSchema } from "../schemas/common.schema.js";
import {
  novelAudioSchema,
  chapterAudioSchema,
} from "../route-schemas/novel-audio.schema.js";

export async function novelAudioRoutes(app: FastifyInstance) {
  // ── 小说音频缓存查询（分页） ──
  app.get("/novel/audio", { schema: novelAudioSchema }, async (request, reply) => {
    const q = NovelAudioQuerySchema.parse(request.query);
    const { pageNum, pageSize } = PaginationSchema.parse(request.query);

    let novelId = q.novel_id;
    if (!novelId && q.novel_title) {
      const novel = novelManager.getByTitle(q.novel_title);
      if (!novel) return reply.status(404).send(fail("小说未找到", 404));
      novelId = novel.id;
    }

    const records = audioCache.listByNovel(novelId!);
    return success({ audio: paginated(records, undefined, pageNum, pageSize) });
  });

  // ── 章节音频缓存查询（分页） ──
  app.get("/novel/audio/chapter", { schema: chapterAudioSchema }, async (request, reply) => {
    const q = ChapterAudioQuerySchema.parse(request.query);
    const { pageNum, pageSize } = PaginationSchema.parse(request.query);

    let novelId = q.novel_id;
    if (q.novel_title) {
      const novel = novelManager.getByTitle(q.novel_title);
      if (!novel) return reply.status(404).send(fail("小说未找到", 404));
      novelId = novel.id;
    }

    const records = audioCache.listByChapterTitle(q.chapter_title, novelId);
    return success({ audio: paginated(records, undefined, pageNum, pageSize) });
  });
}
