import { routeSchema } from "../swagger-helper.js";

export const characterListSchema = routeSchema({
  description: "分页列出角色列表，可按 novel_id 过滤",
  tags: ["character"],
  summary: "角色列表",
  querystring: {
    type: "object",
    properties: {
      novel_id: { type: "string", description: "小说 ID（可选，不传则返回全部角色）" },
      pageNum: { type: "integer", default: 1, minimum: 1, description: "页码" },
      pageSize: { type: "integer", default: 10, minimum: 1, maximum: 50, description: "每页条数" },
    },
  },
  response: {
    "200": {
      description: "查询成功",
      data: {
        type: "object",
        properties: { characters: {
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

export const characterDeleteSchema = routeSchema({
  description: "删除指定小说的指定角色",
  tags: ["character"],
  summary: "删除角色",
  body: {
    type: "object",
    required: ["novel_id", "role_name"],
    properties: {
      novel_id: { type: "string", description: "小说 ID" },
      role_name: { type: "string", description: "角色名" },
    },
  },
  response: {
    "200": { description: "删除成功", data: { type: "object", properties: { role_name: { type: "string" } } } },
    "404": { description: "角色未找到" },
  },
});

export const characterDetailSchema = routeSchema({
  description: "获取单个角色的完整信息，包括角色画像（voice_description / voice_prompt）和音色 ID",
  tags: ["character"],
  summary: "角色详情",
  querystring: {
    type: "object",
    required: ["novel_id", "role_name"],
    properties: {
      novel_id: { type: "string", description: "小说 ID" },
      role_name: { type: "string", description: "角色名" },
    },
  },
  response: {
    "200": { description: "查询成功" },
    "404": { description: "角色未找到" },
  },
});

export const characterUpdateSchema = routeSchema({
  description: "更新角色画像（如 voice_description / voice_prompt），用于人工微调后重新生成音色。更新不会自动调用 CosyVoice，需再调 regenerate。",
  tags: ["character"],
  summary: "更新画像",
  body: {
    type: "object",
    required: ["novel_id", "role_name", "portrait"],
    properties: {
      novel_id: { type: "string", description: "小说 ID" },
      role_name: { type: "string", description: "角色名" },
      portrait: { type: "object", description: "完整的角色画像，覆盖存储" },
    },
  },
  response: {
    "200": { description: "更新成功" },
    "404": { description: "角色未找到" },
  },
});

export const registerSpeakersSchema = routeSchema({
  description: "从已存储的章节中通过 LLM 分析角色，注册所有角色声音到 CosyVoice。这是手动流程的第一步，需先上传小说文本。",
  tags: ["novel"],
  summary: "注册角色声音",
  body: {
    type: "object",
    properties: {
      novel_id: { type: "string", description: "小说 ID（与 novel_title 二选一）" },
      novel_title: { type: "string", description: "小说名称（与 novel_id 二选一）" },
      character_descriptions: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "可选的角色声音描述，key 为角色名，value 为声音特征描述",
      },
    },
  },
  response: {
    "200": {
      description: "注册完成",
      data: {
        type: "object",
        properties: {
          novel_id: { type: "string" },
          characters_registered: { type: "array", items: { type: "string" } },
          character_analysis: { type: "array", items: { type: "object", additionalProperties: true } },
          chapters_available: { type: "integer" },
        },
      },
    },
  },
});

export const regenerateSpeakerSchema = routeSchema({
  description: "删除并重新生成指定角色的声音。适用于对当前音色不满意时重新生成。",
  tags: ["novel"],
  summary: "重新生成角色声音",
  body: {
    type: "object",
    required: ["novel_id", "role_name"],
    properties: {
      novel_id: { type: "string", description: "小说 ID" },
      role_name: { type: "string", description: "角色名" },
      portrait_override: { type: "object", description: "可选的角色画像覆盖" },
    },
  },
  response: {
    "200": {
      description: "重新生成成功",
      data: {
        type: "object",
        properties: {
          novel_id: { type: "string" },
          role_name: { type: "string" },
          base_voice: { type: "string" },
          speaker_id: { type: "string" },
        },
      },
    },
  },
});




export const generateCharactersSchema = routeSchema({
  description: "根据小说 ID 从已存储章节中通过 LLM 分析生成角色画像（含对话粗筛，不含声音注册）。",
  tags: ["character"],
  summary: "从小说生成角色",
  body: {
    type: "object",
    required: ["novel_id"],
    properties: {
      novel_id: { type: "string", description: "小说 ID" },
    },
  },
  response: {
    "200": {
      description: "生成成功",
      data: {
        type: "object",
        properties: {
          novel_id: { type: "string" },
          character_count: { type: "integer" },
          characters: { type: "array", items: { type: "object", additionalProperties: true } },
        },
      },
    },
  },
});
