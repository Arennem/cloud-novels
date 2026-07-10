import { routeSchema } from "../swagger-helper.js";

export const analyzeCharactersSchema = routeSchema({
  description: "对已有章节进行 LLM 角色分析，不含语音合成",
  tags: ["novel"],
  summary: "角色分析",
  body: {
    type: "object",
    required: ["novel_title", "chapters"],
    properties: {
      novel_title: { type: "string", description: "小说名称" },
      chapters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            content: { type: "string" },
          },
        },
        description: "章节列表",
      },
      character_descriptions: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "可选的角色声音描述，key 为角色名，value 为声音特征描述",
      },
    },
  },
  response: {
    "200": {
      description: "分析完成",
      data: {
        type: "object",
        properties: {
          characters: {
            type: "object",
            properties: {
              total: { type: "integer" },
              list: { type: "array", items: { type: "object", additionalProperties: true } },
              pageNum: { type: "integer" },
              pageSize: { type: "integer" },
            },
          },
        },
      },
    },
  },
});

export const uploadAndAnalyzeSchema = routeSchema({
  description: "上传小说文本并立即进行角色分析，一步完成",
  tags: ["novel"],
  summary: "上传并分析角色",
  response: {
    "200": {
      description: "上传并分析成功",
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
              list: { type: "array", items: { type: "object", additionalProperties: true } },
            },
          },
          characters: {
            type: "object",
            properties: {
              total: { type: "integer" },
              pageNum: { type: "integer" },
              pageSize: { type: "integer" },
              list: { type: "array", items: { type: "object", additionalProperties: true } },
            },
          },
        },
      },
    },
  },
});



