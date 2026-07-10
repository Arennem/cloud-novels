import { routeSchema } from "../swagger-helper.js";

export const voicesListSchema = routeSchema({
  description: "分页获取所有内置音色列表",
  tags: ["voice"],
  summary: "音色列表",
  querystring: {
    type: "object",
    properties: {
      pageNum: { type: "integer", default: 1, minimum: 1, description: "页码" },
      pageSize: { type: "integer", default: 10, minimum: 1, maximum: 50, description: "每页条数" },
    },
  },
  response: { "200": { description: "查询成功", data: {
    type: "object", properties: {
      voices: { type: "object", properties: { total: { type: "integer" }, list: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, gender: { type: "string" }, style: { type: "string" }, language: { type: "string" } } } }, pageNum: { type: "integer" }, pageSize: { type: "integer" } } },
    },
  } } },
});

