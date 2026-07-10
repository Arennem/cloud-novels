import { routeSchema } from "../swagger-helper.js";

export const healthCheckSchema = routeSchema({
  description: "健康检查，返回系统概览",
  tags: ["system"],
  summary: "健康检查",
  response: {
    "200": {
      description: "服务正常",
      data: {
        type: "object",
        properties: {
          novels_count: { type: "integer" },
          speakers_count: { type: "integer" },
        },
      },
    },
  },
});
