import type { FastifyInstance } from "fastify";
import { routeSchema } from "../swagger-helper.js";
import { success, fail, paginated } from "../utils/response.js";
import { parseUploadRequest } from "../utils/request-parser.js";
import { logger } from "../utils/logger.js";
import { novelManager } from "../services/novel_manager.js";
import { textSplitter } from "../services/text_splitter.js";
import {
  UploadRequestSchema,
  NovelQuerySchema,
  ChapterQuerySchema,
} from "../schemas/novel.schema.js";

export async function novelRoutes(app: FastifyInstance) {
  // ── 上传：原始文本 → 解析章节 ──
  app.post("/novel/upload", {
    schema: routeSchema({
      description: "上传小说原始文本，自动解析为章节列表",
      tags: ["novel"],
      summary: "上传文本",
      body: {
        type: "object",
        required: ["novel_title"],
        properties: {
          novel_title: { type: "string", description: "小说名称" },
          content: { type: "string", description: "小说文本内容" },
        },
      },
      response: {
        "200": {
          description: "解析成功",
          data: {
            type: "object",
            properties: {
              novel_title: { type: "string" },
              chapters: {
                type: "object",
                properties: {
                  total: { type: "integer" },
                  pageNum: { type: "integer" },
                  pageSize: { type: "integer" },
                  list: { type: "array", items: { type: "object" } },
                },
              },
            },
          },
        },
      },
    }),
  }, async (request) => {
    const { fields, fileContent } = await parseUploadRequest(request);
    const content = fileContent ?? fields["content"] ?? "";
    const params = UploadRequestSchema.parse({ novel_title: fields["novel_title"], content });

    const chapters = textSplitter.parseChaptersFromText(params.content);

    logger.info("上传文本解析完成", {
      novel_title: params.novel_title,
      chapter_count: chapters.length,
      total_chars: params.content.length,
    });

    const novel = novelManager.getOrCreate(params.novel_title);
    novelManager.saveChapters(novel.id, chapters);

    return success({
      novel_title: params.novel_title,
      chapters: paginated(chapters),
    });
  });

  // ── 小说列表 ──
  app.get("/novels", {
    schema: routeSchema({
      description: "获取所有小说列表",
      tags: ["novel"],
      summary: "小说列表",
      response: {
        "200": {
          description: "查询成功",
          data: {
            type: "object",
            properties: { novels: { type: "object" } },
          },
        },
      },
    }),
  }, async () => {
    const novels = novelManager.listAll();
    return success({ novels: paginated(novels) });
  });

  // ── 小说详情 ──
  app.get("/novel", {
    schema: routeSchema({
      description: "按 ID 查询小说详情",
      tags: ["novel"],
      summary: "小说详情",
      querystring: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "小说 ID" },
        },
      },
      response: {
        "200": { description: "查询成功" },
        "404": { description: "小说未找到" },
      },
    }),
  }, async (request, reply) => {
    const { id } = NovelQuerySchema.parse(request.query);
    const novel = novelManager.getById(id);
    if (!novel) return reply.status(404).send(fail("小说未找到", 404));
    return success(novel);
  });

  // ── 章节列表 ──
  app.get("/novel/chapters", {
    schema: routeSchema({
      description: "查询小说的章节列表",
      tags: ["novel"],
      summary: "章节列表",
      querystring: {
        type: "object",
        properties: {
          novel_title: { type: "string", description: "小说名称" },
          novel_id: { type: "string", description: "小说 ID" },
        },
      },
      response: {
        "200": {
          description: "查询成功",
          data: {
            type: "object",
            properties: { chapters: { type: "object" } },
          },
        },
        "404": { description: "未找到小说或无章节记录" },
      },
    }),
  }, async (request, reply) => {
    const q = ChapterQuerySchema.parse(request.query);

    let novelId = q.novel_id;
    if (!novelId && q.novel_title) {
      const novel = novelManager.getByTitle(q.novel_title);
      if (!novel) return reply.status(404).send(fail("小说未找到", 404));
      novelId = novel.id;
    }

    const chapters = novelManager.getChapters(novelId!);
    if (chapters.length === 0) {
      return reply.status(404).send(fail("该小说暂无章节记录，请先上传", 404));
    }
    return success({ chapters: paginated(chapters) });
  });

  // ── 删除小说 ──
  app.post("/novel/delete", {
    schema: routeSchema({
      description: "按 ID 删除小说及其相关数据",
      tags: ["novel"],
      summary: "删除小说",
      body: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "小说 ID" },
        },
      },
      response: {
        "200": {
          description: "删除成功",
          data: { type: "object", properties: { novel_id: { type: "string" } } },
        },
        "404": { description: "小说未找到" },
      },
    }),
  }, async (request, reply) => {
    const { id } = NovelQuerySchema.parse(request.body);
    const deleted = novelManager.delete(id);
    if (!deleted) return reply.status(404).send(fail("小说未找到", 404));
    return success({ novel_id: id });
  });
}

