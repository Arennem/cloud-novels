import type { FastifyInstance } from "fastify";
import { routeSchema } from "../swagger-helper.js";
import { success, fail, paginated } from "../utils/response.js";
import { audioCache } from "../services/audio_cache.js";
import { novelManager } from "../services/novel_manager.js";
import {
  NovelAudioQuerySchema,
  ChapterAudioQuerySchema,
} from "../schemas/novel.schema.js";

export async function novelAudioRoutes(app: FastifyInstance) {
  // ── 小说音频缓存查询 ──
  app.get("/novel/audio", {
    schema: routeSchema({
      description: "查询小说的音频缓存记录",
      tags: ["novel"],
      summary: "音频缓存查询",
      querystring: {
        type: "object",
        properties: {
          novel_id: { type: "string", description: "小说 ID" },
          novel_title: { type: "string", description: "小说名称" },
        },
      },
      response: {
        "200": {
          description: "查询成功",
          data: {
            type: "object",
            properties: { audio: { type: "object" } },
          },
        },
      },
    }),
  }, async (request, reply) => {
    const q = NovelAudioQuerySchema.parse(request.query);

    let novelId = q.novel_id;
    if (!novelId && q.novel_title) {
      const novel = novelManager.getByTitle(q.novel_title);
      if (!novel) return reply.status(404).send(fail("小说未找到", 404));
      novelId = novel.id;
    }

    const records = audioCache.listByNovel(novelId!);
    return success({ audio: paginated(records) });
  });

  // ── 章节音频缓存查询 ──
  app.get("/novel/audio/chapter", {
    schema: routeSchema({
      description: "按章节名查询音频缓存记录",
      tags: ["novel"],
      summary: "章节音频查询",
      querystring: {
        type: "object",
        required: ["chapter_title"],
        properties: {
          chapter_title: { type: "string", description: "章节标题" },
          novel_id: { type: "string", description: "小说 ID" },
          novel_title: { type: "string", description: "小说名称" },
        },
      },
      response: {
        "200": {
          description: "查询成功",
          data: {
            type: "object",
            properties: { audio: { type: "object" } },
          },
        },
      },
    }),
  }, async (request, reply) => {
    const q = ChapterAudioQuerySchema.parse(request.query);

    let novelId = q.novel_id;
    if (q.novel_title) {
      const novel = novelManager.getByTitle(q.novel_title);
      if (!novel) return reply.status(404).send(fail("小说未找到", 404));
      novelId = novel.id;
    }

    const records = audioCache.listByChapterTitle(q.chapter_title, novelId);
    return success({ audio: paginated(records) });
  });
}
