import type { FastifyInstance } from "fastify";
import { routeSchema } from "../swagger-helper.js";
import { success, fail } from "../utils/response.js";
import { logger } from "../utils/logger.js";
import { novelManager } from "../services/novel_manager.js";
import { taskManager } from "../services/task_manager.js";
import {
  ConvertRequestSchema,
  SynthesizeRequestSchema,
} from "../schemas/novel.schema.js";

export async function novelConvertRoutes(app: FastifyInstance) {
  // ── 提交完整合成任务（异步） ──
  app.post("/novel/convert", {
    schema: routeSchema({
      description: "异步提交完整合成流程：角色分析 → 注册声音 → 逐句语音合成。提交后立即返回 task_id，通过 GET /task/:id 查询进度。",
      tags: ["novel"],
      summary: "异步合成语音",
      body: {
        type: "object",
        required: ["novel_title", "chapters"],
        properties: {
          novel_title: { type: "string", description: "小说名称" },
          chapters: { type: "array", items: { type: "object" }, description: "章节列表" },
          output_format: { type: "string", enum: ["wav", "mp3", "pcm"], default: "mp3" },
          merge: { type: "boolean", default: false, description: "是否合并为单个音频文件" },
          cache: { type: "boolean", default: true, description: "是否使用音频缓存" },
          character_descriptions: { type: "object", additionalProperties: { type: "string" }, description: "角色声音描述" },
          character_overrides: { type: "object", description: "角色画像覆盖" },
        },
      },
      response: {
        "200": {
          description: "任务已创建",
          data: {
            type: "object",
            properties: {
              task_id: { type: "string", format: "uuid" },
              task_status: { type: "string", enum: ["pending"] },
              novel_id: { type: "string" },
              total_chapters: { type: "integer" },
            },
          },
        },
      },
    }),
  }, async (request) => {
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
  app.post("/novel/synthesize", {
    schema: routeSchema({
      description: "异步提交按需合成章节音频。提交后立即返回 task_id，通过 GET /task/:id 查询进度。",
      tags: ["novel"],
      summary: "异步合成章节音频",
      body: {
        type: "object",
        properties: {
          novel_id: { type: "string", description: "小说 ID（与 novel_title 二选一）" },
          novel_title: { type: "string", description: "小说名称（与 novel_id 二选一）" },
          chapter_ids: { type: "array", items: { type: "string" }, description: "章节 ID 列表" },
          chapter_titles: { type: "array", items: { type: "string" }, description: "章节标题列表" },
          all: { type: "boolean", default: false, description: "是否合成全部章节" },
          output_format: { type: "string", enum: ["wav", "mp3", "pcm"], default: "mp3" },
          merge: { type: "boolean", default: false, description: "是否合并为单个音频文件" },
          cache: { type: "boolean", default: true, description: "是否使用音频缓存" },
        },
      },
      response: {
        "200": {
          description: "任务已创建",
          data: {
            type: "object",
            properties: {
              task_id: { type: "string", format: "uuid" },
              task_status: { type: "string", enum: ["pending"] },
              novel_id: { type: "string" },
              total_chapters: { type: "integer" },
              chapter_titles: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    }),
  }, async (request, reply) => {
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
  app.get("/task/:id", {
    schema: routeSchema({
      description: "查询合成任务详情，含每章进度和结果",
      tags: ["novel"],
      summary: "任务详情",
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "任务 ID" },
        },
      },
      response: {
        "200": { description: "查询成功" },
        "404": { description: "任务未找到" },
      },
    }),
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = taskManager.getTask(id);
    if (!task) return reply.status(404).send(fail("任务未找到", 404));
    return success(task);
  });

  // ── 查询小说任务列表 ──
  app.get("/tasks", {
    schema: routeSchema({
      description: "查询小说的所有合成任务",
      tags: ["novel"],
      summary: "任务列表",
      querystring: {
        type: "object",
        required: ["novel_id"],
        properties: {
          novel_id: { type: "string", description: "小说 ID" },
          limit: { type: "integer", default: 20, description: "返回条数" },
        },
      },
      response: {
        "200": {
          description: "查询成功",
          data: {
            type: "object",
            properties: { tasks: { type: "object" } },
          },
        },
      },
    }),
  }, async (request) => {
    const q = request.query as { novel_id: string; limit?: string };
    const tasks = taskManager.listTasks(q.novel_id, q.limit ? parseInt(q.limit) : 20);
    return success({ tasks: { list: tasks, total: tasks.length } });
  });
}
