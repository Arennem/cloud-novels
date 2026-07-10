import { routeSchema } from "../swagger-helper.js";

export const uploadNovelSchema = routeSchema({
  description: "上传小说原始文本，自动解析为章节列表",
  tags: ["novel"],
  summary: "上传文本",
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
              list: { type: "array", items: { type: "object", additionalProperties: true } },
            },
          },
        },
      },
    },
  },
});

export const novelListSchema = routeSchema({
  description: "分页获取所有小说列表",
  tags: ["novel"],
  summary: "小说列表",
  querystring: {
    type: "object",
    properties: {
      pageNum: { type: "integer", default: 1, minimum: 1, description: "页码" },
      pageSize: { type: "integer", default: 10, minimum: 1, maximum: 50, description: "每页条数" },
    },
  },
  response: {
    "200": {
      description: "查询成功",
      data: {
        type: "object",
        properties: {
          novels: {
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

export const novelDetailSchema = routeSchema({
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
});

export const chapterListSchema = routeSchema({
  description: "分页查询小说的章节列表",
  tags: ["novel"],
  summary: "章节列表",
  querystring: {
    type: "object",
    properties: {
      novel_title: { type: "string", description: "小说名称" },
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
        properties: { chapters: {
            type: "object",
            properties: {
              total: { type: "integer" },
              pageNum: { type: "integer" },
              pageSize: { type: "integer" },
              list: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: '章节 ID' },
                    title: { type: 'string', description: '章节标题' },
                    sortOrder: { type: 'integer', description: '排序序号' },
                    audioStatus: { type: 'integer', description: '音频状态: 0=未生成, 1=已生成, 2=生成中, 3=生成失败' },
                  },
                },
              },
            },
          }, },
      },
    },
    "404": { description: "未找到小说或无章节记录" },
  },
});

export const deleteNovelSchema = routeSchema({
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
});
export const chapterDetailSchema = routeSchema({
  description: "按章节 ID 查询章节详细内容",
  tags: ["novel"],
  summary: "章节详情",
  querystring: {
    type: "object",
    required: ["chapter_id"],
    properties: {
      chapter_id: { type: "string", description: "章节 ID" },
    },
  },
  response: {
    "200": { description: "查询成功" },
    "404": { description: "章节未找到" },
  },
});





