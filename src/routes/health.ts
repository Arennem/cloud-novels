import type { FastifyInstance } from "fastify";
import { routeSchema } from "../swagger-helper.js";
import { success } from "../utils/response.js";
import { novelManager } from "../services/novel_manager.js";
import { speakerManager } from "../services/speaker_manager.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", {
    schema: routeSchema({
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
    }),
  }, async () => success({
    novels_count: novelManager.listAll().length,
    speakers_count: speakerManager.listAllSpeakers().length,
  }));
}
