import { routeSchema } from "../swagger-helper.js";

export const notificationListSchema = routeSchema({
  description: "分页查询通知列表，可按小说筛选，支持未读过滤",
  tags: ["system"],
  summary: "通知列表",
  querystring: {
    type: "object",
    properties: {
      novel_id: { type: "string", description: "小说 ID（可选）" },
      unread_only: { type: "boolean", default: false, description: "是否仅查未读" },
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
          notifications: {
            type: "object",
            properties: {
              total: { type: "integer" },
              pageNum: { type: "integer" },
              pageSize: { type: "integer" },
              list: { type: "array", items: { type: "object", additionalProperties: true } },
            },
          },
          unread_count: { type: "integer" },
        },
      },
    },
  },
});

export const notificationReadSchema = routeSchema({
  description: "标记指定通知为已读",
  tags: ["system"],
  summary: "标记已读",
  body: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", description: "通知 ID" },
    },
  },
  response: {
    "200": { description: "操作成功", data: { type: "object", properties: { id: { type: "string" } } } },
  },
});

export const notificationReadAllSchema = routeSchema({
  description: "标记某小说的全部通知为已读",
  tags: ["system"],
  summary: "全部已读",
  body: {
    type: "object",
    properties: {
      novel_id: { type: "string", description: "小说 ID（可选，不传则标记全部）" },
    },
  },
  response: {
    "200": { description: "操作成功", data: { type: "object", properties: { count: { type: "integer" } } } },
  },
});


