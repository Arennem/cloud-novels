import { routeSchema } from "../swagger-helper.js";

export const convertNovelSchema = routeSchema({
  description: "异步提交完整合成流程：角色分析 → 注册声音 → 逐句语音合成。提交后立即返回 task_id，通过 GET /task/:id 查询进度。",
  tags: ["novel"],
  summary: "异步合成语音",
  body: {
    type: "object",
    required: ["novel_title", "chapters"],
    properties: {
      novel_title: { type: "string", description: "小说名称" },
      chapters: { type: "array", items: { type: "object", additionalProperties: true }, description: "章节列表" },
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
});

export const synthesizeNovelSchema = routeSchema({
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
});

export const taskDetailSchema = routeSchema({
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
});

export const taskListSchema = routeSchema({
  description: "分页查询小说的所有合成任务",
  tags: ["novel"],
  summary: "任务列表",
  querystring: {
    type: "object",
    required: ["novel_id"],
    properties: {
      novel_id: { type: "string", description: "小说 ID" },
      pageNum: { type: "integer", default: 1, minimum: 1, description: "页码" },
      pageSize: { type: "integer", default: 10, minimum: 1, maximum: 50, description: "每页条数" },
    },
  },
  response: {
    "200": {
      description: "查询成功",
      data: {
        type: "object",
        properties: { tasks: {
            type: "object",
            properties: {
              total: { type: "integer" },
              pageNum: { type: "integer" },
              pageSize: { type: "integer" },
              list: { type: "array", items: { type: "object", additionalProperties: true } },
            },
          }, },
      },
    },
  },
});


