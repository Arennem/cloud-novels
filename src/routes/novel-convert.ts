/**
 * ── 音频合成任务 ──
 * POST /novel/convert     → 提交完整合成任务（异步）：角色分析 → 注册声音 → 逐句合成。
 * POST /novel/synthesize   → 提交按需合成任务（异步）：仅对已有角色做音频合成。
 * GET  /task/:id           → 查询异步任务详情。
 * GET  /tasks              → 查询某小说的任务列表（分页）。
 */
import type { FastifyInstance } from "fastify";
import { success, fail, paginated } from "../utils/response.js";
import { logger } from "../utils/logger.js";
import { novelManager } from "../services/novel_manager.js";
import { taskManager } from "../services/task_manager.js";
import {
  ConvertRequestSchema,
  SynthesizeRequestSchema,
} from "../schemas/novel.schema.js";
import { PaginationSchema } from "../schemas/common.schema.js";
import {
  convertNovelSchema,
  synthesizeNovelSchema,
  taskDetailSchema,
  taskListSchema,
} from "../route-schemas/novel-convert.schema.js";

export async function novelConvertRoutes(app: FastifyInstance) {
  // ── 提交完整合成任务（异步） ──
  app.post("/novel/convert", { schema: convertNovelSchema }, async (request) => {
    const params = ConvertRequestSchema.parse(request.body);
    const novel = novelManager.getOrCreate(params.novel_title);

    // 持久化章节
    novelManager.saveChapters(novel.id, params.chapters.map((ch: { title?: string; content?: string }, i: number) => ({
      title: ch.title ?? "",
      content: ch.content ?? "",
    })));

    const taskId = taskManager.createAndRun({
      novelId: novel.id,
      taskType: "convert",
      chapterTitles: params.chapters.map((ch: { title?: string }) => ch.title ?? ""),
      outputFormat: params.output_format ?? "mp3",
      merge: params.merge ?? false,
      characterDescriptions: params.character_descriptions,
      characterOverrides: params.character_overrides,
    });

    logger.info("异步合成任务已提交", {
      taskId,
      novelTitle: params.novel_title,
      chapters: params.chapters.length,
    });

    return success({
      task_id: taskId,
      task_status: "pending",
      novel_id: novel.id,
      total_chapters: params.chapters.length,
    });
  });

  // ── 提交按需合成任务（异步） ──
  app.post("/novel/synthesize", { schema: synthesizeNovelSchema }, async (request, reply) => {
    const params = SynthesizeRequestSchema.parse(request.body);

    // 解析 novel_id
    let novelId = params.novel_id;
    if (!novelId && params.novel_title) {
      const novel = novelManager.getByTitle(params.novel_title);
      if (!novel) return reply.status(404).send(fail("小说未找到", 404));
      novelId = novel.id;
    }
    if (!novelId) return reply.status(400).send(fail("novel_id 或 novel_title 必填", 400));

    // 筛选章节
    const allChapters = novelManager.getChapters(novelId);
    if (allChapters.length === 0) {
      return reply.status(404).send(fail("该小说暂无章节记录，请先上传", 404));
    }

    let chaptersToSynthesize: typeof allChapters;
    if (params.all) chaptersToSynthesize = allChapters;
    else if (params.chapter_ids && params.chapter_ids.length > 0) {
      const idSet = new Set(params.chapter_ids);
      chaptersToSynthesize = allChapters.filter((c) => idSet.has(c.id));
    } else if (params.chapter_titles && params.chapter_titles.length > 0) {
      const titleSet = new Set(params.chapter_titles);
      chaptersToSynthesize = allChapters.filter((c) => titleSet.has(c.title));
    } else {
      return reply.status(400).send(fail("请指定 chapter_ids、chapter_titles 或设置 all: true", 400));
    }
    if (chaptersToSynthesize.length === 0) {
      return reply.status(404).send(fail("未找到匹配的章节", 404));
    }

    const taskId = taskManager.createAndRun({
      novelId,
      taskType: "synthesize",
      chapterTitles: chaptersToSynthesize.map((c) => c.title),
      outputFormat: params.output_format ?? "mp3",
      merge: params.merge ?? false,
    });

    logger.info("异步按需合成任务已提交", {
      taskId, novelId, chapters: chaptersToSynthesize.length,
    });

    return success({
      task_id: taskId,
      task_status: "pending",
      novel_id: novelId,
      total_chapters: chaptersToSynthesize.length,
      chapter_titles: chaptersToSynthesize.map((c) => c.title),
    });
  });

  // ── 查询任务详情 ──
  app.get("/task/:id", { schema: taskDetailSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = taskManager.getTask(id);
    if (!task) return reply.status(404).send(fail("任务未找到", 404));
    return success(task);
  });

  // ── 查询小说任务列表（分页） ──
  app.get("/tasks", { schema: taskListSchema }, async (request) => {
    const q = request.query as { novel_id: string; pageNum?: string; pageSize?: string };
    const { pageNum, pageSize } = PaginationSchema.parse(request.query);
    const tasks = taskManager.listTasks(q.novel_id, 10000);
    return success({ tasks: paginated(tasks, undefined, pageNum, pageSize) });
  });
}
