import type { FastifyInstance } from "fastify";
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
import { PaginationSchema } from "../schemas/common.schema.js";
import {
  uploadNovelSchema,
  novelListSchema,
  novelDetailSchema,
  chapterListSchema,
  deleteNovelSchema,
} from "../route-schemas/novel.schema.js";

export async function novelRoutes(app: FastifyInstance) {
  // ── 上传：原始文本 → 解析章节 ──
  app.post("/novel/upload", { schema: uploadNovelSchema }, async (request, reply) => {
    const { fields, fileContent } = await parseUploadRequest(request);
    const content = fileContent ?? fields["content"] ?? "";
    if (!content) {
      return reply.status(422).send(fail("请提供小说内容（JSON 的 content 字段或 multipart 的 file 字段）", 422));
    }
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
      chapter_count: chapters.length,
    });
  });

  // ── 小说列表（分页） ──
  app.get("/novels", { schema: novelListSchema }, async (request) => {
    const { pageNum, pageSize } = PaginationSchema.parse(request.query);
    const novels = novelManager.listAll();
    return success({ novels: paginated(novels, undefined, pageNum, pageSize) });
  });

  // ── 小说详情 ──
  app.get("/novel", { schema: novelDetailSchema }, async (request, reply) => {
    const { id } = NovelQuerySchema.parse(request.query);
    const novel = novelManager.getById(id);
    if (!novel) return reply.status(404).send(fail("小说未找到", 404));
    return success(novel);
  });

  // ── 章节列表（分页） ──
  app.get("/novel/chapters", { schema: chapterListSchema }, async (request, reply) => {
    const q = ChapterQuerySchema.parse(request.query);
    const { pageNum, pageSize } = PaginationSchema.parse(request.query);

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
    return success({ chapters: paginated(chapters, undefined, pageNum, pageSize) });
  });

  // ── 删除小说 ──
  app.post("/novel/delete", { schema: deleteNovelSchema }, async (request, reply) => {
    const { id } = NovelQuerySchema.parse(request.body);
    const deleted = novelManager.delete(id);
    if (!deleted) return reply.status(404).send(fail("小说未找到", 404));
    return success({ novel_id: id });
  });
}
