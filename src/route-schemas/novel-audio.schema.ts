import { routeSchema } from "../swagger-helper.js";

export const novelAudioSchema = routeSchema({
  description: "分页查询小说的音频缓存记录",
  tags: ["novel"],
  summary: "音频缓存查询",
  querystring: {
    type: "object",
    properties: {
      novel_id: { type: "string", description: "小说 ID" },
      novel_title: { type: "string", description: "小说名称" },
      pageNum: { type: "integer", default: 1, minimum: 1, description: "页码" },
      pageSize: { type: "integer", default: 10, minimum: 1, maximum: 50, description: "每页条数" },
    },
  },
  response: {
    "200": {
      description: "查询成功",
      data: {
        type: "object",
        properties: { audio: {
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

export const chapterAudioSchema = routeSchema({
  description: "按章节名分页查询音频缓存记录",
  tags: ["novel"],
  summary: "章节音频查询",
  querystring: {
    type: "object",
    required: ["chapter_title"],
    properties: {
      chapter_title: { type: "string", description: "章节标题" },
      novel_id: { type: "string", description: "小说 ID" },
      novel_title: { type: "string", description: "小说名称" },
      pageNum: { type: "integer", default: 1, minimum: 1, description: "页码" },
      pageSize: { type: "integer", default: 10, minimum: 1, maximum: 50, description: "每页条数" },
    },
  },
  response: {
    "200": {
      description: "查询成功",
      data: {
        type: "object",
        properties: { audio: {
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


